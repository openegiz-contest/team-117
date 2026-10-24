#!/usr/bin/env python3
"""Create or explicitly migrate the nine M2 MineGuard X twins."""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

MINEGUARD_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MINEGUARD_ROOT / "backend"))

from app.config import load_configuration  # noqa: E402
from app.integrations.bootstrap_twins import bootstrap_twins  # noqa: E402
from app.integrations.ditto import DittoClient  # noqa: E402
from app.integrations.platform_config import PlatformConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--compose-env",
        type=Path,
        default=MINEGUARD_ROOT.parent / "deploy" / "compose" / ".env",
    )
    args = parser.parse_args()
    config = PlatformConfig.from_compose_env(args.compose_env)
    topology, _ = load_configuration()
    client = DittoClient(config.ditto_url, config.ditto_user, config.ditto_password)
    result = bootstrap_twins(client, topology)
    print(json.dumps(asdict(result), indent=2))


if __name__ == "__main__":
    main()

