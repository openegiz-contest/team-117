# MineGuard X operations

Run inside Ubuntu WSL from the official repository on the Linux filesystem.

## Startup and health

```bash
bash mineguard/scripts/bootstrap.sh
bash mineguard/scripts/full-smoke.sh
```

The first command preserves the official `make up` initialization/readiness
sequence and then starts `mineguard-backend` and `mineguard-ui`. It does not
remove unrelated services or volumes. Open <http://127.0.0.1:8091>.

The combined smoke requires the official platform gate, MineGuard readiness,
and a live Z04 Ditto readback. Readiness reports `platform_configured`,
`platform_connected`, and a credential-free error class.

## Diagnostics

```bash
make ps
docker compose -f deploy/compose/docker-compose.yml \
  -f mineguard/deploy/compose.mineguard.yml logs --tail=100 mineguard-backend
curl --fail http://127.0.0.1:8091/api/health/ready
```

Never print or capture `deploy/compose/.env`, authorization headers, or expanded
Compose configuration containing secrets. The backend port stays internal; the
UI proxy is the localhost entry point.

## Runtime behavior

Physics advances every 0.5 seconds. Platform publication runs in a separate
bounded worker every 60 ticks (30 simulated seconds). The latest pending state
replaces an older pending state if Ditto is slow, preventing platform I/O from
stalling physics. The 30-second cadence passed official smoke on this 8 GB host;
a tested 5-second full-nine-twin cadence caused official event/Influx timeouts
and was rejected.

Scenario reset affects MineGuard's simulation only. Stop the extension while
keeping official data with:

```bash
docker compose -f deploy/compose/docker-compose.yml \
  -f mineguard/deploy/compose.mineguard.yml stop mineguard-ui mineguard-backend
```

Do not use `make clean`, `down -v`, or orphan removal for normal MineGuard work.
