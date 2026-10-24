"""Rebuild the UI state contract from Eclipse Ditto things, not from model memory."""

from collections.abc import Mapping
from typing import Any

from app.integrations.bootstrap_twins import fan_thing_id, zone_thing_id
from app.models import (
    AirwayFlow,
    FanState,
    RiskAssessment,
    RiskState,
    SimulatedFanRequest,
    SimulatedSafetyDecision,
    SimulationSnapshot,
    TelemetryQuality,
    Topology,
    ZoneConcentration,
)
from app.units import percent_to_fraction


def _properties(thing: Mapping[str, Any], feature: str) -> Mapping[str, Any]:
    try:
        value = thing["features"][feature]["properties"]
    except (KeyError, TypeError) as exc:
        raise ValueError(f"Ditto thing is missing feature {feature}") from exc
    if not isinstance(value, Mapping):
        raise ValueError(f"Ditto feature {feature} has no properties object")
    return value


def _number(properties: Mapping[str, Any], key: str = "value") -> float:
    value = properties.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"Ditto property {key} is not numeric")
    return float(value)


def _strings(properties: Mapping[str, Any], key: str) -> tuple[str, ...]:
    value = properties.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Ditto property {key} is not a string list")
    return tuple(value)


def _flag(properties: Mapping[str, Any], key: str) -> bool:
    value = properties.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"Ditto property {key} is not boolean")
    return value


def snapshot_from_things(
    topology: Topology, things: Mapping[str, Mapping[str, Any]], run_id: str
) -> SimulationSnapshot:
    """Validate one consistent publication across all nine twins and convert units once."""
    expected = {
        topology.mine_id,
        *(zone_thing_id(zone.id) for zone in topology.zones),
        *(fan_thing_id(fan.id) for fan in topology.fans),
    }
    if set(things) != expected:
        raise ValueError("Ditto readback must contain exactly the managed twins")
    ticks = set()
    for thing in things.values():
        if _properties(thing, "idSimulationRun").get("value") != run_id:
            raise ValueError("Ditto readback mixes simulation publications")
        ticks.add(int(_number(_properties(thing, "simulation"), "tick")))
    if len(ticks) != 1:
        raise ValueError("Ditto readback mixes simulation ticks")
    mine = things[topology.mine_id]
    simulation = _properties(mine, "simulation")
    tick = ticks.pop()
    seconds = _number(simulation, "simulated_seconds")

    zones = []
    risks = []
    safety = []
    for zone in sorted(topology.zones, key=lambda item: item.id):
        thing = things[zone_thing_id(zone.id)]
        methane = percent_to_fraction(_number(_properties(thing, "methane")))
        co_ppm = _number(_properties(thing, "co"))
        airflow = _number(_properties(thing, "airflow"))
        risk = _properties(thing, "risk")
        interlock = _properties(thing, "safety_interlock")
        zones.append(ZoneConcentration(zone_id=zone.id, methane_fraction=methane, co_ppm=co_ppm))
        risks.append(
            RiskAssessment(
                zone_id=zone.id,
                state=RiskState(risk["value"]),
                reason_codes=_strings(risk, "reason_codes"),
                evaluated_seconds=seconds,
                methane_fraction=methane,
                co_ppm=co_ppm,
                airflow_m3s=airflow,
                quality=TelemetryQuality(risk["quality"]),
                source_type="SYNTHETIC_PHYSICS",
                transitioned=_flag(risk, "transitioned"),
            )
        )
        requests = interlock.get("fan_requests")
        if not isinstance(requests, list):
            raise ValueError("Ditto safety interlock has no fan request list")
        safety.append(
            SimulatedSafetyDecision(
                zone_id=zone.id,
                risk_state=RiskState(interlock["risk_state"]),
                production_stop=_flag(interlock, "trip_power"),
                evacuation_advisory=_flag(interlock, "evacuation_advisory"),
                ventilation_response=_flag(interlock, "ventilation_response"),
                optimization_enabled=_flag(interlock, "optimization_enabled"),
                reason_codes=_strings(interlock, "reason_codes"),
                fan_requests=tuple(
                    SimulatedFanRequest.model_validate(item, strict=False) for item in requests
                ),
            )
        )

    airways = tuple(
        AirwayFlow(
            airway_id=airway.id,
            flow_m3s=_number(_properties(mine, f"airway_{airway.id.lower()}")),
        )
        for airway in sorted(topology.airways, key=lambda item: item.id)
    )
    fans = []
    for fan in sorted(topology.fans, key=lambda item: item.id):
        thing = things[fan_thing_id(fan.id)]
        state = _properties(thing, "state").get("value")
        if state not in {"RUNNING", "FAULTED"}:
            raise ValueError("Ditto fan state is not RUNNING or FAULTED")
        fans.append(
            FanState(
                fan_id=fan.id,
                requested_speed_fraction=percent_to_fraction(
                    _number(_properties(thing, "requested_speed"))
                ),
                actual_speed_fraction=percent_to_fraction(_number(_properties(thing, "speed"))),
                actual_speed_rpm=_number(_properties(thing, "rpm")),
                faulted=state == "FAULTED",
                power_kw=_number(_properties(thing, "power")),
            )
        )
    return SimulationSnapshot(
        tick=tick,
        simulated_seconds=seconds,
        paused=_flag(simulation, "paused"),
        publication_status="ECLIPSE_DITTO_READBACK",
        zones=tuple(zones),
        airways=airways,
        fans=tuple(fans),
        risks=tuple(risks),
        safety=tuple(safety),
    )
