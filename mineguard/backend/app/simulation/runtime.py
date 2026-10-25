"""Deterministic simulation kernel with coupled M2 airflow and gas transport."""

import argparse
import json
from math import isfinite
from pathlib import Path

from app.config import DATA_DIRECTORY, load_configuration, validate_parameters
from app.control.risk_engine import RiskEngine
from app.control.safety import decide_simulated_safety
from app.control.vod_controller import VodController
from app.models import (
    AirwayFlow,
    FanState,
    Parameters,
    ProductionState,
    RiskState,
    SimulationSnapshot,
    TelemetryQuality,
    Topology,
    VodDecision,
    VodStatus,
    ZoneConcentration,
    ZoneObservation,
)
from app.physics.airflow import AirflowResult, gas_flows_from_airflow, solve_airflow
from app.physics.fan_model import fan_speed_rpm
from app.physics.gas_transport import GasStepResult, advance_gas
from app.simulation.clock import SimulationClock
from app.topology import validate_topology
from app.units import fraction_to_percent, fraction_to_ppm


class Simulation:
    def __init__(self, topology: Topology, parameters: Parameters) -> None:
        self.topology = validate_topology(topology)
        self.parameters = validate_parameters(topology, parameters)
        self._volumes = {zone.id: zone.volume_m3 for zone in topology.zones}
        self._initial_sources = {
            item.zone_id: item.methane_source_m3s for item in parameters.initial_zones
        }
        self._initial = {item.zone_id: item.methane_fraction for item in parameters.initial_zones}
        self._initial_co_sources = {
            item.zone_id: item.co_source_m3s for item in parameters.initial_zones
        }
        self._initial_co = {item.zone_id: item.co_fraction for item in parameters.initial_zones}
        self._fans = {fan.id: fan for fan in topology.fans}
        self._initial_fans = {
            item.fan_id: (item.speed_fraction, item.faulted) for item in parameters.initial_fans
        }
        self._risk_engine = RiskEngine(parameters.risk_thresholds)
        self._vod_controller = VodController(topology, parameters)
        self.reset()

    def reset(self) -> None:
        self._fractions = self._initial.copy()
        self._sources = self._initial_sources.copy()
        self._co_fractions = self._initial_co.copy()
        self._co_sources = self._initial_co_sources.copy()
        self._last_co_step: GasStepResult | None = None
        self._fan_speeds = {fan_id: setting[0] for fan_id, setting in self._initial_fans.items()}
        # Commanded speeds; the actual speed ramps toward them each tick.
        self._fan_targets = self._fan_speeds.copy()
        self._fan_faults = {fan_id: setting[1] for fan_id, setting in self._initial_fans.items()}
        self._production_running = True
        self._obstructions: dict[str, float] = {}
        # Zones whose gas sensors stopped reporting: last received CH4/CO fraction and time.
        self._offline: dict[str, tuple[float, float, float]] = {}
        self._airflow = solve_airflow(
            self.topology, self._fan_speeds, self._fan_faults, self._obstructions
        )
        self._clock = SimulationClock(self.parameters.tick_seconds)
        self._paused = False
        self._risk_engine.reset()
        self._refresh_controls()

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    @property
    def airflow(self) -> AirflowResult:
        return self._airflow

    @property
    def last_co_step(self) -> GasStepResult | None:
        """Last conservative CO transport result, or ``None`` before the first tick."""
        return self._last_co_step

    def set_fan(
        self, fan_id: str, *, speed_fraction: float | None = None, faulted: bool | None = None
    ) -> None:
        """Apply a simulated fan command only after a valid airflow solution exists."""
        if fan_id not in self._fan_speeds:
            raise ValueError(f"Unknown fan: {fan_id}")
        speeds = self._fan_speeds.copy()
        faults = self._fan_faults.copy()
        if speed_fraction is not None:
            speeds[fan_id] = speed_fraction
        if faulted is not None:
            faults[fan_id] = faulted
        airflow = solve_airflow(self.topology, speeds, faults, self._obstructions)
        self._fan_speeds, self._fan_faults, self._airflow = speeds, faults, airflow
        self._fan_targets[fan_id] = speeds[fan_id]
        self._refresh_controls()

    def _command_fans(self, targets: dict[str, float]) -> None:
        """Record commanded speeds; tick() ramps the actual speed toward them."""
        if set(targets) != set(self._fan_speeds):
            raise ValueError("A fan command must specify every configured fan exactly once")
        for fan_id, target in targets.items():
            if isinstance(target, bool) or not isfinite(target) or not 0 <= target <= 1:
                raise ValueError(f"Invalid commanded speed for {fan_id}")
        self._fan_targets = dict(targets)
        self._refresh_controls()

    def _ramped_speeds(self) -> dict[str, float]:
        """Move each actual fan speed toward its command at the configured drive ramp."""
        step = self.parameters.fan_ramp_fraction_per_second * self._clock.step_seconds
        speeds = {}
        for fan_id, actual in self._fan_speeds.items():
            target = self._fan_targets[fan_id]
            if abs(target - actual) <= step:
                speeds[fan_id] = target
            else:
                speeds[fan_id] = actual + step if target > actual else actual - step
        return speeds

    def _effective_sources(self) -> tuple[dict[str, float], dict[str, float]]:
        """Configured gas sources plus the cutting machine's emissions while it runs."""
        methane, co = dict(self._sources), dict(self._co_sources)
        production = self.parameters.production
        if self._production_running:
            methane[production.zone_id] += production.cutting_methane_m3s
            co[production.zone_id] += production.equipment_co_m3s
        return methane, co

    def set_obstruction(self, airway_id: str, factor: float | None) -> None:
        """Set a simulated resistance multiplier; None restores the nominal airway."""
        if airway_id not in {airway.id for airway in self.topology.airways}:
            raise ValueError(f"Unknown airway: {airway_id}")
        obstructions = self._obstructions.copy()
        if factor is None:
            obstructions.pop(airway_id, None)
        else:
            obstructions[airway_id] = factor
        airflow = solve_airflow(self.topology, self._fan_speeds, self._fan_faults, obstructions)
        self._obstructions, self._airflow = obstructions, airflow
        self._refresh_controls()

    def set_sensor_offline(self, zone_id: str, offline: bool) -> None:
        """Simulate loss of a zone's gas-sensor communication.

        The physics continues, but the zone keeps reporting its last received
        reading marked STALE, so the risk engine treats it as UNKNOWN_DATA.
        """
        if zone_id not in self._fractions:
            raise ValueError(f"Unknown zone: {zone_id}")
        if offline:
            self._offline.setdefault(
                zone_id,
                (
                    self._fractions[zone_id],
                    self._co_fractions[zone_id],
                    self._clock.elapsed_seconds,
                ),
            )
        else:
            self._offline.pop(zone_id, None)
        self._refresh_controls()

    def _reported_gas(self, zone_id: str) -> tuple[float, float]:
        """Methane and CO fractions as the zone's sensors report them."""
        if zone_id in self._offline:
            methane, co, _ = self._offline[zone_id]
            return methane, co
        return self._fractions[zone_id], self._co_fractions[zone_id]

    def set_methane_source(self, zone_id: str, source_m3s: float) -> None:
        """Set a fictional methane source for a deterministic scenario."""
        if zone_id not in self._sources:
            raise ValueError(f"Unknown zone: {zone_id}")
        if isinstance(source_m3s, bool) or not isfinite(source_m3s) or source_m3s < 0:
            raise ValueError("Methane source must be finite and nonnegative")
        self._sources[zone_id] = source_m3s

    def optimize_ventilation(self) -> VodDecision:
        """Return a simulation-only VOD proposal for the current state."""
        methane, co = self._effective_sources()
        return self._vod_controller.optimize(
            self.snapshot(),
            obstruction_factors=self._obstructions,
            methane_sources=methane,
            co_sources=co,
        )

    def apply_vod_decision(self, decision: VodDecision) -> VodDecision:
        """Atomically apply a selected simulated VOD proposal and return feedback."""
        if (
            decision.status is not VodStatus.SELECTED
            or decision.command_status != "PROPOSED"
            or decision.selected is None
        ):
            raise ValueError("Only a proposed selected VOD decision can be applied")
        if decision != self.optimize_ventilation():
            raise ValueError("VOD proposal is stale or blocked by current safety constraints")
        speeds = {
            setting.fan_id: setting.speed_fraction for setting in decision.selected.fan_speeds
        }
        if set(speeds) != set(self._fan_speeds):
            raise ValueError("VOD decision must specify every configured fan exactly once")
        # Validate that the commanded operating point is solvable before accepting it.
        solve_airflow(self.topology, speeds, self._fan_faults, self._obstructions)
        self._command_fans(speeds)
        return decision.model_copy(update={"command_status": "APPLIED"})

    def apply_emergency_response(self) -> bool:
        """Command the current emergency fan requests in the model, never in equipment.

        The commands are reached through the drive ramp on later ticks, so fan
        feedback reads PENDING until the actual speed equals the request.
        Advisory/warning requests remain proposals; reset restores baseline.
        """
        if self._paused:
            return False
        targets = self._fan_targets.copy()
        for decision in self._safety:
            if decision.risk_state is not RiskState.EMERGENCY:
                continue
            for request in decision.fan_requests:
                if not self._fan_faults[request.fan_id]:
                    targets[request.fan_id] = max(
                        targets[request.fan_id], request.requested_speed_fraction
                    )
        if targets == self._fan_targets:
            return False
        self._command_fans(targets)
        return True

    def _fan_states(self) -> tuple[FanState, ...]:
        return tuple(
            FanState(
                fan_id=fan_id,
                requested_speed_fraction=self._fan_targets[fan_id],
                actual_speed_fraction=point.speed_fraction,
                actual_speed_rpm=fan_speed_rpm(
                    self._fans[fan_id], point.speed_fraction, faulted=point.faulted
                ),
                faulted=point.faulted,
                power_kw=point.power_kw,
            )
            for fan_id, point in sorted(self._airflow.fan_points.items())
        )

    def _zone_airflow(self, zone_id: str) -> float:
        incoming = sum(
            self._airflow.airway_flows_m3s[item.id]
            for item in self.topology.airways
            if item.target == zone_id
        )
        outgoing = sum(
            self._airflow.airway_flows_m3s[item.id]
            for item in self.topology.airways
            if item.source == zone_id
        )
        return max(incoming, outgoing)

    def _refresh_controls(self) -> None:
        now = self._clock.elapsed_seconds
        main_failed = self._fan_faults["FAN_MAIN"]
        self._risks = tuple(
            self._risk_engine.evaluate(
                ZoneObservation(
                    zone_id=zone.id,
                    methane_fraction=self._reported_gas(zone.id)[0],
                    co_fraction=self._reported_gas(zone.id)[1],
                    airflow_m3s=self._zone_airflow(zone.id),
                    sample_seconds=self._offline[zone.id][2] if zone.id in self._offline else now,
                    quality=(
                        TelemetryQuality.STALE
                        if zone.id in self._offline
                        else TelemetryQuality.GOOD
                    ),
                    source_type="SYNTHETIC_PHYSICS",
                ),
                now,
                main_fan_failed=main_failed,
            )
            for zone in sorted(self.topology.zones, key=lambda item: item.id)
        )
        fans = self._fan_states()
        self._safety = tuple(
            decide_simulated_safety(risk, fans, self._clock.ticks) for risk in self._risks
        )
        # The simulated production stop (trip_power) halts the cutting machine; it
        # restarts only when its zone no longer requires a stop.
        production_zone = self.parameters.production.zone_id
        self._production_running = not next(
            item.production_stop for item in self._safety if item.zone_id == production_zone
        )

    def _production_state(self) -> ProductionState:
        production = self.parameters.production
        running = self._production_running
        return ProductionState(
            equipment_id=production.equipment_id,
            zone_id=production.zone_id,
            running=running,
            power_kw=production.operating_power_kw if running else 0.0,
            cutting_methane_m3s=production.cutting_methane_m3s if running else 0.0,
            equipment_co_m3s=production.equipment_co_m3s if running else 0.0,
        )

    def snapshot(self) -> SimulationSnapshot:
        return SimulationSnapshot(
            tick=self._clock.ticks,
            simulated_seconds=self._clock.elapsed_seconds,
            paused=self._paused,
            zones=tuple(
                ZoneConcentration(
                    zone_id=zone,
                    methane_fraction=self._reported_gas(zone)[0],
                    co_ppm=fraction_to_ppm(self._reported_gas(zone)[1]),
                )
                for zone in sorted(self._fractions)
            ),
            airways=tuple(
                AirwayFlow(
                    airway_id=airway,
                    flow_m3s=flow,
                    resistance_factor=self._obstructions.get(airway, 1.0),
                )
                for airway, flow in sorted(self._airflow.airway_flows_m3s.items())
            ),
            fans=self._fan_states(),
            risks=self._risks,
            safety=self._safety,
            production=self._production_state(),
        )

    def tick(self) -> GasStepResult | None:
        if self._paused:
            return None
        speeds = self._ramped_speeds()
        airflow = (
            self._airflow
            if speeds == self._fan_speeds
            else solve_airflow(self.topology, speeds, self._fan_faults, self._obstructions)
        )
        methane_sources, co_sources = self._effective_sources()
        result = advance_gas(
            self._volumes,
            self._fractions,
            gas_flows_from_airflow(self.topology, airflow),
            methane_sources,
            self._clock.step_seconds,
            cfl_limit=self.parameters.cfl_limit,
            max_substeps=self.parameters.max_substeps,
        )
        co_result = advance_gas(
            self._volumes,
            self._co_fractions,
            gas_flows_from_airflow(self.topology, airflow, tracer="co"),
            co_sources,
            self._clock.step_seconds,
            cfl_limit=self.parameters.cfl_limit,
            max_substeps=self.parameters.max_substeps,
        )
        # Commit fans, both tracer states and the clock only after every calculation succeeds.
        self._fan_speeds, self._airflow = speeds, airflow
        self._fractions = result.fractions.copy()
        self._co_fractions = co_result.fractions.copy()
        self._last_co_step = co_result
        self._clock = self._clock.advance()
        self._refresh_controls()
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=120)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIRECTORY)
    args = parser.parse_args()
    if not 1 <= args.steps <= 100000:
        parser.error("--steps must be between 1 and 100000")
    simulation = Simulation(*load_configuration(args.data_dir))
    residuals = []
    co_residuals = []
    for _ in range(args.steps):
        result = simulation.tick()
        if result is not None:
            residuals.append(abs(result.balance_residual_m3))
            if simulation.last_co_step is not None:
                co_residuals.append(abs(simulation.last_co_step.balance_residual_m3))
    snapshot = simulation.snapshot()
    output = snapshot.model_dump(mode="json")
    output["methane_percent_volume"] = {
        zone.zone_id: fraction_to_percent(zone.methane_fraction) for zone in snapshot.zones
    }
    output["carbon_monoxide_ppm"] = {zone.zone_id: zone.co_ppm for zone in snapshot.zones}
    output["max_abs_balance_residual_m3"] = max(residuals)
    output["max_abs_co_balance_residual_m3"] = max(co_residuals)
    print(json.dumps(output, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
