#!/usr/bin/env bash
# Run local extension checks without touching upstream services or Git state.
set -euo pipefail
extension_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$extension_root/backend"
python="$PWD/.venv/bin/python"
if [[ ! -x "$python" ]]; then
  echo "Missing backend/.venv. Follow mineguard/README.md setup." >&2
  exit 1
fi
"$python" -m ruff check app tests
"$python" -m ruff format --check app tests
"$python" -m mypy app
"$python" -m pytest "$@"

cd "$extension_root/frontend"
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
npm run typecheck
npm run lint
npm run test -- --run --maxWorkers=1
npm run build
