"""Explicit gas-unit conversions. Never infer units from a numeric magnitude."""

from math import isfinite


def _bounded(value: float, maximum: float) -> float:
    if isinstance(value, bool) or not isfinite(value) or not 0 <= value <= maximum:
        raise ValueError(f"Expected a finite value between 0 and {maximum}")
    return value


def fraction_to_percent(value: float) -> float:
    return _bounded(value, 1.0) * 100.0


def percent_to_fraction(value: float) -> float:
    return _bounded(value, 100.0) / 100.0


def fraction_to_ppm(value: float) -> float:
    return _bounded(value, 1.0) * 1_000_000.0


def ppm_to_fraction(value: float) -> float:
    return _bounded(value, 1_000_000.0) / 1_000_000.0
