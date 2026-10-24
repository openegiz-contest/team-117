import json

import pytest

from app.integrations.bootstrap_twins import fan_thing_id, zone_thing_id
from app.integrations.telemetry import (
    ditto_modify_features,
    fan_features,
    mine_features,
    mqtt_topic,
    validate_run_id,
    zone_features,
)
from app.models import Parameters, Topology
from app.simulation.runtime import Simulation


def test_zone_telemetry_preserves_units_and_provenance(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    features = zone_features(snapshot, topology, "Z04", "m2-test-001")
    methane = features["methane"]["properties"]  # type: ignore[index]
    co = features["co"]["properties"]  # type: ignore[index]
    airflow = features["airflow"]["properties"]  # type: ignore[index]
    assert methane["value"] == pytest.approx(0.15)
    assert methane["unit"] == "% volume"
    assert methane["source_type"] == "SYNTHETIC_PHYSICS"
    assert co["value"] == pytest.approx(12.0)
    assert co["unit"] == "ppm"
    assert co["source_type"] == "SYNTHETIC_PHYSICS"
    assert airflow["unit"] == "m3/s"
    assert features["idSimulationRun"] == {"properties": {"value": "m2-test-001"}}
    risk = features["risk"]["properties"]  # type: ignore[index]
    assert risk["value"] == "NORMAL"
    assert risk["simulation_only"] is True
    interlock = features["safety_interlock"]["properties"]  # type: ignore[index]
    assert interlock["trip_power"] is False
    assert interlock["simulation_only"] is True
    assert interlock["equipment_io"] is False


def test_safety_feature_maps_simulated_production_stop_to_trip_power(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    data["initial_zones"][3]["methane_fraction"] = 0.011
    hazardous = Parameters.model_validate_json(json.dumps(data))
    snapshot = Simulation(topology, hazardous).snapshot()
    safety = zone_features(snapshot, topology, "Z04", "m2-test-002")["safety_interlock"]
    properties = safety["properties"]  # type: ignore[index]
    decision = next(item for item in snapshot.safety if item.zone_id == "Z04")
    assert properties["trip_power"] is decision.production_stop is True
    assert properties["evacuation_advisory"] is decision.evacuation_advisory
    assert properties["ventilation_response"] is decision.ventilation_response
    assert properties["equipment_io"] is False


def test_fan_telemetry_publishes_actual_rpm_with_explicit_unit(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    features = fan_features(snapshot, "FAN_MAIN", "m2-test-rpm")
    rpm = features["rpm"]["properties"]  # type: ignore[index]
    state = next(item for item in snapshot.fans if item.fan_id == "FAN_MAIN")
    assert rpm["value"] == pytest.approx(state.actual_speed_rpm)
    assert rpm["unit"] == "rpm"


def test_all_nine_feature_documents_are_complete(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    documents = {topology.mine_id: mine_features(snapshot, "m2-test")}
    documents.update(
        {
            zone_thing_id(zone.id): zone_features(snapshot, topology, zone.id, "m2-test")
            for zone in topology.zones
        }
    )
    documents.update(
        {fan_thing_id(fan.id): fan_features(snapshot, fan.id, "m2-test") for fan in topology.fans}
    )
    assert len(documents) == 9
    for thing_id, features in documents.items():
        command = ditto_modify_features(thing_id, features)
        assert command["path"] == "/features"
        assert command["value"] == features
        assert command["topic"].endswith("/things/twin/commands/modify")  # type: ignore[union-attr]
        assert mqtt_topic(thing_id).startswith("telemetry/")


@pytest.mark.parametrize("run_id", ["", "space is unsafe", "x" * 81, "#wildcard"])
def test_invalid_run_ids_are_rejected(run_id: str) -> None:
    with pytest.raises(ValueError):
        validate_run_id(run_id)


def test_mqtt_wildcards_are_rejected() -> None:
    with pytest.raises(ValueError):
        mqtt_topic("mineguard:zone+#")
