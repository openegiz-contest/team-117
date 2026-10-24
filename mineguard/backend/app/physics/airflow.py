"""Conservative quasi-steady solver for MineGuard X's fixed two-branch network."""

from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite, sqrt
from typing import Literal

from app.models import GasFlow, Topology
from app.physics.fan_model import FanOperatingPoint, fan_power_kw, fan_pressure_pa


@dataclass(frozen=True)
class AirflowResult:
    airway_flows_m3s: dict[str, float]
    fan_points: dict[str, FanOperatingPoint]
    total_flow_m3s: float
    common_branch_pressure_pa: float
    converged: bool


def _speed(value: float, name: str) -> float:
    if isinstance(value, bool) or not isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} speed must be a finite fraction in [0, 1]")
    return value


def solve_airflow(
    topology: Topology,
    fan_speeds: Mapping[str, float],
    fan_faults: Mapping[str, bool] | None = None,
    obstruction_factors: Mapping[str, float] | None = None,
) -> AirflowResult:
    """Solve the documented Z01→Z02→(Z03|Z04)→Z05→Z06 layout.

    Both branch flows are nonnegative. A stopped/faulted main fan gives zero
    network flow because reverse/passive flow through that fan is outside M2.
    """
    edges = {edge.id: edge for edge in topology.airways}
    if set(edges) != {"E01", "E02", "E03", "E04", "E05", "E06"}:
        raise ValueError("M2 solver requires the versioned six-airway topology")
    expected_pairs = {
        "E01": ("Z01", "Z02"),
        "E02": ("Z02", "Z03"),
        "E03": ("Z02", "Z04"),
        "E04": ("Z03", "Z05"),
        "E05": ("Z04", "Z05"),
        "E06": ("Z05", "Z06"),
    }
    if any(
        (edge.source, edge.target) != expected_pairs[edge_id] for edge_id, edge in edges.items()
    ):
        raise ValueError("Airway IDs do not match the documented topology")
    fans = {fan.id: fan for fan in topology.fans}
    if set(fans) != {"FAN_MAIN", "FAN_AUX"} or set(fan_speeds) != set(fans):
        raise ValueError("Both and only configured fan speeds are required")
    faults = {fan_id: False for fan_id in fans}
    if fan_faults:
        if not set(fan_faults) <= set(fans):
            raise ValueError("Unknown fan fault key")
        faults.update(fan_faults)
    factors = {edge_id: 1.0 for edge_id in edges}
    if obstruction_factors:
        if not set(obstruction_factors) <= set(edges):
            raise ValueError("Unknown obstruction airway")
        for edge_id, factor in obstruction_factors.items():
            if isinstance(factor, bool) or not isfinite(factor) or factor < 1:
                raise ValueError("Obstruction factors must be finite and at least 1")
            factors[edge_id] = factor
    resistance = {
        edge_id: edge.resistance_pa_s2_m6 * factors[edge_id] for edge_id, edge in edges.items()
    }
    main_speed = 0.0 if faults["FAN_MAIN"] else _speed(fan_speeds["FAN_MAIN"], "main")
    aux_speed = 0.0 if faults["FAN_AUX"] else _speed(fan_speeds["FAN_AUX"], "aux")
    if main_speed == 0:
        zero = {edge_id: 0.0 for edge_id in edges}
        points = {}
        for fan_id, fan in fans.items():
            actual_speed = 0.0 if faults[fan_id] else _speed(fan_speeds[fan_id], fan_id)
            points[fan_id] = FanOperatingPoint(
                speed_fraction=actual_speed,
                flow_m3s=0.0,
                pressure_pa=fan_pressure_pa(fan, actual_speed, 0.0),
                power_kw=fan_power_kw(fan, actual_speed, faulted=faults[fan_id]),
                faulted=faults[fan_id],
            )
        return AirflowResult(zero, points, 0.0, 0.0, True)

    main, aux = fans["FAN_MAIN"], fans["FAN_AUX"]
    series_r = resistance["E01"] + resistance["E06"]
    heading_r = resistance["E02"] + resistance["E04"]
    production_r = resistance["E03"] + resistance["E05"]
    aux_head = aux.shutoff_pressure_pa * aux_speed**2
    aux_total_r = heading_r + aux.curve_resistance_pa_s2_m6

    def flows(common_pressure: float) -> tuple[float, float, float]:
        heading = sqrt((common_pressure + aux_head) / aux_total_r)
        production = sqrt(common_pressure / production_r)
        return heading, production, heading + production

    def residual(common_pressure: float) -> float:
        _, _, total = flows(common_pressure)
        return fan_pressure_pa(main, main_speed, total) - series_r * total**2 - common_pressure

    low = 0.0
    high = main.shutoff_pressure_pa * main_speed**2
    if residual(low) < 0:
        raise ValueError("Auxiliary setting requires an operating point outside this model")
    for _ in range(100):
        middle = (low + high) / 2
        if residual(middle) > 0:
            low = middle
        else:
            high = middle
    common = (low + high) / 2
    heading, production, total = flows(common)
    if abs(residual(common)) > 1e-8:
        raise RuntimeError("Airflow solver did not converge")
    airway_flows = {
        "E01": total,
        "E02": heading,
        "E03": production,
        "E04": heading,
        "E05": production,
        "E06": total,
    }
    points = {
        "FAN_MAIN": FanOperatingPoint(
            main_speed,
            total,
            fan_pressure_pa(main, main_speed, total),
            fan_power_kw(main, main_speed),
            False,
        ),
        "FAN_AUX": FanOperatingPoint(
            aux_speed,
            heading,
            fan_pressure_pa(aux, aux_speed, heading),
            fan_power_kw(aux, aux_speed, faulted=faults["FAN_AUX"]),
            faults["FAN_AUX"],
        ),
    }
    return AirflowResult(airway_flows, points, total, common, True)


def gas_flows_from_airflow(
    topology: Topology,
    result: AirflowResult,
    *,
    tracer: Literal["methane", "co"] = "methane",
) -> tuple[GasFlow, ...]:
    """Map solved airflows to one conservative gas tracer's boundary input."""
    flows = [
        GasFlow(
            source=edge.source,
            target=edge.target,
            flow_m3s=result.airway_flows_m3s[edge.id],
        )
        for edge in topology.airways
    ]
    inlet = next(boundary for boundary in topology.boundaries if boundary.kind == "INLET")
    exhaust = next(boundary for boundary in topology.boundaries if boundary.kind == "EXHAUST")
    inlet_fraction = inlet.methane_fraction if tracer == "methane" else inlet.co_fraction
    if inlet_fraction is None:
        raise ValueError(f"INLET boundary is missing its {tracer} fraction")
    flows.extend(
        (
            GasFlow(
                source=None,
                target=inlet.zone_id,
                flow_m3s=result.total_flow_m3s,
                inlet_fraction=inlet_fraction,
            ),
            GasFlow(
                source=exhaust.zone_id,
                target=None,
                flow_m3s=result.total_flow_m3s,
            ),
        )
    )
    return tuple(flows)
