# Third-party software and assets

MineGuard X keeps the licenses and notices shipped with OpenEgiz (`LICENSE`,
`NOTICE`, `LICENSES/` at the repository root). It uses these ecosystems through
locked manifests:

- **OpenEgiz platform** (Eclipse Ditto, Eclipse Mosquitto, Telegraf, InfluxDB,
  Grafana, MongoDB and the platform's own services), under their respective
  licenses, through the official Docker images named in
  `deploy/compose/docker-compose.yml`.
- **Python backend** (`backend/requirements*.txt`, hash-locked): FastAPI,
  Starlette, Uvicorn, Pydantic, paho-mqtt and their dependencies; pytest, Ruff,
  mypy and httpx for development.
- **Frontend** (`frontend/package-lock.json`): React, React DOM and React Router
  (MIT); Three.js (MIT) for the 3D scene; Lucide React icons (ISC);
  Tailwind CSS (MIT); Vite, TypeScript, ESLint, Vitest, Testing Library and
  jsdom for building and testing.
- **Container base images**: `python:3.12.12-slim`, `node:24.16.0-alpine`
  (build stage only), `nginx:1.25-alpine`.

Visual assets: the 3D mine is procedural Three.js geometry generated at
runtime. The scenario-card and banner images in `frontend/public/` were
supplied to the team as part of its UI design package. Screenshots in `docs/`
are captures of this application. No industrial measurement, proprietary
dataset or personal data is included.

This notice lists dependencies; it is not a legal license audit of every
transitive package.
