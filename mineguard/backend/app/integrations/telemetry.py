"""Translate simulation snapshots into complete Ditto feature replacements."""

import re
from math import fsum

from app.integrations.bootstrap_twins import fan_thing_id, zone_thing_id
from app.models import SimulationSnapshot, Topology
from app.units import fraction_to_percent

RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def validate_run_id(run_id: str) -> str:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("Run ID must be 1-80 safe identifier characters")
    return run_id


def _feature(value: object, **metadata: object) -> dict[str, object]:
    return {"properties": {"value": value, **metadata}}


def _zone_airflows(snapshot: SimulationSnapshot, topology: Topology) -> dict[str, float]:
    values = {airway.airway_id: airway.flow_m3s for airway in snapshot.airways}
    result: dict[str, float] = {}
    for zone in topology.zones:
        incoming = fsum(values[item.id] for item in topology.airways if item.target == zone.id)
        outgoing = fsum(values[item.id] for item in topology.airways if item.source == zone.id)
        result[zone.id] = max(incoming, outgoing)
    return result


def zone_features(
    snapshot: SimulationSnapshot, topology: Topology, zone_id: str, run_id: str
) -> dict[str, object]:
    validate_run_id(run_id)
    methane = {item.zone_id: item.methane_fraction for item in snapshot.zones}
    co_ppm = {item.zone_id: item.co_ppm for item in snapshot.zones}
    if zone_id not in methane:
        raise ValueError(f"Unknown snapshot zone: {zone_id}")
    airflow = _zone_airflows(snapshot, topology)[zone_id]
    try:
        risk = next(item for item in snapshot.risks if item.zone_id == zone_id)
    except StopIteration as exc:
        raise ValueError(f"Missing risk assessment for zone: {zone_id}") from exc
    try:
        safety = next(item for item in snapshot.safety if item.zone_id == zone_id)
    except StopIteration as exc:
        raise ValueError(f"Missing safety decision for zone: {zone_id}") from exc
    return {
        "idSimulationRun": _feature(run_id),
        "methane": _feature(
            round(fraction_to_percent(methane[zone_id]), 8),
            unit="% volume",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "co": _feature(
            round(co_ppm[zone_id], 8),
            unit="ppm",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "airflow": _feature(
            round(airflow, 8),
            unit="m3/s",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "simulation": _feature(
            True,
            tick=snapshot.tick,
            simulated_seconds=snapshot.simulated_seconds,
        ),
        "risk": _feature(
            risk.state.value,
            reason_codes=list(risk.reason_codes),
            quality=risk.quality.value,
            source_type=risk.source_type,
            simulation_only=True,
        ),
        "safety_interlock": _feature(
            "TRIPPED" if safety.production_stop else "CLEAR",
            trip_power=safety.production_stop,
            evacuation_advisory=safety.evacuation_advisory,
            ventilation_response=safety.ventilation_response,
            optimization_enabled=safety.optimization_enabled,
            reason_codes=list(safety.reason_codes),
            simulation_only=True,
            equipment_io=False,
        ),
    }


def fan_features(snapshot: SimulationSnapshot, fan_id: str, run_id: str) -> dict[str, object]:
    validate_run_id(run_id)
    try:
        fan = next(item for item in snapshot.fans if item.fan_id == fan_id)
    except StopIteration as exc:
        raise ValueError(f"Unknown snapshot fan: {fan_id}") from exc
    return {
        "idSimulationRun": _feature(run_id),
        "speed": _feature(
            round(100 * fan.actual_speed_fraction, 6),
            unit="% rated speed",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "rpm": _feature(
            round(fan.actual_speed_rpm, 6),
            unit="rpm",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "power": _feature(
            round(fan.power_kw, 8),
            unit="kW",
            quality="GOOD",
            source_type=snapshot.source_type,
        ),
        "state": _feature("FAULTED" if fan.faulted else "RUNNING"),
        "simulation": _feature(
            True,
            tick=snapshot.tick,
            simulated_seconds=snapshot.simulated_seconds,
        ),
    }


def mine_features(snapshot: SimulationSnapshot, run_id: str) -> dict[str, object]:
    validate_run_id(run_id)
    max_methane = max(item.methane_fraction for item in snapshot.zones)
    max_co_ppm = max(item.co_ppm for item in snapshot.zones)
    total_power = fsum(item.power_kw for item in snapshot.fans)
    total_flow = next(item.flow_m3s for item in snapshot.airways if item.airway_id == "E01")
    return {
        "idSimulationRun": _feature(run_id),
        "max_methane": _feature(
            round(fraction_to_percent(max_methane), 8),
            unit="% volume",
            source_type=snapshot.source_type,
        ),
        "max_co": _feature(
            round(max_co_ppm, 8),
            unit="ppm",
            source_type=snapshot.source_type,
        ),
        "total_airflow": _feature(round(total_flow, 8), unit="m3/s"),
        "fan_power": _feature(round(total_power, 8), unit="kW"),
        "simulation": _feature(
            True,
            tick=snapshot.tick,
            simulated_seconds=snapshot.simulated_seconds,
        ),
    }


def snapshot_features(
    snapshot: SimulationSnapshot, topology: Topology, run_id: str
) -> dict[str, dict[str, object]]:
    """Build a complete feature replacement for every managed twin."""
    features: dict[str, dict[str, object]] = {topology.mine_id: mine_features(snapshot, run_id)}
    features.update(
        {
            zone_thing_id(zone.id): zone_features(snapshot, topology, zone.id, run_id)
            for zone in topology.zones
        }
    )
    features.update(
        {fan_thing_id(fan.id): fan_features(snapshot, fan.id, run_id) for fan in topology.fans}
    )
    return features


def ditto_modify_features(thing_id: str, features: dict[str, object]) -> dict[str, object]:
    namespace, separator, name = thing_id.rpartition(":")
    if not separator or not namespace or not name:
        raise ValueError("Thing ID must contain namespace:name")
    return {
        "topic": f"{namespace}/{name}/things/twin/commands/modify",
        "path": "/features",
        "value": features,
    }


def mqtt_topic(thing_id: str) -> str:
    validate = thing_id.replace(":", "/")
    if "+" in validate or "#" in validate:
        raise ValueError("Thing ID cannot contain MQTT wildcards")
    return f"telemetry/{validate}"
