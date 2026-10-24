#!/usr/bin/env python3
"""Export current evidence from a running MineGuard API without credentials."""

import argparse
import json
import urllib.request
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8091/api/v1/evidence")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with urllib.request.urlopen(args.url, timeout=15) as response:
        value: object = json.load(response)
    encoded = json.dumps(value, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(encoded, encoding="utf-8")
        temporary.replace(args.output)
        print(f"Wrote {args.output}")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
