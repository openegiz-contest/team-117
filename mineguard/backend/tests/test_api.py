import json
import threading
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.api.service import RuntimeService
from app.models import Parameters, Topology
from app.simulation.runtime import Simulation


def _service(
    topology: Topology,
    parameters: Parameters,
    twin_reader: Any = None,
) -> RuntimeService:
    return RuntimeService(
        Simulation(topology, parameters), history_limit=10, twin_reader=twin_reader
    )


def test_health_state_topology_and_vod_routes(topology: Topology, parameters: Parameters) -> None:
    with TestClient(create_app(_service(topology, parameters))) as client:
        assert client.get("/api/health/live").json() == {"status": "alive"}
        ready = client.get("/api/health/ready").json()
        assert ready["status"] == "degraded"
        assert ready["simulation_running"] is True
        assert ready["platform_connected"] is False
        assert len(client.get("/api/v1/topology").json()["zones"]) == 6
        state = client.get("/api/v1/state")
        assert state.status_code == 200
        assert state.json()["simulation_only"] is True
        decision = client.get("/api/v1/vod/decision").json()
        assert decision["status"] == "SELECTED"
        assert decision["command_status"] == "PROPOSED"


def test_history_is_bounded_and_returns_real_snapshots(
    topology: Topology, parameters: Parameters
) -> None:
    service = _service(topology, parameters)
    with TestClient(create_app(service)) as client:
        history = client.get("/api/v1/history").json()
        assert history
        assert history[0]["tick"] == 0


def test_websocket_stream_emits_valid_simulation_snapshot(
    topology: Topology, parameters: Parameters
) -> None:
    with TestClient(create_app(_service(topology, parameters))) as client:
        with client.websocket_connect("/api/v1/stream") as websocket:
            first = websocket.receive_json()
            second = websocket.receive_json()
            assert first["simulation_only"] is True
            assert first["source_type"] == "SYNTHETIC_PHYSICS"
            assert len(first["risks"]) == 6
            assert second["tick"] >= first["tick"]
            assert second["simulated_seconds"] >= first["simulated_seconds"]


def test_twin_inspector_allows_only_managed_ids(topology: Topology, parameters: Parameters) -> None:
    calls: list[str] = []

    def reader(thing_id: str) -> dict[str, object]:
        calls.append(thing_id)
        return {"thingId": thing_id, "attributes": {"simulation_only": True}}

    with TestClient(create_app(_service(topology, parameters, reader))) as client:
        response = client.get("/api/v1/twins/mineguard:zone-z04")
        assert response.status_code == 200
        assert response.json()["thingId"] == "mineguard:zone-z04"
        assert calls == ["mineguard:zone-z04"]
        assert client.get("/api/v1/twins/other:thing").status_code == 404


def test_unconfigured_ditto_is_explicitly_unavailable(
    topology: Topology, parameters: Parameters
) -> None:
    with TestClient(create_app(_service(topology, parameters))) as client:
        response = client.get("/api/v1/twins/mineguard:mine-01")
        assert response.status_code == 503
        assert "not configured" in response.json()["detail"]


def test_ditto_transport_failure_returns_service_unavailable(
    topology: Topology, parameters: Parameters
) -> None:
    def unavailable(_: str) -> dict[str, object]:
        raise TimeoutError("Ditto read timed out")

    with TestClient(create_app(_service(topology, parameters, unavailable))) as client:
        response = client.get("/api/v1/twins/mineguard:mine-01")
        assert response.status_code == 503
        assert response.json()["detail"] == "Ditto read timed out"


def test_slow_platform_publish_does_not_pause_physics_clock(
    topology: Topology, parameters: Parameters
) -> None:
    data = parameters.model_dump(mode="json")
    data["tick_seconds"] = 0.01
    quick = Parameters.model_validate_json(json.dumps(data))
    publishing = threading.Event()
    release = threading.Event()

    def slow_publish(_: object) -> bool:
        publishing.set()
        release.wait(timeout=1)
        return True

    service = RuntimeService(
        Simulation(topology, quick),
        snapshot_publisher=slow_publish,
        publish_every_ticks=1,
    )
    service.start()
    try:
        assert publishing.wait(timeout=1)
        first_tick = service.snapshot().tick
        time.sleep(0.05)
        assert service.snapshot().tick > first_tick
    finally:
        release.set()
        service.stop()


def test_scenario_commands_require_explicit_simulation_header(
    topology: Topology, parameters: Parameters
) -> None:
    with TestClient(create_app(_service(topology, parameters))) as client:
        assert client.post("/api/v1/scenarios/S1_METHANE_LEAK/start").status_code == 403
        response = client.post(
            "/api/v1/scenarios/S1_METHANE_LEAK/start",
            headers={"X-MineGuard-Simulation": "SIMULATION_ONLY"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "RUNNING"
        reset = client.post(
            "/api/v1/scenarios/reset",
            headers={"X-MineGuard-Simulation": "SIMULATION_ONLY"},
        )
        assert reset.json()["status"] == "IDLE"


def test_scenario_commands_reject_untrusted_browser_origin(
    topology: Topology, parameters: Parameters, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MINEGUARD_ALLOWED_ORIGINS", "http://127.0.0.1:8091")
    with TestClient(create_app(_service(topology, parameters))) as client:
        headers = {
            "X-MineGuard-Simulation": "SIMULATION_ONLY",
            "Origin": "https://untrusted.example",
        }
        assert (
            client.post("/api/v1/scenarios/S1_METHANE_LEAK/start", headers=headers).status_code
            == 403
        )
        headers["Origin"] = "http://127.0.0.1:8091"
        assert (
            client.post("/api/v1/scenarios/S1_METHANE_LEAK/start", headers=headers).status_code
            == 200
        )


def test_decision_trace_is_internally_consistent(
    topology: Topology, parameters: Parameters
) -> None:
    with TestClient(create_app(_service(topology, parameters))) as client:
        trace = client.get("/api/v1/decision-trace").json()
        evidence = client.get("/api/v1/evidence").json()
        assert trace["simulation_only"] is True
        assert trace["source_type"] == "SYNTHETIC_PHYSICS"
        assert len(trace["risk_assessments"]) == 6
        assert (
            trace["constraints"]["warning_methane_fraction"]
            == parameters.risk_thresholds.warning_methane_fraction
        )
        comparison = trace["vod_decision"]["comparison"]
        assert comparison["same_initial_state"] is True
        assert comparison["optimized_constraints_met"] is True
        assert evidence["units"]["internal_methane"] == "volume fraction"
        assert evidence["decision_trace"]["simulated_seconds"] == trace["simulated_seconds"]
