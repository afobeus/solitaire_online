# Solitaire Battle Royale

Полноценная многопользовательская браузерная игра для 2–8 человек. Сервер Fastify хранит активные комнаты, карты и дуэли в памяти, проверяет каждое игровое действие и синхронизирует персональные представления по WebSocket. React-клиент получает только видимые позиции, открытые карты и количества скрытых карт. Аккаунты, HttpOnly-сессии и завершённые результаты хранятся в SQLite.

## Локальный запуск

Нужны Node.js 24.4+ и pnpm 10. Docker для локальной разработки не требуется.

```bash
corepack enable
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Откройте `http://localhost:5173`. Для проверки реального матча зарегистрируйте два аккаунта в разных браузерах (или в обычном и приватном окне). Backend работает на `http://localhost:3000`, Vite проксирует API и WebSocket.

Основные команды:

```bash
pnpm typecheck       # проверка TypeScript
pnpm build           # production-сборка клиента и сервера
pnpm start           # запуск production-сборки из dist
pnpm db:migrate      # применить ещё не применённые migrations/*.sql
pnpm db:backup       # согласованная резервная копия в ./backups
```

Чтобы проверить собранное приложение без Vite, остановите `pnpm dev`, временно укажите `APP_ORIGIN=http://localhost:3000` в `.env`, оставьте `NODE_ENV=development`, выполните `pnpm build && pnpm start` и откройте `http://localhost:3000`. Для production используйте Compose ниже: он включает Secure cookie и HTTPS. Для локального восстановления сначала остановите приложение, затем выполните `RESTORE_OFFLINE=1 pnpm db:restore ./backups/имя.sqlite` (PowerShell: `$env:RESTORE_OFFLINE='1'; pnpm db:restore ./backups/имя.sqlite`).

При запуске приложение само применяет последовательные SQL-миграции. Параметры матча, сетевые пределы, расписание зоны и их единицы описаны в [.env.example](./.env.example).

В Windows команды `cp` можно заменить на `Copy-Item`. Если `corepack` отсутствует в установленной поставке Node.js, установите pnpm: `npm install -g pnpm@10.30.3`.

## Production: Docker Compose и HTTPS

На сервере нужны Linux, Docker Engine с Compose v2, домен с A/AAAA-записью на сервер и открытые входящие TCP-порты 80/443, а также UDP 443 для HTTP/3. Порт приложения 3000 наружу не публикуется. Caddy сам получает и обновляет сертификат Let's Encrypt.

Для Ubuntu 24.04/22.04 установите Docker из официального репозитория ([документация Docker](https://docs.docker.com/engine/install/ubuntu/)):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo mkdir -p /opt/solitaire
sudo chown "$USER":"$USER" /opt/solitaire
```

Команды Docker далее выполняйте от пользователя с доступом к Docker (например, через `sudo`). Если включён UFW, разрешите свой SSH-порт, затем `sudo ufw allow 80/tcp`, `sudo ufw allow 443/tcp`, `sudo ufw allow 443/udp`. Не создавайте AAAA-запись, если IPv6 на VPS не настроен.

Основной вариант рассчитан на заранее собранный образ, поэтому маломощный VPS не компилирует TypeScript и React.

На машине сборки (той же архитектуры CPU, что сервер):

```bash
docker build -t solitaire-br:1.0.0 .
docker save solitaire-br:1.0.0 | gzip > solitaire-br-1.0.0.tar.gz
scp solitaire-br-1.0.0.tar.gz user@server:/opt/solitaire/
scp -r compose.yaml Caddyfile scripts migrations .env.production.example user@server:/opt/solitaire/
```

На сервере:

```bash
cd /opt/solitaire
cp .env.production.example .env
# измените DOMAIN и оставьте IMAGE_NAME=solitaire-br:1.0.0
gunzip -c solitaire-br-1.0.0.tar.gz | docker load
chmod +x scripts/*.sh
./scripts/deploy.sh
curl https://game.example.com/api/health
```

Ответ `{"ok":true}` означает, что приложение и SQLite доступны. Данные находятся в Docker volume `solitaire_data`, сертификаты — в `caddy_data`, а переносимые копии — в `/opt/solitaire/backups`.

Эксплуатация:

```bash
docker compose logs -f --tail=200    # логи
docker compose restart app           # перезапуск
docker compose stop                  # остановка
docker compose start                 # запуск
./scripts/backup.sh                  # backup SQLite без остановки приложения
./scripts/restore.sh backups/solitaire-YYYYMMDDTHHMMSSZ.sqlite
```

Backup использует SQLite Online Backup API и проверяет `integrity_check`, поэтому не копирует работающий WAL-файл вслепую. Restore принимает обязательный файл только из `./backups`, останавливает запись, проверяет файл, сохраняет текущую базу рядом с основной как `*.before-restore-*`, заменяет базу и вновь запускает приложение.

Для обновления загрузите новый образ (`docker load`) и измените `IMAGE_NAME` в `.env`, затем выполните `./scripts/update.sh`. Если образ хранится в registry, укажите его полное имя и выполните `./scripts/update.sh --pull`. Перед обновлением создаётся backup. Контейнер автоматически перезапускается после сбоя, healthcheck следит за SQLite, а Docker ограничивает каждый лог тремя файлами по 10 МБ. Дополнительные игровые настройки можно добавить в production `.env`; Compose передаёт их приложению.

Активные комнаты и матчи живут только в памяти одного процесса. При перезапуске или обновлении они прекращаются; их участникам нужно создать новый матч. Аккаунты, сессии и уже завершённая статистика сохраняются в volume. Масштабировать сервис на несколько процессов без общего координатора нельзя.

## Правила и устройство

- Сервер принимает намерения, проверяет фазу, участника, частоту, ревизию поля, предмет и правила хода. Клиент не присылает координаты, состояние поля, таймеры или победителя.
- WebSocket использует последовательные номера. При пропуске события клиент просит новый снимок; обычные изменения отправляются merge-патчами, а не полным матчем.
- Вторая вкладка того же аккаунта становится единственным управляющим соединением. Первая явно блокируется. Краткий обрыв восстанавливает серверное состояние; после 20 секунд игрок выбывает без расхода щита.
- Закрытые карты представлены только количеством. Seed и порядок колоды не отправляются. Способность «Подсмотреть» получает максимум три карты и только в персональном сообщении владельцу.
- Завершение матча транзакционно и идемпотентно по UUID матча. Перемещения и карточные действия в SQLite не пишутся. Пароли хешируются `scrypt` с индивидуальной случайной солью; session cookie — HttpOnly, SameSite=Strict и Secure в production.

В журнал намеренно не попадают тела запросов, cookie, пароли и закрытые карты. `APP_ORIGIN` должен точно совпадать с публичным HTTPS-origin: он проверяется для WebSocket и изменяющих состояние HTTP-запросов.

Модули: `server/auth.ts` — аккаунты и сессии; `rooms.ts` — комнаты; `game.ts` — жизненный цикл; `map.ts`/`items.ts`/`duels.ts` — игровые правила; `network.ts` — WebSocket; `db.ts` и `migrations/` — SQLite. Чистые правила «Косынки» лежат в `shared/solitaire.ts`, протокол и патчи — в `shared/protocol.ts`. В `client/` находятся русские экраны, карта и оба поля пасьянса.

Сведения о реально выполненных проверках и их пределах: [docs/verification.md](./docs/verification.md).
