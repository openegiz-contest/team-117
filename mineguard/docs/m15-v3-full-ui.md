# M15 full V3 UI replacement — 24 October 2026

## Outcome

MineGuard X now uses the supplied V3 package as the full visual system rather than
as an inspiration layer. The application header, tab navigation, left ventilation
and sector rails, central mine scene, right risk/sector rails, bottom status strip,
responsive layout and procedural Three.js environment come from the V3 design.
Twin Inspector, Scenario Laboratory, Energy Intelligence and Engineering Evidence
retain their functional implementations inside the same V3 shell and panel system.

## Live integration

The V3 prototype's synthetic demo loop and proposed API client were deliberately
excluded. `sceneAdapter.ts` maps the validated `MineSceneModel` into the V3 engine:

- six authoritative zone identifiers and names;
- methane in percent by volume, CO in ppm and airflow in m3/s;
- explicit telemetry quality;
- main-fan actual RPM and intake flow;
- risk state, safety response and selected-zone state.

The global header polls validated readiness. The command center continues to use
the existing FastAPI WebSocket/HTTP fallback hook. Scenario buttons call the guarded
`/api/v1/scenarios/...` routes with simulation-only protection. Eclipse Ditto remains
the platform readback; no browser control can reach physical equipment.

## Source and build verification

- TypeScript project build: passed.
- ESLint: passed without warnings.
- Vitest: 9 files and 35 tests passed.
- Vite production build: passed, 1,964 modules transformed.
- Docker `mineguard-ui` image rebuilt and container recreated successfully.
- UI and readiness endpoints returned HTTP 200.

## Browser verification

`docs/m15-v3-full-ui-final/m11-browser-validation.json` records:

- all six zones rendered and selectable;
- V3 sensor visibility and camera stability passed;
- `/`, `/twins`, `/scenarios`, `/energy`, `/evidence` passed on desktop and mobile;
- no horizontal page overflow in the tested viewports;
- no uncaught browser exception.

The screenshot filename retains the old `m11-` prefix because the established browser
harness uses it. The evidence directory and report date identify this as M15.

## Live scenario verification

The final scenario runner exited 0. It captured and asserted:

- baseline;
- Z04 advisory at tick 18 and 0.510238% methane;
- Z04 warning at tick 47 and 1.004394% methane;
- Z04 emergency at tick 84 and 1.507208% methane;
- simulated production isolation, evacuation advisory and maximum ventilation;
- Ditto emergency readback and two achieved 100% fan responses;
- main-fan-failure readback with zero actual RPM;
- baseline reset, cleared fan faults/interlocks and Ditto reset readback.

Evidence is in `docs/m15-v3-scenario-final/`. All safety actions are simulated.

## Performance boundary

The full supplied V3 scene is substantially heavier than the previous schematic.
The final CPU SwiftShader scenario sample reported about 0.56 approximate RAF FPS,
1,227 draw calls and 196,564 triangles at a 1680x1120 viewport with a 0.55 render
ratio. This measurement is a diagnostic software-rendering result, not a hardware
GPU benchmark. Hardware validation and a later geometry-instancing pass remain open;
the visual replacement is complete, but software-rendering smoothness is not solved.
