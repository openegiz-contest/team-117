#!/usr/bin/env bash
set -euo pipefail

mineguard_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(cd "$mineguard_root/.." && pwd)"
cd "$repository_root"
for command in docker make curl python3; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
docker compose version >/dev/null

startup_log="$(mktemp)"
readiness_file="$(mktemp)"
trap 'rm -f "$startup_log" "$readiness_file"' EXIT
if ! make up >"$startup_log" 2>&1; then
  echo "Official OpenEgiz startup failed. Sanitized diagnostic tail:" >&2
  tail -n 120 "$startup_log" \
    | sed -E 's/((password|passwd|token|secret|credential)[^:= ]*[[:space:]]*[:=][[:space:]]*)[^[:space:]]+/\1[REDACTED]/Ig' >&2
  docker compose -f deploy/compose/docker-compose.yml ps -a >&2 || true
  exit 1
fi

compose_files=(-f deploy/compose/docker-compose.yml)
if [[ -f deploy/compose/.example-mine ]]; then
  compose_files+=(-f examples/mine/compose.yml)
fi
compose_files+=(-f mineguard/deploy/compose.mineguard.yml)
# grafana is listed so the overlay's MineGuard dashboard mount is applied.
docker compose "${compose_files[@]}" up -d --build --wait --wait-timeout 600 \
  mineguard-backend mineguard-ui grafana

port="${MINEGUARD_PORT:-8091}"
base="http://127.0.0.1:${port}"
deadline=$((SECONDS + 150))
while (( SECONDS < deadline )); do
  if curl --max-time 10 --fail --silent --show-error "$base/api/health/ready" >"$readiness_file" \
    && python3 - "$readiness_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    value = json.load(stream)
raise SystemExit(not (
    value.get("status") == "ready"
    and value.get("platform_configured") is True
    and value.get("platform_connected") is True
))
PY
  then
    break
  fi
  sleep 3
done

if (( SECONDS >= deadline )); then
  echo "MineGuard API started, but Eclipse Ditto synchronization did not become ready." >&2
  python3 - "$readiness_file" <<'PY' >&2
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        value = json.load(stream)
except (OSError, ValueError):
    print("Readiness response was unavailable or invalid.")
else:
    print(
        "Readiness:"
        f" configured={value.get('platform_configured')!r},"
        f" connected={value.get('platform_connected')!r},"
        f" error={value.get('platform_error')!r}"
    )
PY
  docker compose "${compose_files[@]}" ps -a >&2 || true
  exit 1
fi

echo "MineGuard X ready: http://127.0.0.1:${port}"
echo "Eclipse Ditto synchronization: connected"
echo "All controls are simulation-only."
