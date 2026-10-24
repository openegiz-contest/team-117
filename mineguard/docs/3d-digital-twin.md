# 3D mine visualization

The Command Center (<http://127.0.0.1:8091>) shows the mine as a procedural
Three.js cutaway (`frontend/src/v3/MineEngine.js`) with HTML overlays. The scene
only displays state; it never writes to Ditto or to the simulation.

## Data lineage

```text
Eclipse Ditto twins ─► backend batch readback ─► /api/v1/stream (WebSocket, 1 Hz)
    ─► useMineState (validation, reset detection, staleness)
    ─► sceneModel.ts ─► sceneAdapter.ts ─► MineEngine.setState()
```

If no new state arrives for 6 s, or the clock is unhealthy, every zone is shown
as `UNKNOWN_DATA` (purple). Stale data is never drawn as safe.

## Visual semantics

| Element | Driven by | Meaning |
|---|---|---|
| Zone marker and halo colour | `risk.state` from Ditto | cyan NORMAL, yellow ADVISORY/WARNING, red EMERGENCY, purple UNKNOWN_DATA; the selected zone has a larger halo |
| Floating zone label | Ditto `methane` (% volume), `risk` | live CH₄ and the risk state machine's state |
| Methane volume (false colour) | zone CH₄ | appears above 0.2 %, grows and turns red toward the 1.5 % emergency tier; methane itself is invisible, so this is a data overlay |
| Airflow particles and arrows | intake airflow (m³/s) | speed proportional to flow; they stop when flow is zero (main-fan failure) |
| Fan rotor | main fan `rpm` | rotation proportional to actual RPM; the rim turns red when the fan is FAULTED |
| Rails and rail cards | Ditto state | RPM, intake flow, every zone's CH₄ and risk, selected zone's CH₄/CO/airflow |
| Emergency dialog | `safety_interlock` | simulated power isolation and evacuation advisory; must be acknowledged |

Rocks, supports, conveyors, ducts and machines are illustrative procedural
geometry. Zone anchor positions are chosen for readability; the authoritative
topology (connectivity, volumes, depths) is in `data/mine_topology.json` and the
Twin Inspector.

## Rendering profiles

At startup `renderProfile.ts` probes the WebGL renderer. On CPU-only WebGL
(SwiftShader, llvmpipe — the judge machine has no GPU) the *software* profile
applies:

- static meshes are merged by material and particles/arrows are instanced
  (both profiles): 88 draw calls instead of 1,229;
- no MSAA, pixel ratio 0.5, Lambert instead of physically based materials, no
  point lights, no additive halo tubes, half the tube segments and particles;
- render loop capped at 20 fps; label positions are recomputed only when the
  camera moves;
- no CSS `backdrop-filter` blurs over the canvas.

Measured with headless Chrome forced onto SwiftShader on a 4-core i5-8365U
laptop that was also running the full platform: 0.6–4.5 frames/s, depending on host
load. All readings, labels, rails and controls update independently of the
frame rate. Hardware-GPU browsers use the full-detail profile.

## Boundary

This is a visualization of a fictional, simulation-only twin, not a surveyed
mine model or a certified safety display.
