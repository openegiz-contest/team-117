"""Closed-loop model feedback and current-state safety precedence."""

import time

import pytest

from app.api.service import RuntimeService
from app.models import Parameters, RiskState, Topology
from app.simulation.runtime import Simulation


def emergency(model: Simulation) -> None:
    model.set_methane_source("Z04", 1.0)
    for _ in range(200):
        model.tick()
        if any(
            r.zone_id == "Z04" and r.state is RiskState.EMERGENCY for r in model.snapshot().risks
        ):
            return
    pytest.fail("Configured methane source did not reach emergency")


def test_emergency_response_changes_flow_and_confirms_model_feedback(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    initial = model.snapshot()
    emergency(model)
    before = model.snapshot()
    assert model.apply_emergency_response()
    after = model.snapshot()
    assert after.tick == before.tick
    assert after.zones == before.zones  # Actuation does not fabricate a lower gas reading.
    assert all(f.actual_speed_fraction == 1.0 for f in after.fans)
    assert sum(a.flow_m3s for a in after.airways) > sum(a.flow_m3s for a in before.airways)
    safety = next(s for s in after.safety if s.zone_id == "Z04")
    assert safety.production_stop and safety.evacuation_advisory
    assert not safety.optimization_enabled
    assert all(r.status == "ACHIEVED" and r.actual_speed_fraction == 1 for r in safety.fan_requests)
    assert not model.apply_emergency_response()  # Idempotent, no repeated mutation.
    model.reset()
    assert model.snapshot() == initial


def test_faulted_main_fan_stays_excluded_and_zero(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    model.set_fan("FAN_MAIN", faulted=True)
    assert model.apply_emergency_response()
    snapshot = model.snapshot()
    main = next(f for f in snapshot.fans if f.fan_id == "FAN_MAIN")
    assert main.faulted and main.actual_speed_rpm == 0
    assert all(a.flow_m3s == 0 for a in snapshot.airways)
    for decision in snapshot.safety:
        request = next(r for r in decision.fan_requests if r.fan_id == "FAN_MAIN")
        assert request.status == "EXCLUDED_FAULTED"


def test_old_vod_proposal_cannot_override_emergency(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    proposal = model.optimize_ventilation()
    emergency(model)
    model.apply_emergency_response()
    before = model.snapshot()
    with pytest.raises(ValueError, match="stale or blocked"):
        model.apply_vod_decision(proposal)
    assert model.snapshot() == before


def test_emergency_response_respects_pause_and_normal_state(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    before = model.snapshot()
    assert not model.apply_emergency_response()
    assert model.snapshot() == before
    emergency(model)
    model.pause()
    frozen = model.snapshot()
    assert not model.apply_emergency_response()
    assert model.snapshot() == frozen


def test_live_worker_applies_emergency_response(topology: Topology, parameters: Parameters) -> None:
    model = Simulation(topology, parameters.model_copy(update={"tick_seconds": 0.01}))
    model.set_fan("FAN_MAIN", faulted=True)
    service = RuntimeService(model)
    service.start()
    try:
        deadline = time.monotonic() + 2
        while not any(
            f.fan_id == "FAN_AUX" and f.actual_speed_fraction == 1 for f in service.snapshot().fans
        ):
            if time.monotonic() >= deadline:
                pytest.fail("Runtime did not apply the simulated emergency command")
            time.sleep(0.01)
        assert service.simulation_running
    finally:
        service.stop()
