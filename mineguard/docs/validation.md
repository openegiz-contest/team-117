# Validation

All results below were observed on 25 October 2026 from this repository
(Ubuntu 24.04 under WSL2, Docker Engine 29.5, Compose 5.1, official OpenEgiz
v1.0.4 services). They show software behaviour of a fictional model, not
real-mine accuracy.

## Source gates (`bash mineguard/scripts/test.sh`)

| Gate | Result |
|---|---|
| Ruff lint and format check (backend) | pass |
| Strict mypy, 25 source files | pass |
| pytest | **198 passed** |
| TypeScript, ESLint (frontend) | pass |
| Vitest | **31 passed** (8 files) |
| Vite production build | pass |

Backend tests cover topology validation, unit conversions, gas-balance
conservation and analytic dilution, airflow conservation and fan-failure
response, risk thresholds/hysteresis/stale data/fan-failure precedence,
simulated safety flags, VOD feasibility and infeasibility, scenarios and reset,
telemetry mapping, the Ditto readback rebuild, mixed-publication rejection,
the API command guard, and the WebSocket/readiness behaviour.

## Live platform gates

| Command | What it proves | Result |
|---|---|---|
| `bash mineguard/scripts/bootstrap.sh` | official `make up`, MineGuard overlay, first verified Ditto readback; rerun on a running stack | exit 0 (172 s on a running stack) |
| `bash mineguard/scripts/full-smoke.sh` | official `make smoke` (MQTT → Ditto → Telegraf → InfluxDB → Grafana); WebSocket frames are `ECLIPSE_DITTO_READBACK` with an advancing tick; CO ppm, fan RPM and the simulation-only interlock read back from Ditto | pass |
| `bash mineguard/scripts/scenario-smoke.sh` | S1 drives Z04 to EMERGENCY (1.52 % CH₄, tick 86); the Ditto twin shows `trip_power`, evacuation and ventilation response with `equipment_io: false`; reset returns the Ditto readback to tick 0 with interlocks cleared | pass |

## Runtime validation (`GET /api/v1/evidence` → `validation`)

Checks executed by the running service, shown on the Evidence page:

| Check | Observed |
|---|---|
| Unit checks | Ditto % volume / ppm readback matches model fractions at the same tick: max CH₄ error 3.9e-11 (fraction), max CO error 3.1e-9 ppm |
| Residual bounds | max abs gas-balance residual 2.2e-15 m³ (limit 1e-9) |
| Scenario repeatability | two seeded S1 runs identical after 120 ticks; reset reproduces the tick-0 baseline exactly |
| Telemetry freshness | Ditto readback verified within the 1 s publication cycle |
| Source traceability | UI state rebuilt from nine Ditto twins sharing one publication run ID |

## Browser evidence (headless Chrome, SwiftShader CPU WebGL)

`frontend/e2e/browser-smoke.mjs` → `docs/final-browser/`: all five routes at
1680×1080 and 390 px mobile width, six zones selectable, sensor toggle, stable
camera, Twin Inspector showing nine authenticated Ditto responses, no
horizontal overflow, no browser exception.

`frontend/e2e/scenario-evidence.mjs` → `docs/final-scenario-evidence/`:

| Stage | Tick | Simulated s | Z04 CH₄ (% vol) |
|---|---:|---:|---:|
| Baseline | 7 | 3.5 | 0.15 |
| ADVISORY | 20 | 10.0 | 0.548 |
| WARNING | 48 | 24.0 | 1.020 |
| EMERGENCY | 86 | 43.0 | 1.525 |

At EMERGENCY, both fans were read back from Ditto at 100 % speed (model
feedback `ACHIEVED`), and the Z04 interlock was tripped. S2 then read back the
main fan at 0 RPM, FAULTED. Reset returned Ditto to tick 0. Samples are taken
from the 1 Hz readback, so they are observed sample times, not exact
threshold-crossing times.

## Historical integration evidence

`m0-readback.json`, `m2-validation.json` … `m9-validation.json` record the
earlier milestone runs: first twin bootstrap, the first MQTT → Ditto → InfluxDB
run tag, and risk-aware readback.
