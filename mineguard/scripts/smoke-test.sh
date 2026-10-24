#!/usr/bin/env bash
set -euo pipefail

mineguard_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$mineguard_dir/backend/.venv/bin/python" "$mineguard_dir/scripts/smoke_test.py" "$@"

