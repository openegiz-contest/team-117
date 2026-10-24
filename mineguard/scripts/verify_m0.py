"""Create two M0 simulation-only things via upstream setup and verify readback.

Run from the official checkout after make smoke succeeds. Existing changed
MineGuard state is never reset by this test. Credentials are never printed.
"""

import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


def main() -> int:
    repository = Path(__file__).resolve().parents[2]
    definitions = repository / "mineguard/data/m0_twins.json"
    expected = json.loads(definitions.read_text())
    config = {}
    for line in (repository / "deploy/compose/.env").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator:
            config[key] = value
    port = int(config["DITTO_PORT"])
    if not 1 <= port <= 65535:
        raise ValueError("Invalid configured Ditto port")
    base_url = f"http://127.0.0.1:{port}"
    authentication = base64.b64encode(f"ditto:{config['DITTO_PASSWORD']}".encode()).decode()

    def get(path: str):
        request = urllib.request.Request(base_url + path, headers={"Authorization": "Basic " + authentication})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    policy = get("/api/2/policies/default:basic_policy")
    if policy.get("policyId") != "default:basic_policy":
        raise RuntimeError("Upstream policy readback failed")
    print("PASS upstream policy authenticated readback", flush=True)

    for thing_id, body in expected.items():
        if not body["attributes"]["simulation_only"]:
            raise ValueError("M0 things must be simulation only")
        try:
            existing = get("/api/2/things/" + thing_id)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        else:
            if any(existing.get(key) != body[key] for key in ("attributes", "features", "policyId")):
                raise RuntimeError(f"Refusing to overwrite existing changed state for {thing_id}")

    environment = os.environ.copy()
    environment.update(DITTO_PASSWORD=config["DITTO_PASSWORD"], DITTO_URL=base_url, TWINS_FILE=str(definitions))
    command = [sys.executable, str(repository / "examples/mine/setup_twins.py")]
    # Exercise create/update idempotency using the official supported script.
    for run in (1, 2):
        subprocess.run(command, cwd=repository, env=environment, check=True)
        print(f"PASS upstream bootstrap run {run}", flush=True)

    observed = {}
    for thing_id, body in expected.items():
        actual = get("/api/2/things/" + thing_id)
        if actual.get("thingId") != thing_id:
            raise RuntimeError(f"Wrong readback ID for {thing_id}")
        for key in ("policyId", "attributes", "features"):
            if actual.get(key) != body[key]:
                raise RuntimeError(f"Readback mismatch for {thing_id}: {key}")
        observed[thing_id] = actual
        print(f"PASS persisted authenticated GET readback: {thing_id}", flush=True)

    evidence = repository / "mineguard/docs/m0-readback.json"
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "upstream_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip(),
        "bootstrap_runs": 2,
        "simulation_only": True,
        "result": "PASS",
        "things": observed,
    }, indent=2) + "\n")
    print(f"Evidence: {evidence}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as error:
        print(f"FAILED: Ditto HTTP {error.code}; no credentials or response body displayed", file=sys.stderr)
        raise SystemExit(1)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
