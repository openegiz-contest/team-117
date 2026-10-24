import math

import pytest

from app.units import fraction_to_percent, fraction_to_ppm, percent_to_fraction, ppm_to_fraction


def test_explicit_methane_units() -> None:
    fraction = percent_to_fraction(0.8)
    assert fraction == pytest.approx(0.008)
    assert fraction_to_ppm(fraction) == pytest.approx(8000)
    assert fraction_to_percent(ppm_to_fraction(8000)) == pytest.approx(0.8)


def test_explicit_co_ppm_round_trip() -> None:
    co_fraction = ppm_to_fraction(35.0)
    assert co_fraction == pytest.approx(0.000035)
    assert fraction_to_ppm(co_fraction) == pytest.approx(35.0)


@pytest.mark.parametrize("value", [-1.0, math.nan, math.inf, -math.inf, True])
@pytest.mark.parametrize(
    "converter",
    [
        fraction_to_percent,
        fraction_to_ppm,
        percent_to_fraction,
        ppm_to_fraction,
    ],
)
def test_reject_nonphysical_values(value, converter) -> None:
    with pytest.raises(ValueError):
        converter(value)


@pytest.mark.parametrize(
    "converter,value",
    [
        (fraction_to_percent, 1.01),
        (fraction_to_ppm, 1.01),
        (percent_to_fraction, 101.0),
        (ppm_to_fraction, 1_000_001.0),
    ],
)
def test_reject_values_exceeding_complete_volume(converter, value) -> None:
    with pytest.raises(ValueError):
        converter(value)
