# MineGuard X

MineGuard X is a fictional, simulation-only underground mine digital twin built
on the official OpenEgiz platform. It couples deterministic airflow and methane
transport, risk and simulated safety state machines, ventilation-on-demand
optimization, controlled scenarios, live Eclipse Ditto publication, and a React
command center with an interactive WebGL spatial twin. It does not control real
equipment.

The browser scene consumes validated FastAPI snapshots from the same runtime
state that is published through OpenEgiz. Eclipse Ditto readiness and the Twin
Inspector provide separate platform readback evidence; the UI does not relabel
an in-memory value as a Ditto response.

## Start in Ubuntu WSL

From the official repository root:

```bash
bash mineguard/scripts/bootstrap.sh
```

Open <http://127.0.0.1:8091>. The wrapper runs the official `make up` sequence
and then starts two nonroot MineGuard extension containers. It preserves the
Example Mine overlay when that overlay is already enabled.

Port `3000` remains assigned to the official OpenEgiz Grafana service. MineGuard
uses `8091` so the extension does not replace or mask upstream infrastructure.

Run the combined live gate with:

```bash
bash mineguard/scripts/full-smoke.sh
bash mineguard/scripts/scenario-smoke.sh
```

The first command runs the official `make smoke`, then requires an advancing
WebSocket stream plus CO/RPM and simulation-only safety features read back from
Eclipse Ditto. The scenario gate drives S1 through Z04 emergency, verifies the
simulated interlock in Ditto, and verifies an exact tick-0 platform reset. Generated credentials
remain in the ignored official Compose environment file and are never placed in
the browser bundle.

## Demonstrate scenarios

```bash
bash mineguard/scripts/run-demo.sh S1_METHANE_LEAK
bash mineguard/scripts/run-demo.sh S2_MAIN_FAN_FAILURE
```

Use the Scenario Laboratory to observe the deterministic run, risk transition,
simulated safety response, pause/resume, and exact baseline reset. Every command
requires the explicit simulation-only API header.

The Command Center also provides a **Simulate methane outburst** control. It
invokes the same guarded scenario API, then visualizes the evolving Z04 gas
cloud, airflow particles, fan response, risk lighting, and simulated production
lockout/evacuation decision in the 3D twin. It does not issue a physical command.

## Operate the 3D twin

- Drag to orbit, scroll to zoom, and select a zone in the scene or zone rail.
- Use the reset-camera and fullscreen controls in the upper-right of the scene.
- Animated fan speed comes from `actual_speed_fraction`; the label reports
  `actual_speed_rpm`. Fan failure stops the rotor and changes its state to red.
- Airflow particle velocity comes from each calculated airway flow. Methane
  particle opacity and zone lighting come from the validated risk snapshot.
- The browser receives snapshots over `/api/v1/stream` WebSocket. The client
  falls back to validated HTTP snapshots if that stream is interrupted.
- Use the map button for the keyboard-accessible directed 2D topology. Browsers
  without WebGL select it automatically rather than receiving fabricated graphics.

## Explain and verify a response

Below the 3D scene, the response panel connects the selected zone's observation,
simulated protection decision, connected airflow paths, and fan request to actual
simulated feedback. The separate Ditto verified tick makes publication delay
visible. The transition log records received sample times, not invented crossing
times; its evidence export includes the received history and provenance.

Energy Intelligence now exposes the complete ventilation candidate search:
feasible/rejected filters, methane/CO forecasts, minimum flow, modeled energy,
switching penalty, and reason codes. A recommendation is not an issued actuator
command. Failed refreshes clear the decision display instead of retaining an
apparently current recommendation.

At `EMERGENCY`, the live worker applies the current safety request to healthy
simulated fans and exposes achieved speed/RPM feedback. Failed fans remain
excluded. This quasi-steady model changes speed instantly; it does not model
motor inertia or physical acknowledgement. Advisory/warning fan requests remain
proposals. Emergency speed is held until a model action or reset changes it;
VOD proposals are revalidated against current state before application.

Tunnel rocks, roofs, ducts and equipment are illustrative procedural geometry.
Colored methane volumes are a false-color data overlay; methane itself is not
visible smoke. SwiftShader/software renderers use a 0.65 canvas pixel ratio;
HTML text and charts retain normal resolution. The 2D topology remains available.
See `docs/m13-validation.md` for measured performance and remaining release gates.

## Local engineering checks

```bash
cd mineguard/backend
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
cd ../frontend
npm ci --no-audit --no-fund
cd ../..
bash mineguard/scripts/test.sh
```

The gate runs Ruff, format verification, strict mypy, pytest, TypeScript,
ESLint, Vitest, and the production frontend build. Dependencies are pinned in
the Python hash locks and `package-lock.json`.

## Model and platform behavior

The six-zone model uses explicit fictional volumes, resistances, fan curves,
gas sources, and demonstration thresholds. Methane stays a volume fraction
inside the physics layer and is displayed as percent volume. Sensor failure or
staleness produces `UNKNOWN_DATA`; it never becomes a safe reading.

The backend physics clock advances every 0.5 seconds. A full nine-twin snapshot
is published every 30 simulated seconds through the official MQTT -> Ditto ->
Telegraf -> InfluxDB path. Platform I/O runs independently from the physics
clock, so slow infrastructure is exposed as connection status instead of
freezing the model.

The backend applies the same conservative transport solver to a
separate configured CO tracer, evaluates configured CO demonstration thresholds,
and exposes CO in ppm. Fan feedback also includes `actual_speed_rpm`, derived
only from the configured fictional nameplate RPM and the simulated speed
fraction. The Command Center shows peak/selected-zone CO and real simulated fan
RPM; runtime validators reject missing, nonfinite, negative, or out-of-range values.

The WebGL view is a procedural representation of the fictional six-zone
topology. It is not a surveyed mine model. A real deployment would require
surveyed geometry, calibrated sensors and fan curves, OT network integration,
role-based access, redundancy, site acceptance testing, and applicable safety
certification before any control authority could be considered.

The energy page compares baseline and VOD candidates from the same state using
the same sources, constraints, and forecast horizon. Values are synthetic model
estimates, not measured industrial savings. All lockout, evacuation, production
stop, fan failure, and fan command behavior is simulated.

See `docs/physics.md`, `docs/safety.md`, `docs/optimization.md`,
`docs/provenance.md`, `docs/validation.md`, and `docs/3d-digital-twin.md` for
equations, assumptions, limitations, and evidence.
