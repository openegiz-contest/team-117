"""MQTT delivery alone cannot prove that Eclipse Ditto stored a publication."""

from typing import Any

import pytest

from app.integrations.live import LivePlatformBridge
from app.models import Parameters, Topology
from app.simulation.runtime import Simulation


class FakePlatform:
    def __init__(self) -> None:
        self.messages: dict[str, dict[str, Any]] = {}
        self.stored: dict[str, dict[str, Any]] = {}
        self.propagate = True
        self.exclude: str | None = None
        self.read_ids: set[str] = set()

    def publish(self, topic: str, command: dict[str, Any]) -> None:
        thing_id = topic.removeprefix("telemetry/").replace("/", ":", 1)
        self.messages[thing_id] = {"features": command["value"]}
        if self.propagate and thing_id != self.exclude:
            self.stored[thing_id] = self.messages[thing_id]

    def get_thing(self, thing_id: str) -> dict[str, Any] | None:
        self.read_ids.add(thing_id)
        return self.stored.get(thing_id)

    def get_things(self, thing_ids: Any) -> dict[str, dict[str, Any]]:
        ids = set(thing_ids)
        self.read_ids.update(ids)
        return {
            thing_id: {"thingId": thing_id, **thing}
            for thing_id, thing in self.stored.items()
            if thing_id in ids
        }


def _bridge(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> tuple[LivePlatformBridge, FakePlatform]:
    fake = FakePlatform()
    monkeypatch.setattr("app.integrations.live.DittoClient", lambda *a, **k: fake)
    monkeypatch.setattr("app.integrations.live.MqttPublisher", lambda *a, **k: fake)
    bridge = LivePlatformBridge(
        topology,
        "http://example.invalid",
        "test",
        "test",
        "localhost",
        1883,
        production=parameters.production,
        verification_timeout_seconds=0.02,
    )
    bridge._bootstrapped = True
    return bridge, fake


def test_all_managed_twins_require_matching_readback(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> None:
    bridge, fake = _bridge(topology, parameters, monkeypatch)
    snapshot = Simulation(topology, parameters).snapshot()
    readback = bridge.publish(snapshot)
    assert readback.publication_status == "ECLIPSE_DITTO_READBACK"
    assert readback.tick == snapshot.tick
    assert len(fake.read_ids) == 16
    assert fake.read_ids == set(fake.messages)


def test_mqtt_acknowledged_but_one_missing_twin_fails_verification(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> None:
    bridge, fake = _bridge(topology, parameters, monkeypatch)
    fake.exclude = "mineguard:zone-z04"
    with pytest.raises(TimeoutError, match="not verified"):
        bridge.publish(Simulation(topology, parameters).snapshot())
    assert len(fake.messages) == 16


def test_reset_same_tick_cannot_reuse_previous_publication_readback(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> None:
    bridge, fake = _bridge(topology, parameters, monkeypatch)
    snapshot = Simulation(topology, parameters).snapshot()
    assert bridge.publish(snapshot).tick == snapshot.tick
    fake.propagate = False
    with pytest.raises(TimeoutError, match="not verified"):
        bridge.publish(snapshot)


def test_matching_run_with_wrong_tick_does_not_count_as_verified() -> None:
    thing = {
        "features": {
            "idSimulationRun": {"properties": {"value": "live-test-1"}},
            "simulation": {"properties": {"tick": 59}},
        }
    }
    assert not LivePlatformBridge._matches_publication(thing, "live-test-1", 60)
