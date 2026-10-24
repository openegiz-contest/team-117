"""Deterministic simulation-only scenario lifecycle."""

from app.models import ScenarioDefinition, ScenarioRunStatus, ScenarioState
from app.simulation.runtime import Simulation


class ScenarioEngine:
    def __init__(self, simulation: Simulation, definitions: tuple[ScenarioDefinition, ...]) -> None:
        self.simulation = simulation
        self.definitions = {item.id: item for item in definitions}
        self._active: ScenarioDefinition | None = None
        self._actions: list[str] = []
        self._status = ScenarioRunStatus.IDLE

    def state(self) -> ScenarioState:
        elapsed = self.simulation.snapshot().simulated_seconds if self._active else 0.0
        if self._active and self._status is ScenarioRunStatus.COMPLETED:
            elapsed = self._active.duration_seconds
        return ScenarioState(
            scenario_id=self._active.id if self._active else None,
            status=self._status,
            elapsed_seconds=elapsed,
            duration_seconds=self._active.duration_seconds if self._active else 0.0,
            applied_actions=tuple(self._actions),
        )

    def start(self, scenario_id: str) -> ScenarioState:
        try:
            definition = self.definitions[scenario_id]
        except KeyError as exc:
            raise ValueError(f"Unknown scenario: {scenario_id}") from exc
        self.simulation.reset()
        self._active = definition
        self._actions = []
        self._status = ScenarioRunStatus.RUNNING
        if definition.methane_source_zone_id and definition.methane_source_m3s is not None:
            self.simulation.set_methane_source(
                definition.methane_source_zone_id, definition.methane_source_m3s
            )
            self._actions.append("METHANE_SOURCE_APPLIED")
        return self.state()

    def after_tick(self) -> None:
        if self._active is None or self._status is not ScenarioRunStatus.RUNNING:
            return
        elapsed = self.simulation.snapshot().simulated_seconds
        if (
            self._active.fan_failure_id
            and self._active.fan_failure_at_seconds is not None
            and elapsed >= self._active.fan_failure_at_seconds
            and "FAN_FAILURE_APPLIED" not in self._actions
        ):
            self.simulation.set_fan(self._active.fan_failure_id, faulted=True)
            self._actions.append("FAN_FAILURE_APPLIED")
        if elapsed >= self._active.duration_seconds:
            self._restore_actions()
            self._status = ScenarioRunStatus.COMPLETED

    def pause(self) -> ScenarioState:
        if self._status is not ScenarioRunStatus.RUNNING:
            raise ValueError("Only a running scenario can be paused")
        self.simulation.pause()
        self._status = ScenarioRunStatus.PAUSED
        return self.state()

    def resume(self) -> ScenarioState:
        if self._status is not ScenarioRunStatus.PAUSED:
            raise ValueError("Only a paused scenario can be resumed")
        self.simulation.resume()
        self._status = ScenarioRunStatus.RUNNING
        return self.state()

    def reset(self) -> ScenarioState:
        self.simulation.reset()
        self._active = None
        self._actions = []
        self._status = ScenarioRunStatus.IDLE
        return self.state()

    def _restore_actions(self) -> None:
        if self._active is None:
            return
        if self._active.methane_source_zone_id:
            initial = next(
                item.methane_source_m3s
                for item in self.simulation.parameters.initial_zones
                if item.zone_id == self._active.methane_source_zone_id
            )
            self.simulation.set_methane_source(self._active.methane_source_zone_id, initial)
        if self._active.fan_failure_id:
            self.simulation.set_fan(self._active.fan_failure_id, faulted=False)
