"""Reliable bounded MQTT publisher for Ditto protocol messages."""

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion


class MqttPublisher:
    def __init__(self, host: str, port: int) -> None:
        self._client = mqtt.Client(
            CallbackAPIVersion.VERSION2,
            client_id=f"mineguard-x-{os.getpid()}",
            protocol=mqtt.MQTTv5,
        )
        self._client.connect(host, port, keepalive=30)
        self._client.loop_start()

    def publish(self, topic: str, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        result = self._client.publish(topic, encoded, qos=1)
        result.wait_for_publish(timeout=10)
        if result.rc != mqtt.MQTT_ERR_SUCCESS or not result.is_published():
            raise RuntimeError(f"MQTT publish failed with result code {result.rc}")

    def close(self) -> None:
        self._client.disconnect()
        self._client.loop_stop()


@contextmanager
def mqtt_publisher(host: str, port: int) -> Iterator[MqttPublisher]:
    publisher = MqttPublisher(host, port)
    try:
        yield publisher
    finally:
        publisher.close()
