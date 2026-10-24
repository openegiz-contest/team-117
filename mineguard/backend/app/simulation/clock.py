"""Fixed-step simulated time has no dependence on wall-clock scheduling."""

from dataclasses import dataclass
from math import isfinite


@dataclass(frozen=True)
class SimulationClock:
    step_seconds: float
    ticks: int = 0

    def __post_init__(self) -> None:
        if (
            isinstance(self.step_seconds, bool)
            or not isfinite(self.step_seconds)
            or self.step_seconds <= 0
        ):
            raise ValueError("Clock step must be finite and positive")
        if isinstance(self.ticks, bool) or not isinstance(self.ticks, int) or self.ticks < 0:
            raise ValueError("Clock ticks must be a nonnegative integer")

    @property
    def elapsed_seconds(self) -> float:
        return self.ticks * self.step_seconds

    def advance(self) -> "SimulationClock":
        return SimulationClock(self.step_seconds, self.ticks + 1)
