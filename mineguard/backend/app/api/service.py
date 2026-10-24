"""Thread-safe owner for the live deterministic simulation and bounded history."""

from __future__ import annotations

import threading
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from time import monotonic
from typing import Any

from app.config import load_scenarios
from app.models import (
    ScenarioDefinition,
    ScenarioState,
    SimulationSnapshot,
    Topology,
    VodDecision,
)
from app.simulation.runtime import Simulation
from app.simulation.scenarios import ScenarioEngine


class RuntimeUnavailableError(RuntimeError):
    """The clock or its state cannot currently support a live-state response."""


class RuntimeService:
    def __init__(
        self,
        simulation: Simulation,
        *,
        history_limit: int = 240,
        twin_reader: Callable[[str], dict[str, Any] | None] | None = None,
        snapshot_publisher: Callable[[SimulationSnapshot], SimulationSnapshot | bool] | None = None,
        publisher_close: Callable[[], None] | None = None,
        publish_every_ticks: int = 2,
    ) -> None:
        if history_limit < 2:
            raise ValueError("history_limit must be at least two")
        if publish_every_ticks < 1:
            raise ValueError("publish_every_ticks must be positive")
        self._simulation = simulation
        self._scenarios = ScenarioEngine(simulation, load_scenarios())
        self._history: deque[SimulationSnapshot] = deque(maxlen=history_limit)
        self._history.append(simulation.snapshot())
        # State rebuilt from Eclipse Ditto after each verified publication; this,
        # not the in-memory model, is what the UI reads when the platform is configured.
        self._platform_snapshot: SimulationSnapshot | None = None
        self._platform_history: deque[SimulationSnapshot] = deque(maxlen=history_limit)
        self._twin_reader = twin_reader
        self._snapshot_publisher = snapshot_publisher
        self._publisher_close = publisher_close
        self._publish_every_ticks = publish_every_ticks
        self._publish_interval = simulation.parameters.tick_seconds * publish_every_ticks
        self._clock_timeout = max(3.0, simulation.parameters.tick_seconds * 5)
        self._clock_error: str | None = None
        self._clock_heartbeat: float | None = None
        self._last_verified_publication: float | None = None
        self._last_verified_tick: int | None = None
        self._platform_error: str | None = (
            "AWAITING_FIRST_PUBLICATION" if snapshot_publisher is not None else None
        )
        self._lock = threading.RLock()
        self._publish_lock = threading.Lock()
        self._publish_event = threading.Event()
        self._publication_generation = 0
        self._pending_snapshot: tuple[int, SimulationSnapshot] | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._publisher_thread: threading.Thread | None = None

    @property
    def topology(self) -> Topology:
        return self._simulation.topology

    @property
    def platform_connected(self) -> bool:
        return self.platform_configured and self.platform_error is None

    @property
    def platform_configured(self) -> bool:
        return self._twin_reader is not None and self._snapshot_publisher is not None

    @property
    def platform_last_verified_tick(self) -> int | None:
        return self._last_verified_tick

    @property
    def platform_error(self) -> str | None:
        if not self.platform_configured:
            return "NOT_CONFIGURED"
        if self._platform_error is not None:
            return self._platform_error
        if self._last_verified_publication is None:
            return "AWAITING_DITTO_READBACK"
        # The default publication cadence is one second (two physics ticks). The
        # verified readback becomes stale only after two missed cycles plus margin.
        if monotonic() - self._last_verified_publication > self._publish_interval * 2 + 15:
            return "DITTO_READBACK_STALE"
        return None

    @property
    def simulation_error(self) -> str | None:
        if self._clock_error is not None:
            return self._clock_error
        if self._thread is None or not self._thread.is_alive():
            return "CLOCK_NOT_RUNNING"
        if (
            self._clock_heartbeat is None
            or monotonic() - self._clock_heartbeat > self._clock_timeout
        ):
            return "CLOCK_STALLED"
        return None

    @property
    def simulation_running(self) -> bool:
        """A paused simulation is healthy when its worker continues checking ticks."""
        return self.simulation_error is None

    def require_available(self) -> None:
        if not self.simulation_running:
            raise RuntimeUnavailableError("Simulation clock is unavailable")

    @contextmanager
    def _state_access(self) -> Iterator[None]:
        if not self._lock.acquire(timeout=1.0):
            raise RuntimeUnavailableError("Simulation state is busy")
        try:
            yield
        finally:
            self._lock.release()

    def _queue_publication(self, snapshot: SimulationSnapshot, *, invalidate: bool = False) -> None:
        if self._snapshot_publisher is None:
            return
        with self._publish_lock:
            if invalidate:
                self._publication_generation += 1
                self._last_verified_publication = None
                self._last_verified_tick = None
                self._platform_error = "AWAITING_DITTO_READBACK"
            self._pending_snapshot = (self._publication_generation, snapshot)
        self._publish_event.set()

    def start(self) -> None:
        with self._lock:
            if self._thread is not None:
                return
            self._stop.clear()
            self._clock_error = None
            self._clock_heartbeat = monotonic()
            self._queue_publication(self._simulation.snapshot(), invalidate=True)
            self._thread = threading.Thread(target=self._run, name="mineguard-clock", daemon=True)
            self._thread.start()
            if self._snapshot_publisher is not None:
                self._publisher_thread = threading.Thread(
                    target=self._run_publisher,
                    name="mineguard-platform-publisher",
                    daemon=True,
                )
                self._publisher_thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._publish_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=3)
            if thread.is_alive():
                raise RuntimeError("Simulation clock did not stop")
        self._thread = None
        publisher_thread = self._publisher_thread
        if publisher_thread is not None:
            publisher_thread.join(timeout=25)
            if publisher_thread.is_alive():
                raise RuntimeError("Platform publisher did not stop")
        self._publisher_thread = None
        if self._publisher_close is not None:
            self._publisher_close()

    def _run(self) -> None:
        interval = self._simulation.parameters.tick_seconds
        deadline = monotonic() + interval
        publication_deadline = monotonic() + self._publish_interval
        try:
            while not self._stop.wait(max(0.0, deadline - monotonic())):
                with self._lock:
                    previous = self._simulation.snapshot()
                    result = self._simulation.tick()
                    if result is not None:
                        self._scenarios.after_tick()
                        self._simulation.apply_emergency_response()
                    snapshot = self._simulation.snapshot()
                    if not snapshot.paused and snapshot.tick <= previous.tick:
                        raise RuntimeUnavailableError("Simulation clock did not advance")
                    if result is not None:
                        self._history.append(snapshot)
                now = monotonic()
                self._clock_heartbeat = now
                if now >= publication_deadline:
                    self._queue_publication(snapshot)
                    publication_deadline = now + self._publish_interval
                deadline += interval
        except Exception as exc:
            # Record only a type, never exception text that may contain secrets.
            self._clock_error = type(exc).__name__

    def _run_publisher(self) -> None:
        while not self._stop.is_set():
            self._publish_event.wait(timeout=0.5)
            if self._stop.is_set():
                break
            self._publish_event.clear()
            with self._publish_lock:
                pending = self._pending_snapshot
                self._pending_snapshot = None
            if pending is None or self._snapshot_publisher is None:
                continue
            generation, snapshot = pending
            try:
                result = self._snapshot_publisher(snapshot)
                readback = result if isinstance(result, SimulationSnapshot) else None
                with self._publish_lock:
                    if generation == self._publication_generation:
                        if result is True or readback is not None:
                            self._last_verified_publication = monotonic()
                            self._last_verified_tick = snapshot.tick
                            self._platform_error = None
                            if readback is not None:
                                self._store_platform_readback(readback)
                        else:
                            self._platform_error = "DITTO_PUBLICATION_UNVERIFIED"
            except Exception as exc:
                with self._publish_lock:
                    if generation == self._publication_generation:
                        self._platform_error = type(exc).__name__

    def _store_platform_readback(self, readback: SimulationSnapshot) -> None:
        previous = self._platform_snapshot
        if previous is not None and (
            readback.tick < previous.tick or readback.simulated_seconds < previous.simulated_seconds
        ):
            self._platform_history.clear()
        if previous is None or readback.tick != previous.tick or readback.paused:
            self._platform_history.append(readback)
        self._platform_snapshot = readback

    @property
    def state_source(self) -> str:
        return "ECLIPSE_DITTO_READBACK" if self.platform_configured else "LOCAL_MODEL"

    def snapshot(self) -> SimulationSnapshot:
        """Current in-memory model state, used by the controller and diagnostics."""
        with self._state_access():
            return self._simulation.snapshot()

    def platform_snapshot(self) -> SimulationSnapshot:
        """State served to the UI: the latest Ditto readback when the platform is configured."""
        if not self.platform_configured:
            return self.snapshot()
        with self._publish_lock:
            readback = self._platform_snapshot
        if readback is None:
            raise RuntimeUnavailableError("Awaiting the first Eclipse Ditto readback")
        return readback

    def history(self) -> tuple[SimulationSnapshot, ...]:
        if self.platform_configured:
            with self._publish_lock:
                return tuple(self._platform_history)
        with self._state_access():
            return tuple(self._history)

    def optimize(self) -> VodDecision:
        with self._state_access():
            return self._simulation.optimize_ventilation()

    def scenario_definitions(self) -> tuple[ScenarioDefinition, ...]:
        return tuple(
            self._scenarios.definitions[key] for key in sorted(self._scenarios.definitions)
        )

    def scenario_state(self) -> ScenarioState:
        with self._state_access():
            return self._scenarios.state()

    def start_scenario(self, scenario_id: str) -> ScenarioState:
        with self._state_access():
            state = self._scenarios.start(scenario_id)
            self._history.clear()
            self._history.append(self._simulation.snapshot())
            self._queue_publication(self._simulation.snapshot(), invalidate=True)
            return state

    def pause_scenario(self) -> ScenarioState:
        with self._state_access():
            return self._scenarios.pause()

    def resume_scenario(self) -> ScenarioState:
        with self._state_access():
            return self._scenarios.resume()

    def reset_scenario(self) -> ScenarioState:
        with self._state_access():
            state = self._scenarios.reset()
            self._history.clear()
            self._history.append(self._simulation.snapshot())
            self._queue_publication(self._simulation.snapshot(), invalidate=True)
            return state

    def decision_trace(self) -> dict[str, Any]:
        with self._state_access():
            snapshot = self._simulation.snapshot()
            vod = self._simulation.optimize_ventilation()
            risk = self._simulation.parameters.risk_thresholds
            optimizer = self._simulation.parameters.vod
            return {
                "simulation_only": True,
                "source_type": snapshot.source_type,
                "evaluated_on": "CONTROLLER_MODEL_STATE",
                "model_tick": snapshot.tick,
                "platform_last_verified_tick": self.platform_last_verified_tick,
                "simulated_seconds": snapshot.simulated_seconds,
                "scenario": self._scenarios.state().model_dump(mode="json"),
                "risk_assessments": [item.model_dump(mode="json") for item in snapshot.risks],
                "safety_decisions": [item.model_dump(mode="json") for item in snapshot.safety],
                "vod_decision": vod.model_dump(mode="json"),
                "constraints": {
                    "warning_methane_fraction": risk.warning_methane_fraction,
                    "warning_co_fraction": risk.warning_co_fraction,
                    "minimum_airflow_m3s": risk.minimum_airflow_m3s,
                    "max_speed_step_fraction": optimizer.max_speed_step_fraction,
                    "forecast_horizon_seconds": optimizer.forecast_horizon_seconds,
                },
            }

    def engineering_evidence(self) -> dict[str, Any]:
        trace = self.decision_trace()
        return {
            "project": "MineGuard X",
            "simulation_only": True,
            "mine_id": self.topology.mine_id,
            "model_source": "SYNTHETIC_PHYSICS",
            "assumption_source": self.topology.assumption_source,
            "equations": {
                "fan_curve": "delta_p = shutoff_pressure * speed^2 - K * flow^2",
                "fan_power": "power = rated_power * speed^3",
                "gas_balance": "V dc/dt = sum(q_in*c_in) - sum(q_out*c) + source",
            },
            "units": {
                "internal_methane": "volume fraction",
                "display_methane": "% volume",
                "internal_co": "volume fraction",
                "display_co": "ppm",
                "fan_speed": "rpm",
                "airflow": "m3/s",
                "power": "kW",
                "energy": "kWh",
            },
            "decision_trace": trace,
            "limitations": [
                "Fictional uncalibrated geometry and parameters",
                "No real equipment integration",
                "Calculated energy is a model estimate, not measured savings",
            ],
        }

    def read_twin(self, thing_id: str) -> dict[str, Any] | None:
        if self._twin_reader is None:
            raise ConnectionError("Eclipse Ditto is not configured")
        try:
            value = self._twin_reader(thing_id)
            return value
        except (OSError, RuntimeError, TimeoutError) as exc:
            self._platform_error = type(exc).__name__
            raise
