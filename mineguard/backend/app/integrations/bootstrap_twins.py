"""Guarded, idempotent MineGuard X twin bootstrap for Eclipse Ditto."""

from dataclasses import dataclass

from app.integrations.ditto import DittoClient
from app.models import ProductionParameters, Topology

POLICY_ID = "default:basic_policy"
MODEL_STAGE = "M17_VENTILATION_NETWORK"
SCHEMA_VERSION = 5
PREVIOUS_MANAGED_SCHEMA = ("M10_MULTI_GAS", 3)
# Earlier managed schemas that may be replaced by the current definition.
MIGRATABLE_SCHEMAS = {("M2_PHYSICS", 2), PREVIOUS_MANAGED_SCHEMA, (MODEL_STAGE, 4)}
M0_MIGRATION_IDS = {"mineguard:zone-z01", "mineguard:fan-main"}


@dataclass(frozen=True)
class BootstrapResult:
    created: tuple[str, ...]
    migrated: tuple[str, ...]
    unchanged: tuple[str, ...]


def zone_thing_id(zone_id: str) -> str:
    return f"mineguard:zone-{zone_id.lower()}"


def fan_thing_id(fan_id: str) -> str:
    return f"mineguard:{fan_id.lower().replace('_', '-')}"


def airway_thing_id(airway_id: str) -> str:
    return f"mineguard:airway-{airway_id.lower()}"


def equipment_thing_id(equipment_id: str) -> str:
    return f"mineguard:{equipment_id.lower().replace('_', '-')}"


def _unknown_features() -> dict[str, object]:
    return {
        "idSimulationRun": {"properties": {"value": "BOOTSTRAP"}},
        "telemetry_health": {
            "properties": {
                "quality": "STALE",
                "source_type": "SYNTHETIC_BOOTSTRAP",
                "reason_codes": ["AWAITING_SIMULATOR"],
            }
        },
    }


def _unknown_measurement(unit: str) -> dict[str, object]:
    return {
        "properties": {
            "value": None,
            "unit": unit,
            "quality": "STALE",
            "source_type": "SYNTHETIC_BOOTSTRAP",
        }
    }


def _unknown_zone_features() -> dict[str, object]:
    return {
        **_unknown_features(),
        "methane": _unknown_measurement("% volume"),
        "co": _unknown_measurement("ppm"),
        "airflow": _unknown_measurement("m3/s"),
    }


def _unknown_fan_features() -> dict[str, object]:
    return {
        **_unknown_features(),
        "speed": _unknown_measurement("% rated speed"),
        "rpm": _unknown_measurement("rpm"),
        "power": _unknown_measurement("kW"),
    }


def _unknown_airway_features() -> dict[str, object]:
    return {
        **_unknown_features(),
        "flow": _unknown_measurement("m3/s"),
        "obstruction": _unknown_measurement("resistance multiplier"),
    }


def _unknown_equipment_features() -> dict[str, object]:
    return {
        **_unknown_features(),
        "power": _unknown_measurement("kW"),
        "cutting_methane": _unknown_measurement("m3/s"),
        "exhaust_co": _unknown_measurement("m3/s"),
    }


def twin_definitions(
    topology: Topology, production: ProductionParameters | None = None
) -> dict[str, dict[str, object]]:
    """Mine, zone, fan, airway and production-equipment twins with their relations."""
    common = {
        "_isType": False,
        "simulation_only": True,
        "model_stage": MODEL_STAGE,
        "schema_version": SCHEMA_VERSION,
        "assumption_source": topology.assumption_source,
    }
    definitions: dict[str, dict[str, object]] = {
        topology.mine_id: {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": "MineGuard X fictional underground mine",
                "kind": "underground-mine",
                "zone_ids": [zone_thing_id(zone.id) for zone in topology.zones],
                "airway_ids": [airway_thing_id(airway.id) for airway in topology.airways],
                "fan_ids": [fan_thing_id(fan.id) for fan in topology.fans],
            },
            "features": _unknown_features(),
        }
    }
    boundaries = {boundary.zone_id: boundary.kind for boundary in topology.boundaries}
    for zone in topology.zones:
        inflow = [airway for airway in topology.airways if airway.target == zone.id]
        outflow = [airway for airway in topology.airways if airway.source == zone.id]
        definitions[zone_thing_id(zone.id)] = {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": f"MineGuard X {zone.name}",
                "display_name": zone.name,
                "zone_id": zone.id,
                "zone_type": zone.role,
                "_parents": topology.mine_id,
                "volume_m3": zone.volume_m3,
                "depth_m": zone.depth_m,
                "boundary": boundaries.get(zone.id, "NONE"),
                "inflow_airway_ids": [airway_thing_id(airway.id) for airway in inflow],
                "outflow_airway_ids": [airway_thing_id(airway.id) for airway in outflow],
                "upstream_zone_ids": [zone_thing_id(airway.source) for airway in inflow],
                "downstream_zone_ids": [zone_thing_id(airway.target) for airway in outflow],
                "fan_ids": [
                    fan_thing_id(fan.id) for fan in topology.fans if fan.zone_id == zone.id
                ],
                "sensors": [
                    {"id": sensor.id, "quantity": sensor.quantity, "unit": sensor.unit}
                    for sensor in topology.sensors
                    if sensor.zone_id == zone.id
                ],
            },
            "features": _unknown_zone_features(),
        }
    for airway in topology.airways:
        definitions[airway_thing_id(airway.id)] = {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": f"MineGuard X airway {airway.id}",
                "airway_id": airway.id,
                "kind": "ventilation-airway",
                "_parents": topology.mine_id,
                "from_zone_id": zone_thing_id(airway.source),
                "to_zone_id": zone_thing_id(airway.target),
                "length_m": airway.length_m,
                "resistance_pa_s2_m6": airway.resistance_pa_s2_m6,
                "design_flow_m3s": airway.flow_m3s,
                "fan_ids": [
                    fan_thing_id(fan.id) for fan in topology.fans if airway.id in fan.airway_ids
                ],
            },
            "features": _unknown_airway_features(),
        }
    for fan in topology.fans:
        definitions[fan_thing_id(fan.id)] = {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": f"MineGuard X {fan.id}",
                "fan_id": fan.id,
                "kind": "ventilation-fan",
                "rated_power_kw": fan.rated_power_kw,
                "rated_speed_rpm": fan.rated_speed_rpm,
                "shutoff_pressure_pa": fan.shutoff_pressure_pa,
                "curve_resistance_pa_s2_m6": fan.curve_resistance_pa_s2_m6,
                "_parents": topology.mine_id,
                "associated_zone_ids": [zone_thing_id(fan.zone_id)],
                "airway_ids": [airway_thing_id(airway_id) for airway_id in fan.airway_ids],
            },
            "features": _unknown_fan_features(),
        }
    if production is not None:
        equipment_id = equipment_thing_id(production.equipment_id)
        zone_id = zone_thing_id(production.zone_id)
        definitions[equipment_id] = {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": f"MineGuard X cutting machine {production.equipment_id}",
                "equipment_id": production.equipment_id,
                "kind": "production-equipment",
                "_parents": topology.mine_id,
                "zone_id": zone_id,
                "operating_power_kw": production.operating_power_kw,
                "cutting_methane_m3s": production.cutting_methane_m3s,
                "equipment_co_m3s": production.equipment_co_m3s,
                "interlock": f"{zone_id} safety_interlock.trip_power stops this machine",
            },
            "features": _unknown_equipment_features(),
        }
        mine_attributes = definitions[topology.mine_id]["attributes"]
        zone_attributes = definitions[zone_id]["attributes"]
        if isinstance(mine_attributes, dict) and isinstance(zone_attributes, dict):
            mine_attributes["equipment_ids"] = [equipment_id]
            zone_attributes["equipment_ids"] = [equipment_id]
    return definitions


def existing_twin_action(
    thing_id: str, current: dict[str, object] | None, expected: dict[str, object]
) -> str:
    if current is None:
        return "create"
    attributes = current.get("attributes")
    if not isinstance(attributes, dict) or attributes.get("simulation_only") is not True:
        raise RuntimeError(f"Refusing to replace unmanaged twin {thing_id}")
    stage = attributes.get("model_stage")
    if stage == "M0_BOOTSTRAP" and thing_id in M0_MIGRATION_IDS:
        return "migrate"
    current_schema = (stage, attributes.get("schema_version"))
    if current_schema not in MIGRATABLE_SCHEMAS | {(MODEL_STAGE, SCHEMA_VERSION)}:
        raise RuntimeError(f"Refusing unknown MineGuard schema for {thing_id}")
    expected_attributes = expected["attributes"]
    if not isinstance(expected_attributes, dict):
        raise RuntimeError("Internal twin definition has invalid attributes")
    identity_keys = {
        "zone_id",
        "zone_type",
        "fan_id",
        "airway_id",
        "equipment_id",
        "kind",
        "_parents",
    }
    if any(
        key in expected_attributes and attributes.get(key) != expected_attributes[key]
        for key in identity_keys
    ):
        raise RuntimeError(f"Refusing identity mismatch for {thing_id}")
    if current_schema in MIGRATABLE_SCHEMAS:
        return "migrate"
    return "unchanged"


def bootstrap_twins(
    client: DittoClient, topology: Topology, production: ProductionParameters | None = None
) -> BootstrapResult:
    created: list[str] = []
    migrated: list[str] = []
    unchanged: list[str] = []
    for thing_id, definition in twin_definitions(topology, production).items():
        action = existing_twin_action(thing_id, client.get_thing(thing_id), definition)
        if action == "unchanged":
            unchanged.append(thing_id)
            continue
        status = client.put_thing(thing_id, definition)
        if status not in {201, 204}:
            raise RuntimeError(f"Unexpected Ditto PUT status {status} for {thing_id}")
        (created if action == "create" else migrated).append(thing_id)
    return BootstrapResult(tuple(created), tuple(migrated), tuple(unchanged))
