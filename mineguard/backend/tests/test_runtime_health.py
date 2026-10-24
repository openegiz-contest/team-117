"""Health must distinguish live physics, pending MQTT and verified Ditto state."""

import threading
import time
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.main import create_app
from app.api.service import RuntimeService
from app.models import Parameters, SimulationSnapshot, Topology
from app.simulation.runtime import Simulation


def _quick(parameters: Parameters) -> Parameters:
    return parameters.model_copy(update={"tick_seconds": 0.01})


def _wait_until(condition: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 2
    while not condition():
        if time.monotonic() >= deadline:
            pytest.fail("Expected runtime condition did not become true")
        time.sleep(0.005)


def test_mqtt_success_without_ditto_verification_is_not_ready(
    topology: Topology, parameters: Parameters
) -> None:
    service = RuntimeService(
        Simulation(topology, _quick(parameters)),
        twin_reader=lambda _: {},
        snapshot_publisher=lambda _: False,
        publish_every_ticks=1,
    )
    with TestClient(create_app(service)) as client:
        _wait_until(lambda: service.platform_error == "DITTO_PUBLICATION_UNVERIFIED")
        response = client.get("/api/health/ready")
        assert response.status_code == 503
        assert response.json()["status"] == "degraded"
        assert response.json()["platform_connected"] is False
        assert response.json()["simulation_running"] is True


def test_verified_publication_and_reset_do_not_reuse_old_verification(
    topology: Topology, parameters: Parameters
) -> None:
    second_entered = threading.Event()
    release = threading.Event()
    calls = 0

    def publish(_: SimulationSnapshot) -> bool:
        nonlocal calls
        calls += 1
        if calls > 1:
            second_entered.set()
            release.wait(2)
        return True

    service = RuntimeService(
        Simulation(topology, parameters),
        twin_reader=lambda _: {},
        snapshot_publisher=publish,
    )
    with TestClient(create_app(service)) as client:
        try:
            _wait_until(lambda: service.platform_connected)
            ready = client.get("/api/health/ready")
            assert ready.status_code == 200
            assert ready.json()["platform_last_verified_tick"] == 0
            service.reset_scenario()
            assert second_entered.wait(1)
            assert service.platform_connected is False
            assert service.platform_last_verified_tick is None
        finally:
            release.set()
        _wait_until(lambda: service.platform_connected)


def test_paused_clock_stays_healthy_and_continues_verifying_ditto(
    topology: Topology, parameters: Parameters
) -> None:
    publications: list[int] = []

    def publish(snapshot: SimulationSnapshot) -> bool:
        publications.append(snapshot.tick)
        return True

    service = RuntimeService(
        Simulation(topology, _quick(parameters)),
        twin_reader=lambda _: {},
        snapshot_publisher=publish,
        publish_every_ticks=2,
    )
    with TestClient(create_app(service)) as client:
        service.start_scenario("S1_METHANE_LEAK")
        service.pause_scenario()
        count = len(publications)
        _wait_until(lambda: len(publications) >= count + 2)
        assert publications[-1] == publications[-2]
        assert service.snapshot().paused is True
        assert client.get("/api/health/ready").json()["status"] == "ready"


@pytest.mark.parametrize("crash", [False, True])
def test_dead_or_nonadvancing_clock_cannot_stream_healthy_state(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch, crash: bool
) -> None:
    simulation = Simulation(topology, _quick(parameters))

    def invalid_tick() -> None:
        if crash:
            raise ValueError("Internal model error")
        return None

    monkeypatch.setattr(simulation, "tick", invalid_tick)
    service = RuntimeService(simulation)
    with TestClient(create_app(service)) as client:
        _wait_until(lambda: not service.simulation_running)
        assert client.get("/api/health/live").status_code == 503
        ready = client.get("/api/health/ready")
        assert ready.status_code == 503
        assert ready.json()["status"] == "unavailable"
        assert ready.json()["simulation_running"] is False
        assert client.get("/api/v1/state").status_code == 503
        with client.websocket_connect("/api/v1/stream") as websocket:
            with pytest.raises(WebSocketDisconnect) as error:
                websocket.receive_json()
            assert error.value.code == 1013


def test_blocked_clock_health_is_accessible_without_taking_simulation_lock(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> None:
    simulation = Simulation(topology, _quick(parameters))
    entered = threading.Event()
    release = threading.Event()

    def blocking_tick() -> None:
        entered.set()
        release.wait(2)

    monkeypatch.setattr(simulation, "tick", blocking_tick)
    service = RuntimeService(simulation)
    service._clock_timeout = 0.05
    with TestClient(create_app(service)) as client:
        try:
            assert entered.wait(1)
            _wait_until(lambda: service.simulation_error == "CLOCK_STALLED")
            started = time.monotonic()
            assert client.get("/api/health/ready").status_code == 503
            assert time.monotonic() - started < 0.5
            assert client.get("/api/v1/state").status_code == 503
        finally:
            release.set()
