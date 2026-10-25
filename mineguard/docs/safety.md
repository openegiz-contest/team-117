# M3 risk and simulated safety behavior

MineGuard X uses five states: `NORMAL`, `ADVISORY`, `WARNING`, `EMERGENCY` and
`UNKNOWN_DATA`. The configured methane thresholds are fictional demonstration
values: 0.5%, 1.0% and 1.5% volume. They are not legal limits. Internal values
remain fractions (0.005, 0.010 and 0.015). A 0.1 percentage-point downgrade
hysteresis prevents oscillation at boundaries. The configured CO demonstration
thresholds are 25, 35, and 50 ppm with a 5 ppm downgrade hysteresis. They are
fictional scenario settings, not occupational or legal limits. The highest
severity produced by methane or CO is used before airflow/fan precedence. The
minimum demonstration airflow is 5 m3/s and the freshness timeout is 5 simulated
seconds.

Invalid, explicitly stale or expired readings become `UNKNOWN_DATA`; they never
become zero or safe. A known main-fan failure has hard `EMERGENCY` precedence,
even when telemetry is stale. Low airflow produces at least `WARNING`. Upgrades
are immediate, while downgrades cross the configured hysteresis band first.
Every state transition emits structured zone, previous/current state, reasons,
simulation time and source provenance fields.

Safety decisions are pure simulated state with no equipment I/O:

| State | Production stop | Evacuation advisory | Ventilation request | Optimization |
|---|---:|---:|---:|---:|
| NORMAL | No | No | No | Enabled |
| ADVISORY | No | No | Yes | Enabled |
| WARNING | Yes | No | Yes | Disabled |
| EMERGENCY | Yes | Yes | Yes | Disabled |
| UNKNOWN_DATA | Yes | Yes | No blind command | Disabled |

Ventilation requests have deterministic simulated command IDs and separately
record requested versus actual fan speed. A failed fan is marked
`EXCLUDED_FAULTED`; it is never presented as an achieved response. `PENDING`
does not mean the simulated actuator changed. Future optimization and scenarios
must respect these interlocks and cannot re-enable optimization during warning,
emergency or uncertainty.

Ditto zone features mirror the decision as a simulation-only `safety_interlock`:
`trip_power` equals `production_stop` exactly, and evacuation/ventilation flags
come from the same decision. `equipment_io` remains false. These fields are
state for demonstration and audit; they are not connected to a PLC, relay, fan,
or mine power system.

## M13 emergency model response

After each live physics/scenario step, `RuntimeService` applies current
`EMERGENCY` fan requests to the healthy simulated fans. The fan/network model
is quasi-steady: speed changes immediately, airflow is solved atomically, and
the safety assessment is refreshed to expose achieved model feedback. Gas
concentrations are unchanged by the command itself and evolve on subsequent
transport steps. No motor inertia, ramp timing or hardware acknowledgement is
claimed. Advisory/warning requests remain proposals; paused models do not actuate.

Failed fans remain `EXCLUDED_FAULTED` and at zero actual RPM. Reset restores
the versioned baseline. VOD application recomputes and compares the current
proposal, rejecting stale or safety-blocked requests before changing model state.
Five regression tests cover feedback, flow response, failed-fan exclusion,
pause/reset, live-worker integration and stale-proposal precedence.

## Production interlock and fan drive ramp

The Z04 cutting machine (`mineguard:shearer-z04`) runs while its zone has no
simulated production stop. When `trip_power` is set (WARNING, EMERGENCY or
UNKNOWN_DATA in Z04, or a failed main fan), the machine stops: its 600 kW load
drops to 0, and its cutting methane (0.025 m³/s) and exhaust CO (0.0001 m³/s)
leave the Z04 mass balance on the next tick. It restarts when the zone no
longer requires a stop. The trip therefore changes the physics, not only a flag.

Fan commands — EMERGENCY requests from the safety state machine and an applied
VOD recommendation — set the *requested* speed. The actual speed follows it at
5 % of rated speed per second, a variable-speed-drive acceleration limit used
as a design assumption. Feedback stays `PENDING` until the actual speed equals
the request, then reads `ACHIEVED`. A failed fan stays `EXCLUDED_FAULTED` at
0 rpm. Ditto shows both `requested_speed` and `speed` for every fan.

| Scenario | Safety consequence |
|---|---|
| S3 airway roof fall | Z04 airflow below 5 m³/s → WARNING (`DILUTION_AIRFLOW_LOW`) → cutting machine tripped |
| S4 sensor loss | Z04 gas readings STALE → UNKNOWN_DATA → production stop and evacuation advisory, optimizer disabled |
