import pytest
from pydantic import ValidationError

from app.control.risk_engine import RiskEngine
from app.models import (
    Parameters,
    RiskState,
    RiskThresholds,
    TelemetryQuality,
    ZoneObservation,
)


def _observation(
    methane: float,
    *,
    co: float = 0.000005,
    airflow: float = 20.0,
    sample: float = 10.0,
    quality: TelemetryQuality = TelemetryQuality.GOOD,
) -> ZoneObservation:
    return ZoneObservation(
        zone_id="Z04",
        methane_fraction=methane,
        co_fraction=co,
        airflow_m3s=airflow,
        sample_seconds=sample,
        quality=quality,
        source_type="SYNTHETIC_PHYSICS",
    )


@pytest.mark.parametrize(
    ("methane", "expected"),
    [
        (0.004, RiskState.NORMAL),
        (0.005, RiskState.ADVISORY),
        (0.01, RiskState.WARNING),
        (0.015, RiskState.EMERGENCY),
    ],
)
def test_configured_methane_transitions(
    parameters: Parameters, methane: float, expected: RiskState
) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(_observation(methane), 10.0)
    assert result.state is expected


@pytest.mark.parametrize(
    ("co", "expected", "reason"),
    [
        (0.000024, RiskState.NORMAL, None),
        (0.000025, RiskState.ADVISORY, "CO_ADVISORY"),
        (0.000035, RiskState.WARNING, "CO_WARNING"),
        (0.00005, RiskState.EMERGENCY, "CO_EMERGENCY"),
    ],
)
def test_configured_co_transitions_are_demonstration_thresholds(
    parameters: Parameters, co: float, expected: RiskState, reason: str | None
) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(_observation(0.0, co=co), 10.0)
    assert result.state is expected
    assert result.co_ppm == pytest.approx(co * 1_000_000)
    if reason is not None:
        assert reason in result.reason_codes


def test_co_downgrade_uses_its_configured_hysteresis(parameters: Parameters) -> None:
    engine = RiskEngine(parameters.risk_thresholds)
    assert engine.evaluate(_observation(0.0, co=0.000036), 10.0).state is RiskState.WARNING
    held = engine.evaluate(_observation(0.0, co=0.000031, sample=11.0), 11.0)
    assert held.state is RiskState.WARNING
    assert "HYSTERESIS_HOLD" in held.reason_codes
    assert (
        engine.evaluate(_observation(0.0, co=0.000029, sample=12.0), 12.0).state
        is RiskState.ADVISORY
    )


def test_downgrade_uses_hysteresis(parameters: Parameters) -> None:
    engine = RiskEngine(parameters.risk_thresholds)
    assert engine.evaluate(_observation(0.0105), 10.0).state is RiskState.WARNING
    held = engine.evaluate(_observation(0.0095, sample=11.0), 11.0)
    assert held.state is RiskState.WARNING
    assert "HYSTERESIS_HOLD" in held.reason_codes
    assert engine.evaluate(_observation(0.0089, sample=12.0), 12.0).state is RiskState.ADVISORY


@pytest.mark.parametrize("quality", [TelemetryQuality.STALE, TelemetryQuality.INVALID])
def test_bad_quality_is_unknown_not_safe(parameters: Parameters, quality: TelemetryQuality) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(
        _observation(0.0, quality=quality), 10.0
    )
    assert result.state is RiskState.UNKNOWN_DATA
    assert result.state is not RiskState.NORMAL


def test_age_timeout_is_unknown(parameters: Parameters) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(_observation(0.0), 15.0001)
    assert result.state is RiskState.UNKNOWN_DATA
    assert result.reason_codes == ("SENSOR_STALE",)


def test_fan_failure_outweighs_stale_data(parameters: Parameters) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(
        _observation(0.0, quality=TelemetryQuality.STALE),
        20.0,
        main_fan_failed=True,
    )
    assert result.state is RiskState.EMERGENCY
    assert result.reason_codes == ("FAN_FAILED",)


def test_low_airflow_is_at_least_warning(parameters: Parameters) -> None:
    result = RiskEngine(parameters.risk_thresholds).evaluate(_observation(0.0, airflow=4.99), 10.0)
    assert result.state is RiskState.WARNING
    assert "DILUTION_AIRFLOW_LOW" in result.reason_codes


def test_transition_is_logged_with_structured_context(
    parameters: Parameters, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("INFO", logger="mineguard.risk"):
        RiskEngine(parameters.risk_thresholds).evaluate(_observation(0.011), 10.0)
    record = caplog.records[-1]
    assert record.message == "risk transition"
    assert record.zone_id == "Z04"  # type: ignore[attr-defined]
    assert record.previous_state == "NORMAL"  # type: ignore[attr-defined]
    assert record.risk_state == "WARNING"  # type: ignore[attr-defined]


def test_evaluation_cannot_precede_sample(parameters: Parameters) -> None:
    with pytest.raises(ValueError, match="precede"):
        RiskEngine(parameters.risk_thresholds).evaluate(_observation(0.0), 9.0)


def test_invalid_threshold_order_is_rejected() -> None:
    with pytest.raises(ValidationError):
        RiskThresholds(
            advisory_methane_fraction=0.01,
            warning_methane_fraction=0.005,
            emergency_methane_fraction=0.015,
            clear_hysteresis_fraction=0.001,
            advisory_co_fraction=0.000025,
            warning_co_fraction=0.000035,
            emergency_co_fraction=0.00005,
            clear_co_hysteresis_fraction=0.000005,
            minimum_airflow_m3s=5.0,
            stale_after_seconds=5.0,
        )


def test_invalid_co_threshold_order_is_rejected(parameters: Parameters) -> None:
    values = parameters.risk_thresholds.model_dump(mode="json")
    values["warning_co_fraction"] = values["advisory_co_fraction"]
    with pytest.raises(ValidationError, match="CO demonstration thresholds"):
        RiskThresholds.model_validate(values)
