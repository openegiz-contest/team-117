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
| pytest | **211 passed** |
| TypeScript, ESLint (frontend) | pass |
| Vitest | **41 passed** |
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

## Fresh-volume rehearsal of this version (16 twins)

The working tree of this commit (airway and cutting-machine twins, S3/S4,
production interlock, fan drive ramp, Apply VOD, Grafana dashboard) was copied
to a separate directory and started as an isolated Compose project with new
data volumes, new credentials and the MineGuard images rebuilt from source:

| Step | Result |
|---|---|
| `bash mineguard/scripts/bootstrap.sh` | exit 0 in 506 s (includes rebuilding both MineGuard images) |
| `bash mineguard/scripts/full-smoke.sh` | pass (official smoke + MineGuard checks) |
| `bash mineguard/scripts/scenario-smoke.sh` | pass: S1 Z04 EMERGENCY at tick 89 (1.58 % CH₄) with the Ditto interlock verified; S3 E03 3.9 m³/s, E02 25.2 m³/s, Z04 WARNING; S4 Z04 UNKNOWN_DATA with quality STALE; reset to the baseline |
| second `bootstrap.sh` on the running stack | exit 0 |
| MineGuard Grafana dashboard | provisioned under OpenEgiz Examples; all 10 data panels returned data for a 5-minute window in 0.3–2.3 s |

## Earlier clean-clone rehearsal (previous version)

Fresh `git clone` of `openegiz-contest/team-117` at commit `8ccd6a3`, run with
an isolated Compose project (new data volumes, newly generated credentials, no
`deploy/compose/.env`) and with the MineGuard images deleted beforehand, so they
were rebuilt from source. The README commands were run literally:

| Step | Result |
|---|---|
| `bash mineguard/scripts/bootstrap.sh` | exit 0 in 113 s; Ditto synchronization connected |
| `bash mineguard/scripts/full-smoke.sh` | pass (official smoke + MineGuard checks) |
| `bash mineguard/scripts/scenario-smoke.sh` | pass: Z04 EMERGENCY at tick 84 (1.51 % CH₄), Ditto interlock verified, reset to tick 0 |
| second `bootstrap.sh` on the running stack | exit 0 in 72 s |
| browser gate (`browser-smoke.mjs`) | all five routes, desktop and mobile, no browser errors |

Limitation: the official platform images and Python/Node base images were
already in the local Docker cache, so this rehearsal does not measure first-time
download time. The judge environment downloads them (about 2.3 GB for the
platform, per the OpenEgiz documentation).

## Runtime validation (`GET /api/v1/evidence` → `validation`)

Checks executed by the running service, shown on the Evidence page:

| Check | Observed |
|---|---|
| Unit checks | Ditto % volume / ppm readback matches model fractions at the same tick: max CH₄ error 3.9e-11 (fraction), max CO error 3.1e-9 ppm |
| Residual bounds | max abs gas-balance residual 2.2e-15 m³ (limit 1e-9) |
| Scenario repeatability | two seeded S1 runs identical after 120 ticks; reset reproduces the tick-0 baseline exactly |
| Telemetry freshness | Ditto readback verified within the 1 s publication cycle |
| Source traceability | UI state rebuilt from all managed Ditto twins (16 in this version) sharing one publication run ID |

## Final-day run of this version (commit `aafd677`)

The Command Center fixes (Safety Response panel, incident wording, scenario
tray, footer tick) were applied on top of `ecc6a7d` and checked on a second
machine (Arch Linux, Docker Engine 29.9, Compose 5.6) on 25 October 2026:

| Step | Result |
|---|---|
| `bash mineguard/scripts/test.sh` | pass: 211 pytest, 41 Vitest, Ruff, strict mypy, TypeScript, ESLint, build |
| readiness | `"status":"ready"`, `"platform_connected":true` |
| `bash mineguard/scripts/scenario-smoke.sh` | pass: S1 Z04 EMERGENCY at tick 83 (1.52 % CH₄) with the Ditto interlock verified; S3 E03 3.94 m³/s with Z04 WARNING; S4 Z04 UNKNOWN_DATA; reset to tick 0 |
| `bash mineguard/scripts/full-smoke.sh` | not run on this machine: the official Grafana 12.3.0 container (unchanged upstream) exits at startup on this host, also when started alone without MineGuard. The last full-smoke pass is the fresh-volume rehearsal above |

## Browser evidence (headless Chromium, SwiftShader CPU WebGL)

Captured on 25 October 2026 (12:52–12:55 UTC) from commit `aafd677` against
the live stack; the files are in `docs/final-browser/` and
`docs/final-scenario-evidence/`.

`frontend/e2e/browser-smoke.mjs` → `docs/final-browser/`: all five routes at
1680×1080 and 390 px mobile width, six zones selectable, sensor toggle, stable
camera, Twin Inspector showing 16 authenticated Ditto responses, no
horizontal overflow, no browser exception (`"browser_errors": []`).
Renderer: ANGLE on SwiftShader (Vulkan), render profile `v3-software-lite`,
93 draw calls, about 4.4 frames per second in a 3.2 s sample.

`frontend/e2e/scenario-evidence.mjs` → `docs/final-scenario-evidence/` (S1):

| Stage | Tick | Simulated s | Z04 CH₄ (% vol) |
|---|---:|---:|---:|
| ADVISORY | 19 | 9.5 | 0.541 |
| WARNING | 48 | 24.0 | 1.046 |
| EMERGENCY | 105 | 52.5 | 1.698 |

EMERGENCY was first seen at tick 82 with the fans still at 75 % (main) and
50 % (aux); the runner waits until the fan feedback reads `ACHIEVED`, so the
EMERGENCY row is sampled after both fans reached 100 %. Ditto then showed the
Z04 interlock tripped with `equipment_io: false` and both fan twins at 100 %
(`ditto_emergency_verified`, `simulated_fan_response_verified`). S2 read back
the main fan at 0 RPM, FAULTED (`fan_failure_verified`). S3 read back the
roof fall on E03 (×250) with flows E01 29.11, E02 25.18, E03 3.94 m³/s and the
cutting machine tripped. S4 read back Z04 as UNKNOWN_DATA with quality STALE
(`sensor_loss_verified`). The final reset returned Ditto to tick 0. Samples
are taken from the 1 Hz readback, so they are observed sample times, not exact
threshold-crossing times.

The first scenario-evidence run on this machine stopped at the Ditto interlock
check right after EMERGENCY, before the readback showed the trip. The evidence
folder was restored from Git and the runner was started again unchanged; the
second run passed every check above.

Energy decision after a reset (`GET /api/v1/vod/decision`): 16 candidates, all
feasible; selected main 60 %, aux 40 %; 60 s horizon 1.1708 kWh at the current
speeds versus 0.5995 kWh selected (48.8 %, model estimate); forecast max CH₄
0.180 %, max CO 9.9 ppm, min airflow 11.9 m³/s.

## Historical integration evidence

`m0-readback.json`, `m2-validation.json` … `m9-validation.json` record the
earlier milestone runs: first twin bootstrap, the first MQTT → Ditto → InfluxDB
run tag, and risk-aware readback.
