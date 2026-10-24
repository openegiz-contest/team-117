# MineGuard X presentation source

1. MineGuard X — connected simulation-only underground mine digital twin.
2. Operational question — methane, ventilation, uncertainty, energy, and fan
   reliability must be interpreted together.
3. Architecture — runtime snapshots feed React through FastAPI/WebSocket and
   separately publish through MQTT → Ditto → twin events → Telegraf → InfluxDB.
   The Twin Inspector performs authenticated Ditto GET readback through FastAPI.
4. Physics — six-zone conservative gas balance, network airflow, explicit units
   and fictional assumptions.
5. Safety — deterministic state machine, hysteresis, unknown-data handling,
   simulated interlocks, and safety-over-energy precedence.
6. VOD — bounded exhaustive search, feasibility first, same-condition energy
   comparison; initial uncalibrated synthetic result 1.170833 vs 0.599467 kWh over
   60 seconds (48.8% modeled difference, not measured savings).
7. Scenarios and evidence — S1 methane release, S2 fan failure, exact reset,
   reason codes, live Ditto readback, and exportable decision trace.
8. Reproduce — bootstrap command, full smoke, URL, scope and limitations.

The rendered `presentation.pdf` is generated from `presentation.html` using a
headless browser. All numeric claims in the slides are linked to actual local
validation evidence and labeled as synthetic model outputs.

M13 slide update: parallel Z03/Z04 branches, CO tracer, demonstration thresholds,
candidate/response explainability, S1 emergency at 42 simulated seconds,
194 backend / 32 frontend tests, and pending clean-VM/remote submission gates.
