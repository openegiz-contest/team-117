#!/usr/bin/env bash
set -euo pipefail
port="${MINEGUARD_PORT:-8091}"
base="http://127.0.0.1:${port}/api/v1"
scenario="${1:-S1_METHANE_LEAK}"
case "$scenario" in S1_METHANE_LEAK|S2_MAIN_FAN_FAILURE) ;; *) echo "Unknown scenario" >&2; exit 2;; esac
curl --fail --silent --show-error -X POST \
  -H "X-MineGuard-Simulation: SIMULATION_ONLY" "$base/scenarios/$scenario/start"
echo
echo "Scenario started. Open http://127.0.0.1:${port}/scenarios"
