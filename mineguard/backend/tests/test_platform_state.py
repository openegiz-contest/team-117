"""The UI contract must be reconstructable from Ditto JSON alone."""

import json
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.api.service import RuntimeService
from app.integrations.platform_state import snapshot_from_things
from app.integrations.telemetry import snapshot_features
from app.models import Parameters, SimulationSnapshot, Topology
from app.simulation.runtime import Simulation


def _things(snapshot: SimulationSnapshot, topology: Topology, run_id: str) -> dict[str, Any]:
    features = snapshot_features(snapshot, topology, run_id)
    # Serialize as Ditto would return it, so no Python object identity survives.
    return {
        thing_id: json.loads(json.dumps({"thingId": thing_id, "features": value}))
        for thing_id, value in features.items()
    }


def _hazardous(topology: Topology, parameters: Parameters) -> SimulationSnapshot:
    simulation = Simulation(topology, parameters)
    simulation.set_methane_source("Z04", 0.8)
    for _ in range(90):
        simulation.tick()
    simulation.set_fan("FAN_AUX", faulted=True)
    return simulation.snapshot()


def test_ditto_readback_reproduces_the_published_snapshot(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = _hazardous(topology, parameters)
    rebuilt = snapshot_from_things(topology, _things(snapshot, topology, "live-x-1"), "live-x-1")
    assert rebuilt.publication_status == "ECLIPSE_DITTO_READBACK"
    assert (rebuilt.tick, rebuilt.paused) == (snapshot.tick, snapshot.paused)
    for original, copy in zip(snapshot.zones, rebuilt.zones, strict=True):
        assert copy.zone_id == original.zone_id
        assert copy.methane_fraction == pytest.approx(original.methane_fraction, abs=1e-9)
        assert copy.co_ppm == pytest.approx(original.co_ppm, abs=1e-7)
    for original_flow, copy_flow in zip(snapshot.airways, rebuilt.airways, strict=True):
        assert copy_flow.flow_m3s == pytest.approx(original_flow.flow_m3s, abs=1e-7)
    for original_fan, copy_fan in zip(snapshot.fans, rebuilt.fans, strict=True):
        assert copy_fan.faulted is original_fan.faulted
        assert copy_fan.actual_speed_rpm == pytest.approx(original_fan.actual_speed_rpm)
        assert copy_fan.requested_speed_fraction == pytest.approx(
            original_fan.requested_speed_fraction
        )
    assert [item.state for item in rebuilt.risks] == [item.state for item in snapshot.risks]
    assert rebuilt.safety == snapshot.safety


def test_mixed_or_incomplete_ditto_readback_is_rejected(
    topology: Topology, parameters: Parameters
) -> None:
    snapshot = Simulation(topology, parameters).snapshot()
    things = _things(snapshot, topology, "live-x-2")
    stale = dict(things)
    stale["mineguard:zone-z04"] = _things(snapshot, topology, "live-x-1")["mineguard:zone-z04"]
    with pytest.raises(ValueError, match="mixes"):
        snapshot_from_things(topology, stale, "live-x-2")
    missing = dict(things)
    missing.pop("mineguard:fan-main")
    with pytest.raises(ValueError, match="exactly the managed twins"):
        snapshot_from_things(topology, missing, "live-x-2")


def test_configured_platform_serves_only_ditto_readback(
    topology: Topology, parameters: Parameters
) -> None:
    quick = parameters.model_copy(update={"tick_seconds": 0.01})
    published: list[int] = []

    def publish(snapshot: SimulationSnapshot) -> SimulationSnapshot:
        published.append(snapshot.tick)
        return snapshot_from_things(
            topology,
            _things(snapshot, topology, f"live-t-{len(published)}"),
            f"live-t-{len(published)}",
        )

    service = RuntimeService(
        Simulation(topology, quick),
        twin_reader=lambda _: {},
        snapshot_publisher=publish,
        publish_every_ticks=5,
    )
    with TestClient(create_app(service)) as client:
        deadline = time.monotonic() + 2
        while len(published) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        state = client.get("/api/v1/state").json()
        assert state["publication_status"] == "ECLIPSE_DITTO_READBACK"
        assert state["tick"] in published
        assert client.get("/api/health/ready").json()["state_source"] == "ECLIPSE_DITTO_READBACK"
        history = client.get("/api/v1/history").json()
        assert history and all(
            item["publication_status"] == "ECLIPSE_DITTO_READBACK" for item in history
        )


def test_configured_platform_without_readback_is_unavailable(
    topology: Topology, parameters: Parameters
) -> None:
    service = RuntimeService(
        Simulation(topology, parameters),
        twin_reader=lambda _: {},
        snapshot_publisher=lambda _: False,
    )
    with TestClient(create_app(service)) as client:
        assert client.get("/api/v1/state").status_code == 503
