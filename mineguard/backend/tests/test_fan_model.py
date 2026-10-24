from math import isclose

import pytest

from app.models import Topology
from app.physics.fan_model import energy_kwh, fan_power_kw, fan_pressure_pa, fan_speed_rpm


def test_affinity_law_relationships(topology: Topology) -> None:
    fan = next(item for item in topology.fans if item.id == "FAN_MAIN")
    assert fan_pressure_pa(fan, 0.5, 0.0) == pytest.approx(0.25 * fan.shutoff_pressure_pa)
    assert fan_power_kw(fan, 0.5) == pytest.approx(0.125 * fan.rated_power_kw)
    assert fan_pressure_pa(fan, 0.5, 10.0) < fan_pressure_pa(fan, 0.5, 0.0)


def test_energy_conversion_and_fault_power(topology: Topology) -> None:
    fan = next(item for item in topology.fans if item.id == "FAN_AUX")
    assert isclose(energy_kwh(60.0, 60.0), 1.0)
    assert fan_power_kw(fan, 1.0, faulted=True) == 0.0


def test_rpm_feedback_scales_with_configured_nameplate_speed(topology: Topology) -> None:
    fan = next(item for item in topology.fans if item.id == "FAN_MAIN")
    assert fan_speed_rpm(fan, 0.75) == pytest.approx(0.75 * fan.rated_speed_rpm)
    assert fan_speed_rpm(fan, 0.75, faulted=True) == 0.0


@pytest.mark.parametrize("value", [-0.1, 1.1, float("inf"), float("nan"), True])
def test_invalid_fan_speed_is_rejected(topology: Topology, value: float) -> None:
    with pytest.raises(ValueError):
        fan_power_kw(topology.fans[0], value)
