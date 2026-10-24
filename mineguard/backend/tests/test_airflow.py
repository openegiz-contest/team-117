from math import fsum

import pytest

from app.models import Parameters, Topology
from app.physics.airflow import gas_flows_from_airflow, solve_airflow
from app.physics.gas_transport import advance_gas


def _settings(parameters: Parameters) -> tuple[dict[str, float], dict[str, bool]]:
    return (
        {item.fan_id: item.speed_fraction for item in parameters.initial_fans},
        {item.fan_id: item.faulted for item in parameters.initial_fans},
    )


def test_solver_conserves_air_at_every_zone(topology: Topology, parameters: Parameters) -> None:
    result = solve_airflow(topology, *_settings(parameters))
    flows = gas_flows_from_airflow(topology, result)
    assert result.converged
    assert result.total_flow_m3s > 0
    for zone in topology.zones:
        incoming = fsum(flow.flow_m3s for flow in flows if flow.target == zone.id)
        outgoing = fsum(flow.flow_m3s for flow in flows if flow.source == zone.id)
        assert incoming == pytest.approx(outgoing, abs=1e-10)


def test_main_fan_failure_stops_network_flow(topology: Topology, parameters: Parameters) -> None:
    speeds, faults = _settings(parameters)
    faults["FAN_MAIN"] = True
    result = solve_airflow(topology, speeds, faults)
    assert result.total_flow_m3s == 0
    assert set(result.airway_flows_m3s.values()) == {0.0}
    assert result.fan_points["FAN_MAIN"].speed_fraction == 0
    assert result.fan_points["FAN_MAIN"].power_kw == 0


def test_obstruction_redistributes_branch_flow(topology: Topology, parameters: Parameters) -> None:
    speeds, faults = _settings(parameters)
    normal = solve_airflow(topology, speeds, faults)
    obstructed = solve_airflow(topology, speeds, faults, {"E03": 4.0})
    assert obstructed.airway_flows_m3s["E03"] < normal.airway_flows_m3s["E03"]
    assert obstructed.airway_flows_m3s["E02"] > normal.airway_flows_m3s["E02"]


def test_auxiliary_fan_increases_heading_share(topology: Topology, parameters: Parameters) -> None:
    speeds, faults = _settings(parameters)
    stopped = solve_airflow(topology, {**speeds, "FAN_AUX": 0.0}, faults)
    running = solve_airflow(topology, {**speeds, "FAN_AUX": 1.0}, faults)
    stopped_share = stopped.airway_flows_m3s["E02"] / stopped.total_flow_m3s
    running_share = running.airway_flows_m3s["E02"] / running.total_flow_m3s
    assert running_share > stopped_share


def test_dynamic_airflow_changes_gas_transport(topology: Topology, parameters: Parameters) -> None:
    speeds, faults = _settings(parameters)
    fast = solve_airflow(topology, speeds, faults)
    slow = solve_airflow(topology, {**speeds, "FAN_MAIN": 0.4}, faults)
    volumes = {zone.id: zone.volume_m3 for zone in topology.zones}
    fractions = {item.zone_id: item.methane_fraction for item in parameters.initial_zones}
    sources = {item.zone_id: item.methane_source_m3s for item in parameters.initial_zones}
    fast_step = advance_gas(
        volumes, fractions, gas_flows_from_airflow(topology, fast), sources, 30.0
    )
    slow_step = advance_gas(
        volumes, fractions, gas_flows_from_airflow(topology, slow), sources, 30.0
    )
    assert fast_step.fractions != slow_step.fractions


def test_co_transport_uses_explicit_intake_fraction(
    topology: Topology, parameters: Parameters
) -> None:
    speeds, faults = _settings(parameters)
    airflow = solve_airflow(topology, speeds, faults)
    flows = gas_flows_from_airflow(topology, airflow, tracer="co")
    inlet = next(flow for flow in flows if flow.source is None)
    boundary = next(item for item in topology.boundaries if item.kind == "INLET")
    assert inlet.inlet_fraction == boundary.co_fraction


@pytest.mark.parametrize("factor", [0.0, 0.5, float("inf"), True])
def test_invalid_obstruction_is_rejected(
    topology: Topology, parameters: Parameters, factor: float
) -> None:
    with pytest.raises(ValueError):
        solve_airflow(topology, _settings(parameters)[0], obstruction_factors={"E03": factor})
