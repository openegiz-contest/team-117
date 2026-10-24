# M16 — supplied exact UI patches

Date: 24 October 2026

## Scope

The supplied `MineGuardX_Final_Three_Pages_Full.zip` visual system now owns the
Twin Inspector, Scenario Laboratory and Energy Intelligence routes. The supplied
`MineGuardX_Evidence_Exact_Patch.zip` visual system owns Engineering Evidence.
The Command Center and its live V3 mine remain unchanged.

The original CSS and reference artwork were retained. Integration code replaces
the standalone package's proposed/demo data path with MineGuard's validated
FastAPI/WebSocket contracts, guarded scenario commands, Eclipse Ditto readiness
and VOD decision trace.

## Truth and safety controls

- Operational routes default to live backend state.
- Methane is converted from internal fraction to percent volume exactly once.
- CO stays in ppm and airflow stays in m3/s.
- Scenario actions use the existing `X-MineGuard-Simulation: SIMULATION_ONLY`
  guarded API client.
- Energy candidates are read from `/api/v1/decision-trace`; rejected candidates
  remain rejected and missing values remain unavailable.
- Evidence does not manufacture test results. Validation cards say `NOT VERIFIED`
  unless structured trusted results are supplied.
- Twin Inspector refreshes all nine authenticated Eclipse Ditto entities and
  displays the real policy, attributes and scalar feature properties. Its local
  snapshot fallback is separately labeled.
- `?reference=1` shows the unchanged supplied PNG for visual comparison only and
  labels it as a static reference.

## Validation

- TypeScript: pass.
- ESLint: pass with no warnings.
- Vitest: 10 files, 37 tests passed.
- Vite production build: pass, 1,964 modules.
- Docker UI image rebuild/recreate: pass.
- HTTP UI and readiness: pass; platform and simulation connected.
- Chromium desktop/mobile direct routes: pass for Command, Twin, Scenario,
  Energy and Evidence.
- Browser exceptions: none captured.
- Twin Inspector: nine managed entities displayed after live state arrival.

Final screenshots and `m11-browser-validation.json` are in
`docs/m16-exact-ui-patches-final/`.

## Remaining limitation

The Command Center's full procedural V3 scene remains expensive under CPU
SwiftShader. The latest run sampled approximately 1.17 RAF FPS, 1,229 draw calls
and 196,660 triangles. This is a software-renderer diagnostic, not a hardware-GPU
performance claim, and remains a release optimization item.
