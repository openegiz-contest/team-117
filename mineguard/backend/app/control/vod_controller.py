"""Constraint-first ventilation-on-demand for the deterministic mine model."""

import json
from collections.abc import Mapping
from itertools import product
from math import fsum

from app.models import (
    EnergyComparison,
    FanSpeedSetting,
    Parameters,
    RiskState,
    SimulationSnapshot,
    Topology,
    VodCandidate,
    VodDecision,
    VodStatus,
)
from app.physics.airflow import AirflowResult, gas_flows_from_airflow, solve_airflow
from app.physics.fan_model import energy_kwh
from app.physics.gas_transport import advance_gas
from app.units import fraction_to_ppm, ppm_to_fraction

_BLOCKING_RISKS = {RiskState.WARNING, RiskState.EMERGENCY, RiskState.UNKNOWN_DATA}


class VodController:
    """Enumerate bounded fan settings and select the least-energy feasible option.

    This controller returns a simulated decision. It never writes to an actuator.
    All candidates use the same snapshot, sources, model and forecast horizon.
    """

    def __init__(self, topology: Topology, parameters: Parameters) -> None:
        self.topology = topology
        self.parameters = parameters
        self._volumes = {zone.id: zone.volume_m3 for zone in topology.zones}
        self._sources = {zone.zone_id: zone.methane_source_m3s for zone in parameters.initial_zones}
        self._co_sources = {zone.zone_id: zone.co_source_m3s for zone in parameters.initial_zones}

    def optimize(
        self,
        snapshot: SimulationSnapshot,
        *,
        obstruction_factors: Mapping[str, float] | None = None,
        methane_sources: Mapping[str, float] | None = None,
        co_sources: Mapping[str, float] | None = None,
    ) -> VodDecision:
        if any(risk.state in _BLOCKING_RISKS for risk in snapshot.risks) or any(
            not decision.optimization_enabled for decision in snapshot.safety
        ):
            return VodDecision(
                status=VodStatus.DISABLED_BY_SAFETY,
                command_status="NOT_ISSUED",
                reason_codes=("SAFETY_STATE_BLOCKS_OPTIMIZATION",),
                selected=None,
                candidates=(),
                comparison=None,
            )

        current = {fan.fan_id: fan.actual_speed_fraction for fan in snapshot.fans}
        faults = {fan.fan_id: fan.faulted for fan in snapshot.fans}
        if any(faults.values()):
            return VodDecision(
                status=VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION,
                command_status="NOT_ISSUED",
                reason_codes=("FAN_FAULT",),
                selected=None,
                candidates=(),
                comparison=None,
            )
        fractions = {zone.zone_id: zone.methane_fraction for zone in snapshot.zones}
        co_fractions = {zone.zone_id: ppm_to_fraction(zone.co_ppm) for zone in snapshot.zones}
        active_methane_sources = self._sources if methane_sources is None else methane_sources
        active_co_sources = self._co_sources if co_sources is None else co_sources
        candidates = tuple(
            self._evaluate_candidate(
                speeds,
                current,
                faults,
                fractions,
                co_fractions,
                active_methane_sources,
                active_co_sources,
                obstruction_factors,
            )
            for speeds in self._candidate_settings(current)
        )
        feasible = [candidate for candidate in candidates if candidate.feasible]
        if not feasible:
            return VodDecision(
                status=VodStatus.NO_FEASIBLE_SAFE_OPTIMIZATION,
                command_status="NOT_ISSUED",
                reason_codes=("NO_FEASIBLE_SAFE_OPTIMIZATION",),
                selected=None,
                candidates=candidates,
                comparison=None,
            )
        selected = min(
            feasible,
            key=lambda candidate: (
                candidate.objective_kwh if candidate.objective_kwh is not None else float("inf"),
                tuple(item.speed_fraction for item in candidate.fan_speeds),
            ),
        )
        baseline = self._evaluate_candidate(
            current,
            current,
            faults,
            fractions,
            co_fractions,
            active_methane_sources,
            active_co_sources,
            obstruction_factors,
        )
        comparison = self._compare(baseline, selected)
        return VodDecision(
            status=VodStatus.SELECTED,
            command_status="PROPOSED",
            reason_codes=("LOWEST_FEASIBLE_ENERGY",),
            selected=selected,
            candidates=candidates,
            comparison=comparison,
        )

    def _candidate_settings(self, current: Mapping[str, float]) -> tuple[dict[str, float], ...]:
        fan_ids = tuple(sorted(current))
        maximum_step = self.parameters.vod.max_speed_step_fraction
        choices = [
            tuple(
                speed
                for speed in self.parameters.vod.candidate_speed_fractions
                if abs(speed - current[fan_id]) <= maximum_step + 1e-12
            )
            for fan_id in fan_ids
        ]
        return tuple(dict(zip(fan_ids, values, strict=True)) for values in product(*choices))

    def _evaluate_candidate(
        self,
        speeds: Mapping[str, float],
        current: Mapping[str, float],
        faults: Mapping[str, bool],
        fractions: Mapping[str, float],
        co_fractions: Mapping[str, float],
        methane_sources: Mapping[str, float],
        co_sources: Mapping[str, float],
        obstruction_factors: Mapping[str, float] | None,
    ) -> VodCandidate:
        settings = tuple(
            FanSpeedSetting(fan_id=fan_id, speed_fraction=speed)
            for fan_id, speed in sorted(speeds.items())
        )
        try:
            airflow = solve_airflow(self.topology, speeds, faults, obstruction_factors)
            gas = advance_gas(
                self._volumes,
                fractions,
                gas_flows_from_airflow(self.topology, airflow),
                methane_sources,
                self.parameters.vod.forecast_horizon_seconds,
                cfl_limit=self.parameters.cfl_limit,
                max_substeps=self.parameters.max_substeps,
            )
            co = advance_gas(
                self._volumes,
                co_fractions,
                gas_flows_from_airflow(self.topology, airflow, tracer="co"),
                co_sources,
                self.parameters.vod.forecast_horizon_seconds,
                cfl_limit=self.parameters.cfl_limit,
                max_substeps=self.parameters.max_substeps,
            )
        except (ValueError, RuntimeError):
            return VodCandidate(
                fan_speeds=settings,
                feasible=False,
                reason_codes=("MODEL_SOLUTION_FAILED",),
                forecast_max_methane_fraction=None,
                forecast_max_co_ppm=None,
                forecast_min_airflow_m3s=None,
                fan_energy_kwh=None,
                switching_penalty_kwh=None,
                objective_kwh=None,
            )
        max_methane = max(gas.fractions.values())
        max_co = max(co.fractions.values())
        min_airflow = min(self._zone_airflow(airflow, zone.id) for zone in self.topology.zones)
        reasons: list[str] = []
        if max_methane >= self.parameters.risk_thresholds.warning_methane_fraction:
            reasons.append("FORECAST_METHANE_CONSTRAINT")
        if max_co >= self.parameters.risk_thresholds.warning_co_fraction:
            reasons.append("FORECAST_CO_CONSTRAINT")
        if min_airflow < self.parameters.risk_thresholds.minimum_airflow_m3s:
            reasons.append("FORECAST_AIRFLOW_CONSTRAINT")
        duration = self.parameters.vod.forecast_horizon_seconds
        fan_energy = fsum(
            energy_kwh(point.power_kw, duration) for point in airflow.fan_points.values()
        )
        switching = self.parameters.vod.switching_penalty_kwh_per_fraction * fsum(
            abs(speeds[fan_id] - current[fan_id]) for fan_id in current
        )
        return VodCandidate(
            fan_speeds=settings,
            feasible=not reasons,
            reason_codes=tuple(reasons or ["FORECAST_CONSTRAINTS_MET"]),
            forecast_max_methane_fraction=max_methane,
            forecast_max_co_ppm=fraction_to_ppm(max_co),
            forecast_min_airflow_m3s=min_airflow,
            fan_energy_kwh=fan_energy,
            switching_penalty_kwh=switching,
            objective_kwh=fan_energy + switching,
        )

    def _zone_airflow(self, airflow: AirflowResult, zone_id: str) -> float:
        incoming = fsum(
            airflow.airway_flows_m3s[edge.id]
            for edge in self.topology.airways
            if edge.target == zone_id
        )
        outgoing = fsum(
            airflow.airway_flows_m3s[edge.id]
            for edge in self.topology.airways
            if edge.source == zone_id
        )
        return max(incoming, outgoing)

    def _compare(self, baseline: VodCandidate, selected: VodCandidate) -> EnergyComparison:
        baseline_energy = baseline.fan_energy_kwh or 0.0
        optimized_energy = selected.fan_energy_kwh or 0.0
        absolute = baseline_energy - optimized_energy
        percent = 100.0 * absolute / baseline_energy if baseline_energy > 0 else None
        return EnergyComparison(
            horizon_seconds=self.parameters.vod.forecast_horizon_seconds,
            baseline_energy_kwh=baseline_energy,
            optimized_energy_kwh=optimized_energy,
            absolute_savings_kwh=absolute,
            savings_percent=percent,
            baseline_constraints_met=baseline.feasible,
            optimized_constraints_met=selected.feasible,
        )


def main() -> None:
    """Print one reproducible decision for the versioned initial condition."""
    from app.config import load_configuration
    from app.simulation.runtime import Simulation

    simulation = Simulation(*load_configuration())
    decision = simulation.optimize_ventilation()
    print(json.dumps(decision.model_dump(mode="json"), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
