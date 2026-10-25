# DeepCore Labs: MineGuard X — a digital mine on OpenEgiz

MineGuard X is a physics-informed, simulation-only digital twin of a fictional
underground coal mine. Six connected ventilation zones, six airways, two fans
and a cutting machine are Eclipse Ditto twins. A deterministic airflow and
gas-transport model publishes their
state through the official OpenEgiz MQTT path, and the web interface reads it
back from Ditto. The twin supports methane-risk, simulated-safety and
fan-energy decisions. The Concept, modules and scenarios are in
[SUBMISSION.md](SUBMISSION.md).

All safety actions (production stop, evacuation advisory, fan commands) are
**simulated**. Nothing connects to real equipment.

## Running

Requirements: Ubuntu 24.04 (or WSL2 on Windows, see [OPENEGIZ.md](OPENEGIZ.md)),
Docker with Compose v2.20+, `git`, `curl`, `python3`, and about 6 GiB of memory
for Docker. From the repository root:

```bash
sudo apt-get update
sudo apt-get install -y make
bash mineguard/scripts/bootstrap.sh
```

`bootstrap.sh` runs the official `make up` (Ditto, Mosquitto, Telegraf,
InfluxDB, Grafana and the rest of OpenEgiz). It then builds and starts the two
MineGuard containers through the overlay `mineguard/deploy/compose.mineguard.yml`.
It waits until the first simulated state has been published over MQTT and read
back from Ditto. The command is idempotent: running it again on a running stack
succeeds without changes.

On success it prints:

```text
MineGuard X ready: http://127.0.0.1:8091
Eclipse Ditto synchronization: connected
All controls are simulation-only.
```

The first run downloads the official OpenEgiz images (about 2.3 GB) and builds
the platform's Extended API, the MineGuard backend (Python 3.12) and the
MineGuard UI (Node 24, served by nginx). No dataset or model download is
required. Generated credentials stay in the git-ignored `deploy/compose/.env`.

## What to open

| Address | What it shows |
|---|---|
| <http://127.0.0.1:8091> | **MineGuard X Command Center**: interactive 3D cutaway of the six-zone mine and a live ventilation-network plan view (every airway's flow), with methane, CO, airflow, fan RPM, cutting-machine state and risk per zone, plus the scenario controls |
| <http://127.0.0.1:8091/twins> | Twin Inspector: authenticated Eclipse Ditto readback of all 16 MineGuard twins (mine, 6 zones, 6 airways, 2 fans, cutting machine): policy, attributes, features |
| <http://127.0.0.1:8091/scenarios> | Scenario Laboratory: start, pause, resume and reset the four what-if scenarios |
| <http://127.0.0.1:8091/energy> | Energy Intelligence: constraint-first ventilation-on-demand candidates, modeled energy comparison, *Apply recommendation (simulated)* |
| <http://127.0.0.1:8091/evidence> | Engineering Evidence: equations, limitations, decision trace and live runtime validation checks |
| <http://127.0.0.1:3000> | Official OpenEgiz Grafana: twins under **OpenEgiz → Twins**; history under **Dashboards → OpenEgiz Examples → MineGuard X — ventilation twin history** (InfluxDB, written by the official Telegraf path). Logins: `bash scripts/compose-urls.sh` |

MineGuard uses port 8091 so that the official Grafana keeps port 3000.

## Verifying (optional)

```bash
bash mineguard/scripts/full-smoke.sh      # official make smoke + MineGuard stream and Ditto readback
bash mineguard/scripts/scenario-smoke.sh  # S1 to EMERGENCY, S3 roof fall, S4 sensor loss, each read back from Ditto, then reset
```

## Scenarios from the command line (optional)

The same guarded, simulation-only API that the UI uses:

```bash
bash mineguard/scripts/run-demo.sh S1_METHANE_LEAK
bash mineguard/scripts/run-demo.sh S2_MAIN_FAN_FAILURE
bash mineguard/scripts/run-demo.sh S3_AIRWAY_OBSTRUCTION
bash mineguard/scripts/run-demo.sh S4_SENSOR_LOSS
curl -X POST -H 'X-MineGuard-Simulation: SIMULATION_ONLY' http://127.0.0.1:8091/api/v1/scenarios/reset
```

## Stopping

```bash
# stop the platform and MineGuard; twins and data are kept
docker compose -f deploy/compose/docker-compose.yml -f mineguard/deploy/compose.mineguard.yml down
```

## Repository contents

| Path | Contents |
|---|---|
| `mineguard/` | The Team's code: backend (physics, risk, VOD, Ditto/MQTT integration), frontend (React + Three.js), data, Compose overlay, scripts, docs and evidence. See [mineguard/README.md](mineguard/README.md) |
| `SUBMISSION.md` | Description of the Submission |
| `presentation.pdf` | Presentation |
| `deploy/`, `Makefile`, `scripts/`, … | Official OpenEgiz v1.0.4 platform, unchanged |
| `examples/mine/` | Official Example Mine; not used by MineGuard X |
| `OPENEGIZ.md`, `OPENEGIZ.ru.md` | OpenEgiz platform documentation |
| `AGENTS.md`, `CLAUDE.md` | Contest template instructions for AI agents |

## License

MIT, see [LICENSE](LICENSE). Third-party software and attributions:
[mineguard/THIRD_PARTY.md](mineguard/THIRD_PARTY.md).

---

Platform: [aleka07/openegiz](https://github.com/aleka07/openegiz).
