from pathlib import Path

import pytest

from app.integrations.platform_config import PlatformConfig


def test_compose_environment_loads_without_secret_repr(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "DITTO_PASSWORD=ditto-secret\n"
        "INFLUXDB_TOKEN=influx-secret\n"
        "MQTT_PORT=1884\n"
        "DITTO_PORT=8081\n"
        "INFLUXDB_PORT=8087\n",
        encoding="utf-8",
    )
    config = PlatformConfig.from_compose_env(env_file)
    assert config.mqtt_port == 1884
    assert config.ditto_url == "http://127.0.0.1:8081"
    assert "ditto-secret" not in repr(config)
    assert "influx-secret" not in repr(config)


def test_missing_secrets_are_rejected(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("MQTT_PORT=1883\n", encoding="utf-8")
    with pytest.raises(ValueError, match="must be configured"):
        PlatformConfig.from_compose_env(env_file)


@pytest.mark.parametrize("port", ["0", "65536", "abc"])
def test_invalid_port_is_rejected(tmp_path: Path, port: str) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(f"DITTO_PASSWORD=x\nINFLUXDB_TOKEN=y\nMQTT_PORT={port}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="MQTT_PORT"):
        PlatformConfig.from_compose_env(env_file)
