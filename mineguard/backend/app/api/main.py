"""FastAPI entrypoint for live MineGuard X state and Ditto inspection."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from app.api.service import RuntimeService, RuntimeUnavailableError
from app.config import load_configuration
from app.integrations.bootstrap_twins import fan_thing_id, zone_thing_id
from app.integrations.live import LivePlatformBridge
from app.models import (
    ScenarioDefinition,
    ScenarioState,
    SimulationSnapshot,
    Topology,
    VodDecision,
)
from app.simulation.runtime import Simulation


def _managed_ids(topology: Topology) -> set[str]:
    return {
        topology.mine_id,
        *(zone_thing_id(zone.id) for zone in topology.zones),
        *(fan_thing_id(fan.id) for fan in topology.fans),
    }


def _service_from_environment() -> RuntimeService:
    topology, parameters = load_configuration()
    url = os.environ.get("DITTO_URL")
    password = os.environ.get("DITTO_PASSWORD")
    if bool(url) != bool(password):
        raise RuntimeError("DITTO_URL and DITTO_PASSWORD must be configured together")
    bridge = None
    if url and password:
        bridge = LivePlatformBridge(
            topology,
            url,
            os.environ.get("DITTO_USER", "ditto"),
            password,
            os.environ.get("MQTT_HOST", "mosquitto"),
            int(os.environ.get("MQTT_PORT", "1883")),
        )
    return RuntimeService(
        Simulation(topology, parameters),
        twin_reader=bridge.read_twin if bridge else None,
        snapshot_publisher=bridge.publish if bridge else None,
        publisher_close=bridge.close if bridge else None,
        publish_every_ticks=int(os.environ.get("MINEGUARD_PUBLISH_EVERY_TICKS", "60")),
    )


def create_app(service: RuntimeService | None = None) -> FastAPI:
    runtime = service or _service_from_environment()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        runtime.start()
        try:
            yield
        finally:
            runtime.stop()

    app = FastAPI(
        title="MineGuard X API",
        version="0.5.0",
        description="Simulation-only underground mine digital twin API",
        lifespan=lifespan,
    )

    def require_simulation_command(request: Request) -> None:
        runtime.require_available()
        if request.headers.get("X-MineGuard-Simulation") != "SIMULATION_ONLY":
            raise HTTPException(status_code=403, detail="Simulation command confirmation required")
        origin = request.headers.get("Origin")
        allowed = {
            item.strip()
            for item in os.environ.get(
                "MINEGUARD_ALLOWED_ORIGINS",
                "http://127.0.0.1:8091,http://localhost:8091",
            ).split(",")
        }
        if origin is not None and origin not in allowed:
            raise HTTPException(status_code=403, detail="Origin is not allowed")

    @app.get("/api/health/live")
    def live() -> JSONResponse:
        return JSONResponse(
            {"status": "alive" if runtime.simulation_running else "unavailable"},
            status_code=200 if runtime.simulation_running else 503,
        )

    @app.exception_handler(RuntimeUnavailableError)
    async def unavailable(_: Request, exc: RuntimeUnavailableError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.get("/api/health/ready")
    def ready() -> JSONResponse:
        running = runtime.simulation_running
        connected = runtime.platform_connected
        status = "unavailable" if not running else "ready" if connected else "degraded"
        return JSONResponse(
            {
                "status": status,
                "simulation_running": running,
                "simulation_error": runtime.simulation_error or "NONE",
                "platform_configured": runtime.platform_configured,
                "platform_connected": connected,
                "platform_error": runtime.platform_error or "NONE",
                "platform_last_verified_tick": runtime.platform_last_verified_tick,
                "source_type": "SYNTHETIC_PHYSICS",
            },
            status_code=200 if status == "ready" else 503,
        )

    @app.get("/api/v1/topology", response_model=Topology)
    def topology() -> Topology:
        return runtime.topology

    @app.get("/api/v1/state", response_model=SimulationSnapshot)
    def state() -> SimulationSnapshot:
        runtime.require_available()
        return runtime.snapshot()

    @app.websocket("/api/v1/stream")
    async def state_stream(websocket: WebSocket) -> None:
        """Stream validated snapshots; commands remain on guarded HTTP routes."""
        await websocket.accept()
        try:
            while True:
                runtime.require_available()
                snapshot = await asyncio.to_thread(runtime.snapshot)
                runtime.require_available()
                await websocket.send_json(snapshot.model_dump(mode="json"))
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            return
        except RuntimeUnavailableError:
            await websocket.close(code=1013, reason="Simulation clock unavailable")

    @app.get("/api/v1/history", response_model=tuple[SimulationSnapshot, ...])
    def history() -> tuple[SimulationSnapshot, ...]:
        runtime.require_available()
        return runtime.history()

    @app.get("/api/v1/vod/decision", response_model=VodDecision)
    def vod_decision() -> VodDecision:
        runtime.require_available()
        return runtime.optimize()

    @app.get("/api/v1/decision-trace")
    def decision_trace() -> dict[str, Any]:
        runtime.require_available()
        return runtime.decision_trace()

    @app.get("/api/v1/evidence")
    def evidence() -> dict[str, Any]:
        runtime.require_available()
        return runtime.engineering_evidence()

    @app.get("/api/v1/scenarios", response_model=tuple[ScenarioDefinition, ...])
    def scenarios() -> tuple[ScenarioDefinition, ...]:
        return runtime.scenario_definitions()

    @app.get("/api/v1/scenarios/state", response_model=ScenarioState)
    def scenario_state() -> ScenarioState:
        runtime.require_available()
        return runtime.scenario_state()

    @app.post("/api/v1/scenarios/{scenario_id}/start", response_model=ScenarioState)
    def start_scenario(scenario_id: str, request: Request) -> ScenarioState:
        require_simulation_command(request)
        try:
            return runtime.start_scenario(scenario_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/v1/scenarios/pause", response_model=ScenarioState)
    def pause_scenario(request: Request) -> ScenarioState:
        require_simulation_command(request)
        try:
            return runtime.pause_scenario()
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/v1/scenarios/resume", response_model=ScenarioState)
    def resume_scenario(request: Request) -> ScenarioState:
        require_simulation_command(request)
        try:
            return runtime.resume_scenario()
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/v1/scenarios/reset", response_model=ScenarioState)
    def reset_scenario(request: Request) -> ScenarioState:
        require_simulation_command(request)
        return runtime.reset_scenario()

    @app.get("/api/v1/twins/{thing_id:path}")
    def twin(thing_id: str) -> JSONResponse:
        if thing_id not in _managed_ids(runtime.topology):
            raise HTTPException(status_code=404, detail="Unknown managed twin")
        try:
            value: dict[str, Any] | None = runtime.read_twin(thing_id)
        except (OSError, RuntimeError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if value is None:
            raise HTTPException(status_code=404, detail="Twin not found")
        return JSONResponse(value)

    return app


app = create_app()
