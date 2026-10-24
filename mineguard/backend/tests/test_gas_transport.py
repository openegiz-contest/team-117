from math import exp
from random import Random

import pytest

from app.models import GasFlow
from app.physics.gas_transport import advance_gas


def inlet_outlet(rate: float, concentration: float = 0.0) -> tuple[GasFlow, ...]:
    return (
        GasFlow(source=None, target="A", flow_m3s=rate, inlet_fraction=concentration),
        GasFlow(source="A", target=None, flow_m3s=rate),
    )


def test_uniform_concentration_is_preserved_without_source() -> None:
    result = advance_gas({"A": 10.0}, {"A": 0.02}, inlet_outlet(2.0, 0.02), {"A": 0.0}, 100)
    assert result.fractions["A"] == pytest.approx(0.02)
    assert abs(result.balance_residual_m3) < 1e-12


def test_closed_zone_source_uses_volume_per_second() -> None:
    result = advance_gas({"A": 100.0}, {"A": 0.001}, (), {"A": 0.01}, 10)
    assert result.source_added_m3 == pytest.approx(0.1)
    assert result.fractions["A"] == pytest.approx(0.002)
    assert result.gas_before_m3 == result.methane_before_m3
    assert result.gas_after_m3 == result.methane_after_m3
    assert abs(result.balance_residual_m3) < 1e-12


def test_dilution_converges_to_analytical_well_mixed_solution() -> None:
    expected = 0.1 * exp(-2)
    coarse = advance_gas({"A": 10.0}, {"A": 0.1}, inlet_outlet(2.0), {"A": 0.0}, 10, cfl_limit=0.1)
    fine = advance_gas({"A": 10.0}, {"A": 0.1}, inlet_outlet(2.0), {"A": 0.0}, 10, cfl_limit=0.01)
    assert abs(fine.fractions["A"] - expected) < abs(coarse.fractions["A"] - expected)
    assert fine.fractions["A"] == pytest.approx(expected, rel=0.02)


def test_increased_ventilation_lowers_source_driven_steady_concentration() -> None:
    slow = advance_gas({"A": 10.0}, {"A": 0.0}, inlet_outlet(1.0), {"A": 0.02}, 1000)
    fast = advance_gas({"A": 10.0}, {"A": 0.0}, inlet_outlet(2.0), {"A": 0.02}, 1000)
    assert slow.fractions["A"] == pytest.approx(0.02)
    assert fast.fractions["A"] == pytest.approx(0.01)


def test_source_propagates_downstream_on_successive_simultaneous_steps() -> None:
    flows = (
        GasFlow(source=None, target="A", flow_m3s=2.0),
        GasFlow(source="A", target="B", flow_m3s=2.0),
        GasFlow(source="B", target=None, flow_m3s=2.0),
    )
    volumes, sources = {"A": 10.0, "B": 10.0}, {"A": 0.01, "B": 0.0}
    first = advance_gas(volumes, {"A": 0.0, "B": 0.0}, flows, sources, 0.1)
    second = advance_gas(volumes, first.fractions, flows, sources, 0.1)
    assert first.fractions["A"] > 0
    assert first.fractions["B"] == 0
    assert second.fractions["B"] > 0


def test_large_interval_substeps_without_negative_concentration() -> None:
    result = advance_gas({"A": 10.0}, {"A": 0.1}, inlet_outlet(2.0), {"A": 0.0}, 20)
    assert result.substeps == 8
    assert 0 < result.fractions["A"] < 0.1
    assert abs(result.balance_residual_m3) < 1e-12


def test_seeded_closed_networks_conserve_methane() -> None:
    rng = Random(2026)
    for _ in range(100):
        volumes = {z: rng.uniform(50, 500) for z in ("A", "B", "C")}
        fractions = {z: rng.uniform(0, 0.1) for z in volumes}
        rate = rng.uniform(1, 20)
        flows = tuple(
            GasFlow(source=a, target=b, flow_m3s=rate)
            for a, b in (("A", "B"), ("B", "C"), ("C", "A"))
        )
        result = advance_gas(
            volumes, fractions, flows, dict.fromkeys(volumes, 0.0), rng.uniform(0.1, 100)
        )
        assert result.methane_after_m3 == pytest.approx(result.methane_before_m3, abs=1e-10)
        assert abs(result.balance_residual_m3) < 1e-10
        assert all(
            min(fractions.values()) <= c <= max(fractions.values())
            for c in result.fractions.values()
        )


def test_impossible_source_fails_without_clipping_or_mutating_input() -> None:
    initial = {"A": 0.99}
    with pytest.raises(ValueError, match="no clipping"):
        advance_gas({"A": 1.0}, initial, (), {"A": 1.0}, 1)
    assert initial == {"A": 0.99}


def test_reject_unbalanced_ventilation() -> None:
    with pytest.raises(ValueError, match="Unbalanced"):
        advance_gas({"A": 10.0}, {"A": 0.0}, inlet_outlet(1.0)[:1], {"A": 0.0}, 1)


def test_reject_unknown_flow_endpoint() -> None:
    with pytest.raises(ValueError, match="unknown"):
        advance_gas({"B": 10.0}, {"B": 0.0}, inlet_outlet(1.0), {"B": 0.0}, 1)


def test_reject_work_exceeding_substep_limit() -> None:
    with pytest.raises(ValueError, match="work limit"):
        advance_gas({"A": 10.0}, {"A": 0.0}, inlet_outlet(100.0), {"A": 0.0}, 100, max_substeps=10)


@pytest.mark.parametrize("dt", [0, -1, float("nan"), float("inf"), True])
def test_reject_invalid_step(dt) -> None:
    with pytest.raises(ValueError):
        advance_gas({"A": 10.0}, {"A": 0.0}, (), {"A": 0.0}, dt)


@pytest.mark.parametrize("value", [-1, 1.1, float("nan")])
def test_reject_invalid_initial_fraction(value) -> None:
    with pytest.raises(ValueError):
        advance_gas({"A": 10.0}, {"A": value}, (), {"A": 0.0}, 1)
