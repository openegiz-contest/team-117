"""Long-lived bridge from the simulator to the official OpenEgiz MQTT path."""

from datetime import UTC, datetime
from time import monotonic, sleep
from typing import Any

from app.integrations.bootstrap_twins import bootstrap_twins
from app.integrations.ditto import DittoClient
from app.integrations.mqtt import MqttPublisher
from app.integrations.platform_state import snapshot_from_things
from app.integrations.telemetry import (
    ditto_modify_features,
    mqtt_topic,
    snapshot_features,
)
from app.models import ProductionParameters, SimulationSnapshot, Topology


class LivePlatformBridge:
    def __init__(
        self,
        topology: Topology,
        ditto_url: str,
        ditto_user: str,
        ditto_password: str,
        mqtt_host: str,
        mqtt_port: int,
        *,
        production: ProductionParameters | None = None,
        verification_timeout_seconds: float = 10.0,
    ) -> None:
        if verification_timeout_seconds <= 0:
            raise ValueError("Ditto verification timeout must be positive")
        self._topology = topology
        self._production = production
        self._ditto = DittoClient(ditto_url, ditto_user, ditto_password, timeout_seconds=5.0)
        self._mqtt_host = mqtt_host
        self._mqtt_port = mqtt_port
        self._mqtt: MqttPublisher | None = None
        self._bootstrapped = False
        self._run_id = datetime.now(UTC).strftime("live-%Y%m%dT%H%M%S%fZ")
        self._publication_sequence = 0
        self._verification_timeout = verification_timeout_seconds

    def read_twin(self, thing_id: str) -> dict[str, Any] | None:
        return self._ditto.get_thing(thing_id)

    def publish(self, snapshot: SimulationSnapshot) -> SimulationSnapshot:
        """Publish through MQTT, then return the state rebuilt from Ditto's stored twins.

        The returned snapshot is derived only from the authenticated Ditto readback,
        so the UI shows platform state rather than the simulator's memory.
        """
        if not self._bootstrapped:
            bootstrap_twins(self._ditto, self._topology, self._production)
            self._bootstrapped = True
        if self._mqtt is None:
            self._mqtt = MqttPublisher(self._mqtt_host, self._mqtt_port)
        self._publication_sequence += 1
        # A reset reuses tick 0; a distinct marker prevents old state satisfying
        # the readback check for a new publication at the same simulated tick.
        run_id = f"{self._run_id}-{self._publication_sequence}"
        updates = snapshot_features(snapshot, self._topology, run_id)
        for thing_id, features in updates.items():
            self._mqtt.publish(mqtt_topic(thing_id), ditto_modify_features(thing_id, features))
        deadline = monotonic() + self._verification_timeout
        while True:
            things = self._ditto.get_things(updates)
            if set(things) == set(updates) and all(
                self._matches_publication(thing, run_id, snapshot.tick) for thing in things.values()
            ):
                return snapshot_from_things(self._topology, things, run_id, self._production)
            if monotonic() >= deadline:
                raise TimeoutError("Published telemetry was not verified in Eclipse Ditto")
            sleep(min(0.1, max(0.0, deadline - monotonic())))

    @staticmethod
    def _matches_publication(thing: dict[str, Any] | None, run_id: str, tick: int) -> bool:
        if thing is None:
            return False
        try:
            features = thing["features"]
            return bool(
                features["idSimulationRun"]["properties"]["value"] == run_id
                and features["simulation"]["properties"]["tick"] == tick
            )
        except (KeyError, TypeError):
            return False

    def close(self) -> None:
        if self._mqtt is not None:
            self._mqtt.close()
            self._mqtt = None
