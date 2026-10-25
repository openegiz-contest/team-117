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

**Twins in Eclipse Ditto (namespace `mineguard`, 16 things, schema v5):**

| Thing ID | Kind | Main features (live state) | Attributes (relations and properties) |
|---|---|---|---|
| `mineguard:mine-01` | underground mine | max methane, max CO, total airflow, fan power, simulation tick | lists of its zones, airways, fans and equipment |
| `mineguard:zone-z01` … `zone-z06` | ventilation zone | `methane` (% volume), `co` (ppm), `airflow` (m³/s), `risk` (state, reason codes), `safety_interlock` (simulated trip, evacuation, fan request and feedback) | volume, depth, inflow/outflow airways, upstream/downstream zones, fans located there, sensor list, boundary (inlet/exhaust) |
| `mineguard:airway-e01` … `airway-e06` | ventilation airway | `flow` (m³/s), `obstruction` (resistance multiplier, OPEN/RESTRICTED) | from-zone, to-zone, length, resistance, design flow, fans on the airway |
| `mineguard:fan-main`, `fan-aux` | ventilation fan | `speed` and `requested_speed` (% rated), `rpm`, `power` (kW), `state` (RUNNING/FAULTED) | rated power and speed, fan-curve parameters, zone, airways |
| `mineguard:shearer-z04` | production equipment (cutting machine) | `state` (RUNNING/TRIPPED), `power` (kW), `cutting_methane` and `exhaust_co` (m³/s) | zone (Z04), operating power, emission rates, interlock source |

**Relations:** all twins carry `_parents: mineguard:mine-01`. Each airway twin
names its `from_zone_id` and `to_zone_id`, and each zone lists its inflow and
outflow airways, its upstream and downstream zones, and the fans and equipment
located in it, so the directed ventilation network can be read straight from
Ditto. The cutting machine is linked to Z04, whose simulated `trip_power`
stops it. Every reference points to
an existing twin (checked by the tests). The same graph is versioned in the
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
reads all 16 twins back from Ditto in one authenticated request, checks that
they belong to one publication, and rebuilds the state that the web UI streams
over WebSocket. Every number the UI shows comes from Ditto
(`publication_status: ECLIPSE_DITTO_READBACK`). Scenario commands go to the
model, never to equipment.

## Modules and What-if Scenarios

| Module or What-if Scenario | What it does | How to see it on the Stand | How to undo it (scenarios) |
|---|---|---|---|
| Coupled airflow and gas-transport twin | Solves the fan/airway network (quadratic resistance, fan curves) and transports methane and CO through the six zones with a conservative well-mixed mass balance; airway flows, fan speeds and the cutting machine are twins of their own | Command Center (3D mine and the **ventilation network** plan view with every airway's live flow); Twin Inspector (16 raw Ditto twins) | — |
| Ventilation and safety: risk state machine and simulated interlock | Classifies each zone as NORMAL / ADVISORY / WARNING / EMERGENCY / UNKNOWN_DATA with hysteresis. At WARNING the simulated `trip_power` **stops the Z04 cutting machine**, which removes its cutting methane and exhaust CO from the mass balance. At EMERGENCY it issues an evacuation advisory and commands both fans to 100 %; the fans ramp at the 5 %/s drive limit, with feedback PENDING → ACHIEVED. A failed fan is excluded; stale data is never treated as safe | Command Center: risk advisory, zone list, **cutting-machine status**, fan RPM, emergency dialog; red face work lamps in 3D; Ditto features `safety_interlock` and `shearer-z04/state` | — |
| Energy: constraint-first ventilation on demand | Enumerates fan-speed combinations within ramp limits, forecasts methane, CO and airflow 60 s ahead, rejects every candidate that violates a constraint, and picks the lowest modeled energy. **Apply recommendation (simulated)** commands the selected speeds in the model after re-checking the current safety state. Disabled while any zone is WARNING, EMERGENCY or UNKNOWN_DATA | Energy page: candidate table (all / feasible / rejected / selected, reason codes), baseline vs VOD kWh, gate status, apply button; the fans then ramp in the Command Center | Reset restores the baseline speeds |
| Explainable decision trace and runtime evidence | Shows observation → reason codes → decision → fan feedback, and runs live checks: Ditto-vs-model unit consistency, gas-balance residual bound, scenario repeatability, readback freshness, single-publication traceability | Evidence page (validation cards, JSON/CSV/report export) | — |
| History dashboard in the official Grafana | Methane and CO by zone, airway flows and obstruction, fan RPM, fan and cutting-machine power, read from InfluxDB (written by the official Telegraf path) | Grafana → Dashboards → OpenEgiz Examples → **MineGuard X — ventilation twin history** | — |
| **S1 — production-face methane release** | Sets the Z04 strata methane source to 0.8 m³/s (from 0.015) for 180 s; methane accumulates by the mass balance, reaches ADVISORY (0.5 %), WARNING (1.0 %, cutting machine tripped) and EMERGENCY (1.5 %, simulated evacuation, both fans ramp to 100 %); downstream Z05/Z06 follow | Command Center → **Simulate methane outburst** / **Gas Release**, or Scenario Lab → *Start controlled run* | **Reset** (Command Center tray or Scenario Lab *Reset baseline*) restores the exact tick-0 baseline. After 180 s the extra source stops by itself |
| **S2 — main ventilation fan failure** | At 10 s the main fan faults (0 RPM); network airflow stops, every zone goes to EMERGENCY with `FAN_FAILED`, the cutting machine trips, the failed fan is excluded from responses, and methane accumulates | Command Center → **Fan Failure**, or Scenario Lab | **Reset** restores the baseline. After 90 s the fault clears automatically |
| **S3 — face intake airway roof fall** | At 10 s the resistance of airway E03 (Z02 → Z04) is multiplied by 250. The network redistributes flow (E03 24.7 → 3.9 m³/s, E02 14.9 → 25.2 m³/s), the face falls below the 5 m³/s dilution constraint → WARNING (`DILUTION_AIRFLOW_LOW`), the cutting machine trips, and methane rises | Command Center → **Airway Block** (the network map shows E03 dashed amber "×250"), or Scenario Lab | **Reset**, or the obstruction clears at 240 s |
| **S4 — production-face gas sensor loss** | At 10 s the Z04 methane and CO sensors stop reporting. The zone keeps its last reading marked STALE, so it becomes UNKNOWN_DATA (never safe): simulated production stop and evacuation, optimizer disabled | Command Center → **Sensor Loss** (Z04 turns purple), or Scenario Lab; Ditto shows quality `STALE` | **Reset**, or the sensors return at 90 s |
| Pause / resume | Freezes and continues the simulated clock; the twins keep publishing the paused state | Command Center tray or Scenario Lab | **Resume** |

## What works and what does not

Verified on 25 October 2026 on Ubuntu 24.04 (WSL2) with Docker 29 and the
official OpenEgiz v1.0.4 stack from this repository:

- **Works:** `bash mineguard/scripts/bootstrap.sh` (official `make up`, the
  MineGuard overlay, wait for verified Ditto readback); rerunning it on a
  running stack. A clean-clone rehearsal from GitHub (fresh volumes and
  credentials, MineGuard images rebuilt) started in 113 s and passed every gate
  below (`mineguard/docs/validation.md`). Base images were already cached
  locally, so first-download time was not measured.
- **Works:** `bash mineguard/scripts/full-smoke.sh`. It runs the official
  `make smoke` (MQTT → Ditto → Telegraf → InfluxDB → Grafana), then checks the
  WebSocket stream, Ditto-sourced state, CO ppm, fan RPM and the
  simulation-only interlock.
- **Works:** `bash mineguard/scripts/scenario-smoke.sh`. S1 reaches Z04
  EMERGENCY (≈1.5 % CH₄, about 43 simulated seconds) and the Ditto twin shows
  the simulated trip and evacuation. S3 shows airway E03 RESTRICTED at
  3.9 m³/s with Z04 in WARNING. S4 shows Z04 UNKNOWN_DATA with quality STALE.
  Every reset returns Ditto to the tick-0 baseline.
- **Works:** source gates — 211 backend tests (pytest), Ruff, strict mypy;
  36 frontend tests (Vitest), TypeScript, ESLint, production build.
- **Works:** live runtime validation on the Evidence page. All five checks
  pass; for example, the Ditto readback matches the model within 2e-11 in
  CH₄ fraction, and the maximum gas-balance residual stays around 1e-14 m³.
- **Works:** the cutting machine trips at WARNING and restarts when Z04 clears.
  Emergency and applied VOD fan commands ramp at 5 %/s; Ditto shows
  `requested_speed` versus `speed`, and the safety feedback moves from PENDING
  to ACHIEVED.
- **Limitation:** the full 3D scene is heavy for CPU-only WebGL (SwiftShader).
  A reduced-detail profile is used automatically on software renderers. The
  readings, labels, network map and controls do not depend on the frame rate.
- **Known simplification:** the airflow network is solved quasi-steadily at
  each tick (no air inertia). Only EMERGENCY fan requests are applied
  automatically; VOD recommendations are applied only when the operator
  presses *Apply recommendation (simulated)*.

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
| Methane sources | Face 0.04 m³/s (2.4 m³/min) = strata 0.015 + coal cutting 0.025; heading 0.008 m³/s; S1 release 0.8 m³/s | Gives baseline face methane ≈0.16 % (0.04 / 24.7 m³/s). The cutting share stops when the machine trips; S1 is a sudden release large enough to cross all tiers within a minute |
| Cutting machine (shearer) | 600 kW operating power; adds 0.025 m³/s CH₄ and 0.0001 m³/s CO at Z04 while running | Fictional machine sized like a mid-range longwall shearer load; it stops whenever Z04's simulated `trip_power` is set (mirrors the 1.0 % de-energize rule above) |
| Fan drive ramp | 5 % of rated speed per second | Variable-speed-drive acceleration limit, a design assumption; the main fan goes 75 → 100 % in 5 s |
| S3 roof fall | Airway E03 resistance × 250 | Chosen so the face falls below the 5 m³/s dilution constraint (E03 → 3.9 m³/s) |
| S4 sensor loss | Z04 CH₄ and CO sensors silent from 10 s to 90 s | Communication-loss case; the stale-data rule turns it into UNKNOWN_DATA |
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

<http://127.0.0.1:8091> — the MineGuard X Command Center. Two spatial views
are driven by the Ditto readback:

- **3D cutaway** of the mine: zone markers coloured by the risk state, labels
  with live CH₄ %, a false-colour methane volume that grows with CH₄, airflow
  particles whose speed follows the intake flow (they stop when the main fan
  fails), the fan rotor driven by actual RPM (red rim on a fault), and face
  work lamps that turn red when the cutting machine is tripped.
- **Ventilation network plan view** (bottom-left of the scene): the real
  Z01–Z06 topology with directed airways E01–E06. Line width and labels show
  each airway's live flow in m³/s. A restricted airway is drawn dashed amber
  with its resistance multiplier, zero flow is grey, zone rings take the risk
  colour, and fan and cutting-machine states are shown. S3 makes the flow
  redistribution directly visible here.

Click a zone label, a network node or a zone in the left rail to inspect it.
*Airflow*, *Sensors*, *Wireframe* and *Recenter View* toggle the scene. The
left rail shows main-fan RPM, intake flow, the cutting-machine state and every
zone's CH₄; the right rail shows the risk advisory and the selected zone's
CH₄, CO and airflow meters. Other views: `/twins`, `/scenarios`, `/energy`,
`/evidence` (see README). The official Grafana remains at
<http://127.0.0.1:3000>.

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
