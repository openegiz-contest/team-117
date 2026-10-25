import json

import pytest

from app.config import load_scenarios
from app.control.vod_controller import VodController
from app.models import Parameters, RiskState, Topology, VodStatus
from app.simulation.runtime import Simulation
from app.simulation.scenarios import ScenarioEngine


def _parameters(parameters: Parameters, **vod: object) -> Parameters:
    data = parameters.model_dump(mode="json")
    data["vod"].update(vod)
    return Parameters.model_validate_json(json.dumps(data))


def test_optimizer_is_deterministic_and_constraint_first(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    first = VodController(topology, parameters).optimize(snapshot)
    second = VodController(topology, parameters).optimize(snapshot)
    assert first == second
    assert first.status is VodStatus.SELECTED
    assert first.selected is not None
    assert first.selected.feasible
    assert first.comparison is not None
    assert first.comparison.same_initial_state
    assert first.comparison.optimized_constraints_met
    assert first.comparison.horizon_seconds == parameters.vod.forecast_horizon_seconds
    assert first.selected.forecast_max_co_ppm is not None


def test_every_candidate_respects_configured_ramp(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    current = {fan.fan_id: fan.actual_speed_fraction for fan in snapshot.fans}
    decision = VodController(topology, parameters).optimize(snapshot)
    assert decision.candidates
    for candidate in decision.candidates:
        for setting in candidate.fan_speeds:
            assert (
                abs(setting.speed_fraction - current[setting.fan_id])
                <= parameters.vod.max_speed_step_fraction + 1e-12
            )


@pytest.mark.parametrize("risk", [RiskState.WARNING, RiskState.EMERGENCY, RiskState.UNKNOWN_DATA])
def test_safety_state_disables_optimization(
    topology: Topology, parameters: Parameters, risk: RiskState
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    risks = tuple(item.model_copy(update={"state": risk}) for item in snapshot.risks)
    blocked = snapshot.model_copy(update={"risks": risks})
    decision = VodController(topology, parameters).optimize(blocked)
    assert decision.status is VodStatus.DISABLED_BY_SAFETY
    assert decision.selected is None
    assert not decision.candidates


def test_fault_returns_explicit_no_feasible_result(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    snapshot = model.snapshot()
    fans = tuple(
        fan.model_copy(update={"faulted": fan.fan_id == "FAN_AUX"}) for fan in snapshot.fans
    )
    decision = VodController(topology, parameters).optimize(
        snapshot.model_copy(update={"fans": fans})
    )
    assert decision.status is VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION
    assert decision.reason_codes == ("FAN_FAULT",)


def test_impossible_airflow_constraint_rejects_every_candidate(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    data["risk_thresholds"]["minimum_airflow_m3s"] = 1000.0
    impossible = Parameters.model_validate_json(json.dumps(data))
    snapshot = Simulation(topology, parameters).snapshot()
    decision = VodController(topology, impossible).optimize(snapshot)
    assert decision.status is VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION
    assert decision.candidates
    assert all(not item.feasible for item in decision.candidates)
    assert all("FORECAST_AIRFLOW_CONSTRAINT" in item.reason_codes for item in decision.candidates)


def test_configured_co_constraint_rejects_unsafe_forecasts(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    data["risk_thresholds"].update(
        {
            "advisory_co_fraction": 0.00000025,
            "warning_co_fraction": 0.0000005,
            "emergency_co_fraction": 0.000001,
            "clear_co_hysteresis_fraction": 0.0000001,
        }
    )
    constrained = Parameters.model_validate_json(json.dumps(data))
    snapshot = Simulation(topology, parameters).snapshot()
    decision = VodController(topology, constrained).optimize(snapshot)
    assert decision.status is VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION
    assert decision.candidates
    assert all("FORECAST_CO_CONSTRAINT" in item.reason_codes for item in decision.candidates)


def test_scenario_source_changes_forecast_before_readings_cross_a_threshold(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    baseline = simulation.optimize_ventilation()
    baseline_snapshot = simulation.snapshot()
    engine = ScenarioEngine(simulation, load_scenarios())
    engine.start("S1_METHANE_LEAK")
    # The outburst source is active immediately, before any physics tick changes readings.
    assert simulation.snapshot() == baseline_snapshot
    outburst = simulation.optimize_ventilation()
    assert outburst.candidates
    for before, after in zip(baseline.candidates, outburst.candidates, strict=True):
        assert before.fan_speeds == after.fan_speeds
        assert before.forecast_max_methane_fraction is not None
        assert after.forecast_max_methane_fraction is not None
        assert after.forecast_max_methane_fraction > before.forecast_max_methane_fraction
        assert after.forecast_max_co_ppm == before.forecast_max_co_ppm
    engine.reset()
    assert simulation.optimize_ventilation() == baseline


@pytest.mark.parametrize(
    ("source_argument", "rate", "reason"),
    [
        ("methane_sources", 1.0, "FORECAST_METHANE_CONSTRAINT"),
        ("co_sources", 0.01, "FORECAST_CO_CONSTRAINT"),
    ],
)
def test_active_source_override_rejects_infeasible_forecasts(
    topology: Topology,
    parameters: Parameters,
    source_argument: str,
    rate: float,
    reason: str,
) -> None:
    sources = {zone.id: rate if zone.id == "Z04" else 0.0 for zone in topology.zones}
    snapshot = Simulation(topology, parameters).snapshot()
    decision = VodController(topology, parameters).optimize(snapshot, **{source_argument: sources})
    assert decision.status is VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION
    assert decision.candidates
    assert all(reason in item.reason_codes for item in decision.candidates)


def test_comparison_uses_energy_without_switching_penalty(
    topology: Topology, parameters: Parameters
) -> None:
    decision = VodController(topology, parameters).optimize(
        Simulation(topology, parameters).snapshot()
    )
    assert decision.selected is not None
    assert decision.comparison is not None
    assert decision.selected.fan_energy_kwh == decision.comparison.optimized_energy_kwh
    assert decision.comparison.baseline_energy_kwh > 0
    assert decision.comparison.absolute_savings_kwh == pytest.approx(
        decision.comparison.baseline_energy_kwh - decision.comparison.optimized_energy_kwh
    )


def test_runtime_applies_selected_command_atomically(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    decision = model.optimize_ventilation()
    before_tick = model.snapshot().tick
    feedback = model.apply_vod_decision(decision)
    assert feedback.command_status == "APPLIED"
    assert model.snapshot().tick == before_tick
    assert decision.selected is not None
    commanded = {item.fan_id: item.speed_fraction for item in decision.selected.fan_speeds}
    assert {fan.fan_id: fan.requested_speed_fraction for fan in model.snapshot().fans} == commanded
    # The drives reach the new setting through the configured ramp (at most 0.2 at 5 %/s).
    for _ in range(8):
        model.tick()
    assert {fan.fan_id: fan.actual_speed_fraction for fan in model.snapshot().fans} == commanded


def test_runtime_rejects_non_selected_decision_without_mutation(
    topology: Topology, parameters: Parameters
) -> None:
    model = Simulation(topology, parameters)
    model.set_fan("FAN_MAIN", faulted=True)
    before = model.snapshot()
    decision = model.optimize_ventilation()
    with pytest.raises(ValueError, match="proposed selected"):
        model.apply_vod_decision(decision)
    assert model.snapshot() == before


def test_unsorted_candidate_configuration_is_rejected(parameters: Parameters) -> None:
    with pytest.raises(ValueError, match="sorted and unique"):
        _parameters(parameters, candidate_speed_fractions=[0.7, 0.5])
