#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
name="solitaire-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
docker compose run --rm --no-deps app node scripts/database.mjs backup "/backups/$name"
echo "backups/$name"
