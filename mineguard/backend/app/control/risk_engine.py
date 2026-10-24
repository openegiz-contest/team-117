"""Deterministic risk classification using explicit fictional thresholds."""

import logging

from app.models import (
    RiskAssessment,
    RiskState,
    RiskThresholds,
    TelemetryQuality,
    ZoneObservation,
)
from app.units import fraction_to_ppm

SEVERITY = {
    RiskState.NORMAL: 0,
    RiskState.ADVISORY: 1,
    RiskState.WARNING: 2,
    RiskState.EMERGENCY: 3,
    RiskState.UNKNOWN_DATA: 4,
}
log = logging.getLogger("mineguard.risk")


class RiskEngine:
    def __init__(self, thresholds: RiskThresholds) -> None:
        self.thresholds = thresholds
        self._previous: dict[str, RiskState] = {}

    def reset(self) -> None:
        self._previous.clear()

    def evaluate(
        self,
        observation: ZoneObservation,
        evaluated_seconds: float,
        *,
        main_fan_failed: bool = False,
    ) -> RiskAssessment:
        if evaluated_seconds < observation.sample_seconds:
            raise ValueError("Evaluation time cannot precede the sample")
        previous = self._previous.get(observation.zone_id, RiskState.NORMAL)
        reasons: list[str] = []
        if main_fan_failed:
            state = RiskState.EMERGENCY
            reasons.append("FAN_FAILED")
        elif (
            observation.quality is not TelemetryQuality.GOOD
            or evaluated_seconds - observation.sample_seconds > self.thresholds.stale_after_seconds
        ):
            state = RiskState.UNKNOWN_DATA
            reasons.append(
                "SENSOR_INVALID"
                if observation.quality is TelemetryQuality.INVALID
                else "SENSOR_STALE"
            )
        else:
            methane_state = self._gas_state(
                observation.methane_fraction,
                self.thresholds.advisory_methane_fraction,
                self.thresholds.warning_methane_fraction,
                self.thresholds.emergency_methane_fraction,
            )
            co_state = self._gas_state(
                observation.co_fraction,
                self.thresholds.advisory_co_fraction,
                self.thresholds.warning_co_fraction,
                self.thresholds.emergency_co_fraction,
            )
            state = max((methane_state, co_state), key=SEVERITY.__getitem__)
            if methane_state is not RiskState.NORMAL:
                reasons.append(f"METHANE_{methane_state.value}")
            if co_state is not RiskState.NORMAL:
                reasons.append(f"CO_{co_state.value}")
            if observation.airflow_m3s < self.thresholds.minimum_airflow_m3s:
                reasons.append("DILUTION_AIRFLOW_LOW")
                if SEVERITY[state] < SEVERITY[RiskState.WARNING]:
                    state = RiskState.WARNING
            state = self._apply_hysteresis(
                previous,
                state,
                observation.methane_fraction,
                observation.co_fraction,
                reasons,
            )
        assessment = RiskAssessment(
            zone_id=observation.zone_id,
            state=state,
            reason_codes=tuple(reasons or ["WITHIN_DEMO_CONSTRAINTS"]),
            evaluated_seconds=evaluated_seconds,
            methane_fraction=observation.methane_fraction,
            co_ppm=fraction_to_ppm(observation.co_fraction),
            airflow_m3s=observation.airflow_m3s,
            quality=observation.quality,
            source_type=observation.source_type,
            transitioned=state is not previous,
        )
        if assessment.transitioned:
            log.info(
                "risk transition",
                extra={
                    "zone_id": observation.zone_id,
                    "previous_state": previous.value,
                    "risk_state": state.value,
                    "reason_codes": assessment.reason_codes,
                    "co_ppm": assessment.co_ppm,
                    "evaluated_seconds": evaluated_seconds,
                    "source_type": observation.source_type,
                },
            )
        self._previous[observation.zone_id] = state
        return assessment

    @staticmethod
    def _gas_state(
        concentration: float, advisory: float, warning: float, emergency: float
    ) -> RiskState:
        if concentration >= emergency:
            return RiskState.EMERGENCY
        if concentration >= warning:
            return RiskState.WARNING
        if concentration >= advisory:
            return RiskState.ADVISORY
        return RiskState.NORMAL

    def _apply_hysteresis(
        self,
        previous: RiskState,
        current: RiskState,
        methane: float,
        co: float,
        reasons: list[str],
    ) -> RiskState:
        if (
            previous in {RiskState.UNKNOWN_DATA, RiskState.NORMAL}
            or SEVERITY[current] >= SEVERITY[previous]
        ):
            return current
        methane_clear_levels = {
            RiskState.ADVISORY: self.thresholds.advisory_methane_fraction,
            RiskState.WARNING: self.thresholds.warning_methane_fraction,
            RiskState.EMERGENCY: self.thresholds.emergency_methane_fraction,
        }
        co_clear_levels = {
            RiskState.ADVISORY: self.thresholds.advisory_co_fraction,
            RiskState.WARNING: self.thresholds.warning_co_fraction,
            RiskState.EMERGENCY: self.thresholds.emergency_co_fraction,
        }
        methane_held = (
            methane >= methane_clear_levels[previous] - self.thresholds.clear_hysteresis_fraction
        )
        co_held = co >= co_clear_levels[previous] - self.thresholds.clear_co_hysteresis_fraction
        if methane_held or co_held:
            reasons.append("HYSTERESIS_HOLD")
            return previous
        return current
