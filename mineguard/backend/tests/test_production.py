"""The simulated production stop must change the physics, not just a flag."""

from app.config import load_scenarios
from app.integrations.bootstrap_twins import twin_definitions
from app.integrations.telemetry import equipment_features
from app.models import Parameters, RiskState, Topology
from app.simulation.runtime import Simulation
from app.simulation.scenarios import ScenarioEngine


def test_baseline_machine_runs_and_adds_cutting_emissions(
    topology: Topology, parameters: Parameters
) -> None:
    production = Simulation(topology, parameters).snapshot().production
    assert production is not None
    assert production.running
    assert production.power_kw == parameters.production.operating_power_kw
    assert production.cutting_methane_m3s == parameters.production.cutting_methane_m3s
    # Strata plus cutting emission equals the documented 0.04 m3/s face source.
    strata = next(z for z in parameters.initial_zones if z.zone_id == "Z04").methane_source_m3s
    assert strata + production.cutting_methane_m3s == 0.04


def test_trip_power_stops_the_machine_and_its_emissions(
    topology: Topology, parameters: Parameters
) -> None:
    simulation = Simulation(topology, parameters)
    engine = ScenarioEngine(simulation, load_scenarios())
    engine.start("S2_MAIN_FAN_FAILURE")
    for _ in range(22):
        simulation.tick()
        engine.after_tick()
    snapshot = simulation.snapshot()
    face = next(item for item in snapshot.safety if item.zone_id == "Z04")
    assert face.risk_state is RiskState.EMERGENCY and face.production_stop
    production = snapshot.production
    assert production is not None and not production.running
    assert production.power_kw == 0 and production.cutting_methane_m3s == 0
    features = equipment_features(snapshot, "live-production-1")
    assert features["state"]["properties"]["value"] == "TRIPPED"  # type: ignore[index]


def test_stopped_cutting_removes_its_methane_from_the_mass_balance(
    topology: Topology, parameters: Parameters
) -> None:
    """With no airflow, Z04 gains exactly the strata source once the machine has tripped."""
    model = Simulation(topology, parameters)
    model.set_fan("FAN_MAIN", faulted=True)  # EMERGENCY everywhere: trip_power stops cutting
    production = model.snapshot().production
    assert production is not None and not production.running
    for _ in range(60):  # 30 simulated seconds
        model.tick()
    initial = next(z for z in parameters.initial_zones if z.zone_id == "Z04")
    volume = next(z.volume_m3 for z in topology.zones if z.id == "Z04")
    face = next(z.methane_fraction for z in model.snapshot().zones if z.zone_id == "Z04")
    strata_only = initial.methane_fraction + initial.methane_source_m3s * 30.0 / volume
    with_cutting = strata_only + parameters.production.cutting_methane_m3s * 30.0 / volume
    assert abs(face - strata_only) < 1e-12
    assert face < with_cutting


def test_equipment_twin_is_related_to_its_zone(topology: Topology, parameters: Parameters) -> None:
    definitions = twin_definitions(topology, parameters.production)
    assert len(definitions) == 16
    machine = definitions["mineguard:shearer-z04"]["attributes"]
    assert machine["zone_id"] == "mineguard:zone-z04"  # type: ignore[index]
    zone = definitions["mineguard:zone-z04"]["attributes"]
    assert zone["equipment_ids"] == ["mineguard:shearer-z04"]  # type: ignore[index]
