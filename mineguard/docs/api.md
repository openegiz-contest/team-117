# MineGuard X API

The browser uses the same-origin `/api` proxy at `http://127.0.0.1:8091`.
Service credentials exist only in the backend container.

Read routes:

- `GET /api/health/live` and `/api/health/ready`
- `GET /api/v1/topology`, `/state`, and `/history`
- `GET /api/v1/stream` as a WebSocket upgrade for one validated snapshot/second
- `GET /api/v1/twins/{managed-thing-id}`
- `GET /api/v1/vod/decision`, `/decision-trace`, and `/evidence`
- `GET /api/v1/scenarios` and `/scenarios/state`

Simulation mutation routes:

- `POST /api/v1/scenarios/{scenario-id}/start`
- `POST /api/v1/scenarios/pause`, `/resume`, and `/reset`

Mutation requests require `X-MineGuard-Simulation: SIMULATION_ONLY`. Browser
requests with an Origin must match the configured localhost allowlist. Backend
ports remain internal to Compose; nginx exposes only the same-origin UI/API.

Snapshot messages include `source_type`, `simulation_only`, monotonic simulation
time/tick, zone/airway/fan state, risk, and exact simulated safety decisions.
Current M10 backend source adds zone `co_ppm` and fan `actual_speed_rpm`; frontend
validation/presentation and the final post-change gates remain pending. Explicit
units live in Ditto features, and quality/risk remain separate concepts.

Readiness separates `platform_configured` from `platform_connected` and returns
a credential-free `platform_error`. An unavailable Ditto read returns HTTP 503;
an unknown managed ID returns 404. The UI never substitutes a fabricated safe
reading. The WebSocket is read-only; all changes remain on guarded HTTP routes.
