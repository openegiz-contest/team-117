import pytest

from app.integrations.bootstrap_twins import (
    MODEL_STAGE,
    PREVIOUS_MANAGED_SCHEMA,
    SCHEMA_VERSION,
    existing_twin_action,
    twin_definitions,
)
from app.models import Topology


def test_definitions_cover_mine_zones_fans_and_airways(topology: Topology) -> None:
    definitions = twin_definitions(topology)
    assert len(definitions) == 15
    assert set(definitions) == {
        "mineguard:mine-01",
        *(f"mineguard:zone-z0{i}" for i in range(1, 7)),
        "mineguard:fan-main",
        "mineguard:fan-aux",
        *(f"mineguard:airway-e0{i}" for i in range(1, 7)),
    }
    assert all(item["policyId"] == "default:basic_policy" for item in definitions.values())
    zone_features = definitions["mineguard:zone-z04"]["features"]
    assert zone_features["co"]["properties"]["unit"] == "ppm"  # type: ignore[index]
    fan = definitions["mineguard:fan-main"]
    assert fan["attributes"]["rated_speed_rpm"] == 980  # type: ignore[index]
    assert fan["features"]["rpm"]["properties"]["unit"] == "rpm"  # type: ignore[index]


def test_twin_attributes_describe_the_ventilation_network(topology: Topology) -> None:
    definitions = twin_definitions(topology)
    distribution = definitions["mineguard:zone-z02"]["attributes"]
    assert distribution["inflow_airway_ids"] == ["mineguard:airway-e01"]  # type: ignore[index]
    assert set(distribution["outflow_airway_ids"]) == {  # type: ignore[index]
        "mineguard:airway-e02",
        "mineguard:airway-e03",
    }
    assert set(distribution["downstream_zone_ids"]) == {  # type: ignore[index]
        "mineguard:zone-z03",
        "mineguard:zone-z04",
    }
    face = definitions["mineguard:zone-z04"]["attributes"]
    assert face["volume_m3"] == 1800  # type: ignore[index]
    assert {s["quantity"] for s in face["sensors"]} >= {"methane", "co"}  # type: ignore[index]
    airway = definitions["mineguard:airway-e06"]["attributes"]
    assert airway["from_zone_id"] == "mineguard:zone-z05"  # type: ignore[index]
    assert airway["to_zone_id"] == "mineguard:zone-z06"  # type: ignore[index]
    assert airway["fan_ids"] == ["mineguard:fan-main"]  # type: ignore[index]
    mine = definitions["mineguard:mine-01"]["attributes"]
    assert len(mine["airway_ids"]) == 6  # type: ignore[index]
    # Every referenced thing exists, so the relations form a closed graph.
    for item in definitions.values():
        attributes = item["attributes"]
        for key in ("inflow_airway_ids", "outflow_airway_ids", "upstream_zone_ids", "fan_ids"):
            for reference in attributes.get(key, []):  # type: ignore[union-attr]
                assert reference in definitions


def test_m2_and_m10_twins_migrate_to_the_network_schema(topology: Topology) -> None:
    definition = twin_definitions(topology)["mineguard:zone-z04"]
    for stage, version in (("M2_PHYSICS", 2), ("M10_MULTI_GAS", 3)):
        current: dict[str, object] = {
            "attributes": {
                "simulation_only": True,
                "model_stage": stage,
                "schema_version": version,
                "zone_id": "Z04",
                "zone_type": "production",
                "_parents": "mineguard:mine-01",
            }
        }
        assert existing_twin_action("mineguard:zone-z04", current, definition) == "migrate"


def test_only_known_m0_twins_can_migrate(topology: Topology) -> None:
    definition = twin_definitions(topology)["mineguard:zone-z01"]
    current: dict[str, object] = {
        "attributes": {"simulation_only": True, "model_stage": "M0_BOOTSTRAP"}
    }
    assert existing_twin_action("mineguard:zone-z01", current, definition) == "migrate"
    with pytest.raises(RuntimeError, match="unknown MineGuard schema"):
        existing_twin_action("mineguard:zone-z02", current, definition)


def test_unmanaged_or_wrong_identity_is_never_replaced(topology: Topology) -> None:
    definition = twin_definitions(topology)["mineguard:zone-z01"]
    with pytest.raises(RuntimeError, match="unmanaged"):
        existing_twin_action("mineguard:zone-z01", {"attributes": {}}, definition)
    current: dict[str, object] = {
        "attributes": {
            "simulation_only": True,
            "model_stage": MODEL_STAGE,
            "schema_version": SCHEMA_VERSION,
            "zone_id": "Z99",
            "zone_type": "intake",
            "_parents": "mineguard:mine-01",
        }
    }
    with pytest.raises(RuntimeError, match="identity mismatch"):
        existing_twin_action("mineguard:zone-z01", current, definition)


def test_matching_current_twin_is_left_unchanged(topology: Topology) -> None:
    definition = twin_definitions(topology)["mineguard:zone-z01"]
    current = {"attributes": definition["attributes"]}
    assert existing_twin_action("mineguard:zone-z01", current, definition) == "unchanged"


def test_previous_managed_schema_is_safely_migrated(topology: Topology) -> None:
    definition = twin_definitions(topology)["mineguard:fan-main"]
    attributes = dict(definition["attributes"])  # type: ignore[arg-type]
    attributes["model_stage"], attributes["schema_version"] = PREVIOUS_MANAGED_SCHEMA
    current: dict[str, object] = {"attributes": attributes}
    assert existing_twin_action("mineguard:fan-main", current, definition) == "migrate"
    assert MODEL_STAGE != PREVIOUS_MANAGED_SCHEMA[0]
    assert SCHEMA_VERSION != PREVIOUS_MANAGED_SCHEMA[1]
