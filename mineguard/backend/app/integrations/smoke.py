"""Real-stack M2 verification through MQTT, Ditto, and InfluxDB."""

from __future__ import annotations

import time
from dataclasses import asdict
from datetime import UTC, datetime
from math import isfinite
from typing import Any

from app.integrations.bootstrap_twins import BootstrapResult, bootstrap_twins, zone_thing_id
from app.integrations.ditto import DittoClient
from app.integrations.mqtt import mqtt_publisher
from app.integrations.platform_config import PlatformConfig
from app.integrations.storage import InfluxVerifier
from app.integrations.telemetry import (
    ditto_modify_features,
    mqtt_topic,
    snapshot_features,
)
from app.simulation.runtime import Simulation


def _run_id() -> str:
    return datetime.now(UTC).strftime("m2-%Y%m%dT%H%M%S%fZ")


def _ditto_has_run(thing_id: str, thing: dict[str, Any] | None, run_id: str, tick: int) -> bool:
    if thing is None:
        return False
    try:
        features = thing["features"]
        common_valid = bool(
            features["idSimulationRun"]["properties"]["value"] == run_id
            and features["simulation"]["properties"]["tick"] == tick
        )
        if not common_valid:
            return common_valid
        if thing_id.startswith("mineguard:zone-"):
            risk = features["risk"]["properties"]
            co = features["co"]["properties"]
            interlock = features["safety_interlock"]["properties"]
            return bool(
                risk["simulation_only"] is True
                and risk["value"] in {"NORMAL", "ADVISORY", "WARNING", "EMERGENCY", "UNKNOWN_DATA"}
                and co["unit"] == "ppm"
                and isfinite(float(co["value"]))
                and interlock["simulation_only"] is True
                and interlock["equipment_io"] is False
                and isinstance(interlock["trip_power"], bool)
            )
        if thing_id.startswith("mineguard:fan-"):
            rpm = features["rpm"]["properties"]
            return bool(rpm["unit"] == "rpm" and isfinite(float(rpm["value"])))
        return True
    except (KeyError, TypeError):
        return False


def run_smoke(
    config: PlatformConfig,
    simulation: Simulation,
    *,
    ditto_timeout_seconds: float = 30.0,
    influx_timeout_seconds: float = 40.0,
) -> dict[str, object]:
    topology = simulation.topology
    ditto = DittoClient(config.ditto_url, config.ditto_user, config.ditto_password)
    bootstrap: BootstrapResult = bootstrap_twins(ditto, topology)
    for _ in range(20):
        simulation.tick()
    snapshot = simulation.snapshot()
    run_id = _run_id()
    features = snapshot_features(snapshot, topology, run_id)
    with mqtt_publisher(config.host, config.mqtt_port) as publisher:
        for thing_id, thing_features in features.items():
            publisher.publish(mqtt_topic(thing_id), ditto_modify_features(thing_id, thing_features))

    pending = set(features)
    deadline = time.monotonic() + ditto_timeout_seconds
    while pending and time.monotonic() < deadline:
        pending = {
            thing_id
            for thing_id in pending
            if not _ditto_has_run(thing_id, ditto.get_thing(thing_id), run_id, snapshot.tick)
        }
        if pending:
            time.sleep(0.5)
    if pending:
        raise RuntimeError(f"Ditto did not persist this run for: {', '.join(sorted(pending))}")

    influx = InfluxVerifier(
        config.influxdb_url,
        config.influxdb_token,
        config.influxdb_org,
        config.influxdb_bucket,
    )
    evidence_id = zone_thing_id("Z04")
    deadline = time.monotonic() + influx_timeout_seconds
    while time.monotonic() < deadline:
        if influx.run_seen(evidence_id, run_id):
            break
        time.sleep(1.0)
    else:
        raise RuntimeError(f"InfluxDB did not receive run {run_id} for {evidence_id}")

    return {
        "result": "PASS",
        "run_id": run_id,
        "simulation_only": True,
        "bootstrap": asdict(bootstrap),
        "snapshot_tick": snapshot.tick,
        "simulated_seconds": snapshot.simulated_seconds,
        "ditto_verified": sorted(features),
        "influx_verified": evidence_id,
        "airflow_m3s": snapshot.airways[0].flow_m3s,
        "max_methane_percent_volume": 100 * max(zone.methane_fraction for zone in snapshot.zones),
        "max_co_ppm": max(zone.co_ppm for zone in snapshot.zones),
        "fan_actual_rpm": {fan.fan_id: fan.actual_speed_rpm for fan in snapshot.fans},
    }
