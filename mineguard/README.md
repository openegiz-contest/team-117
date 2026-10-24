# MineGuard X — developer guide

This directory holds the team's code. Startup for judges and users is in the
[root README](../README.md). The concept, modules and scenarios are in
[SUBMISSION.md](../SUBMISSION.md).

## Layout

| Path | Contents |
|---|---|
| `backend/app/physics/` | `airflow.py` fan/airway network, `gas_transport.py` conservative tracer transport, `fan_model.py` |
| `backend/app/control/` | `risk_engine.py` risk state machine, `safety.py` simulated safety decisions, `vod_controller.py` constraint-first VOD |
| `backend/app/simulation/` | fixed-step clock, coupled runtime, S1/S2 scenario engine |
| `backend/app/integrations/` | Ditto client and twin bootstrap, MQTT publisher, telemetry mapping, Ditto readback (`platform_state.py`), live bridge, Influx check |
| `backend/app/api/` | FastAPI routes, runtime service (clock thread, publisher thread, runtime validation) |
| `backend/tests/` | pytest suite |
| `frontend/src/` | React app: `pages/` (Command Center, Twin, Scenario, Energy, Evidence), `v3/` Three.js mine engine, `api/` validated client, `hooks/` |
| `frontend/e2e/` | Chrome DevTools-protocol browser and scenario evidence runners |
| `data/` | versioned topology, model parameters, scenario definitions |
| `deploy/compose.mineguard.yml` | Compose overlay on the official stack |
| `scripts/` | `bootstrap.sh`, `full-smoke.sh`, `scenario-smoke.sh`, `test.sh`, `run-demo.sh`, helpers |
| `docs/` | architecture, physics, safety, optimization, provenance, API, operations, 3D, validation, evidence |

## Source checks

```bash
cd mineguard/backend
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
cd ../frontend && npm ci --no-audit --no-fund && cd ../..
bash mineguard/scripts/test.sh
```

`test.sh` runs Ruff (lint and format), strict mypy and pytest, then TypeScript,
ESLint, Vitest and the production build.

## Live checks

With the stack running (`bash mineguard/scripts/bootstrap.sh`):

```bash
bash mineguard/scripts/full-smoke.sh
bash mineguard/scripts/scenario-smoke.sh
```

Browser evidence (needs a local Chrome started with
`--remote-debugging-port=9234 --use-angle=swiftshader --enable-unsafe-swiftshader`):

```bash
cd mineguard/frontend
node e2e/browser-smoke.mjs http://127.0.0.1:8091 9234 ../docs/final-browser
node e2e/scenario-evidence.mjs http://127.0.0.1:8091 9234 ../docs/final-scenario-evidence
```

## Model commands

```bash
cd mineguard/backend
.venv/bin/python -m app.simulation.runtime --steps 120   # 60 s of physics, prints the balance residual
.venv/bin/python -m app.control.vod_controller           # initial-state VOD decision and energy comparison
```

## Principles

- Methane is a volume fraction inside the model, % volume at interfaces (0.8 %
  = 8,000 ppm), and CO is ppm. Conversions are explicit (`app/units.py`).
- Stale or invalid data becomes `UNKNOWN_DATA`, never a safe value.
- Safety outranks energy: WARNING, EMERGENCY or UNKNOWN_DATA disables the
  optimizer.
- Every actuator, lockout and evacuation action is simulated. Ditto features
  carry `simulation_only: true` and `equipment_io: false`.
- The UI shows Ditto readback (`publication_status: ECLIPSE_DITTO_READBACK`),
  never the simulator's memory.
