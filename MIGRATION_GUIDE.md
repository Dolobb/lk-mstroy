# MIGRATION_GUIDE.md — Полное руководство по переносу ЛК Мстрой

Пошаговая инструкция для миграции проекта с рабочего ПК (Windows, пользователь `user_ogtr1`) на личный MacBook или другой ПК.

---

## 1. Обзор: что переносим

| Компонент | Источник | Способ переноса |
|-----------|----------|-----------------|
| Код проекта | Git-репозиторий | `git clone` |
| PostgreSQL `kip_vehicles` | Дамп `kip_vehicles.dump` (196 МБ) | Облако → `pg_restore` |
| PostgreSQL `mstroy` | Дамп `mstroy.dump` (176 МБ) | Облако → `pg_restore` |
| SQLite `tyagachi/archive.db` | Внутри проекта, но gitignored | Ручное копирование |
| Секреты (.env, creds.json, config.yaml) | Нигде не хранятся автоматически | Ручное воссоздание |

---

## 2. Установка зависимостей

### Windows

| ПО | Способ | Примечание |
|----|--------|-----------|
| Node.js 24+ | https://nodejs.org (LTS) | Галочка «Add to PATH for all users» |
| PostgreSQL 16 | https://www.postgresql.org/download/windows/ | Порт 5432, encoding UTF-8 |
| Git | https://git-scm.com/download/win | |
| Python 3.13+ | https://www.python.org/downloads/ | Галочка «Add Python to PATH» |
| VS Code | https://code.visualstudio.com | |

### macOS

| ПО | Способ | Примечание |
|----|--------|-----------|
| Node.js 24+ | `brew install node` | |
| PostgreSQL 16 + 17 | `brew install postgresql@16 postgresql@17` | **Два экземпляра на разных портах!** |
| Git | `brew install git` или Xcode CLI |
| Python 3.13+ | `brew install python` | |
| PostGIS | `brew install postgis` | Обязательно для geo-схемы |

---

## 3. Ключевая разница: Windows vs macOS

### Порты PostgreSQL

**Windows** — один экземпляр PG16 на порту 5432, базы `kip_vehicles` и `mstroy` на одном сервере.

**macOS** — два экземпляра (Homebrew ставит параллельно):
- PG16 → порт **5432** (база `kip_vehicles`)
- PG17 → порт **5433** (база `mstroy`)

Кодовые дефолты в проекте:
- KIP (`kip/server`): дефолт `DB_PORT=5432` → **подходит и для Win, и для Mac**
- dump-trucks, geo-admin, vehicle-status: дефолт `DB_PORT=5433` → **для Mac**, для Windows нужно переопределить в `.env` на `5432`
- admin: `KIP_DB_PORT` дефолт 5432, `MAIN_DB_PORT` дефолт 5433

**Итого**: на Windows ВСЕ `.env` файлы должны явно указывать `DB_PORT=5432`. На macOS — KIP на 5432, остальные на 5433.

### Пользователь БД

Кодовые дефолты:
- admin: `KIP_DB_USER=max`, `MAIN_DB_USER=max`
- Остальные сервисы: дефолт `postgres`

На рабочем ПК в `.env` везде стоит `DB_USER=postgres`. При развёртывании с нуля — создайте пользователя `max` ИЛИ используйте `postgres` и укажите это в `.env`.

### Запуск PostgreSQL на macOS

```bash
# PG16 (kip_vehicles)
brew services start postgresql@16
# Проверка
/opt/homebrew/opt/postgresql@16/bin/psql -p 5432 -d postgres -c "SELECT 1"

# PG17 (mstroy)
brew services start postgresql@17
# Проверка
/opt/homebrew/opt/postgresql@17/bin/psql -p 5433 -d postgres -c "SELECT 1"
```

---

## 4. Восстановление баз данных из дампов

Дампы в custom format (`-F c`), созданы через `pg_dump`. Перенесите файлы через облако (Яндекс.Диск, Google Drive, etc.).

### 4.1. Создание баз и пользователя

**Windows** (один экземпляр, порт 5432):
```cmd
"C:\Program Files\PostgreSQL\16\bin\psql" -U postgres -p 5432
```
```sql
CREATE USER max WITH PASSWORD '888' LOGIN SUPERUSER;
CREATE DATABASE kip_vehicles OWNER max;
CREATE DATABASE mstroy OWNER max;
```

**macOS** (два экземпляра):
```bash
# kip_vehicles → PG16 (порт 5432)
/opt/homebrew/opt/postgresql@16/bin/psql -U $USER -p 5432 -d postgres
```
```sql
CREATE USER max WITH PASSWORD '888' LOGIN SUPERUSER;
CREATE DATABASE kip_vehicles OWNER max;
```

```bash
# mstroy → PG17 (порт 5433)
/opt/homebrew/opt/postgresql@17/bin/psql -U $USER -p 5433 -d postgres
```
```sql
CREATE USER max WITH PASSWORD '888' LOGIN SUPERUSER;
CREATE DATABASE mstroy OWNER max;
-- PostGIS обязателен для схемы geo
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
```

### 4.2. Восстановление

**Windows:**
```cmd
"C:\Program Files\PostgreSQL\16\bin\pg_restore" -U max -d kip_vehicles -p 5432 --no-owner --no-privileges kip_vehicles.dump
"C:\Program Files\PostgreSQL\16\bin\pg_restore" -U max -d mstroy -p 5432 --no-owner --no-privileges mstroy.dump
```

**macOS:**
```bash
/opt/homebrew/opt/postgresql@16/bin/pg_restore -U max -d kip_vehicles -p 5432 --no-owner --no-privileges kip_vehicles.dump
/opt/homebrew/opt/postgresql@17/bin/pg_restore -U max -d mstroy -p 5433 --no-owner --no-privileges mstroy.dump
```

> `--no-owner` — игнорировать владельца из дампа, использовать текущего.
> `--no-privileges` — не восстанавливать GRANT/REVOKE.

### 4.3. После восстановления: проверка

```sql
-- kip_vehicles (8 таблиц)
\dt
-- Ожидается: _migrations, kip_shift_segments, monitoring_raw, pl_calcs, requests, route_lists, vehicle_records, vehicles

-- mstroy (3 схемы)
\dn
-- Ожидается: dump_trucks, geo, pgboss, public, vehicle_status

\dt dump_trucks.*
-- Ожидается: _migrations, order_norms, repairs, requests, route_lists, shift_records, shift_segments, trips, vehicle_organizations, zone_events

\dt vehicle_status.*
-- Ожидается: _migrations, snapshots, status_history, vehicles

\dt geo.*
-- Ожидается: _migrations, objects, zone_tags, zones
```

---

## 5. SQLite (tyagachi)

Файл `tyagachi/archive.db` исключён из git через `*.db` в `.gitignore`.

**Перенос:** скопируйте файл вручную в `tyagachi/archive.db`.

Путь в коде: `ai-reports/server/src/config/index.ts` — относительный от `__dirname`:
```typescript
sqlitePath: path.resolve(__dirname, process.env.SQLITE_PATH || '../../../tyagachi/archive.db')
```

Если структура каталогов сохранена — работает автоматически. Иначе укажите `SQLITE_PATH` в `.env`.

---

## 6. Секреты: все .env файлы и конфиги

> Все `.env` файлы gitignored. Их нужно воссоздать вручную.

### 6.1. kip/.env

```env
DB_NAME=kip_vehicles
DB_USER=postgres
DB_PASSWORD=888
DB_HOST=localhost
DB_PORT=5432                              # Windows: 5432; macOS: 5432

TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=<СМ. НИЖЕ РАЗДЕЛ 7>

SERVER_PORT=3001
NODE_ENV=development

# Main DB (mstroy) — для загрузки геозон из geo.zones
MAIN_DB_HOST=localhost
MAIN_DB_PORT=5432                         # Windows: 5432; macOS: 5433
MAIN_DB_NAME=mstroy
MAIN_DB_USER=postgres
MAIN_DB_PASSWORD=888
```

### 6.2. dump-trucks/server/.env

```env
DB_HOST=localhost
DB_PORT=5432                              # Windows: 5432; macOS: 5433
DB_NAME=mstroy
DB_USER=postgres
DB_PASSWORD=888

TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=<СМ. НИЖЕ РАЗДЕЛ 7>       # 18 токенов через запятую

DT_SERVER_PORT=3002
NODE_ENV=development
```

### 6.3. geo-admin/server/.env

```env
DB_HOST=localhost
DB_PORT=5432                              # Windows: 5432; macOS: 5433
DB_NAME=mstroy
DB_USER=postgres
DB_PASSWORD=888

GEO_SERVER_PORT=3003
NODE_ENV=development
```

### 6.4. admin/.env

```env
KIP_DB_HOST=localhost
KIP_DB_PORT=5432                          # Всегда 5432 (PG16)
KIP_DB_NAME=kip_vehicles
KIP_DB_USER=postgres
KIP_DB_PASSWORD=888

MAIN_DB_HOST=localhost
MAIN_DB_PORT=5432                         # Windows: 5432; macOS: 5433
MAIN_DB_NAME=mstroy
MAIN_DB_USER=postgres
MAIN_DB_PASSWORD=888
```

### 6.5. vehicle-status/server/.env

```env
GOOGLE_CREDS_PATH=creds.json
GOOGLE_SHEET_ID=1DabDuxyA3DdI9BDuCKN9NgQ3joEQ7sxd
DB_HOST=localhost
DB_PORT=5432                              # Windows: 5432; macOS: 5433
DB_NAME=mstroy
DB_USER=postgres
DB_PASSWORD=888
VS_SERVER_PORT=3004
```

### 6.6. ai-reports/server/.env

```env
ANTHROPIC_API_KEY=<получить у разработчика>

# Windows: single PG instance on port 5432
# macOS: PG16 on 5432, PG17 on 5433
PG16_PORT=5432
PG16_USER=postgres
PG16_PASSWORD=888
PG17_PORT=5432                            # Windows: 5432; macOS: 5433
PG17_USER=postgres
PG17_PASSWORD=888
```

### 6.7. tyagachi/config.yaml

Файл `tyagachi/config.yaml` содержит API-токены и не должен коммититься (см. раздел 9).
Содержимое — скопируйте с рабочего ПК или воссоздайте по структуре:

```yaml
api:
  base_url: "https://tt.tis-online.com/tt/api/v3"
  token: "<ПЕРВЫЙ_ТОКЕН>"
  tokens:
    - "<ТОКЕН_1>"
    - "<ТОКЕН_2>"
    # ... 18 токенов
  format: "json"
  timeout: 10
  retry_count: 3

paths:
  input:
    requests: "Data/raw/Requests_raw.json"
    pl: "Data/raw/PL_raw.json"
  output:
    intermediate: "Data/intermediate/"
    final: "Data/final/"
    logs: "Data/logs/"

parsing:
  fail_on_missing_fields: false
  log_warnings: true

extraction:
  pattern_description: "Цифры от начала строки до '/' или пробела"
  ignore_suffix: true

logging:
  level: "INFO"
  console: false
  file: true
  file_format: "pipeline_{date}.log"
```

### 6.8. vehicle-status/server/creds.json

Google Service Account JSON key. Файл gitignored. Скопируйте с рабочего ПК целиком.
Убедитесь что Google Sheet расшарен на `client_email` из этого файла.

---

## 7. TIS API токены

25 токенов (используются во всех сервисах через TIS_API_TOKENS в .env):
```
6C72DAA5076B,8FE4AB7FA54C,79206427B583,333825C3820A,16B1EF2678AD,C47F3BB6DE85,8ABFA559284D,A84D5398F74E,0505CB134904,5F28AB5DB6CD,C8564A44FD67,7831D53E9DD0,3045540D6E2B,3CDD3FE02277,62AB1C7131F9,920DA1FD0B46,9AC0CADC0CE3,5455D081B637,B2859F4BB800,23659A194272,3B291A847CC1,B3E62D9BCF94,507638A60F30,6AE883545F27,B811D1274B15
```

- KIP `.env` использует все 25 токенов
- dump-trucks `.env` и tyagachi `config.yaml` используют 18 (первые 18)
- Rate limit: 1 запрос / 30 секунд на idMO; токены ротируются round-robin

---

## 8. npm install и Python venv

```bash
# Корень (frontend + все workspaces)
npm install

# Каждый сервис (если нужно по отдельности)
cd kip && npm install
cd dump-trucks/server && npm install
cd geo-admin/server && npm install
cd vehicle-status/server && npm install
cd ai-reports/server && npm install
cd admin && npm install

# Python: tyagachi
cd tyagachi
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS:
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 9. Безопасность: что НЕ должно попасть в Git

### Текущие проблемы

1. **`tyagachi/config.yaml`** — содержит 18+ API-токенов, но **коммитится в git**.
   В `tyagachi/.gitignore` есть комментарий-предупреждение, но файл не добавлен в исключения.
   **Действие**: добавить `config.yaml` в `tyagachi/.gitignore` и создать `config.example.yaml`.

2. **`.env` файлы** — корректно gitignored (и корневым `.gitignore`, и локальными).

3. **`vehicle-status/server/creds.json`** — корректно gitignored.

4. **`dumps/`** — дамппы БД (180-200 МБ), не должны коммититься. Добавить в `.gitignore`.

5. **`*.db`** — корректно gitignored (SQLite).

### Чеклист перед push

```bash
git diff --staged -- '*.env' '*.json' 'tyagachi/config.yaml'
# Убедиться что ни один секретный файл не попал в staging
```

---

## 10. Внешний файл: Самосвалы объёмы.xlsx

`dump-trucks/scripts/build_registry.py:18` ссылается на:
```python
EXCEL_PATH = os.path.join(os.path.dirname(BASE_DIR), 'Самосвалы объёмы.xlsx')
```
Файл лежит в **родительской папке** монорепо. Скопируйте вручную на новый ПК в ту же позицию относительно проекта, или отредактируйте путь в скрипте.

---

## 11. Проверка после миграции

```bash
# 1. Базы доступны
psql -U max -d kip_vehicles -p 5432 -c "SELECT COUNT(*) FROM vehicles;"        # Windows/macOS PG16
psql -U max -d mstroy -p 5432 -c "SELECT COUNT(*) FROM dump_trucks.shift_records;"   # Windows
psql -U max -d mstroy -p 5433 -c "SELECT COUNT(*) FROM dump_trucks.shift_records;"   # macOS

# 2. SQLite
ls tyagachi/archive.db

# 3. .env файлы на месте
ls kip/.env dump-trucks/server/.env geo-admin/server/.env admin/.env vehicle-status/server/.env ai-reports/server/.env

# 4. Python venv
cd tyagachi && python -c "import fastapi; print('OK')"

# 5. Node
cd kip && npm run dev:server    # :3001
cd dump-trucks/server && npm run dev    # :3002
# ... и т.д.

# 6. Полный запуск (admin поднимает все бэкенды)
cd admin && npm run dev         # :3005 + все бэкенды
cd frontend && npm run dev      # :5173

# 7. Vite proxy (frontend/vite.config.ts)
# /api/kip    → :3001
# /api/tyagachi → :8000 (strip prefix)
# /api/dt     → :3002
# /api/vs     → :3004
# /api/admin  → :3005
# /api/reports → :3006
```

---

## 12. Краткий чеклист миграции

- [ ] Установить Node.js 24+, PostgreSQL 16 (+17 на Mac), Git, Python 3.13+
- [ ] `git clone` проекта
- [ ] Скачать дампы из облака, выполнить `pg_restore` для обеих баз
- [ ] На macOS: установить PostGIS, `CREATE EXTENSION postgis` в mstroy
- [ ] Скопировать `tyagachi/archive.db`
- [ ] Создать все 6 `.env` файлов (см. раздел 6)
- [ ] Скопировать `vehicle-status/server/creds.json`
- [ ] Скопировать `tyagachi/config.yaml` (или создать вручную)
- [ ] Скопировать `Самосвалы объёмы.xlsx` в родительскую папку
- [ ] `npm install` в корне
- [ ] Создать Python venv для tyagachi: `python -m venv .venv && pip install -r requirements.txt`
- [ ] На macOS: проверить что `.env` файлы используют правильные порты (5432 для KIP, 5433 для mstroy)
- [ ] Запустить `admin` + `frontend`, проверить все API эндпоинты
