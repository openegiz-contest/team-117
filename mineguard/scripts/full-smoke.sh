#!/usr/bin/env bash
set -euo pipefail

mineguard_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(cd "$mineguard_root/.." && pwd)"
cd "$repository_root"
make smoke

port="${MINEGUARD_PORT:-8091}"
base="http://127.0.0.1:${port}"
deadline=$((SECONDS + 150))
while (( SECONDS < deadline )); do
  if ready="$(curl --max-time 10 --fail --silent "$base/api/health/ready" 2>/dev/null)" \
    && python3 -c 'import json,sys; v=json.load(sys.stdin); raise SystemExit(not (v["status"] == "ready" and v["platform_connected"] is True))' <<<"$ready"; then
    break
  fi
  sleep 3
done
(( SECONDS < deadline )) || { echo "MineGuard platform connection did not become ready" >&2; exit 1; }

python3 - "$port" <<'PY'
import base64
import hashlib
import json
import math
import os
import socket
import sys

host = "127.0.0.1"
port = int(sys.argv[1])
key = base64.b64encode(os.urandom(16)).decode("ascii")
request = (
    "GET /api/v1/stream HTTP/1.1\r\n"
    f"Host: {host}:{port}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n\r\n"
)

with socket.create_connection((host, port), timeout=10) as client:
    client.sendall(request.encode("ascii"))
    response = bytearray()
    while b"\r\n\r\n" not in response:
        chunk = client.recv(4096)
        if not chunk:
            raise RuntimeError("WebSocket handshake closed before headers")
        response.extend(chunk)
    raw_headers, initial = bytes(response).split(b"\r\n\r\n", 1)
    lines = raw_headers.decode("latin-1").split("\r\n")
    if " 101 " not in lines[0]:
        raise RuntimeError(f"WebSocket upgrade failed: {lines[0]}")
    headers = {
        name.strip().lower(): value.strip()
        for name, value in (line.split(":", 1) for line in lines[1:] if ":" in line)
    }
    expected = base64.b64encode(
        hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
    ).decode("ascii")
    if headers.get("sec-websocket-accept") != expected:
        raise RuntimeError("WebSocket server returned an invalid accept key")

    buffered = bytearray(initial)

    def read_exact(size: int) -> bytes:
        while len(buffered) < size:
            chunk = client.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket closed while reading a frame")
            buffered.extend(chunk)
        value = bytes(buffered[:size])
        del buffered[:size]
        return value

    def read_frame() -> tuple[int, bytes]:
        first, second = read_exact(2)
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            length = int.from_bytes(read_exact(2), "big")
        elif length == 127:
            length = int.from_bytes(read_exact(8), "big")
        mask = read_exact(4) if masked else b""
        payload = read_exact(length)
        if masked:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload

    snapshots: list[dict[str, object]] = []
    while len(snapshots) < 2:
        opcode, payload = read_frame()
        if opcode == 1:
            snapshots.append(json.loads(payload))
        elif opcode == 8:
            raise RuntimeError("WebSocket closed before two snapshots arrived")

first, second = snapshots
assert first["simulation_only"] is True
assert first["source_type"] == "SYNTHETIC_PHYSICS"
assert second["simulation_only"] is True
assert second["source_type"] == "SYNTHETIC_PHYSICS"
for snapshot in snapshots:
    assert len(snapshot["zones"]) == 6
    for zone in snapshot["zones"]:
        assert math.isfinite(zone["co_ppm"]) and 0 <= zone["co_ppm"] <= 1_000_000
        assert math.isfinite(zone["methane_fraction"]) and 0 <= zone["methane_fraction"] <= 1
    for fan in snapshot["fans"]:
        assert math.isfinite(fan["actual_speed_rpm"]) and fan["actual_speed_rpm"] >= 0
        if fan["faulted"]:
            assert fan["actual_speed_rpm"] == 0
if not first["paused"] and not second["paused"]:
    assert int(second["tick"]) > int(first["tick"]), "Unpaused physics clock did not advance"
    assert float(second["simulated_seconds"]) > float(first["simulated_seconds"])
print("MineGuard WebSocket smoke passed: advancing state, CO ppm, and fan RPM")
PY

state="$(curl --max-time 10 --fail --silent --show-error "$base/api/v1/state")"
twin="$(curl --max-time 10 --fail --silent --show-error "$base/api/v1/twins/mineguard%3Azone-z04")"
fan="$(curl --max-time 10 --fail --silent --show-error "$base/api/v1/twins/mineguard%3Afan-main")"
python3 - "$state" "$twin" "$fan" <<'PY'
import json
import sys

state, twin, fan = map(json.loads, sys.argv[1:])
assert state["simulation_only"] is True and state["source_type"] == "SYNTHETIC_PHYSICS"
assert len(state["zones"]) == 6
assert twin["thingId"] == "mineguard:zone-z04"
assert twin["features"]["risk"]["properties"]["simulation_only"] is True
assert twin["features"]["idSimulationRun"]["properties"]["value"].startswith("live-")
assert twin["features"]["co"]["properties"]["unit"] == "ppm"
assert twin["features"]["co"]["properties"]["value"] >= 0
interlock = twin["features"]["safety_interlock"]["properties"]
assert interlock["simulation_only"] is True and interlock["equipment_io"] is False
assert isinstance(interlock["trip_power"], bool)
assert fan["features"]["rpm"]["properties"]["unit"] == "rpm"
assert fan["features"]["rpm"]["properties"]["value"] >= 0
print("MineGuard full smoke passed: API, live Ditto readback, and official OpenEgiz smoke")
PY
