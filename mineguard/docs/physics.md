# Coupled gas transport and ventilation network

Every zone is a fixed well-mixed volume. Each dilute tracer is an internal
volume fraction C, source G has units m3 tracer/s, and directed mixture flow Q
has units m3/s. Volumes and rates refer to the same assumed pressure and
temperature. Methane and CO are advanced independently by the same conservative
solver; neither source changes the bulk ventilation solution.

```text
V_i dC_i/dt = G_i + sum_j(Q_ji C_j) - sum_k(Q_ik C_i)
```

This dilute-tracer approximation does not model compressibility, stratification,
buoyancy, gas adsorption, turbulent dispersion or changing oxygen. Concentrations
outside [0,1] are rejected rather than clipped into a plausible-looking result.
No configured concentration is a legal operating threshold.

The data configuration retains the balanced 40 m3/s M1 reference flow for
input validation. M2 no longer transports methane on that prescribed value;
it solves the fan/network operating point before every tick.

## M2 quasi-steady airflow model

Each open airway uses the quadratic pressure-loss assumption:

```text
delta_p = R Q^2
```

Each simulated fan uses a quadratic curve and affinity-law electrical power
approximation:

```text
delta_p_fan = p_shutoff s^2 - K_fan Q^2
power = rated_power s^3
```

Here `s` is a command fraction in [0,1]. The fixed topology is Z01 -> Z02,
parallel Z03/Z04 branches, Z05 -> Z06. The auxiliary fan adds pressure to the
Z03 branch. A bounded bisection solves the common branch pressure; derived
branch flows conserve volume at every junction. The main fan operating point
balances its curve against the two series airways and parallel network.

This is a deterministic demonstration model, not a calibrated mine ventilation
solver. It assumes incompressible, steady, nonnegative flow and fixed quadratic
resistance. It omits leakage, natural ventilation, doors, recirculation,
transients and reverse flow. A stopped or faulted main fan therefore gives zero
network flow. Configured fan efficiency is retained as engineering metadata but
is not used by the rated-power cubic approximation. Obstruction factors can only
increase resistance and all fan/obstruction changes are calculated before state
commit, so an invalid command cannot partially change the simulation.

## Conservative time integration

All zones use the same old-state snapshot during each explicit substep.
Internal flux leaving one zone enters the connected zone with the identical
rate and concentration. The solver chooses:

```text
n = max(1, ceil(dt * max_i(Q_out_i / V_i) / cfl_limit))
h = dt / n
C_next_i = C_i * (1 - h Q_out_i / V_i)
           + h * (G_i + sum_j(Q_ji C_j)) / V_i
```

The default cfl_limit is 0.5; accepted values lie in (0,1]. This makes the
source-free transport update a convex mixture for balanced flows. More than
max_substeps is rejected to bound work. Explicit Euler has first-order temporal
accuracy and numerical mixing; substeps are a stability mechanism, not a
calibration or accuracy guarantee. Tests compare convergence with the
single-zone analytic solution C(t)=C(0) exp(-Q t/V) for zero source/clean inlet.

Each methane and CO step has its own ledger:

```text
residual = tracer_after - tracer_before - source_added - inlet_added + exhausted
```

A tick commits methane, CO, and clock state only after both tracer calculations
succeed. The clock uses tick_count * fixed_dt, independent of wall-clock speed.
Model fractions are converted explicitly for external units: 0.008 fraction =
0.8 percent volume = 8000 ppm. CO is exposed in ppm; its fictional sources and
boundary concentration are versioned in the same model data as methane.

Fan actual RPM is `rated_speed_rpm * actual_speed_fraction`, and becomes zero
for a faulted fan. Rated RPM is fictional nameplate metadata, so this calculation
does not model slip, motor dynamics, tachometer error, or measured shaft speed.

Observed numerical behaviour: over live runs the maximum absolute balance
residual of both tracers stays near 2e-15 m³ (see `validation.md`).
