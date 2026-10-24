import json
from math import fsum

import pytest

from app.models import Parameters, Topology
from app.simulation.clock import SimulationClock
from app.simulation.runtime import Simulation


def test_identical_inputs_produce_identical_trajectories(
    topology: Topology, parameters: Parameters
) -> None:
    first, second = Simulation(topology, parameters), Simulation(topology, parameters)
    for _ in range(200):
        assert first.tick() == second.tick()
        assert first.snapshot() == second.snapshot()
    assert first.snapshot().simulated_seconds == 100.0
    assert first.snapshot().publication_status == "LOCAL_MODEL_SNAPSHOT"


def test_pause_resume_and_reset(topology: Topology, parameters: Parameters) -> None:
    model = Simulation(topology, parameters)
    initial = model.snapshot()
    model.tick()
    first_tick = model.snapshot()
    model.pause()
    paused = model.snapshot()
    assert model.tick() is None
    assert model.snapshot() == paused
    model.resume()
    model.tick()
    assert model.snapshot().tick == 2
    model.reset()
    assert model.snapshot() == initial
    model.tick()
    assert model.snapshot() == first_tick


def test_failed_step_does_not_advance_state_or_time(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    data["initial_zones"][3]["methane_source_m3s"] = 1_000_000.0
    model = Simulation(topology, Parameters.model_validate_json(json.dumps(data)))
    initial = model.snapshot()
    with pytest.raises(ValueError):
        model.tick()
    assert model.snapshot() == initial


def test_returned_calculation_cannot_mutate_runtime(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    result = model.tick()
    assert result is not None
    snapshot = model.snapshot()
    result.fractions["Z04"] = 1.0
    assert model.snapshot() == snapshot


def test_full_mine_cumulative_boundary_balance(topology: Topology, parameters: Parameters) -> None:
    model = Simulation(topology, parameters)
    results = [model.tick() for _ in range(1000)]
    valid = [r for r in results if r is not None]
    expected_change = fsum(r.source_added_m3 + r.inlet_added_m3 - r.exhausted_m3 for r in valid)
    observed_change = valid[-1].methane_after_m3 - valid[0].methane_before_m3
    assert observed_change == pytest.approx(expected_change, abs=1e-10)
    assert max(abs(r.balance_residual_m3) for r in valid) < 1e-10


def test_clock_uses_tick_count_without_cumulative_float_drift() -> None:
    clock = SimulationClock(0.1)
    for _ in range(10):
        clock = clock.advance()
    assert clock.elapsed_seconds == 1.0


def test_fan_command_is_atomic_and_changes_airflow(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    initial = model.snapshot()
    initial_flow = model.airflow.total_flow_m3s
    model.set_fan("FAN_MAIN", speed_fraction=0.6)
    assert model.airflow.total_flow_m3s < initial_flow
    assert model.snapshot().tick == initial.tick
    before_invalid = model.snapshot()
    with pytest.raises(ValueError):
        model.set_fan("FAN_MAIN", speed_fraction=2.0)
    assert model.snapshot() == before_invalid


def test_simulated_fan_failure_is_visible_and_reversible(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    model.set_fan("FAN_MAIN", faulted=True)
    failed = model.snapshot()
    main = next(fan for fan in failed.fans if fan.fan_id == "FAN_MAIN")
    assert main.faulted
    assert main.actual_speed_fraction == 0
    assert main.actual_speed_rpm == 0
    assert set(airway.flow_m3s for airway in failed.airways) == {0.0}
    assert {risk.state.value for risk in failed.risks} == {"EMERGENCY"}
    assert all(action.simulation_only for action in failed.safety)
    assert all(not action.optimization_enabled for action in failed.safety)
    model.set_fan("FAN_MAIN", faulted=False)
    assert model.airflow.total_flow_m3s > 0


def test_snapshot_exposes_deterministic_co_ppm_and_scaled_fan_rpm(
    topology: Topology, parameters: Parameters
) -> None:
    first, second = Simulation(topology, parameters), Simulation(topology, parameters)
    for _ in range(20):
        first.tick()
        second.tick()
    assert first.snapshot() == second.snapshot()
    snapshot = first.snapshot()
    assert all(0 <= zone.co_ppm <= 1_000_000 for zone in snapshot.zones)
    assert first.last_co_step is not None
    assert abs(first.last_co_step.balance_residual_m3) < 1e-10
    fan_config = {fan.id: fan for fan in topology.fans}
    for fan in snapshot.fans:
        assert fan.actual_speed_rpm == pytest.approx(
            fan_config[fan.fan_id].rated_speed_rpm * fan.actual_speed_fraction
        )


def test_co_source_is_transport_driven_and_resettable(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    for zone in data["initial_zones"]:
        zone["co_fraction"] = 0.000002
        zone["co_source_m3s"] = 0.001 if zone["zone_id"] == "Z04" else 0.0
    configured = Parameters.model_validate_json(json.dumps(data))
    model = Simulation(topology, configured)
    initial = model.snapshot()
    for _ in range(20):
        model.tick()
    before = next(zone.co_ppm for zone in initial.zones if zone.zone_id == "Z04")
    after = next(zone.co_ppm for zone in model.snapshot().zones if zone.zone_id == "Z04")
    assert after > before
    model.reset()
    assert model.snapshot() == initial


def test_obstruction_update_is_atomic(topology: Topology, parameters: Parameters) -> None:
    model = Simulation(topology, parameters)
    initial = model.snapshot()
    model.set_obstruction("E03", 3.0)
    assert model.snapshot().airways != initial.airways
    obstructed = model.snapshot()
    with pytest.raises(ValueError):
        model.set_obstruction("E03", 0.5)
    assert model.snapshot() == obstructed
