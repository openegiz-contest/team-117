"""Conservative explicit well-mixed trace-gas transport on balanced airflows."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import ceil, fsum, isclose, isfinite

from app.models import GasFlow


@dataclass(frozen=True)
class GasStepResult:
    fractions: dict[str, float]
    substeps: int
    gas_before_m3: float
    gas_after_m3: float
    source_added_m3: float
    inlet_added_m3: float
    exhausted_m3: float
    balance_residual_m3: float

    @property
    def methane_before_m3(self) -> float:
        """Backward-compatible methane name for existing methane-only evidence."""
        return self.gas_before_m3

    @property
    def methane_after_m3(self) -> float:
        """Backward-compatible methane name for existing methane-only evidence."""
        return self.gas_after_m3


def _finite_nonnegative(value: float, name: str, *, positive: bool = False) -> None:
    if isinstance(value, bool) or not isfinite(value) or value < 0 or (positive and value == 0):
        raise ValueError(f"{name} must be finite and {'positive' if positive else 'nonnegative'}")


def advance_gas(
    volumes_m3: Mapping[str, float],
    fractions: Mapping[str, float],
    flows: Sequence[GasFlow],
    sources_m3s: Mapping[str, float],
    dt_seconds: float,
    *,
    cfl_limit: float = 0.5,
    max_substeps: int = 10000,
) -> GasStepResult:
    """Advance simultaneously; reject imbalance, impossible state or excessive work.

    Source volume is a dilute tracer in a fixed-volume carrier mixture.
    Constant-density ventilation balance excludes the source's bulk volume.
    All volumes/rates refer to the same assumed pressure and temperature.
    """
    _finite_nonnegative(dt_seconds, "dt_seconds", positive=True)
    _finite_nonnegative(cfl_limit, "cfl_limit", positive=True)
    if cfl_limit > 1:
        raise ValueError("cfl_limit cannot exceed 1")
    if isinstance(max_substeps, bool) or not isinstance(max_substeps, int) or max_substeps < 1:
        raise ValueError("max_substeps must be a positive integer")
    zones = sorted(volumes_m3)
    if not zones or set(fractions) != set(zones) or set(sources_m3s) != set(zones):
        raise ValueError("Volumes, concentrations and sources require identical nonempty zone IDs")
    for zone in zones:
        _finite_nonnegative(volumes_m3[zone], "zone volume", positive=True)
        _finite_nonnegative(fractions[zone], "gas fraction")
        _finite_nonnegative(sources_m3s[zone], "gas source")
        if fractions[zone] > 1:
            raise ValueError("Gas fraction exceeds 1")
    inflows: dict[str, list[GasFlow]] = {zone: [] for zone in zones}
    outflows: dict[str, list[GasFlow]] = {zone: [] for zone in zones}
    for flow in flows:
        if flow.source is not None:
            if flow.source not in outflows:
                raise ValueError("Flow references unknown source")
            outflows[flow.source].append(flow)
        if flow.target is not None:
            if flow.target not in inflows:
                raise ValueError("Flow references unknown target")
            inflows[flow.target].append(flow)
    out_rate = {zone: fsum(f.flow_m3s for f in outflows[zone]) for zone in zones}
    for zone in zones:
        incoming = fsum(f.flow_m3s for f in inflows[zone])
        if not isclose(incoming, out_rate[zone], rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError(f"Unbalanced ventilation in {zone}")
    required = dt_seconds * max(out_rate[z] / volumes_m3[z] for z in zones) / cfl_limit
    if not isfinite(required) or required > max_substeps:
        raise ValueError("Required transport substeps exceed configured work limit")
    substeps = max(1, ceil(required))
    h = dt_seconds / substeps
    current = dict(fractions)
    before = fsum(volumes_m3[z] * current[z] for z in zones)
    source_added = fsum(sources_m3s.values()) * dt_seconds
    inlet_added = fsum(f.flow_m3s * f.inlet_fraction for f in flows if f.source is None)
    inlet_added *= dt_seconds
    exhausted_steps = []
    for _ in range(substeps):
        exhausted_steps.append(
            h
            * fsum(
                f.flow_m3s * current[f.source]
                for f in flows
                if f.target is None and f.source is not None
            )
        )
        updated = {}
        for zone in zones:
            incoming_gas = fsum(
                f.flow_m3s * (f.inlet_fraction if f.source is None else current[f.source])
                for f in inflows[zone]
            )
            # Convex transport contribution; nonnegative sources cannot create negative gas.
            value = (
                current[zone] * (1 - h * out_rate[zone] / volumes_m3[zone])
                + h * (sources_m3s[zone] + incoming_gas) / volumes_m3[zone]
            )
            if not isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"Gas fraction outside physical range in {zone}; no clipping")
            updated[zone] = value
        current = updated
    after = fsum(volumes_m3[z] * current[z] for z in zones)
    exhausted = fsum(exhausted_steps)
    residual = fsum([after, -before, -source_added, -inlet_added, exhausted])
    return GasStepResult(
        current, substeps, before, after, source_added, inlet_added, exhausted, residual
    )
