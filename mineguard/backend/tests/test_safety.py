import pytest

from app.control.safety import decide_simulated_safety
from app.models import (
    FanState,
    RiskAssessment,
    RiskState,
    TelemetryQuality,
)


def _assessment(state: RiskState) -> RiskAssessment:
    return RiskAssessment(
        zone_id="Z04",
        state=state,
        reason_codes=("TEST_INPUT",),
        evaluated_seconds=10.0,
        methane_fraction=0.0,
        co_ppm=5.0,
        airflow_m3s=20.0,
        quality=TelemetryQuality.GOOD,
        source_type="SYNTHETIC_PHYSICS",
        transitioned=True,
    )


def _fans(*, main_faulted: bool = False) -> tuple[FanState, ...]:
    return (
        FanState(
            fan_id="FAN_MAIN",
            requested_speed_fraction=0.75,
            actual_speed_fraction=0.0 if main_faulted else 0.75,
            actual_speed_rpm=0.0 if main_faulted else 735.0,
            faulted=main_faulted,
            power_kw=0.0 if main_faulted else 67.5,
        ),
        FanState(
            fan_id="FAN_AUX",
            requested_speed_fraction=0.5,
            actual_speed_fraction=0.5,
            actual_speed_rpm=725.0,
            faulted=False,
            power_kw=2.75,
        ),
    )


def test_normal_has_no_interlock_or_fan_request() -> None:
    result = decide_simulated_safety(_assessment(RiskState.NORMAL), _fans(), 1)
    assert not result.production_stop
    assert not result.evacuation_advisory
    assert result.optimization_enabled
    assert result.fan_requests == ()
    assert result.simulation_only


def test_emergency_outweighs_optimization_and_requests_response() -> None:
    result = decide_simulated_safety(_assessment(RiskState.EMERGENCY), _fans(), 7)
    assert result.production_stop
    assert result.evacuation_advisory
    assert result.ventilation_response
    assert not result.optimization_enabled
    assert {item.status for item in result.fan_requests} == {"PENDING"}
    assert all(item.command_id.startswith("sim-7-Z04-") for item in result.fan_requests)


def test_unknown_data_is_conservative_without_blind_fan_command() -> None:
    result = decide_simulated_safety(_assessment(RiskState.UNKNOWN_DATA), _fans(), 2)
    assert result.production_stop
    assert result.evacuation_advisory
    assert not result.optimization_enabled
    assert not result.ventilation_response
    assert result.fan_requests == ()


def test_failed_fan_is_explicitly_excluded() -> None:
    result = decide_simulated_safety(_assessment(RiskState.EMERGENCY), _fans(main_faulted=True), 3)
    main = next(item for item in result.fan_requests if item.fan_id == "FAN_MAIN")
    assert main.status == "EXCLUDED_FAULTED"
    assert "FAILED_FAN_EXCLUDED" in result.reason_codes


def test_actual_feedback_is_distinct_from_requested_command() -> None:
    result = decide_simulated_safety(_assessment(RiskState.WARNING), _fans(), 4)
    main = next(item for item in result.fan_requests if item.fan_id == "FAN_MAIN")
    assert main.requested_speed_fraction == 1.0
    assert main.actual_speed_fraction == 0.75
    assert main.status == "PENDING"


def test_negative_sequence_is_rejected() -> None:
    with pytest.raises(ValueError):
        decide_simulated_safety(_assessment(RiskState.WARNING), _fans(), -1)
