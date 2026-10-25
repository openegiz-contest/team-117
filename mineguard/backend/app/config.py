"""Load explicit versioned data files; no generated secrets are used by M1."""

from pathlib import Path

from app.models import Parameters, ScenarioDefinition, Topology
from app.topology import load_topology

DATA_DIRECTORY = Path(__file__).resolve().parents[2] / "data"


def load_scenarios(data_directory: Path = DATA_DIRECTORY) -> tuple[ScenarioDefinition, ...]:
    import json

    value: object = json.loads((data_directory / "scenario_defaults.json").read_text())
    if not isinstance(value, list):
        raise ValueError("Scenario defaults must be a JSON array")
    scenarios = tuple(ScenarioDefinition.model_validate(item) for item in value)
    if len({item.id for item in scenarios}) != len(scenarios):
        raise ValueError("Scenario IDs must be unique")
    return scenarios


def validate_parameters(topology: Topology, parameters: Parameters) -> Parameters:
    ids = [item.zone_id for item in parameters.initial_zones]
    if len(ids) != len(set(ids)) or set(ids) != {zone.id for zone in topology.zones}:
        raise ValueError("Initial gas/source settings must cover each zone exactly once")
    fan_ids = [item.fan_id for item in parameters.initial_fans]
    if len(fan_ids) != len(set(fan_ids)) or set(fan_ids) != {fan.id for fan in topology.fans}:
        raise ValueError("Initial fan settings must cover each fan exactly once")
    if parameters.production.zone_id not in set(ids):
        raise ValueError("Production equipment must be located in a configured zone")
    return parameters


def load_configuration(data_directory: Path = DATA_DIRECTORY) -> tuple[Topology, Parameters]:
    topology = load_topology(data_directory / "mine_topology.json")
    parameters = Parameters.model_validate_json(
        (data_directory / "model_parameters.json").read_text(encoding="utf-8")
    )
    return topology, validate_parameters(topology, parameters)
