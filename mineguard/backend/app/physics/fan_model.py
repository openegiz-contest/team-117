"""Explicit demonstration fan curve and affinity-law power approximation."""

from dataclasses import dataclass
from math import isfinite

from app.models import Fan


@dataclass(frozen=True)
class FanOperatingPoint:
    speed_fraction: float
    flow_m3s: float
    pressure_pa: float
    power_kw: float
    faulted: bool


def _fraction(value: float) -> float:
    if isinstance(value, bool) or not isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Fan speed must be a finite fraction in [0, 1]")
    return value


def fan_pressure_pa(fan: Fan, speed_fraction: float, flow_m3s: float) -> float:
    """Quadratic curve: pressure = shutoff pressure * speed² - K * flow²."""
    speed = _fraction(speed_fraction)
    if isinstance(flow_m3s, bool) or not isfinite(flow_m3s) or flow_m3s < 0:
        raise ValueError("Fan flow must be finite and nonnegative")
    return fan.shutoff_pressure_pa * speed**2 - fan.curve_resistance_pa_s2_m6 * flow_m3s**2


def fan_power_kw(fan: Fan, speed_fraction: float, *, faulted: bool = False) -> float:
    """Uncalibrated affinity-law estimate, valid only within this demo model."""
    speed = _fraction(speed_fraction)
    return 0.0 if faulted else fan.rated_power_kw * speed**3


def fan_speed_rpm(fan: Fan, speed_fraction: float, *, faulted: bool = False) -> float:
    """Convert simulated per-unit feedback to RPM using the configured nameplate speed."""
    speed = _fraction(speed_fraction)
    return 0.0 if faulted else fan.rated_speed_rpm * speed


def energy_kwh(power_kw: float, dt_seconds: float) -> float:
    if (
        isinstance(power_kw, bool)
        or isinstance(dt_seconds, bool)
        or not isfinite(power_kw)
        or not isfinite(dt_seconds)
        or power_kw < 0
        or dt_seconds < 0
    ):
        raise ValueError("Power and duration must be finite and nonnegative")
    return power_kw * dt_seconds / 3600.0
