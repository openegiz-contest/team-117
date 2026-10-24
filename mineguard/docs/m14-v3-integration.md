# M14 V3 industrial cutaway integration — 24 October 2026

> Superseded by M15, which integrates the full supplied V3 shell and original V3
> Three.js engine. This file records the earlier incremental integration only.

## Scope

The supplied `mineguard-x-3d-react-v3` is a standalone React 18 prototype with a
separate synthetic demo state and a proposed, unverified API adapter. MineGuard X
already has a validated React 19 frontend, six-zone topology, FastAPI WebSocket
state, Eclipse Ditto readiness/readback and guarded scenarios. This milestone
therefore ports the V3 visual language into the existing renderer instead of
replacing the application or its data contracts.

The integrated scene adds a topology-sized geological cutaway, layered strata,
deterministic rock escarpment, service deck, industrial lane markings, conveyor
detail, intake portal, risk-coloured lamps and a larger ventilation fan housing.
The existing six-zone locations, airway flows, methane/CO values, risk state,
fan RPM/power/fault state and simulated interlock indicators remain authoritative.
The geometry is fictional procedural artwork and is not surveyed mine geometry.

## Adaptive rendering

Hardware rendering retains the full V3 scene detail. A detected software renderer
uses the same operational topology and state with fewer decorative supports,
conveyor parts and lamps. This preserves readability and interaction while reducing
CPU rasterization load; no data, risk state or safety indication is removed.

On the same local SwiftShader browser workflow, the first direct integration measured
approximately 1.32 RAF frames per second, 224 draw calls and 46,156 triangles. After
the software detail profile, the final sample measured approximately 5.16 RAF frames
per second, 153 draw calls and 29,164 triangles over a 3.10-second sample. These are
diagnostic measurements on one software renderer, not claims about production GPUs.

## Verification

- `tsc -b --pretty false`: passed.
- `eslint .`: passed with no warnings.
- `vitest run`: 8 files and 34 tests passed.
- `vite build`: passed; 3,092 modules transformed.
- Docker `mineguard-ui` rebuild/recreate: passed.
- `/api/health/ready` and `/`: HTTP 200 after deployment.
- Chrome browser smoke: WebGL, six zones, stable camera, sensor layer, keyboard 2D
  selection, all five desktop routes and all five mobile routes passed with no
  captured browser exception.

Evidence: `docs/m14-v3-browser-optimized/m11-browser-validation.json` and the
screenshots beside it. The historical `m11-` filename is retained by the existing
browser harness; this run is M14 evidence.

## Remaining release limits

This milestone does not complete the independent clean-VM/cache-free startup gate,
hardware-GPU benchmarking, GitHub handoff, or final submission audit. All control,
lockout and evacuation behavior remains simulation only.
