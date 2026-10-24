#!/usr/bin/env python3
"""Run the M2 physics-to-OpenEgiz integration gate and print safe evidence."""

import argparse
import json
import sys
from pathlib import Path

MINEGUARD_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MINEGUARD_ROOT / "backend"))

from app.config import load_configuration  # noqa: E402
from app.integrations.platform_config import PlatformConfig  # noqa: E402
from app.integrations.smoke import run_smoke  # noqa: E402
from app.simulation.runtime import Simulation  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--compose-env",
        type=Path,
        default=MINEGUARD_ROOT.parent / "deploy" / "compose" / ".env",
    )
    args = parser.parse_args()
    config = PlatformConfig.from_compose_env(args.compose_env)
    evidence = run_smoke(config, Simulation(*load_configuration()))
    print(json.dumps(evidence, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()

