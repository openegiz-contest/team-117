# SUBMISSION — MineGuard X (DeepCore Labs)

## Concept

**Enterprise:** The ventilation system of an underground coal mine. The twin
covers one gassy mine section: intake shaft, main intake gallery, a development
heading, a production face, the return gallery and the return shaft. A main
exhausting fan and an auxiliary heading fan move the air.

**Users:** A control-room operator (what is happening now and where), a
ventilation engineer (which fan setting is safe and how much energy it uses),
and a reliability engineer (what happens when a fan fails, and whether the
response that was requested actually occurred).

**Decision:** How to ventilate the section. Specifically:

- when rising methane or CO requires a stronger ventilation response, a
  production stop or an evacuation advisory;
- which fan speeds are feasible under the methane, CO and airflow constraints,
  and which of them uses the least energy;
- whether a requested response was actually achieved.

**Why this choice:** In a gassy coal mine, ventilation, gas risk, fan
reliability and electricity use are one coupled problem. Changing a fan changes
airflow in every connected zone, and airflow sets methane dilution. A dashboard
that shows each sensor separately cannot answer "what happens if…". A connected
digital twin can. Methane accidents in coal basins, such as the October 2023
Kostenko mine accident in Kazakhstan's Karaganda basin, show why
methane-and-ventilation decision support matters. Main fans are also among the
largest electrical loads of a mine, so ventilation on demand is a real energy
question. Safety must always outrank it.

**Real or fictional:** Fictional. It resembles a typical gassy coal-mine
section ventilated by an exhausting main fan, with an auxiliary fan on a
development heading. Geometry, volumes, resistances and gas sources are
documented design assumptions, not data from a surveyed mine. Where possible,
the numbers follow public engineering references; see *Data and Assumptions*.

## Team

| GitHub |
|---|
| [aljabid](https://github.com/aljabid) |

## Mine

**Part of the enterprise:** an underground coal-mine ventilation section with
six connected zones and two fans.

```text
           E01            E02 (aux fan)         E04
  Z01 Intake shaft ──► Z02 Main intake gallery ──► Z03 Development heading ──┐
                                   │                                         ▼
                                   └── E03 ──► Z04 Production face ── E05 ──► Z05 Return gallery ── E06 ──► Z06 Return shaft (main fan)
```

**Twins in Eclipse Ditto (namespace `mineguard`, nine things):**

| Thing ID | Kind | Main features |
|---|---|---|
| `mineguard:mine-01` | underground mine | max methane, max CO, total airflow, fan power, per-airway flow (`airway_e01`…`airway_e06`), simulation tick |
| `mineguard:zone-z01` … `mineguard:zone-z06` | ventilation zone | `methane` (% volume), `co` (ppm), `airflow` (m³/s), `risk` (state, reason codes), `safety_interlock` (simulated trip, evacuation, fan request and feedback), `simulation` |
| `mineguard:fan-main`, `mineguard:fan-aux` | ventilation fan | `speed` and `requested_speed` (% rated), `rpm`, `power` (kW), `state` (RUNNING/FAULTED) |

**Relations:** zones and fans carry `_parents: mineguard:mine-01`. Each fan
lists its `associated_zone_ids`. The directed airway graph is versioned in the
topology file and validated at startup (connected, acyclic, flow-balanced).

**Where they are defined in the code:**

- Topology, sensors and fans: `mineguard/data/mine_topology.json`
- Initial state, gas sources, thresholds and VOD settings: `mineguard/data/model_parameters.json`
- Twin definitions and idempotent bootstrap: `mineguard/backend/app/integrations/bootstrap_twins.py`
- Snapshot-to-Ditto feature mapping (MQTT `modify /features`): `mineguard/backend/app/integrations/telemetry.py`
- Ditto readback to UI state: `mineguard/backend/app/integrations/platform_state.py`

**Data path:** the deterministic model (0.5 s physics tick) publishes a
complete Ditto `modify /features` message for every twin to MQTT
`telemetry/mineguard/...` once per second. Eclipse Ditto stores the twins and
re-publishes events, and Telegraf writes them to InfluxDB. The MineGuard backend
reads all nine twins back from Ditto in one authenticated request, checks that
they belong to one publication, and rebuilds the state that the web UI streams
over WebSocket. Every number the UI shows comes from Ditto
(`publication_status: ECLIPSE_DITTO_READBACK`). Scenario commands go to the
model, never to equipment.

## Modules and What-if Scenarios

| Module or What-if Scenario | What it does | How to see it on the Stand | How to undo it (scenarios) |
|---|---|---|---|
| Coupled airflow and gas-transport twin | Solves the fan/airway network (quadratic resistance, fan curves) and transports methane and CO through the six zones with a conservative well-mixed mass balance | Command Center (3D mine; per-zone CH₄ %, CO ppm, airflow, fan RPM); Twin Inspector (raw Ditto features) | — |
| Risk and simulated safety state machine | Classifies each zone as NORMAL / ADVISORY / WARNING / EMERGENCY / UNKNOWN_DATA with hysteresis; decides simulated production stop, evacuation advisory and fan response; a failed main fan has emergency precedence; stale or invalid data is never treated as safe | Command Center: risk advisory, zone list, emergency dialog; Ditto feature `safety_interlock` | — |
| Constraint-first ventilation on demand (energy) | Enumerates fan-speed combinations within ramp limits, forecasts methane, CO and airflow 60 s ahead, rejects every candidate that violates a constraint, and picks the lowest modeled energy; disabled while any zone is WARNING, EMERGENCY or UNKNOWN_DATA | Energy page: candidate table (feasible / rejected / selected, reason codes), baseline vs VOD kWh, gate status | — |
| Explainable decision trace and runtime evidence | Shows observation → reason codes → decision → fan feedback, and runs live checks: Ditto-vs-model unit consistency, gas-balance residual bound, scenario repeatability, readback freshness, single-publication traceability | Evidence page (validation cards, JSON/CSV/report export) | — |
| **S1 — production-face methane release** | Raises the Z04 methane source from 0.04 to 0.8 m³/s for 180 s; methane accumulates by the mass balance, reaches ADVISORY (0.5 %), WARNING (1.0 %, simulated production stop) and EMERGENCY (1.5 %, simulated evacuation, both fans to 100 %) | Command Center → **Simulate methane outburst** (or **Gas Release**), or Scenario Lab → *Start controlled run* | **Reset** (Command Center tray or Scenario Lab *Reset baseline*) restores the exact tick-0 baseline. After 180 s the source returns to normal by itself |
| **S2 — main ventilation fan failure** | At 10 s the main fan faults (0 RPM); network airflow stops, every zone goes to EMERGENCY with reason `FAN_FAILED`, the failed fan is excluded from responses, and methane accumulates | Command Center → **Fan Failure**, or Scenario Lab | **Reset** restores the baseline. After 90 s the fault is cleared automatically |
| Pause / resume | Freezes and continues the simulated clock; the twin keeps publishing the paused state | Command Center tray or Scenario Lab | **Resume** |

## What works and what does not

Verified on 25 October 2026 on Ubuntu 24.04 (WSL2) with Docker 29 and the
official OpenEgiz v1.0.4 stack from this repository:

- **Works:** `bash mineguard/scripts/bootstrap.sh` (official `make up`, the
  MineGuard overlay, wait for verified Ditto readback); rerunning it on a
  running stack.
- **Works:** `bash mineguard/scripts/full-smoke.sh`. It runs the official
  `make smoke` (MQTT → Ditto → Telegraf → InfluxDB → Grafana), then checks the
  WebSocket stream, Ditto-sourced state, CO ppm, fan RPM and the
  simulation-only interlock.
- **Works:** `bash mineguard/scripts/scenario-smoke.sh`. S1 reaches Z04
  EMERGENCY (≈1.5 % CH₄ at about tick 84), the Ditto twin shows the simulated
  trip and evacuation, and reset returns Ditto to tick 0.
- **Works:** source gates — 198 backend tests (pytest), Ruff, strict mypy;
  37 frontend tests (Vitest), TypeScript, ESLint, production build.
- **Works:** live runtime validation on the Evidence page. All five checks
  pass; for example, the Ditto readback matches the model within 4e-11 in
  CH₄ fraction, and the maximum gas-balance residual is about 2e-15 m³.
- **Limitation:** the full 3D scene is heavy for CPU-only WebGL (SwiftShader).
  A reduced-detail profile is used automatically on software renderers. The
  readings, labels and controls do not depend on the frame rate.
- **Not implemented:** airway-obstruction and sensor-communication-loss
  scenarios. The model supports obstruction factors and stale-data handling,
  but there is no UI scenario for them.
- **Known simplification:** fan response is quasi-steady (no motor inertia).
  VOD recommendations are proposals and are not applied automatically. Only
  EMERGENCY fan requests are applied to the model.

## Data and Assumptions

All data is **synthetic** and generated by the model at runtime. No
dataset, confidential data or personal data is used.

| Parameter | Value | Source or justification |
|---|---|---|
| Methane demonstration thresholds | ADVISORY 0.5 %, WARNING 1.0 %, EMERGENCY 1.5 % (volume) | The 1.0 % and 1.5 % tiers mirror the action levels of US 30 CFR 75.323(b): at 1.0 %, de-energize equipment and adjust ventilation; at 1.5 %, withdraw persons and disconnect power. Used for demonstration only, not a compliance claim |
| CO demonstration thresholds | 25 / 35 / 50 ppm | 35 ppm = NIOSH REL (TWA), 50 ppm = OSHA PEL (TWA), per the NIOSH Pocket Guide; 25 ppm is used as an early advisory level |
| Main fan | 160 kW, 980 rpm nameplate, shut-off pressure 2.5 kPa | Exhausting axial fan driven by a 6-pole 50 Hz motor (≈1000 rpm synchronous); size chosen to move ≈40 m³/s through the section |
| Auxiliary fan | 22 kW, 1450 rpm, shut-off pressure 180 Pa | Heading booster on a 4-pole 50 Hz motor (≈1500 rpm synchronous) |
| Section airflow | ≈40 m³/s at baseline (39.6 m³/s solved) | About 3 m/s in a roadway of 12–15 m²; a design assumption |
| Zone volumes | 1,200–3,600 m³ | Roadway cross-section 10–15 m² × airway length 200–320 m; design assumptions |
| Airway resistances | 0.12–0.30 N·s²/m⁸ | Chosen to give the baseline split (≈15 m³/s heading, ≈25 m³/s face); not measured |
| Methane sources | Face 0.04 m³/s (2.4 m³/min), heading 0.008 m³/s; S1 release 0.8 m³/s | Gives baseline face methane ≈0.16 % (0.04 / 24.7 m³/s); S1 is a sudden release large enough to cross all tiers within a minute |
| Fan power | rated power × speed³ | Fan affinity law; uncalibrated |
| Physics tick | 0.5 s; transport sub-steps limited by a 0.5 CFL bound | Numerical stability; the mass-balance residual is reported |

Units: methane is a volume fraction inside the model and % volume at the
interface (0.8 % = 8,000 ppm); CO in ppm; airflow in m³/s; power in kW; energy
in kWh. Equations and limits: `mineguard/docs/physics.md`,
`mineguard/docs/safety.md`, `mineguard/docs/optimization.md`,
`mineguard/docs/provenance.md`.

Energy result (model only): from the versioned initial state, over a 60 s
horizon, keeping the current fan speeds uses 1.1708 kWh. The selected feasible
setting (main 60 %, aux 40 %) uses 0.5995 kWh, a 48.8 % difference, with all 16
candidates meeting the constraints. This is an uncalibrated synthetic
estimate, not a measured saving.

## Mine visualization

<http://127.0.0.1:8091> — the MineGuard X Command Center. A procedural 3D
cutaway of the six-zone mine shows zone labels with live CH₄ % and risk
state, airflow particles along the airways, fan rotors driven by actual RPM,
and risk-coloured lighting. Click a zone label or a zone in the left rail to
inspect it. *Airflow*, *Sensors*, *Wireframe* and *Recenter View* toggle the
scene. The left rail shows main-fan RPM, intake flow and every zone's CH₄; the
right rail shows the risk advisory and the selected zone's CH₄, CO and airflow
meters. Other views: `/twins`, `/scenarios`, `/energy`, `/evidence` (see
README). The official Grafana remains at <http://127.0.0.1:3000>.

Rocks, roof supports, ducts and machinery are illustrative procedural
geometry, not a surveyed mine. Coloured methane volumes are a false-colour data
overlay.

## Limitations

- Fictional, uncalibrated mine: the results show model behaviour, not
  predictions for a real mine.
- Physics: steady incompressible network flow with fixed quadratic resistance
  (no leakage, natural ventilation, recirculation or reverse flow). Gas is a
  dilute tracer in well-mixed zones (no layering or buoyancy). A stopped main
  fan gives zero network flow.
- Safety: thresholds are demonstration settings. Production stop, evacuation
  and fan commands are simulated state in Ditto (`equipment_io: false`). This
  is not a certified safety system.
- Energy: the affinity-law estimate does not include motor or drive
  efficiency curves.
- 3D rendering is slow on CPU-only WebGL; the numbers on screen remain correct.
- A real deployment would need surveyed geometry, calibrated sensors and fans,
  an OT gateway, authentication and roles, redundancy, alarm management, a
  hazard analysis and regulatory approval.

## Presentation

`presentation.pdf` in the repository root.

---

Platform: OpenEgiz v1.0.4.
