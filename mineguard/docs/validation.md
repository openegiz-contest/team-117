# M1 validation procedure

Run bash mineguard/scripts/test.sh from the Linux OpenEgiz root. It runs Ruff,
format verification, strict mypy and pytest against the real source/data files.

Acceptance checks:
- Exact six-zone connected intake/return graph, unique references, 2 fans and
  at least 12 logical sensors; invalid topology/units/parameters rejected.
- Fraction/percent/ppm conversions and nonfinite/negative input rejection.
- Closed-zone source accumulation and zero-source uniform concentration.
- Single-zone analytical dilution with convergence under smaller substeps.
- Source-driven steady concentration decreases with greater prescribed flow.
- Downstream propagation is simultaneous, not dependent on zone iteration order.
- Seeded closed-network conservation, full-mine boundary/source ledger and
  bounded nonnegative transport under larger requested timesteps.
- Pause/resume/reset, identical trajectories, immutable snapshots and atomic
  state/time behavior after a rejected tick.

## Observed M1 result — 15 October 2026

`bash mineguard/scripts/test.sh` passed on Ubuntu Python 3.12.3:

- Ruff lint: passed.
- Ruff formatting check: passed after canonical formatting.
- Strict mypy: passed for seven source files.
- Pytest: 74 passed in 0.33 seconds.
- `pip check`: no broken requirements.
- Runtime and development lock files contain pinned packages and verified
  official PyPI release SHA256 hashes.

The CLI ran 120 fixed 0.5-second ticks, producing 60 simulated seconds and six
zone states labeled `LOCAL_MODEL_UNPUBLISHED`. The observed maximum absolute gas
ledger residual was `2.1569660120512868e-15 m3`. This is a numerical consistency
result for this run, not a performance benchmark or real-mine accuracy claim.

These checks assess numerical consistency of a fictional model; they do not
validate predictions for an operating mine. Real MQTT/Ditto/time-series and UI
checks belong to M2 and later milestones. Remote CI is deferred by user request.

## Observed M2 result — 15 October 2026

`bash mineguard/scripts/test.sh` passed with Ruff lint/format, strict mypy over
16 source files, and 112 pytest cases in 0.68 seconds. Tests cover fan affinity
relationships, airflow conservation, branch redistribution, main-fan failure,
dynamic gas coupling, atomic commands, guarded twin migration, telemetry units,
secret-safe configuration and annotated Influx CSV parsing.

`bash mineguard/scripts/smoke-test.sh` then produced run
`m2-20261015T044921650397Z`. Authenticated Ditto GETs verified that run and tick
20 on all nine MineGuard twins. InfluxDB verified the same run tag for
`mineguard:zone-z04`. The snapshot reported 39.62675005306711 m3/s total airflow
and 0.1517854756427366 percent-volume maximum methane after 10 simulated seconds.
Exact machine-readable evidence is in `m2-validation.json`.

Two earlier smoke attempts correctly failed because the verifier assumed the
wrong annotated CSV result label. Direct read-only Influx inspection showed both
runs had actually been stored. The verifier now parses CSV table columns and has
regression tests. Only the fresh post-fix run above is the M2 pass evidence.

These values come from explicit fictional assumptions. The result demonstrates
deterministic software behavior and the real OpenEgiz message/storage path; it
does not demonstrate prediction accuracy, safe operating limits, certified fan
performance or real-mine safety.

## Observed M4-M9 result — 15 October 2026

M4 introduced the deterministic constraint-first VOD controller and same-state
energy comparison. M5-M7 added the live FastAPI/React product, bounded OpenEgiz
publisher, managed Ditto inspector, S1/S2 scenarios, decision trace, energy and
evidence views. The final source gate passed 152 backend tests, strict mypy over
24 source files, Ruff lint/format, four frontend tests, TypeScript, ESLint,
dependency integrity, and the production frontend build.

The deployed S2 run applied the simulated main-fan failure, produced local
`EMERGENCY`, published `EMERGENCY` to the Z04 Ditto twin at tick 60, and reset
to baseline tick 0. The one-command startup and combined smoke passed: official
OpenEgiz telemetry/storage/Grafana checks, MineGuard readiness, and live Ditto
readback. Exact evidence is in `m4-validation.json`, `m5-m8-validation.json`,
`m9-validation.json`, and `final-evidence.json`.

The eight-page `presentation.pdf` and root submission instructions were rendered
and validated locally. Remote commit/push is an administrative handoff deferred
by user instruction, not a software test result.

## Observed M3 result — 15 October 2026

The local gate passed Ruff lint/format, strict mypy over 18 source files and 131
pytest cases in 0.86 seconds. Risk tests cover threshold transitions, downgrade
hysteresis, stale/invalid uncertainty, airflow constraints, fan-failure
precedence and structured transition logs. Safety tests prove that emergency
and unknown data disable optimization, every action is simulation-only, failed
fans are excluded, and requested speed remains distinct from actual feedback.

Fresh integration run `m2-20261015T050021700677Z` verified all nine twins. The
smoke test additionally required the six zone `risk` features, allowed state
enumeration and `simulation_only=true` from authenticated Ditto readback, then
verified the same run in InfluxDB. Exact evidence is in `m3-validation.json`.

## Observed M10 result — 23 October 2026

The final source gate passed Ruff lint/format, strict mypy over 24 source files,
189 backend tests, TypeScript, ESLint, 28 frontend tests, and the production
frontend build. The combined live gate passed official OpenEgiz smoke, an
advancing WebSocket stream, CO ppm and actual fan RPM contracts, and CO/RPM plus
simulation-only interlock features read back from Eclipse Ditto.

The S1 live run reached Z04 `EMERGENCY` at tick 84 with 1.5072079809% modeled
methane. Ditto verified a post-incident snapshot at tick 95; the twin reported
simulated `trip_power`, evacuation, and ventilation response with
`equipment_io=false`. Reset returned the scenario to `IDLE` and Ditto verified
tick 0. These are deterministic fictional-model results, not safety certification.

Headless Chromium rendered the live WebGL scene and selectable 2D topology,
verified all six zones, keyboard selection, and direct routes for twins,
scenarios, energy, and evidence with no uncaught browser exception. Evidence is
in `m10-browser-validation.json` and the two `m10-command-center-*.png` images.
