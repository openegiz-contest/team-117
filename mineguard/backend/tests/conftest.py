"""Fixtures use the real versioned fictional mine input files."""

import json
from typing import Any

import pytest

from app.config import DATA_DIRECTORY, load_configuration
from app.models import Parameters, Topology


@pytest.fixture
def topology() -> Topology:
    return load_configuration()[0]


@pytest.fixture
def parameters() -> Parameters:
    return load_configuration()[1]


@pytest.fixture
def topology_json() -> dict[str, Any]:
    return json.loads((DATA_DIRECTORY / "mine_topology.json").read_text())
