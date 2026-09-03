#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Solitaire Battle Royale"
DEFAULT_REPOSITORY="https://github.com/afobeus/solitaire_online.git"
DEFAULT_INSTALL_DIR="/opt/solitaire-battle-royale"
PROJECT_DIR=""

green='\033[1;32m'
yellow='\033[1;33m'
red='\033[1;31m'
reset='\033[0m'

info() { printf "${green}▶${reset} %s\n" "$*"; }
warn() { printf "${yellow}⚠${reset} %s\n" "$*" >&2; }
die() { printf "${red}Ошибка:${reset} %s\n" "$*" >&2; exit 1; }

on_error() {
  local line="$1"
  printf "\n${red}Установка остановлена на строке %s.${reset}\n" "$line" >&2
  if [[ -n "$PROJECT_DIR" && -f "$PROJECT_DIR/compose.yaml" ]]; then
    printf "Последние логи можно посмотреть так:\n  cd %q && docker compose logs --tail=100\n" "$PROJECT_DIR" >&2
  fi
}
trap 'on_error "$LINENO"' ERR

prompt() {
  local label="$1" default="${2:-}" value
  if [[ -n "$default" ]]; then
    printf "%s [%s]: " "$label" "$default" >/dev/tty
  else
    printf "%s: " "$label" >/dev/tty
  fi
  IFS= read -r value </dev/tty || true
  printf '%s' "${value:-$default}"
}

read_env() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -v wanted="$key" 'index($0, wanted "=") == 1 { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

valid_domain() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}

valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

valid_number() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" >= "$2" && "$1" <= "$3" ))
}

if [[ "$(id -u)" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "Запустите скрипт от root или установите sudo."
  exec sudo -E bash "${BASH_SOURCE[0]}" "$@"
fi

[[ -r /etc/os-release ]] || die "Не удалось определить Linux-дистрибутив."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) die "Автоматическая установка поддерживает Ubuntu и Debian. Обнаружено: ${PRETTY_NAME:-неизвестно}." ;;
esac

export DEBIAN_FRONTEND=noninteractive
info "Устанавливаю системные пакеты"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg openssl >/dev/null

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  info "Устанавливаю Docker Engine и Compose"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  architecture="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:-}"
  [[ -n "$codename" ]] || die "Не удалось определить кодовое имя дистрибутива."
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$architecture" "$ID" "$codename" >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
docker compose version >/dev/null || die "Docker Compose v2 не запустился."

if script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"; then
  :
else
  script_dir="$(pwd)"
fi
if [[ -f "$script_dir/compose.yaml" && -f "$script_dir/Dockerfile" && -f "$script_dir/package.json" ]]; then
  PROJECT_DIR="$script_dir"
  info "Использую проект из $PROJECT_DIR"
else
  repository="$(prompt "Git URL проекта" "$DEFAULT_REPOSITORY")"
  install_dir="$(prompt "Каталог установки" "$DEFAULT_INSTALL_DIR")"
  branch="$(prompt "Ветка Git" "main")"
  [[ "$install_dir" == /* ]] || die "Каталог установки должен быть абсолютным путём."
  if [[ -d "$install_dir/.git" ]]; then
    info "Обновляю исходный код в $install_dir"
    git -C "$install_dir" fetch --prune origin "$branch"
    git -C "$install_dir" checkout "$branch"
    git -C "$install_dir" pull --ff-only origin "$branch"
  elif [[ -e "$install_dir" ]] && [[ -n "$(find "$install_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    die "Каталог $install_dir уже существует и не является Git-репозиторием."
  else
    info "Загружаю исходный код"
    mkdir -p "$(dirname "$install_dir")"
    git clone --branch "$branch" --single-branch "$repository" "$install_dir"
  fi
  PROJECT_DIR="$install_dir"
fi

cd "$PROJECT_DIR"
[[ -f compose.yaml && -f Dockerfile && -f Caddyfile ]] || die "В $PROJECT_DIR нет полного проекта."
mkdir -p backups

old_domain="$(read_env .env DOMAIN)"
old_email="$(read_env .env ACME_EMAIL)"
old_matches="$(read_env .env MAX_MATCHES)"
old_connections="$(read_env .env MAX_CONNECTIONS)"

printf '\nНастройка публичного адреса. До запуска направьте A-запись домена на этот сервер.\n'
while true; do
  domain="$(prompt "Домен без https:// и пути" "${old_domain:-}")"
  domain="${domain,,}"
  valid_domain "$domain" && break
  warn "Введите домен вида game.example.com."
done
while true; do
  acme_email="$(prompt "Email для уведомлений о TLS-сертификате" "${old_email:-admin@$domain}")"
  valid_email "$acme_email" && break
  warn "Введите корректный email."
done
while true; do
  max_matches="$(prompt "Максимум одновременных матчей" "${old_matches:-12}")"
  valid_number "$max_matches" 1 1000 && break
  warn "Введите целое число от 1 до 1000."
done
while true; do
  max_connections="$(prompt "Максимум WebSocket-соединений" "${old_connections:-120}")"
  valid_number "$max_connections" 2 10000 && break
  warn "Введите целое число от 2 до 10000."
done

public_ip="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
dns_ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, - || true)"
if [[ -n "$public_ip" && -n "$dns_ips" && ",$dns_ips," != *",$public_ip,"* ]]; then
  warn "DNS домена $domain сейчас указывает на $dns_ips, а публичный IPv4 сервера — $public_ip."
  warn "Сервисы запустятся, а Caddy получит сертификат автоматически после исправления DNS."
elif [[ -z "$dns_ips" ]]; then
  warn "A-запись $domain пока не найдена. HTTPS станет доступен после появления DNS-записи."
fi

mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
if (( mem_kb < 1800000 && swap_kb < 524288 )); then
  info "На сервере мало памяти; создаю swap 2 ГБ для надёжной сборки"
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
fi

available_kb="$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print $4}')"
(( available_kb >= 3000000 )) || die "Для Docker-сборки нужно не менее 3 ГБ свободного места."

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  info "Открываю HTTP/HTTPS в активном UFW"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  info "Открываю HTTP/HTTPS в firewalld"
  firewall-cmd --permanent --add-service=http >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --permanent --add-port=443/udp >/dev/null
  firewall-cmd --reload >/dev/null
fi

# Переменная нужна Compose уже при чтении конфигурации старой установки,
# где ACME_EMAIL мог ещё отсутствовать.
export ACME_EMAIL="$acme_email"
export DOMAIN="${old_domain:-$domain}"
if [[ -f .env ]] && docker compose ps -q app 2>/dev/null | grep -q .; then
  info "Создаю согласованную резервную копию существующей SQLite"
  bash scripts/backup.sh
fi
if [[ -f .env ]]; then
  cp -a .env ".env.before-install-$(date -u +%Y%m%dT%H%M%SZ)"
fi

umask 077
cat >.env <<ENV
DOMAIN=$domain
ACME_EMAIL=$acme_email
IMAGE_NAME=solitaire-br:server
MAX_MATCHES=$max_matches
MAX_CONNECTIONS=$max_connections
MAX_ROOMS=40
MAX_PLAYERS=8
MAX_MESSAGE_BYTES=4096
MAX_BUFFERED_BYTES=262144
COMMANDS_PER_SECOND=20
MOVE_MS=180
TICK_MS=250
DISCONNECT_MS=20000
COUNTDOWN_MS=3000
DUEL_MS=180000
OVERTIME_MS=30000
PROTECTION_MS=5000
OUTSIDE_MS=10000
RECON_MS=8000
PEEK_MS=5000
MAP_SIZE=12
VISION_RADIUS=3
LOOT_COUNT=24
INVENTORY_SIZE=3
SESSION_DAYS=30
RESULT_RETENTION_MS=60000
ZONE_STAGES=[{"afterMs":60000,"inset":1},{"afterMs":120000,"inset":2},{"afterMs":180000,"inset":3},{"afterMs":240000,"inset":4},{"afterMs":300000,"inset":5,"final":true}]
LOG_LEVEL=info
ENV
chmod 600 .env
export DOMAIN="$domain"

export COMPOSE_PARALLEL_LIMIT=1
export DOCKER_BUILDKIT=1
docker compose config --quiet

info "Загружаю reverse proxy"
docker compose pull caddy
info "Собираю приложение на сервере — на небольшом VPS это может занять несколько минут"
docker compose build --pull app

info "Подготавливаю постоянный том SQLite и применяю миграции"
docker compose stop app >/dev/null 2>&1 || true
docker compose run --rm --no-deps --user 0 app chown 10001:10001 /data /backups
docker compose run --rm --no-deps app node dist/server/migrate.js

info "Запускаю приложение и Caddy"
docker compose up -d --remove-orphans

healthy=false
for _ in {1..45}; do
  container_id="$(docker compose ps -q app)"
  if [[ -n "$container_id" ]]; then
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$state" == "healthy" ]]; then healthy=true; break; fi
    if [[ "$state" == "exited" || "$state" == "dead" ]]; then
      docker compose logs --tail=100 app
      die "Контейнер приложения завершился."
    fi
  fi
  sleep 2
done
$healthy || { docker compose logs --tail=100 app; die "Приложение не прошло внутреннюю проверку здоровья."; }

info "Внутренняя проверка здоровья пройдена"
if curl -fsS --connect-timeout 5 --max-time 15 "https://$domain/api/health" | grep -q '"ok":true'; then
  https_status="HTTPS уже работает."
else
  https_status="Контейнеры работают, но публичный HTTPS пока недоступен. Проверьте DNS и входящие порты 80/443; Caddy продолжит получать сертификат автоматически."
fi

docker compose ps
printf '\n%s установлен и запущен.\n' "$APP_NAME"
printf 'Адрес: https://%s\n' "$domain"
printf 'Каталог: %s\n' "$PROJECT_DIR"
printf 'Данные: Docker volume solitaire_data\n'
printf '%s\n\n' "$https_status"
printf 'Полезные команды:\n'
printf '  cd %q && docker compose logs -f --tail=200\n' "$PROJECT_DIR"
printf '  cd %q && bash scripts/backup.sh\n' "$PROJECT_DIR"
printf '  cd %q && docker compose restart\n' "$PROJECT_DIR"
printf '\nДля обновления исходников запустите этот же install.sh ещё раз. Активные матчи при перезапуске завершатся.\n'
