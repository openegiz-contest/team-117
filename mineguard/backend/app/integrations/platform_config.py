"""Load OpenEgiz connection settings without logging or serializing secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise FileNotFoundError(f"OpenEgiz environment file not found: {path}")
    values: dict[str, str] = {}
    for line_number, source_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = source_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.strip():
            raise ValueError(f"Invalid environment assignment on line {line_number}")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _port(values: dict[str, str], name: str, default: int) -> int:
    raw = os.environ.get(name, values.get(name, str(default)))
    try:
        port = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError(f"{name} must be between 1 and 65535")
    return port


@dataclass(frozen=True)
class PlatformConfig:
    host: str
    mqtt_port: int
    ditto_port: int
    influxdb_port: int
    ditto_user: str = "ditto"
    ditto_password: str = field(repr=False, default="")
    influxdb_token: str = field(repr=False, default="")
    influxdb_org: str = "opentwins"
    influxdb_bucket: str = "default"

    @classmethod
    def from_compose_env(cls, env_path: Path) -> PlatformConfig:
        values = _read_env(env_path)
        host = os.environ.get("OPENEGIZ_HOST", "127.0.0.1")
        ditto_password = os.environ.get("DITTO_PASSWORD", values.get("DITTO_PASSWORD", ""))
        influxdb_token = os.environ.get("INFLUXDB_TOKEN", values.get("INFLUXDB_TOKEN", ""))
        if not ditto_password or not influxdb_token:
            raise ValueError("DITTO_PASSWORD and INFLUXDB_TOKEN must be configured")
        return cls(
            host=host,
            mqtt_port=_port(values, "MQTT_PORT", 1883),
            ditto_port=_port(values, "DITTO_PORT", 8080),
            influxdb_port=_port(values, "INFLUXDB_PORT", 8086),
            ditto_password=ditto_password,
            influxdb_token=influxdb_token,
        )

    @property
    def ditto_url(self) -> str:
        return f"http://{self.host}:{self.ditto_port}"

    @property
    def influxdb_url(self) -> str:
        return f"http://{self.host}:{self.influxdb_port}"
