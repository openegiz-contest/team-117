"""Validate the directed supply/return graph without solving fan pressure."""

from collections import deque
from math import fsum, isclose
from pathlib import Path
from typing import Literal

from app.models import GasFlow, Topology


def _reachable(start: str, adjacency: dict[str, set[str]]) -> set[str]:
    seen = {start}
    queue = deque([start])
    while queue:
        for target in sorted(adjacency[queue.popleft()] - seen):
            seen.add(target)
            queue.append(target)
    return seen


def validate_topology(topology: Topology) -> Topology:
    expected = {f"Z{i:02}" for i in range(1, 7)}
    zone_ids = [zone.id for zone in topology.zones]
    if len(set(zone_ids)) != len(zone_ids) or set(zone_ids) != expected:
        raise ValueError("Topology requires unique zones Z01 through Z06")
    for collection in (topology.airways, topology.fans, topology.sensors):
        ids = [item.id for item in collection]
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate equipment, sensor or airway ID")
    if {fan.id for fan in topology.fans} != {"FAN_MAIN", "FAN_AUX"}:
        raise ValueError("Expected FAN_MAIN and FAN_AUX")
    forward: dict[str, set[str]] = {zone: set() for zone in expected}
    reverse: dict[str, set[str]] = {zone: set() for zone in expected}
    pairs = set()
    for edge in topology.airways:
        if edge.source not in expected or edge.target not in expected:
            raise ValueError("Airway references an unknown zone")
        pair = (edge.source, edge.target)
        if edge.source == edge.target or pair in pairs:
            raise ValueError("Self-loop or duplicate directed airway")
        pairs.add(pair)
        forward[edge.source].add(edge.target)
        reverse[edge.target].add(edge.source)
        if edge.status == "CLOSED" and edge.flow_m3s != 0:
            raise ValueError("Closed airway cannot carry flow")
    if _reachable("Z01", forward) != expected or _reachable("Z06", reverse) != expected:
        raise ValueError("Every zone must lie on an intake-to-exhaust path")
    indegree = {zone: len(reverse[zone]) for zone in expected}
    queue = deque(sorted(zone for zone, degree in indegree.items() if degree == 0))
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for target in sorted(forward[node]):
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if visited != len(expected):
        raise ValueError("M1 topology must be acyclic")
    if forward["Z06"] or reverse["Z01"]:
        raise ValueError("Intake/exhaust graph boundaries are reversed")
    roles = {zone.id: zone.role for zone in topology.zones}
    if roles["Z01"] != "intake" or roles["Z06"] != "exhaust":
        raise ValueError("Z01/Z06 must be intake/exhaust")
    boundary_pairs = [(b.zone_id, b.kind) for b in topology.boundaries]
    if len(boundary_pairs) != 2 or set(boundary_pairs) != {("Z01", "INLET"), ("Z06", "EXHAUST")}:
        raise ValueError("Require exactly Z01 inlet and Z06 exhaust boundaries")
    airway_ids = {edge.id for edge in topology.airways}
    for fan in topology.fans:
        if fan.zone_id not in expected or not set(fan.airway_ids) <= airway_ids:
            raise ValueError("Fan has an unknown zone/airway reference")
        if len(set(fan.airway_ids)) != len(fan.airway_ids):
            raise ValueError("Fan airway references must be unique")
    for sensor in topology.sensors:
        if sensor.zone_id not in expected:
            raise ValueError("Sensor references an unknown zone")
    for zone in expected:
        quantities = {s.quantity for s in topology.sensors if s.zone_id == zone}
        if "airflow" not in quantities:
            raise ValueError("Each zone requires an airflow sensor assignment")
        if zone in {"Z03", "Z04", "Z05", "Z06"} and "methane" not in quantities:
            raise ValueError("Working/return zones require methane sensor assignments")
        if zone in {"Z03", "Z04"} and "co" not in quantities:
            raise ValueError("Heading and production zones require CO sensor assignments")
    flows = gas_flows(topology)
    for zone in expected:
        inflow = fsum(f.flow_m3s for f in flows if f.target == zone)
        outflow = fsum(f.flow_m3s for f in flows if f.source == zone)
        if not isclose(inflow, outflow, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError(f"Unbalanced ventilation flow in {zone}: {inflow} vs {outflow}")
    return topology


def gas_flows(
    topology: Topology, *, tracer: Literal["methane", "co"] = "methane"
) -> tuple[GasFlow, ...]:
    """Return configured flows with the selected trace gas at the intake boundary."""
    flows = [
        GasFlow(source=e.source, target=e.target, flow_m3s=e.flow_m3s) for e in topology.airways
    ]
    for boundary in topology.boundaries:
        inlet_fraction = boundary.methane_fraction if tracer == "methane" else boundary.co_fraction
        flows.append(
            GasFlow(
                source=None if boundary.kind == "INLET" else boundary.zone_id,
                target=boundary.zone_id if boundary.kind == "INLET" else None,
                flow_m3s=boundary.flow_m3s,
                inlet_fraction=inlet_fraction or 0.0,
            )
        )
    return tuple(flows)


def load_topology(path: Path) -> Topology:
    return validate_topology(Topology.model_validate_json(path.read_text(encoding="utf-8")))
