# MineGuard X operations

Run from the repository root on Linux (or Ubuntu under WSL2, on the Linux file
system).

## Startup and health

```bash
sudo apt-get install -y make          # if missing
bash mineguard/scripts/bootstrap.sh   # official make up + MineGuard overlay
bash mineguard/scripts/full-smoke.sh  # official make smoke + MineGuard checks
bash mineguard/scripts/scenario-smoke.sh
```

`bootstrap.sh` keeps the official `make up` initialization and readiness
sequence. It then builds and starts `mineguard-backend` and `mineguard-ui` and
waits until readiness reports a verified Ditto readback. It removes no services
or volumes and can be run again on a running stack. Open
<http://127.0.0.1:8091>.

## Diagnostics

```bash
docker compose -f deploy/compose/docker-compose.yml -f mineguard/deploy/compose.mineguard.yml ps
docker compose -f deploy/compose/docker-compose.yml -f mineguard/deploy/compose.mineguard.yml logs --tail=100 mineguard-backend
curl --fail http://127.0.0.1:8091/api/health/ready
```

Never print `deploy/compose/.env`, authorization headers or an expanded Compose
configuration. The backend port stays internal; the UI proxy is the only
entry point.

## Runtime behaviour

- The physics clock ticks every 0.5 s. The publisher sends all 16 twins every
  2 ticks (`MINEGUARD_PUBLISH_EVERY_TICKS`, default 2 = 1 s) and verifies them by
  Ditto readback. If Ditto is slow, the newest pending snapshot replaces an
  older one, so I/O never stalls the physics.
- Observed load at 1 Hz on a fresh stack (clean-clone rehearsal): Ditto
  `connectivity` ≈ 55 % of one CPU, `things` ≈ 31 %, `gateway` ≈ 14 %,
  `things-search` ≈ 13 %; every container stayed inside its memory limit, and the
  official `make smoke` passed while publishing. On a long-lived development stack
  (hundreds of thousands of journal events) the same publication costs more.
- Telegraf tags every point with the message's `correlationId`, so InfluxDB
  history has high series cardinality by platform design; the MineGuard Grafana
  dashboard therefore defaults to a 5-minute window without auto-refresh.
- Scenario reset restores the versioned baseline at tick 0 and republishes it
  immediately.

## Stopping

```bash
docker compose -f deploy/compose/docker-compose.yml -f mineguard/deploy/compose.mineguard.yml down
```

Twins and time-series data are kept. `make clean` deletes all platform data and
credentials.
