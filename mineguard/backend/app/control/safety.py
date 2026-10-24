"""Simulation-only safety decisions; this module has no equipment I/O."""

from typing import Literal

from app.models import (
    FanState,
    RiskAssessment,
    RiskState,
    SimulatedFanRequest,
    SimulatedSafetyDecision,
)


def decide_simulated_safety(
    assessment: RiskAssessment, fans: tuple[FanState, ...], sequence: int
) -> SimulatedSafetyDecision:
    if sequence < 0:
        raise ValueError("Safety decision sequence must be nonnegative")
    state = assessment.state
    production_stop = state in {RiskState.WARNING, RiskState.EMERGENCY, RiskState.UNKNOWN_DATA}
    evacuation = state in {RiskState.EMERGENCY, RiskState.UNKNOWN_DATA}
    ventilation = state in {RiskState.ADVISORY, RiskState.WARNING, RiskState.EMERGENCY}
    optimization = state in {RiskState.NORMAL, RiskState.ADVISORY}
    requests: list[SimulatedFanRequest] = []
    if ventilation:
        for fan in fans:
            command_id = f"sim-{sequence}-{assessment.zone_id}-{fan.fan_id}"
            requested = 1.0
            status: Literal["PENDING", "ACHIEVED", "EXCLUDED_FAULTED"]
            if fan.faulted:
                status = "EXCLUDED_FAULTED"
            elif fan.actual_speed_fraction == requested:
                status = "ACHIEVED"
            else:
                status = "PENDING"
            requests.append(
                SimulatedFanRequest(
                    fan_id=fan.fan_id,
                    command_id=command_id,
                    requested_speed_fraction=requested,
                    actual_speed_fraction=fan.actual_speed_fraction,
                    status=status,
                )
            )
    reasons = list(assessment.reason_codes)
    if any(item.status == "EXCLUDED_FAULTED" for item in requests):
        reasons.append("FAILED_FAN_EXCLUDED")
    return SimulatedSafetyDecision(
        zone_id=assessment.zone_id,
        risk_state=state,
        production_stop=production_stop,
        evacuation_advisory=evacuation,
        ventilation_response=ventilation,
        optimization_enabled=optimization,
        reason_codes=tuple(reasons),
        fan_requests=tuple(requests),
    )
