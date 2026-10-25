import json

import pytest

from app.integrations.bootstrap_twins import airway_thing_id, fan_thing_id, zone_thing_id
from app.integrations.telemetry import (
    airway_features,
    ditto_modify_features,
    fan_features,
    mine_features,
    mqtt_topic,
    snapshot_features,
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


def test_airway_twin_publishes_flow_and_obstruction(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    simulation.set_obstruction("E03", 4.0)
    features = airway_features(simulation.snapshot(), "E03", "m2-test-airway")
    flow = features["flow"]["properties"]  # type: ignore[index]
    obstruction = features["obstruction"]["properties"]  # type: ignore[index]
    assert flow["unit"] == "m3/s"
    assert flow["value"] == pytest.approx(simulation.airflow.airway_flows_m3s["E03"])
    assert obstruction["value"] == 4.0
    assert obstruction["status"] == "RESTRICTED"


def test_every_managed_feature_document_is_complete(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    documents = snapshot_features(snapshot, topology, "m2-test")
    assert set(documents) == {
        topology.mine_id,
        *(zone_thing_id(zone.id) for zone in topology.zones),
        *(fan_thing_id(fan.id) for fan in topology.fans),
        *(airway_thing_id(airway.id) for airway in topology.airways),
        "mineguard:shearer-z04",
    }
    assert documents[topology.mine_id] == mine_features(snapshot, "m2-test")
    assert documents[fan_thing_id("FAN_AUX")] == fan_features(snapshot, "FAN_AUX", "m2-test")
    assert len(documents) == 16
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
