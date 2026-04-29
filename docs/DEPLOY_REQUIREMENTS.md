# Технические требования для деплоя LK Mstroy на Ubuntu

## Железо (4 ядра / 16 ГБ RAM — хватает с запасом)

| Параметр | Значение | Обоснование |
|---|---|---|
| **RAM минимум** | 4 ГБ (рантайм) / 8 ГБ (сборка) | AI Reports сборка требует `--max-old-space-size=8192`. Рантайм всех сервисов — ~1.5-2 ГБ |
| **CPU** | 2+ ядра | Все сервисы single-thread (Node async I/O + 1 uvicorn). 4 ядра — за глаза |
| **Диск** | **40 ГБ SSD** (с очисткой данных — см. раздел «Очистка данных») | Без очистки: ~17-33 ГБ через год, диск заполнится. С 90-дневным retention: ~13-16 ГБ, остаётся ~24 ГБ свободных |

---

## Системное ПО

| Компонент | Точная версия | Причина |
|---|---|---|
| **Node.js** | **20.x LTS** | Dockerfile проекта: `node:20-alpine` |
| **Python** | **3.13+** | `MIGRATION_GUIDE.md` стр. 28: Python 3.13+ required |
| **PostgreSQL 16** | точный инстанс | БД `kip_vehicles`, миграции 001-006 |
| **PostgreSQL 17** | точный инстанс + **PostGIS** | БД `mstroy`, `GEOMETRY(Polygon, 4326)` в schema `geo` |
| **Nginx** | любая стабильная | Reverse proxy + ститика |
| **Git** | любой | Клонирование репо |

---

## PostgreSQL — конкретные лимиты подключений

| БД | Макс одновременных коннектов (пик) | Откуда |
|---|---|---|
| `kip_vehicles` (PG16) | **25** | KIP=10 + admin=10 + ai-reports=5 |
| `mstroy` (PG17) | **58+** | KIP=3 + DT=10 + VS=10 + geo=10 + admin=10 + ai-reports=5 + pg-boss |

**`postgresql.conf`:** `max_connections ≥ 100` (дефолт 100 — достаточно)

**Пользователь БД:** `max` (не `postgres`!) — захардкожено в AGENTS.md

**Порт:** оба PG на **5432** (один инстанс, две БД). В `.env` каждого сервиса указать `DB_PORT=5432` (код dump-trucks, vehicle-status, geo-admin дефолтит на 5433)

---

## Сеть — порты и прокси

| Порт | Назначение | Доступ |
|---|---|---|
| 80/443 | Nginx (внешний) | public |
| 3001 | KIP | localhost only |
| 3002 | Dump Trucks | localhost only |
| 3003 | Geo Admin | localhost only |
| 3004 | Vehicle Status | localhost only |
| 3005 | Admin | localhost only |
| 3006 | AI Reports | localhost only |
| 8000 | Tyagachi (Python) | localhost only |
| 5432 | PostgreSQL | localhost only |

### Nginx — правила прокси (дополнить `docs/nginx.conf`)

```nginx
# SSE для AI Reports — обязательно
location /api/reports/ {
    proxy_pass http://127.0.0.1:3006;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header X-Accel-Buffering no;
}

# Недостающие в docs/nginx.conf
location /api/vs/ {
    proxy_pass http://127.0.0.1:3004;
    proxy_set_header Host $host;
}
location /api/admin/ {
    proxy_pass http://127.0.0.1:3005;
    proxy_set_header Host $host;
}
```

---

## Процессы — что крутится одновременно

**8 процессов** (admin автозапускает 6 из них):

| # | Процесс | Тип | RAM (оценка) |
|---|---|---|---|
| 1 | admin (port 3005) | Node | ~80 МБ |
| 2 | kip (3001) | Node | ~120 МБ (Turf.js гео) |
| 3 | dump-trucks (3002) | Node | ~100 МБ (Turf.js) |
| 4 | vehicle-status (3004) | Node | ~70 МБ |
| 5 | geo-admin (3003) | Node | ~60 МБ |
| 6 | ai-reports (3006) | Node | ~150 МБ (sql.js WASM + SQLite в памяти) |
| 7 | tyagachi (8000) | Python | ~100 МБ (pandas) |
| 8 | Nginx | — | ~20 МБ |

**Итого рантайм:** ~700 МБ. Сборка (одновременно только один `tsc`): пик до 8 ГБ (ai-reports)

---

## Таймауты — критичные для nginx

| Параметр | Значение | Почему |
|---|---|---|
| `proxy_read_timeout` | **3600s** | DT пайплайн до 50 мин, KIP до 30 мин |
| `proxy_connect_timeout` | 60s | TIS API может отвечать до 30s |
| `client_max_body_size` | 10m | GeoJSON payload в geo-admin |

---

## Часовой пояс

```bash
timedatectl set-timezone Asia/Yekaterinburg
```

Все кроны (10 записей DT + 1 KIP) считают время в UTC+5. pg-boss регистрирует крон в UTC, но расчёт от локального времени.

---

## Секреты — обязательные env-переменные

| Переменная | Где используется | Формат |
|---|---|---|
| `TIS_API_TOKENS` | kip, dump-trucks, tyagachi | 18 токенов через запятую |
| `TIS_API_URL` | kip, dump-trucks | `https://tt.tis-online.com/tt/api/v3` |
| `GOOGLE_CREDS_PATH` | vehicle-status | Путь к `creds.json` |
| `GOOGLE_SHEET_ID` | vehicle-status | ID Google Sheet |
| `ANTHROPIC_API_KEY` | ai-reports | API ключ Claude |
| `DB_PASSWORD` / `MAIN_DB_PASSWORD` | все PG-сервисы | Пароль юзера `max` |

---

## SSL

В коде **нет HTTPS** — всё по HTTP на localhost. SSL terminates на Nginx:

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.ru
```

---

## Сборка — пошагово

```bash
# 1. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. Python 3.13
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install -y python3.13 python3.13-venv python3.13-dev

# 3. PostgreSQL 17 + PostGIS
sudo apt install -y postgresql-17 postgresql-17-postgis-3

# 4. PG16 (отдельный кластер на другом порту, или тот же инстанс)
sudo apt install -y postgresql-16

# 5. Nginx
sudo apt install -y nginx

# 6. Сборка проекта
git clone <repo> && cd lk-mstroy
npm install                      # root
cd kip && npm install && npm run build
cd dump-trucks/server && npm install && npm run build
cd vehicle-status/server && npm install && npm run build
cd geo-admin/server && npm install && npm run build
cd admin && npm install && npm run build
cd ai-reports/server && npm install && NODE_OPTIONS="--max-old-space-size=8192" npm run build
cd frontend && npm install && npm run build
cd tyagachi && python3.13 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# 7. БД
sudo -u postgres createuser max -s -P
sudo -u postgres createdb -O max kip_vehicles
sudo -u postgres createdb -O max mstroy
psql -d mstroy -c "CREATE EXTENSION postgis;"
# затем накатить миграции из каждого сервиса

# 8. Старт
node admin/dist/server.js        # автозапустит все бэкенды
```

---

## Очистка данных (критично для 40 ГБ SSD)

### Проблема: данные растут без очистки

**Ни одна PostgreSQL-таблица не имеет автоматической очистки.** Только tyagachi SQLite удаляет данные старше 60 дней, но даже там нет VACUUM — файл не уменьшается после DELETE.

Рост данных без очистки:

| Что растёт | МБ/день | ГБ/год | Очистка сейчас? |
|---|---|---|---|
| `kip.monitoring_raw` (full GPS+fuel JSONB) | 5-25 | 1.8-9 | Нет |
| `kip.kip_shift_segments` (~12 500 строк/день) | 2.5 | 0.9 | Нет |
| `dt.shift_records` (raw_monitoring JSONB) | 2-8 | 0.7-2.9 | Нет |
| `dt.shift_segments` | 1.9 | 0.7 | Нет |
| Остальные таблицы PG | ~1 | ~0.5 | Нет |
| Логи admin (ротация без удаления) | 3-5 | 1.2-5 | Нет |
| SQLite tyagachi | 1-5 | 0.4-1.8 | Частичная (60 дн., но нет VACUUM) |
| **ИТОГО** | **~17-51** | **6-17** | — |

**Без очистки 40 ГБ заполнятся за 6-12 месяцев.**

### С 90-дневным retention (рекомендуемая политика)

| Статья | Без очистки (год) | С очисткой (90 дней) |
|---|---|---|
| ОС + софт | 6 ГБ | 6 ГБ |
| Код + node_modules + сборка | 3 ГБ | 3 ГБ |
| PostgreSQL | 6-17 ГБ | **1.5-4 ГБ** (данные упираются в лимит) |
| Логи (30-дн. удаление) | 1-5 ГБ | **0.5 ГБ** |
| SQLite (VACUUM) | 0.5-2 ГБ | **0.1 ГБ** |
| Резерв под бэкапы | — | 2-3 ГБ |
| **Итого** | 17-33 ГБ | **~13-16 ГБ** |

**С очисткой 40 ГБ — комфортно**, остаётся ~24 ГБ свободных.

### Обязательные доработки перед деплоем

#### 1. Очистка PostgreSQL — крон-джоба (каждую ночь, 03:00)

Таблицы для удаления старых записей (retention 90 дней):

| Таблица | Ключ очистки | CASCADE? |
|---|---|---|
| `kip_vehicles.monitoring_raw` | `report_date < now() - 90d` | Нет |
| `kip_vehicles.vehicle_records` | `report_date < now() - 90d` | Нет |
| `kip_vehicles.kip_shift_segments` | `report_date < now() - 90d` | Нет |
| `kip_vehicles.route_lists` | `date_out < now() - 90d` | CASCADE: `pl_calcs`, `vehicles` |
| `kip_vehicles.requests` | `date_out < now() - 90d` | Нет |
| `mstroy.dump_trucks.shift_records` | `report_date < now() - 90d` | CASCADE: `trips`, `shift_segments` |
| `mstroy.dump_trucks.zone_events` | `report_date < now() - 90d` | Нет |
| `mstroy.dump_trucks.route_lists` | `date_out < now() - 90d` | Нет |
| `mstroy.dump_trucks.requests` | `date_out < now() - 90d` | Нет |
| `mstroy.vehicle_status.snapshots` | `snapshot_date < now() - 90d` | Нет |
| `mstroy.vehicle_status.status_history` | `created_at < now() - 90d` | Нет |
| `mstroy.public.pipeline_runs` | `created_at < now() - 90d` | Нет |

Главная «бомба» — `monitoring_raw`: ~261 машина × 2 смены × полные GPS-треки каждый день. Даёт до 9 ГБ/год без очистки.

#### 2. Логи admin — удалять старые файлы

Сейчас ротация переименовывает файл >30 МБ в `{id}.{timestamp}.log`, но **никогда не удаляет** старые. Через год — 3-5 ГБ ротированных логов.

Решение: крон-джоба удалять файлы в `admin/logs/` старше 30 дней:

```bash
find /path/to/lk-mstroy/admin/logs/ -name "*.log.*" -mtime +30 -delete
```

#### 3. SQLite VACUUM — раз в неделю

Tyagachi `cleanup_old_data()` удаляет записи старше 60 дней, но SQLite **не освобождает диск** после DELETE — файл только растёт.

Решение: добавить VACUUM после очистки:

```python
# После cleanup_old_data()
cursor.execute("VACUUM")
```

Или внешним кроном:

```bash
sqlite3 /path/to/tyagachi/archive.db "VACUUM;"
```

#### 4. pg-boss — включить archiveCompleted

Сейчас `pgboss.job` накапливает все задачи без очистки (~20-50 строк/день).

Решение: добавить в конфигурацию PgBoss в `admin/server.ts`:

```typescript
const boss = new PgBoss({
  // ... существующие параметры
  archiveCompleted: {
    checkIntervalMinutes: 60,
    batchSize: 100,
  },
});
```

И добавить периодический вызов `boss.archive()` для удаления заархивированных задач старше 90 дней.

### Архивация на внешний SSD (рабочий ПК)

Данные старше 90 дней редко нужны в рантайме, поэтому их можно хранить на внешнем SSD, подключённом к рабочему ПК. Задержка в секунды/минуты при обращении к архиву — допустима.

#### Архитектура

```
Сервер (40 ГБ SSD)              Рабочий ПК + внешний SSD (250+ ГБ)
┌─────────────────────┐          ┌──────────────────────────┐
│  PG: свежие 90 дн. │  ─────> │  Архив PG (pg_dump -Fc)  │
│  SQLite: 60 дн.     │  rsync  │  Архив SQLite            │
│  Логи: 30 дн.      │  SSH    │  Архив логов             │
└─────────────────────┘          └──────────────────────────┘
       ↑                               │
       └──── запрос к архиву (опционально, через VPN)
```

#### Порядок действий (ночной крон на локальном ПК)

Инициатива всегда **от локального ПК** (сервер не достучится за NAT):

```bash
# crontab на локальном ПК (каждую ночь 02:00)

# 1. Дамп старых данных с сервера ПЕРЕД очисткой
ssh max@server "pg_dump -Fc -t kip_vehicles.monitoring_raw \
  --where='report_date < now()-interval\"90 days\"' \
  kip_vehicles" > /mnt/ssd/archive/kip/monitoring_raw_$(date +\%F).dump

ssh max@server "pg_dump -Fc -t kip_vehicles.vehicle_records \
  --where='report_date < now()-interval\"90 days\"' \
  kip_vehicles" > /mnt/ssd/archive/kip/vehicle_records_$(date +\%F).dump

ssh max@server "pg_dump -Fc -t kip_vehicles.kip_shift_segments \
  --where='report_date < now()-interval\"90 days\"' \
  kip_vehicles" > /mnt/ssd/archive/kip/shift_segments_$(date +\%F).dump

ssh max@server "pg_dump -Fc -t mstroy.dump_trucks.shift_records \
  --where='report_date < now()-interval\"90 days\"' \
  mstroy" > /mnt/ssd/archive/dt/shift_records_$(date +\%F).dump

# ... аналогично для остальных таблиц из списка выше

# 2. Rsync логов и SQLite
rsync -avz max@server:/opt/lk-mstroy/admin/logs/ /mnt/ssd/archive/logs/
rsync -avz max@server:/opt/lk-mstroy/tyagachi/archive.db /mnt/ssd/archive/tyagachi/

# 3. Даём серверу команду очистить данные (архив уже на SSD)
ssh max@server "curl -X POST http://localhost:3005/api/admin/cleanup"
```

#### Что нужно добавить на сервер

API-эндпоинт `POST /api/admin/cleanup` в admin, который:
1. Удаляет записи старше 90 дней из всех таблиц (см. список выше)
2. Вызывает `VACUUM` на SQLite
3. Удаляет старые лог-файлы (>30 дней)
4. Архивирует/удаляет старые pg-boss задачи

#### Что нужно настроить на локальном ПК

1. **SSH-ключ** — беспарольный доступ к серверу:
   ```bash
   ssh-keygen -t ed25519
   ssh-copy-id max@server
   ```

2. **Монтирование SSD** (если автоматически не монтируется):
   ```bash
   # Узнать UUID
   lsblk -f
   # Добавить в /etc/fstab
   echo "UUID=xxxx-xxxx  /mnt/ssd  ext4  defaults  0  2" | sudo tee -a /etc/fstab
   sudo mkdir -p /mnt/ssd/archive/{kip,dt,vs,logs,tyagachi}
   sudo mount /mnt/ssd
   ```

3. **Cron** — добавить расписание:
   ```bash
   crontab -e
   # Каждую ночь в 02:00
   0 2 * * * /home/user/scripts/archive_from_server.sh
   ```

#### Доступ к архиву с сервера (опционально)

Если нужен доступ к архивным данным с сервера (редкие запросы):

```
WireGuard VPN между сервером и ПК
→ Сервер видит 10.0.0.2:/mnt/ssd/archive по NFS/SMB
→ Может монтировать и читать pg_dump файлы напрямую
```

Это сложнее — нужен статичный адрес/DMZ или WireGuard с роутингом. Для большинства сценариев rsync через SSH проще и надёжнее.

#### Восстановление из архива

Если понадобились старые данные — восстановить дамп на сервер:

```bash
# Восстановить конкретный дамп
pg_restore -d kip_vehicles -t monitoring_raw /mnt/ssd/archive/kip/monitoring_raw_2026-01-15.dump

# Или на сервер через SSH
scp /mnt/ssd/archive/kip/monitoring_raw_2026-01-15.dump max@server:/tmp/
ssh max@server "pg_restore -d kip_vehicles -t monitoring_raw /tmp/monitoring_raw_2026-01-15.dump"
```

#### Объём архива на SSD

| Период | Объём архива |
|---|---|
| 6 месяцев | ~3-9 ГБ |
| 1 год | ~6-17 ГБ |
| 2 года | ~12-34 ГБ |

SSD 250 ГБ — на 5+ лет вперёд.

---

## Рекомендуемые лимиты ОС

```bash
# /etc/security/limits.conf
*  soft  nofile  65536
*  hard  nofile  65536

# /etc/sysctl.conf
net.core.somaxconn = 65535
vm.overcommit_memory = 1
```
