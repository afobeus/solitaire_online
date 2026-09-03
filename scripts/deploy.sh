#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test -f .env || { echo "Создайте .env из .env.production.example" >&2; exit 1; }
mkdir -p backups
docker compose config --quiet
docker compose run --rm --no-deps --user 0 app chown 10001:10001 /backups /data
docker compose up -d --no-build
docker compose ps
