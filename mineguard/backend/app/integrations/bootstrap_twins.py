"""Guarded, idempotent MineGuard X twin bootstrap for Eclipse Ditto."""

from dataclasses import dataclass

from app.integrations.ditto import DittoClient
from app.models import Topology

POLICY_ID = "default:basic_policy"
MODEL_STAGE = "M10_MULTI_GAS"
SCHEMA_VERSION = 3
PREVIOUS_MANAGED_SCHEMA = ("M2_PHYSICS", 2)
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


def twin_definitions(topology: Topology) -> dict[str, dict[str, object]]:
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
            },
            "features": _unknown_features(),
        }
    }
    for zone in topology.zones:
        definitions[zone_thing_id(zone.id)] = {
            "policyId": POLICY_ID,
            "attributes": {
                **common,
                "name": f"MineGuard X {zone.name}",
                "display_name": zone.name,
                "zone_id": zone.id,
                "zone_type": zone.role,
                "_parents": topology.mine_id,
            },
            "features": _unknown_zone_features(),
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
                "_parents": topology.mine_id,
                "associated_zone_ids": [zone_thing_id(fan.zone_id)],
            },
            "features": _unknown_fan_features(),
        }
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
    if current_schema not in {PREVIOUS_MANAGED_SCHEMA, (MODEL_STAGE, SCHEMA_VERSION)}:
        raise RuntimeError(f"Refusing unknown MineGuard schema for {thing_id}")
    expected_attributes = expected["attributes"]
    if not isinstance(expected_attributes, dict):
        raise RuntimeError("Internal twin definition has invalid attributes")
    identity_keys = {"zone_id", "zone_type", "fan_id", "kind", "_parents"}
    if any(
        key in expected_attributes and attributes.get(key) != expected_attributes[key]
        for key in identity_keys
    ):
        raise RuntimeError(f"Refusing identity mismatch for {thing_id}")
    if current_schema == PREVIOUS_MANAGED_SCHEMA:
        return "migrate"
    return "unchanged"


def bootstrap_twins(client: DittoClient, topology: Topology) -> BootstrapResult:
    created: list[str] = []
    migrated: list[str] = []
    unchanged: list[str] = []
    for thing_id, definition in twin_definitions(topology).items():
        action = existing_twin_action(thing_id, client.get_thing(thing_id), definition)
        if action == "unchanged":
            unchanged.append(thing_id)
            continue
        status = client.put_thing(thing_id, definition)
        if status not in {201, 204}:
            raise RuntimeError(f"Unexpected Ditto PUT status {status} for {thing_id}")
        (created if action == "create" else migrated).append(thing_id)
    return BootstrapResult(tuple(created), tuple(migrated), tuple(unchanged))
