# Ventilation-on-demand optimization

MineGuard X M4 uses an exhaustive, deterministic search over a small configured
set of fan speeds. This is a simulation-only controller. It has no equipment
interface and cannot operate real fans.

For every candidate, the controller:

1. enforces the configured per-decision fan-speed ramp;
2. solves the same six-zone airflow model used by the runtime;
3. advances the same conservative methane model from the current state for the
   configured 60-second horizon;
4. rejects any setting whose minimum zone airflow is below the configured demo
   constraint or whose predicted methane reaches the configured warning level;
5. minimizes predicted fan energy plus a small switching penalty.

`WARNING`, `EMERGENCY`, and `UNKNOWN_DATA` states disable optimization. A fan
fault or an empty feasible set returns `NO_FEASIBLE_SAFE_OPTIMIZATION`; neither
case is reported as a successful optimization. Selected commands are proposals
until `Simulation.apply_vod_decision` validates and atomically applies them to
the simulated runtime.

## Energy comparison

The baseline and optimized estimates start from the same snapshot and use the
same sources, model, constraints, and horizon. Reported savings use fan energy
only; the switching penalty affects selection but is not counted as consumed
energy. A comparison records whether both strategies met the constraints.

The versioned initial-state validation selected main/auxiliary speed fractions
of 0.6/0.4. Over the fictional 60-second model horizon, the baseline estimate
was 1.170833 kWh and the selected estimate was 0.599467 kWh. The calculated
difference was 0.571367 kWh (48.8%). These are outputs of the uncalibrated
synthetic model, not measured savings or a real-mine performance claim.

Run the reproducible decision with:

```bash
cd mineguard/backend
.venv/bin/python -m app.control.vod_controller
```

Configuration provenance and limitations remain those documented in
`physics.md`, `safety.md`, and `provenance.md`.
