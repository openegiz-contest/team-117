#!/usr/bin/env python3
"""Print recent Influx rows for one validated thing ID without exposing credentials."""

import argparse
import sys
from pathlib import Path

MINEGUARD_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MINEGUARD_ROOT / "backend"))

from app.integrations.platform_config import PlatformConfig  # noqa: E402
from app.integrations.storage import InfluxVerifier  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("thing_id")
    parser.add_argument(
        "--compose-env",
        type=Path,
        default=MINEGUARD_ROOT.parent / "deploy" / "compose" / ".env",
    )
    args = parser.parse_args()
    config = PlatformConfig.from_compose_env(args.compose_env)
    verifier = InfluxVerifier(
        config.influxdb_url,
        config.influxdb_token,
        config.influxdb_org,
        config.influxdb_bucket,
    )
    print(verifier.recent_csv(args.thing_id), end="")


if __name__ == "__main__":
    main()
