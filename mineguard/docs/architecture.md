# MineGuard X architecture

MineGuard X is an overlay on the official OpenEgiz deployment. It preserves the
base Compose services and uses their MQTT-to-Ditto and twin-event-to-Influx path:

```text
Deterministic runtime
  ├─ validated snapshot -> official MQTT -> Eclipse Ditto features
  │                                      -> twin events -> Telegraf -> InfluxDB
  └─ validated snapshot -> FastAPI -> WebSocket/HTTP -> React 3D command center
Eclipse Ditto -> authenticated managed-twin GET -> FastAPI -> Twin Inspector
```

The runtime is the single owner of the deterministic clock, airflow, methane,
CO, fan, risk, safety, scenario, and VOD state. It publishes a complete snapshot
at a bounded cadence on a separate worker so platform latency cannot stop the
physics clock. Ditto remains the platform twin store, and InfluxDB remains the
OpenEgiz telemetry historian. The browser has no broker or Ditto credential.

The long-running FastAPI service exposes current state, bounded runtime history,
scenario controls, engineering evidence, and managed Ditto readback. The
read-only WebSocket sends one validated snapshot per second. The client uses
HTTP polling while reconnecting and treats a silent or stale feed as unknown.
Simulation mutations require an explicit simulation-only header and an allowed
Origin. No route controls physical equipment.

The UI scene is a consumer of validated state, not a second simulator. It maps
the configured six-zone graph into procedural tunnels and chambers, while
readiness and the Twin Inspector show whether publication/readback through Ditto
is working. This distinction prevents a local runtime value from being labeled
as platform readback evidence.

The Ditto schema contains one mine, six zones, and two fans. Current M10 backend
source extends it to schema v3 with a guarded schema-v2 migration, CO ppm zone
features, configured/actual fan RPM, and exact simulation-only safety interlock
flags. Post-change source and live-stack gates are required before that extension
is recorded as completed evidence.

All configured sensors, geometry, fan nameplates, sources, and thresholds are
fictional, uncalibrated demonstration inputs. Integration tests show software
data flow and state consistency; they do not validate real mine physics or
safety performance.
