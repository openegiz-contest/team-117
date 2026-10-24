import json

import pytest
from pydantic import ValidationError

from app.config import validate_parameters
from app.models import Parameters, Topology
from app.topology import gas_flows, validate_topology


def parse(data) -> Topology:
    return validate_topology(Topology.model_validate_json(json.dumps(data)))


def test_six_zone_mine_has_balanced_paths_and_real_assignments(topology: Topology) -> None:
    assert len(topology.zones) == 6
    assert len(topology.fans) == 2
    assert len(topology.sensors) >= 12
    flows = gas_flows(topology)
    for zone in topology.zones:
        assert sum(f.flow_m3s for f in flows if f.target == zone.id) == pytest.approx(
            sum(f.flow_m3s for f in flows if f.source == zone.id)
        )


@pytest.mark.parametrize(
    "case",
    [
        "duplicate_zone",
        "unknown_endpoint",
        "self_loop",
        "disconnected",
        "cycle",
        "unbalanced",
        "closed_flow",
        "unknown_sensor",
        "bad_sensor_unit",
        "unknown_fan_airway",
        "invalid_fan_rpm",
        "missing_inlet_co",
        "missing_co_sensor",
        "duplicate_fan",
        "invalid_volume",
        "missing_boundary",
        "unknown_field",
        "nan_volume",
    ],
)
def test_reject_invalid_topology(topology_json, case: str) -> None:
    data = topology_json
    if case == "duplicate_zone":
        data["zones"][1]["id"] = "Z01"
    elif case == "unknown_endpoint":
        data["airways"][0]["to"] = "Z99"
    elif case == "self_loop":
        data["airways"][0]["to"] = "Z01"
    elif case == "disconnected":
        data["airways"] = [e for e in data["airways"] if e["from"] != "Z01"]
    elif case == "cycle":
        data["airways"].append(dict(data["airways"][0], id="E07", **{"from": "Z05", "to": "Z02"}))
    elif case == "unbalanced":
        data["airways"][1]["flow_m3s"] += 1
    elif case == "closed_flow":
        data["airways"][1]["status"] = "CLOSED"
    elif case == "unknown_sensor":
        data["sensors"][0]["zone_id"] = "Z99"
    elif case == "bad_sensor_unit":
        data["sensors"][0]["unit"] = "ppm"
    elif case == "unknown_fan_airway":
        data["fans"][0]["airway_ids"] = ["E99"]
    elif case == "invalid_fan_rpm":
        data["fans"][0]["rated_speed_rpm"] = 0
    elif case == "missing_inlet_co":
        data["boundaries"][0].pop("co_fraction")
    elif case == "missing_co_sensor":
        data["sensors"] = [
            sensor
            for sensor in data["sensors"]
            if not (sensor["zone_id"] == "Z04" and sensor["quantity"] == "co")
        ]
    elif case == "duplicate_fan":
        data["fans"][1]["id"] = "FAN_MAIN"
    elif case == "invalid_volume":
        data["zones"][0]["volume_m3"] = 0
    elif case == "missing_boundary":
        data["boundaries"] = data["boundaries"][:1]
    elif case == "unknown_field":
        data["safety_certified"] = True
    elif case == "nan_volume":
        data["zones"][0]["volume_m3"] = float("nan")
    with pytest.raises((ValueError, ValidationError)):
        parse(data)


def test_reject_duplicate_initial_zone(topology: Topology, parameters: Parameters) -> None:
    data = parameters.model_dump(mode="json")
    data["initial_zones"][1]["zone_id"] = "Z01"
    with pytest.raises(ValueError, match="exactly once"):
        validate_parameters(topology, Parameters.model_validate_json(json.dumps(data)))


def test_configuration_objects_are_immutable(topology: Topology) -> None:
    with pytest.raises(ValidationError):
        topology.zones[0].volume_m3 = 0


@pytest.mark.parametrize(
    "key,value",
    [
        ("tick_seconds", 0),
        ("tick_seconds", 61),
        ("tick_seconds", True),
        ("cfl_limit", 1.1),
        ("max_substeps", 0),
        ("simulation_only", False),
    ],
)
def test_reject_invalid_solver_configuration(parameters: Parameters, key, value) -> None:
    data = parameters.model_dump(mode="json")
    data[key] = value
    with pytest.raises(ValidationError):
        Parameters.model_validate_json(json.dumps(data))
