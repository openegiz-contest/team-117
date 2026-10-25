#!/usr/bin/env bash
set -euo pipefail

port="${MINEGUARD_PORT:-8091}"
python3 - "$port" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

base = f"http://127.0.0.1:{int(sys.argv[1])}/api"


def request(path: str, *, method: str = "GET") -> dict:
    headers = {"Accept": "application/json"}
    if method == "POST":
        headers["X-MineGuard-Simulation"] = "SIMULATION_ONLY"
    call = urllib.request.Request(base + path, method=method, headers=headers)
    try:
        with urllib.request.urlopen(call, timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if path == "/health/ready" and error.code == 503:
            return json.load(error)
        raise


def wait_until(label: str, predicate, timeout: float = 150.0) -> dict:
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        last = predicate()
        if last.get("passed"):
            return last
        time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {label}; last observation={last}")


request("/v1/scenarios/reset", method="POST")
started = request("/v1/scenarios/S1_METHANE_LEAK/start", method="POST")
assert started["status"] == "RUNNING" and started["simulation_only"] is True


def emergency_observation() -> dict:
    state = request("/v1/state")
    risk = next(item for item in state["risks"] if item["zone_id"] == "Z04")
    safety = next(item for item in state["safety"] if item["zone_id"] == "Z04")
    passed = (
        risk["state"] == "EMERGENCY"
        and safety["production_stop"] is True
        and safety["evacuation_advisory"] is True
        and safety["ventilation_response"] is True
        and safety["optimization_enabled"] is False
        and safety["simulation_only"] is True
    )
    return {
        "passed": passed,
        "tick": state["tick"],
        "methane_percent": risk["methane_fraction"] * 100,
        "co_ppm": risk["co_ppm"],
        "risk": risk["state"],
    }


try:
    incident = wait_until("S1 emergency safety response", emergency_observation)

    def ditto_observation() -> dict:
        ready = request("/health/ready")
        tick = ready.get("platform_last_verified_tick")
        return {
            "passed": ready["platform_connected"] is True and isinstance(tick, int) and tick >= incident["tick"],
            "platform_connected": ready["platform_connected"],
            "platform_last_verified_tick": tick,
        }

    verified = wait_until("post-incident Ditto readback", ditto_observation)
    thing_id = urllib.parse.quote("mineguard:zone-z04", safe="")
    twin = request(f"/v1/twins/{thing_id}")
    interlock = twin["features"]["safety_interlock"]["properties"]
    assert interlock["trip_power"] is True
    assert interlock["evacuation_advisory"] is True
    assert interlock["ventilation_response"] is True
    assert interlock["simulation_only"] is True
    assert interlock["equipment_io"] is False
    print(json.dumps({"incident": incident, "ditto": verified}, sort_keys=True))
finally:
    request("/v1/scenarios/reset", method="POST")


def reset_observation() -> dict:
    ready = request("/health/ready")
    scenario = request("/v1/scenarios/state")
    state = request("/v1/state")
    tick = ready.get("platform_last_verified_tick")
    # Ditto is republished every second, so a reset appears as the verified tick
    # restarting near zero with a cleared interlock in the platform readback.
    return {
        "passed": (
            ready["platform_connected"] is True
            and isinstance(tick, int)
            and tick <= 10
            and state["publication_status"] == "ECLIPSE_DITTO_READBACK"
            and state["tick"] <= 20
            and not any(item["production_stop"] for item in state["safety"])
            and scenario["status"] == "IDLE"
            and scenario["scenario_id"] is None
        ),
        "platform_connected": ready["platform_connected"],
        "platform_last_verified_tick": tick,
        "scenario_status": scenario["status"],
    }


reset = wait_until("deterministic reset Ditto readback", reset_observation)
print(json.dumps({"reset": reset}, sort_keys=True))


def twin(thing: str) -> dict:
    return request("/v1/twins/" + urllib.parse.quote(thing, safe=""))


# S3: the roof fall must reach Ditto as a restricted airway with redistributed flow.
request("/v1/scenarios/S3_AIRWAY_OBSTRUCTION/start", method="POST")
try:
    def obstruction_observation() -> dict:
        e02 = twin("mineguard:airway-e02")["features"]
        e03 = twin("mineguard:airway-e03")["features"]
        face = twin("mineguard:zone-z04")["features"]["risk"]["properties"]
        return {
            "passed": (
                e03["obstruction"]["properties"]["status"] == "RESTRICTED"
                and e03["flow"]["properties"]["value"] < 5
                and e02["flow"]["properties"]["value"] > 20
                and face["value"] == "WARNING"
                and "DILUTION_AIRFLOW_LOW" in face["reason_codes"]
            ),
            "e03_flow": e03["flow"]["properties"]["value"],
            "e02_flow": e02["flow"]["properties"]["value"],
            "z04_risk": face["value"],
        }

    print(json.dumps({"s3": wait_until("S3 obstruction in Ditto", obstruction_observation)}))
finally:
    request("/v1/scenarios/reset", method="POST")

# S4: a silent sensor must reach Ditto as STALE and UNKNOWN_DATA, never as a safe reading.
request("/v1/scenarios/S4_SENSOR_LOSS/start", method="POST")
try:
    def sensor_observation() -> dict:
        features = twin("mineguard:zone-z04")["features"]
        risk = features["risk"]["properties"]
        return {
            "passed": (
                risk["value"] == "UNKNOWN_DATA"
                and risk["quality"] == "STALE"
                and features["methane"]["properties"]["quality"] == "STALE"
                and features["safety_interlock"]["properties"]["trip_power"] is True
            ),
            "z04_risk": risk["value"],
            "quality": risk["quality"],
        }

    print(json.dumps({"s4": wait_until("S4 sensor loss in Ditto", sensor_observation)}))
finally:
    request("/v1/scenarios/reset", method="POST")
wait_until("reset after S3/S4", reset_observation)
print("MineGuard live scenario smoke passed: S1 emergency interlock, S3 obstruction, S4 sensor loss, Ditto readback, and reset")
PY
