"""Validated immutable configuration contracts; gas physics uses volume fractions."""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Positive = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Fraction = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Ppm = Annotated[float, Field(ge=0, le=1_000_000, allow_inf_nan=False)]
Identifier = Annotated[str, Field(min_length=1, max_length=100)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, allow_inf_nan=False)


class Zone(Model):
    id: Identifier
    name: Identifier
    role: Literal["intake", "distribution", "heading", "production", "return", "exhaust"]
    volume_m3: Positive
    depth_m: Nonnegative
    x: float
    y: float


class Airway(Model):
    id: Identifier
    source: Identifier = Field(alias="from")
    target: Identifier = Field(alias="to")
    length_m: Positive
    resistance_pa_s2_m6: Positive
    flow_m3s: Nonnegative
    status: Literal["OPEN", "CLOSED"] = "OPEN"


class Boundary(Model):
    zone_id: Identifier
    kind: Literal["INLET", "EXHAUST"]
    flow_m3s: Nonnegative
    methane_fraction: Fraction | None = None
    co_fraction: Fraction | None = None

    @model_validator(mode="after")
    def check_concentration(self) -> Self:
        inlet = self.kind == "INLET"
        if inlet != (self.methane_fraction is not None) or inlet != (self.co_fraction is not None):
            raise ValueError("Only INLET boundaries require methane and CO fractions")
        return self


class Fan(Model):
    id: Identifier
    zone_id: Identifier
    airway_ids: tuple[Identifier, ...] = Field(min_length=1)
    rated_power_kw: Positive
    rated_speed_rpm: Positive
    shutoff_pressure_pa: Positive
    curve_resistance_pa_s2_m6: Positive
    efficiency: Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]


class Sensor(Model):
    id: Identifier
    zone_id: Identifier
    quantity: Literal["methane", "co", "airflow", "temperature", "pressure"]
    unit: Literal["percent_volume", "ppm", "m3/s", "degC", "Pa"]

    @model_validator(mode="after")
    def check_unit(self) -> Self:
        units = {
            "methane": "percent_volume",
            "co": "ppm",
            "airflow": "m3/s",
            "temperature": "degC",
            "pressure": "Pa",
        }
        if self.unit != units[self.quantity]:
            raise ValueError("Sensor unit does not match its quantity")
        return self


class Topology(Model):
    schema_version: Literal[1]
    mine_id: Literal["mineguard:mine-01"]
    simulation_only: Literal[True]
    assumption_source: Annotated[str, Field(min_length=20)]
    zones: tuple[Zone, ...] = Field(min_length=6, max_length=6)
    airways: tuple[Airway, ...] = Field(min_length=1)
    fans: tuple[Fan, ...] = Field(min_length=2, max_length=2)
    sensors: tuple[Sensor, ...] = Field(min_length=12)
    boundaries: tuple[Boundary, ...] = Field(min_length=2)


class InitialZone(Model):
    zone_id: Identifier
    methane_fraction: Fraction
    methane_source_m3s: Nonnegative
    co_fraction: Fraction
    co_source_m3s: Nonnegative


class InitialFan(Model):
    fan_id: Identifier
    speed_fraction: Fraction
    faulted: bool = False


class RiskThresholds(Model):
    advisory_methane_fraction: Fraction
    warning_methane_fraction: Fraction
    emergency_methane_fraction: Fraction
    clear_hysteresis_fraction: Fraction
    advisory_co_fraction: Fraction
    warning_co_fraction: Fraction
    emergency_co_fraction: Fraction
    clear_co_hysteresis_fraction: Fraction
    minimum_airflow_m3s: Nonnegative
    stale_after_seconds: Positive

    @model_validator(mode="after")
    def check_order(self) -> Self:
        methane_levels = (
            self.advisory_methane_fraction,
            self.warning_methane_fraction,
            self.emergency_methane_fraction,
        )
        co_levels = (
            self.advisory_co_fraction,
            self.warning_co_fraction,
            self.emergency_co_fraction,
        )
        if not methane_levels[0] < methane_levels[1] < methane_levels[2]:
            raise ValueError("Methane demonstration thresholds must increase")
        if self.clear_hysteresis_fraction >= min(
            methane_levels[0],
            methane_levels[1] - methane_levels[0],
            methane_levels[2] - methane_levels[1],
        ):
            raise ValueError("Methane hysteresis must be smaller than every threshold gap")
        if not co_levels[0] < co_levels[1] < co_levels[2]:
            raise ValueError("CO demonstration thresholds must increase")
        if self.clear_co_hysteresis_fraction >= min(
            co_levels[0], co_levels[1] - co_levels[0], co_levels[2] - co_levels[1]
        ):
            raise ValueError("CO hysteresis must be smaller than every threshold gap")
        return self


class VodParameters(Model):
    """Constraint-first settings for the simulation-only VOD search."""

    candidate_speed_fractions: tuple[Fraction, ...] = Field(min_length=2)
    max_speed_step_fraction: Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]
    forecast_horizon_seconds: Positive
    switching_penalty_kwh_per_fraction: Nonnegative

    @model_validator(mode="after")
    def check_candidates(self) -> Self:
        if tuple(sorted(set(self.candidate_speed_fractions))) != self.candidate_speed_fractions:
            raise ValueError("VOD candidate speeds must be sorted and unique")
        return self


class Parameters(Model):
    schema_version: Literal[1]
    simulation_only: Literal[True]
    source_type: Literal["SYNTHETIC_PHYSICS"]
    assumption_source: Annotated[str, Field(min_length=20)]
    tick_seconds: Annotated[float, Field(gt=0, le=60)]
    cfl_limit: Annotated[float, Field(gt=0, le=1)]
    max_substeps: Annotated[int, Field(ge=1, le=100000)]
    initial_zones: tuple[InitialZone, ...] = Field(min_length=6, max_length=6)
    initial_fans: tuple[InitialFan, ...] = Field(min_length=2, max_length=2)
    risk_thresholds: RiskThresholds
    vod: VodParameters


class GasFlow(Model):
    """A directed mixture flow. None denotes the external atmosphere."""

    source: Identifier | None
    target: Identifier | None
    flow_m3s: Nonnegative
    inlet_fraction: Fraction = 0.0

    @model_validator(mode="after")
    def check_endpoints(self) -> Self:
        if self.source == self.target:
            raise ValueError("Flow must connect distinct endpoints")
        if self.source is not None and self.inlet_fraction != 0:
            raise ValueError("Only an external inlet can specify inlet_fraction")
        return self


class ZoneConcentration(Model):
    zone_id: Identifier
    methane_fraction: Fraction
    co_ppm: Ppm


class AirwayFlow(Model):
    airway_id: Identifier
    flow_m3s: Nonnegative


class FanState(Model):
    fan_id: Identifier
    requested_speed_fraction: Fraction
    actual_speed_fraction: Fraction
    actual_speed_rpm: Nonnegative
    faulted: bool
    power_kw: Nonnegative


class TelemetryQuality(StrEnum):
    GOOD = "GOOD"
    STALE = "STALE"
    INVALID = "INVALID"


class RiskState(StrEnum):
    NORMAL = "NORMAL"
    ADVISORY = "ADVISORY"
    WARNING = "WARNING"
    EMERGENCY = "EMERGENCY"
    UNKNOWN_DATA = "UNKNOWN_DATA"


class ZoneObservation(Model):
    zone_id: Identifier
    methane_fraction: Fraction
    co_fraction: Fraction
    airflow_m3s: Nonnegative
    sample_seconds: Nonnegative
    quality: TelemetryQuality
    source_type: Literal["SYNTHETIC_PHYSICS"]


class RiskAssessment(Model):
    zone_id: Identifier
    state: RiskState
    reason_codes: tuple[Identifier, ...]
    evaluated_seconds: Nonnegative
    methane_fraction: Fraction
    co_ppm: Ppm
    airflow_m3s: Nonnegative
    quality: TelemetryQuality
    source_type: Literal["SYNTHETIC_PHYSICS"]
    transitioned: bool


class SimulatedFanRequest(Model):
    fan_id: Identifier
    command_id: Identifier
    requested_speed_fraction: Fraction
    actual_speed_fraction: Fraction
    status: Literal["PENDING", "ACHIEVED", "EXCLUDED_FAULTED"]


class SimulatedSafetyDecision(Model):
    zone_id: Identifier
    risk_state: RiskState
    production_stop: bool
    evacuation_advisory: bool
    ventilation_response: bool
    optimization_enabled: bool
    simulation_only: Literal[True] = True
    reason_codes: tuple[Identifier, ...]
    fan_requests: tuple[SimulatedFanRequest, ...]


class FanSpeedSetting(Model):
    fan_id: Identifier
    speed_fraction: Fraction


class VodStatus(StrEnum):
    SELECTED = "SELECTED"
    DISABLED_BY_SAFETY = "DISABLED_BY_SAFETY"
    NO_FEASIBLE_SAFE_OPTIMIZATION = "NO_FEASIBLE_SAFE_OPTIMIZATION"


class VodCandidate(Model):
    fan_speeds: tuple[FanSpeedSetting, ...]
    feasible: bool
    reason_codes: tuple[Identifier, ...]
    forecast_max_methane_fraction: Fraction | None
    forecast_max_co_ppm: Ppm | None
    forecast_min_airflow_m3s: Nonnegative | None
    fan_energy_kwh: Nonnegative | None
    switching_penalty_kwh: Nonnegative | None
    objective_kwh: Nonnegative | None


class EnergyComparison(Model):
    horizon_seconds: Positive
    baseline_energy_kwh: Nonnegative
    optimized_energy_kwh: Nonnegative
    absolute_savings_kwh: float
    savings_percent: float | None
    baseline_constraints_met: bool
    optimized_constraints_met: bool
    same_initial_state: Literal[True] = True
    source_type: Literal["SYNTHETIC_PHYSICS"] = "SYNTHETIC_PHYSICS"


class VodDecision(Model):
    status: VodStatus
    command_status: Literal["NOT_ISSUED", "PROPOSED", "APPLIED"]
    simulation_only: Literal[True] = True
    reason_codes: tuple[Identifier, ...]
    selected: VodCandidate | None
    candidates: tuple[VodCandidate, ...]
    comparison: EnergyComparison | None


class ScenarioDefinition(Model):
    id: Identifier
    name: Identifier
    description: Annotated[str, Field(min_length=20)]
    duration_seconds: Positive
    methane_source_zone_id: Identifier | None = None
    methane_source_m3s: Nonnegative | None = None
    fan_failure_id: Identifier | None = None
    fan_failure_at_seconds: Nonnegative | None = None

    @model_validator(mode="after")
    def check_action(self) -> Self:
        methane = self.methane_source_zone_id is not None or self.methane_source_m3s is not None
        fan = self.fan_failure_id is not None or self.fan_failure_at_seconds is not None
        if methane and (self.methane_source_zone_id is None or self.methane_source_m3s is None):
            raise ValueError("Methane scenario requires zone and source rate")
        if fan and (self.fan_failure_id is None or self.fan_failure_at_seconds is None):
            raise ValueError("Fan scenario requires fan and failure time")
        if methane == fan:
            raise ValueError("Scenario must define exactly one supported action")
        if (
            self.fan_failure_at_seconds is not None
            and self.fan_failure_at_seconds >= self.duration_seconds
        ):
            raise ValueError("Fan failure must occur before scenario completion")
        return self


class ScenarioRunStatus(StrEnum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"


class ScenarioState(Model):
    scenario_id: Identifier | None
    status: ScenarioRunStatus
    elapsed_seconds: Nonnegative
    duration_seconds: Nonnegative
    simulation_only: Literal[True] = True
    applied_actions: tuple[Identifier, ...]


class SimulationSnapshot(Model):
    tick: Annotated[int, Field(ge=0)]
    simulated_seconds: Nonnegative
    paused: bool
    source_type: Literal["SYNTHETIC_PHYSICS"] = "SYNTHETIC_PHYSICS"
    publication_status: Literal["LOCAL_MODEL_SNAPSHOT", "ECLIPSE_DITTO_READBACK"] = (
        "LOCAL_MODEL_SNAPSHOT"
    )
    simulation_only: Literal[True] = True
    zones: tuple[ZoneConcentration, ...]
    airways: tuple[AirwayFlow, ...]
    fans: tuple[FanState, ...]
    risks: tuple[RiskAssessment, ...] = ()
    safety: tuple[SimulatedSafetyDecision, ...] = ()
