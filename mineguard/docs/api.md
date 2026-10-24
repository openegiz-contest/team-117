# MineGuard X API

The browser uses the same-origin `/api` proxy at `http://127.0.0.1:8091`.
Platform credentials exist only inside the backend container.

## Read routes

| Route | Returns |
|---|---|
| `GET /api/health/live` | Simulation clock alive (200) or not (503) |
| `GET /api/health/ready` | `ready` only when the clock runs **and** the latest MQTT publication was verified in Ditto; also reports `platform_last_verified_tick`, `state_source` and a credential-free `platform_error` |
| `GET /api/v1/topology` | Versioned six-zone graph, airways, fans, sensors |
| `GET /api/v1/state` | Latest state rebuilt from the Ditto readback (`publication_status: ECLIPSE_DITTO_READBACK`); 503 until the first readback |
| `GET /api/v1/history` | Bounded history (240 samples) of Ditto readbacks |
| `GET /api/v1/stream` | WebSocket: the current Ditto-readback state once per second |
| `GET /api/v1/twins/{thing-id}` | Raw authenticated Ditto thing (only the nine managed IDs; others → 404) |
| `GET /api/v1/vod/decision` | Constraint-first VOD decision with all candidates |
| `GET /api/v1/decision-trace` | Risk assessments, safety decisions, VOD decision and constraints (evaluated on the controller's model state; includes `model_tick` and `platform_last_verified_tick`) |
| `GET /api/v1/evidence` | Equations, units, limitations, decision trace and `validation` (live runtime checks) |
| `GET /api/v1/scenarios`, `/api/v1/scenarios/state` | Scenario definitions and current run status |

## Simulation commands

`POST /api/v1/scenarios/{S1_METHANE_LEAK|S2_MAIN_FAN_FAILURE}/start`,
`POST /api/v1/scenarios/pause`, `/resume`, `/reset`.

They require the header `X-MineGuard-Simulation: SIMULATION_ONLY`. A browser
Origin must match the configured localhost allowlist. They change only the
simulation, never equipment.

## Snapshot contract

`tick`, `simulated_seconds`, `paused`, `source_type: SYNTHETIC_PHYSICS`,
`publication_status`, `simulation_only: true`, and:

- `zones[]`: `methane_fraction` (volume fraction 0–1), `co_ppm`
- `airways[]`: `flow_m3s`
- `fans[]`: requested/actual speed fraction, `actual_speed_rpm`, `faulted`, `power_kw`
- `risks[]`: state, reason codes, quality, methane, CO, airflow
- `safety[]`: simulated production stop, evacuation advisory, ventilation
  response, optimization flag, fan requests with `PENDING` / `ACHIEVED` /
  `EXCLUDED_FAULTED` feedback

The frontend validates every response at runtime (`src/api/contracts.ts`) and
never substitutes a safe value for missing or stale data.
