# M13 operational depth and verification — 24 October 2026

This records local engineering results. It does not claim industrial readiness,
competition acceptance, or a verified remote submission.

## Delivered behavior

- Readable cutaway scene with instanced rock/support geometry, ducts, lane
  markings, roof sections, portal fan housings and illustrative equipment.
- A separate inspector column, larger scene labels, stable camera across live
  updates, selected-zone focus, responsive routes and a selectable 2D topology.
- Selected-zone observation/protection/ventilation chain, connected airflow
  paths, requested versus actual fan feedback and independent Ditto verified tick.
- Received risk-transition history with sampled timestamps and evidence export.
- Typed, refreshed VOD candidate exploration: feasibility/rejection filters,
  methane/CO/airflow forecasts, modeled energy, switching cost and reason codes.
- Simulated emergency fan response in the live worker. Healthy fans achieve the
  requested model setting, failed fans remain excluded, and stale VOD proposals
  cannot override current safety constraints. Advisory/warning requests remain
  proposals. The quasi-steady response is instantaneous, not a calibrated motor ramp.

## Source and deployed checks

The Ubuntu backend checks passed Ruff lint and formatting, strict mypy over 24
source files, and **194 pytest tests**. Five new tests check emergency airflow
and feedback, fault exclusion, stale VOD rejection, pause/reset, and live-worker
integration. One existing Starlette/httpx deprecation warning remains.

The Windows frontend checks passed TypeScript, ESLint and **32 Vitest tests in
7 files**. The Docker production build also passed. Exact tools used:

```bash
# From mineguard/backend in the Ubuntu checkout:
.venv/bin/python -m ruff check app tests
.venv/bin/python -m ruff format --check app tests
.venv/bin/python -m mypy app
.venv/bin/python -m pytest
# From mineguard/frontend, using the installed Node executable:
node node_modules/typescript/bin/tsc -b --pretty false
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run
```

The final backend was built with Compose `build --no-cache mineguard-backend`;
the UI also completed a no-cache build earlier in this milestone and incremental
builds after its final fixes. **Base images and the existing platform were
already present. This is not an image/cache-independent clean-VM rehearsal.**
Implementation deployment refreshed the two MineGuard extension services.
During the final browser pass, five official services were found stopped with
exit 127 and stale Docker Desktop WSL bind mounts (`not a directory` mounting a
file). Their actual Ubuntu source files were verified present and of the correct
type before recreating only `ditto-nginx`, `mosquitto`, `grafana`, `telegraf` and
`unity` using the existing Compose configuration. Database volumes and repository
configuration were preserved. A failed Twin Inspector browser run during that
outage is not counted as a pass.
The broker's replacement also required restarting the official `connectivity`
worker: the first smoke reported an open connection but no telemetry update.
After reconnection, readiness returned HTTP 200 with newly verified Ditto ticks.
No database reset, volume deletion, credential rotation or source change was used
to restore the platform.

`bash mineguard/scripts/full-smoke.sh` passed the official OpenEgiz smoke,
advancing WebSocket state, CO/RPM contracts, readiness and actual Ditto readback.
One earlier smoke overlapped UI recreation and failed its container health
check; it was rerun after startup. The failed run is not counted as a pass.

## Browser and scenario evidence

From `mineguard/frontend`, with an isolated headless Chrome on loopback CDP 9234:

```bash
node e2e/browser-smoke.mjs http://127.0.0.1:8091 9234 ../docs/m13-browser-final
node e2e/scenario-evidence.mjs http://127.0.0.1:8091 9234 ../docs/m13-closed-loop-evidence
```

The browser report verifies WebGL, six zones, keyboard 2D selection, camera
stability across telemetry, Sensors visibility toggling, four secondary direct
routes and all five routes at a 390px mobile width. No page-level horizontal
  overflow or uncaught browser exception was observed. An earlier Sensors
toggle exposed a DOM unmount error; persistent labels fixed it and the same
regression gate passed afterward.

The final served build also passed the same complete gate after the platform
mount recovery. Its report and screenshots are in `m13-material-browser/`.
The earlier failure screenshot/report in that directory records the actual
Ditto outage; the later `m11-browser-validation.json` records the successful run.

The final scenario runner produced the following *observed samples*. They are
not assertions of exact continuous-time threshold crossings:

| Stage | Tick | Simulated seconds | Z04 methane, % volume |
|---|---:|---:|---:|
| Advisory | 18 | 9 | 0.5102381273 |
| Warning | 47 | 23.5 | 1.0043935539 |
| Emergency | 84 | 42 | 1.5072079809 |

`m13-closed-loop-evidence/report.json` records successful emergency Ditto
interlock, simulated fan response, main-fan failure and reset verification.
`05-ditto-emergency.json` contains actual zone readback and the safety decision;
`05-fan-response-readback.json` contains both fan twins at 100% speed with
nonzero RPM and achieved model feedback. `08-ditto-fan-failure.json` records
main fan failure. `09-reset-ditto.json` records reset readback. Reset verification
requires Ditto tick 0 and scenario IDLE with cleared faults/interlocks; the
running UI may already have advanced a few ticks when its screenshot is taken.

The runner performs guarded simulation commands and always attempts reset in
its finalizer. Intermediate folders `m13-evidence`, `m13-final-evidence` and
`m13-optimized-evidence` are earlier diagnostic runs; use the closed-loop folder
for the final behavioral evidence. Screenshots are actual browser captures.

## Rendering result and remaining performance gate

The final scenario run used ANGLE/SwiftShader software WebGL at 1680×1120 browser
size, a 750×347 drawing buffer for the 1155×534 CSS canvas (0.65 pixel ratio),
195 draw calls and 38,532 triangles. Its approximately 3-second RAF sample was
**3.63 FPS**. The independent final route test sampled **3.26 FPS**. These short
samples on this loaded Windows/WSL host are not a hardware-GPU benchmark or a
claim of sustained frame rate.

A later software-only vertex-lit material variant retained the same geometry
and normal hardware-renderer materials. After platform recovery, its complete
browser gate passed but measured **2.06 FPS** over 3.40 seconds, still at 750×347
canvas pixels and 195 draw calls. That run is in
`m13-material-browser/m11-browser-validation.json`. It does **not** demonstrate
a performance improvement; host load and short samples vary. The final served
profile therefore remains a performance limitation requiring profiling, not an
accepted smooth-rendering result. A read-only host sample reported 23.82 GiB
physical RAM and 7.46 GiB free; older 8 GB setup notes are not current evidence.

Earlier instancing reduced 297 draw calls to 195; resolution and light reductions
did not make software rendering smooth. **The smooth software-WebGL performance
gate remains open.** Keep the functional 2D view available, profile CPU/material
costs next, and measure the actual judge/browser environment. No target FPS is
claimed as achieved. Methane volumes are false-color data, not visible smoke;
geology and equipment are fictional procedural illustrations.

## Truth, license and release audit

- README, SUBMISSION and slide sources describe demonstration thresholds,
  simulated actions and fictional inputs. **48.8% remains an uncalibrated
  initial-state model estimate**, not industrial savings; live forecasts may vary.
- The eight-page PDF was regenerated from the updated slide HTML. Historical
  validation sections retain their original test counts; current claims use
  194 backend / 32 frontend tests.
- `THIRD_PARTY.md` now includes Three.js/Fiber/Drei/Recharts/Tailwind (MIT) and
  Lucide (ISC), verified against the local lockfile. Upstream LICENSE/NOTICE
  remain present. This is not a complete legal review of transitive dependencies.
- `scripts/release-audit.py` scans Git tracked/nonignored working-tree files
  for known credential patterns, suspicious filenames, encoding artifacts and
  large files without printing matched values. Its report is
  `m13-release-audit.json`. Upstream Hono example key/certificate artifacts are
  reported explicitly; findings are compared byte-for-byte with local HEAD.
  It does not scan Git history or prove the absence of every possible secret.
- The recorded scan checked 1,131 text files and approximately 46.42 MiB of
  nonignored files at that point, with no file above 10 MiB. All 26 findings were
  upstream Hono examples identical to local HEAD; none were in MineGuard files.
  No targeted encoding artifact was found. Later evidence captures can increase
  the working-tree size; this is a dated sample, not a repository size limit.
- The local checkout remains `main` at
  `8d60b6dffdfd153e7257ecf5921327920aaba03f` with uncommitted extension work.
  No GitHub commit, push, or submission verification was performed.
- A fresh attempt to open the official rules and environment pages through the
  browsing tool returned “not accessible via this tool.” This milestone does
  not claim a new competition-rule verification; retain the earlier recorded
  source inspection and recheck official requirements before release.

## Next gates

1. Improve and remeasure software rendering; retain the 2D fallback meanwhile.
2. Independent clean Ubuntu VM startup/build, without existing platform images,
   dependency caches or state; validate the final docs from scratch.
3. Resolve final release audit dispositions and team identity, then verify the
   actual submission branch only when the user resumes GitHub work.
