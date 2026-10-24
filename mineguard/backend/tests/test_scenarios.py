import pytest

from app.config import load_scenarios
from app.models import Parameters, RiskState, ScenarioRunStatus, Topology
from app.simulation.runtime import Simulation
from app.simulation.scenarios import ScenarioEngine


def test_methane_scenario_is_deterministic_and_reset_exact(
    topology: Topology, parameters: Parameters
) -> None:
    first = Simulation(topology, parameters)
    second = Simulation(topology, parameters)
    engines = [ScenarioEngine(first, load_scenarios()), ScenarioEngine(second, load_scenarios())]
    initial = first.snapshot()
    for engine in engines:
        engine.start("S1_METHANE_LEAK")
        for _ in range(100):
            engine.simulation.tick()
            engine.after_tick()
    assert first.snapshot() == second.snapshot()
    assert engines[0].state() == engines[1].state()
    assert (
        next(zone for zone in first.snapshot().zones if zone.zone_id == "Z04").methane_fraction
        > next(zone for zone in initial.zones if zone.zone_id == "Z04").methane_fraction
    )
    assert engines[0].reset().status is ScenarioRunStatus.IDLE
    assert first.snapshot() == initial


def test_fan_failure_propagates_to_emergency_and_simulated_safety(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    engine = ScenarioEngine(simulation, load_scenarios())
    engine.start("S2_MAIN_FAN_FAILURE")
    for _ in range(20):
        simulation.tick()
        engine.after_tick()
    snapshot = simulation.snapshot()
    assert "FAN_FAILURE_APPLIED" in engine.state().applied_actions
    assert {risk.state for risk in snapshot.risks} == {RiskState.EMERGENCY}
    assert all(decision.production_stop for decision in snapshot.safety)
    assert all(decision.simulation_only for decision in snapshot.safety)


def test_methane_outburst_reaches_emergency_within_declared_duration(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    engine = ScenarioEngine(simulation, load_scenarios())
    running = engine.start("S1_METHANE_LEAK")
    emergency = None
    while simulation.snapshot().simulated_seconds < running.duration_seconds:
        simulation.tick()
        engine.after_tick()
        snapshot = simulation.snapshot()
        risk = next(item for item in snapshot.risks if item.zone_id == "Z04")
        if risk.state is RiskState.EMERGENCY:
            emergency = snapshot
            break

    assert emergency is not None
    safety = next(item for item in emergency.safety if item.zone_id == "Z04")
    assert safety.production_stop is True
    assert safety.evacuation_advisory is True
    assert safety.ventilation_response is True
    assert safety.optimization_enabled is False
    assert safety.simulation_only is True


def test_pause_and_resume_preserve_scenario_time(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    engine = ScenarioEngine(simulation, load_scenarios())
    engine.start("S1_METHANE_LEAK")
    simulation.tick()
    engine.after_tick()
    paused = engine.pause()
    assert paused.status is ScenarioRunStatus.PAUSED
    assert simulation.tick() is None
    assert engine.state().elapsed_seconds == paused.elapsed_seconds
    assert engine.resume().status is ScenarioRunStatus.RUNNING
    assert simulation.tick() is not None


@pytest.mark.parametrize("scenario_id", ["S1_METHANE_LEAK", "S2_MAIN_FAN_FAILURE"])
def test_completed_scenario_clock_stops_while_physics_continues(
    topology: Topology, parameters: Parameters, scenario_id: str
) -> None:
    simulation = Simulation(topology, parameters)
    engine = ScenarioEngine(simulation, load_scenarios())
    running = engine.start(scenario_id)
    while simulation.snapshot().simulated_seconds < running.duration_seconds:
        simulation.tick()
        engine.after_tick()

    completed = engine.state()
    completed_snapshot = simulation.snapshot()
    assert completed.status is ScenarioRunStatus.COMPLETED
    assert completed.elapsed_seconds == completed.duration_seconds
    assert not any(fan.faulted for fan in completed_snapshot.fans)

    for _ in range(10):
        assert simulation.tick() is not None
        engine.after_tick()

    continued = simulation.snapshot()
    assert engine.state() == completed
    assert continued.simulated_seconds > completed_snapshot.simulated_seconds
    assert continued.zones != completed_snapshot.zones
    assert engine.reset().elapsed_seconds == 0.0
