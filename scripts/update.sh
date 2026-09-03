#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./scripts/backup.sh
# The prebuilt image may be loaded locally with docker load; pull only on request.
if [ "${1:-}" = "--pull" ]; then docker compose pull app caddy; fi
docker compose up -d --no-build --remove-orphans
docker compose ps
