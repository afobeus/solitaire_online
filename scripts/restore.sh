#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test "$#" -eq 1 || { echo "Использование: ./scripts/restore.sh backups/имя.sqlite" >&2; exit 1; }
case "$1" in backups/*.sqlite) ;; *) echo "Файл должен находиться в ./backups и иметь расширение .sqlite" >&2; exit 1;; esac
test -f "$1" || { echo "Файл не найден: $1" >&2; exit 1; }
base=$(basename "$1")
docker compose stop app
trap 'docker compose start app' EXIT
docker compose run --rm --no-deps -e RESTORE_OFFLINE=1 app node scripts/database.mjs restore "/backups/$base"
docker compose start app
trap - EXIT
docker compose ps
