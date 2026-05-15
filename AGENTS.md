# AGENTS.md — ЛК Мстрой

Compact guidance for OpenCode sessions. For full onboarding see `ONBOARDING_AGENT.md`.

## Documentation-First Protocol

**Прежде чем читать исходные файлы — проверить документацию.** Она написана специально чтобы не тратить время на исследование.

### Точки входа

| Что нужно | Куда смотреть |
|-----------|--------------|
| **Бизнес-правила, среда, операционка** | **Obsidian vault** (см. ниже) |
| Сервисная карта, порты, БД | `NAVIGATION.md` → раздел «Сервисная карта» |
| «Хочу изменить X» — где файл? | `NAVIGATION.md` → раздел «Сценарии разработчика» (16 сценариев) |
| Схемы всех таблиц БД | `NAVIGATION.md` → раздел «Схема баз данных» |
| Ключевые алгоритмы (КИП, геозоны, смены) | `NAVIGATION.md` → раздел «Ключевые алгоритмы» |
| Поток данных по кнопке UI | `NAVIGATION.md` → раздел «Потоки данных» |
| Все `.env` переменные | `NAVIGATION.md` → раздел «Переменные окружения» |
| Pipeline конкретного сервиса | `<сервис>/docs/PIPELINE.md` |
| Компоненты фронтенда сервиса | `<сервис>/docs/FRONTEND.md` |
| Что реализовано, ограничения | `<сервис>/docs/HISTORY.md` |
| Запуск, конфиг, расширение | `<сервис>/docs/DEVGUIDE.md` |

### Внешняя база знаний — Obsidian vault

Перед чтением документации/исходников **сначала проверить vault** по теме.

**Путь:** `C:/Users/user_ogtr1/Documents/пмворкк/obsidian-vault/02-Projects/ЛК Мстрой/`
**Доступ:** MCP-сервер `obsidian` (read_notes / search_notes). Если MCP недоступен — читать как обычные файлы.

**Что лежит в vault (чего нет в docs/):**

| Раздел | Содержание |
|--------|-----------|
| `Architecture/Services/*.md` | Каждый сервис отдельной заметкой (KIP, DumpTrucks, Tyagachi, VehicleStatus, GeoAdmin, Frontend, Admin, AIReports) |
| `Architecture/Algorithms.md` | КИП формулы + условия 1–5 (реализация) + структура `fuel_json` |
| `Architecture/Database/*.md` | PG16 / PG17 / SQLite таблицы (включая `monitoring_raw`) |
| `Architecture/API/TIS-API.md` | Протокол + структура `getMonitoringStats` |
| `Architecture/Machine-Quirks.md` | Особенности этой Windows-машины: PG `:5432`, прокси для googleapis, git.exe path |
| `Process/PL-timing.md` | ПЛ оформляются заранее — невалидные гипотезы просадки |
| `Process/Admin-UI-First.md` | Операционка — только через Admin UI, не через curl |
| `Bugs & Solutions/*.md` | Решённые проблемы со ссылками на причины |
| `_Index.md` / `_Overview.md` | Стартовые точки |

### Правило

```
Obsidian vault → NAVIGATION.md → docs/*.md → исходный код
```

Не читать исходники пока vault и docs не проверены и недостаточны. Vault особенно важен для вопросов вида «почему сделано так», «как это запустить через UI», «что-то не работает в среде» — там лежат знания, которые из кода не выводятся.

---

## Обзор проекта

**ЛК Мстрой** — единый личный кабинет управления строительным транспортом. 8 сервисов в монорепо.

| Сервис | Папка | Порт | Стек |
|--------|-------|------|------|
| Единый фронтенд | `frontend/` | 5173 | React 18 + Vite + Tailwind v4 + shadcn/ui |
| КИП техники | `kip/` | 3001 | Express + PostgreSQL 16 (`kip_vehicles`) |
| Тягачи | `tyagachi/` | 8000 | Python / FastAPI + SQLite |
| Самосвалы | `dump-trucks/` | 3002 | Express + PostgreSQL 17 (`mstroy`) |
| Состояние ТС | `vehicle-status/` | 3004 | Express + PostgreSQL 17 (`mstroy`) |
| Гео-Администратор | `geo-admin/` | 3003 | Express + PostgreSQL 17 (`mstroy` / PostGIS) |
| **Admin** | `admin/` | **3005** | Express (процесс-менеджер) |
| AI Отчёты | `ai-reports/` | 3006 | Express + Vercel AI SDK v6 + Claude Haiku |

### Запуск всех сервисов — ОДНА КОМАНДА

```bash
# Из корня монорепо — запускает admin-сервер + frontend одновременно
npm run dev
# Admin-сервер авто-запускает все 5 бэкендов при старте
# Управление + покрытие данных: http://localhost:5173/admin
```

## Dev Commands

```bash
npm run dev                              # Root: starts admin(:3005) + frontend(:5173); admin auto-launches all backends
cd frontend && npm run dev               # Frontend only
cd kip && npm run dev:server             # KIP :3001
cd dump-trucks/server && npm run dev      # Dump trucks :3002
cd geo-admin/server && npm run dev       # Geo admin :3003
cd vehicle-status/server && npm run dev  # Vehicle status :3004
cd ai-reports/server && npm run dev      # AI reports :3006
cd tyagachi && python main.py --web --port 8000  # Python/FastAPI
```

**Typecheck / lint:** `npm run lint` in each subproject (runs `tsc --noEmit`). No ESLint/Prettier configured. No test suites exist.

## Architecture

Monorepo with 7 services. Admin (`:3005`) is a process manager that starts the 5 Node backends on boot.

**Vite proxy** (`frontend/vite.config.ts`): `/api/kip→:3001` `/api/tyagachi→:8000` `/api/dt→:3002` `/api/vs→:3004` `/api/admin→:3005` `/api/reports→:3006`. Note: `/api/kip` and `/api/tyagachi` strip their prefix on rewrite.

**Frontend structure:** `frontend/src/features/<section>/` — each section is isolated. Routes defined in `src/App.tsx`.

## Critical Facts

### TIS API (external data source — all backends use it)
- **POST with empty body**, all params in query string: `POST {url}?token=...&format=json&command={cmd}&{params}`
- Commands: `getRequests`, `getRouteListsByDateOut`, `getMonitoringStats`
- `getMonitoringStats` dates: `DD.MM.YYYY HH:mm`; all others: `DD.MM.YYYY`
- Rate limit: **1 req / 30s on `(token, idMO)` pair** — NOT globally per idMO
- **Мультитокен обходит per-idMO лимит**: 18 токенов означают что один и тот же idMO можно дёрнуть **до 18 раз параллельно** в одном окне 30 сек (по одному через каждый токен). Реальная пауза 30 сек наступает только если на одну ТС нужно >18 запросов в одном окне (типовые сценарии — 1-14 запросов на ТС, никогда не упирается)
- Разные idMO между собой **не блокируются** — параллельность не ограничена
- **Узкое место — HTTP concurrency на стороне нашего бэка + латентность TIS (~1-3 сек/запрос)**, НЕ rate-limit
- Оценки: live-fetch 100 ТС за 1-2 дня ≈ 5-15 сек; худший случай (7 дней, БД пуста, 1400 запросов) ≈ 2.5 мин при 18 parallel connections
- Ready clients: `tyagachi/src/api/client.py`, `kip/server/src/services/tisClient.ts`
- При 429 — линейный backoff в TokenPool: 10s, 20s, 30s до 5 попыток

### Databases
- **Windows:** both PG16 and PG17 databases are on **port 5432** (single instance). Mac docs say 5432/5433 — ignore on Windows.
- **PG16** DB `kip_vehicles`: KIP data (5 tables). NUMERIC columns return as strings — wrap with `Number()`.
- **PG17** DB `mstroy`: 3 schemas — `dump_trucks`, `vehicle_status`, `geo`.
- **SQLite** `tyagachi/archive.db`: tyagachi data.
- **DB user = `max`** (not `postgres`!) for all PG17 connections.

### Shifts (universal across all services)
`shift1` (morning) = 07:30–19:30, `shift2` (evening) = 19:30–07:30+1. Timezone: Asia/Yekaterinburg (UTC+5).

### Secrets — NEVER commit
- All `.env` files in subproject roots
- `vehicle-status/server/creds.json` (Google Service Account)
- `TIS_API_TOKENS` — 18 comma-separated tokens

## Service-Specific Gotchas

- **dump-trucks:** `geo.objects` field is `smu` — NOT `smu_name`. TripBuilder: each unloading zone used once per shift (duplicate visits lost). ObjectDetector: object = max GPS points in `dt_boundary`.
- **vehicle-status:** `isBroken("требует ремонта")` → **false** (machine works, scheduled maintenance). Uses Drive API (not Sheets API) — Sheets API 400s on `.xlsx`. `creds.json` must not be committed.
- **kip:** KIP served as single-port (Express serves React build + API on :3001). Fallback when no zones match: `total_stay_time = engineOnTime`.
- **tyagachi:** `html_generator_v2.py` is ~4600-line monolith — changing one function can break another. `SUCCESSFULLY_COMPLETED` → `stable` → data NOT overwritten on sync. Claim periods precede PL periods by 1-3 months.
- **ai-reports:** **FROZEN** (demo mode). Do not modify without explicit instruction. `tsc --noEmit` OOMs on AI SDK v6 types — use `NODE_OPTIONS="--max-old-space-size=8192"` or skip typecheck for this service.
- **geo-admin:** Vanilla TypeScript client (NOT React). PostGIS: `ST_AsGeoJSON()` / `ST_GeomFromGeoJSON()`. Geometry editing only via direct API PUT, not UI.

## Git Rules

- Every task gets its own branch: `agent/glm/<type>-<description>` (types: `fix/`, `feat/`, `refactor/`, `docs/`)
- **Never** commit to `main`, never `--force`/`--hard`/`--no-verify`, never push without approval
- Commit messages: `<type>(<scope>): <description>` in English
- Stage specific files only (`git add <file>`), never `git add .` or `git add -A`
- Check `git diff` before every commit for secrets/leaked files

## Prohibited Without Approval

- `DROP TABLE`, `DELETE FROM` without WHERE, `TRUNCATE`
- Modifying `.env`, schema migrations (`npm run migrate`), cron schedules
- Adding dependencies, changing `package.json`/`requirements.txt`
- Changing API endpoints, Vite proxy, formulas (KIP, trips, norms)
- Creating new files, altering DB schema

## Документация по подпроектам

| Подпроект | FRONTEND.md | PIPELINE.md | HISTORY.md | DEVGUIDE.md |
|-----------|------------|-------------|------------|-------------|
| КИП | `kip/docs/FRONTEND.md` | `kip/docs/PIPELINE.md` | `kip/docs/HISTORY.md` | `kip/docs/DEVGUIDE.md` |
| Тягачи | `tyagachi/docs/FRONTEND.md` | `tyagachi/docs/PIPELINE.md` | `tyagachi/docs/HISTORY.md` | `tyagachi/docs/DEVGUIDE.md` |
| Самосвалы | `dump-trucks/docs/FRONTEND.md` | `dump-trucks/docs/PIPELINE.md` | `dump-trucks/docs/HISTORY.md` | `dump-trucks/docs/DEVGUIDE.md` |
| Состояние ТС | `vehicle-status/docs/FRONTEND.md` | `vehicle-status/docs/PIPELINE.md` | `vehicle-status/docs/HISTORY.md` | `vehicle-status/docs/DEVGUIDE.md` |
| Гео-Администратор | `geo-admin/docs/FRONTEND.md` | `geo-admin/docs/PIPELINE.md` | `geo-admin/docs/HISTORY.md` | `geo-admin/docs/DEVGUIDE.md` |
| Единый фронтенд | `frontend/docs/FRONTEND.md` | `frontend/docs/PIPELINE.md` | `frontend/docs/HISTORY.md` | `frontend/docs/DEVGUIDE.md` |
| AI Отчёты | `ai-reports/docs/FRONTEND.md` | `ai-reports/docs/PIPELINE.md` | `ai-reports/docs/HISTORY.md` | `ai-reports/docs/DEVGUIDE.md` |

## OpenCode Edit Gotcha — Кириллица и комментарии

**edit tool НЕ работает с кириллицей в `oldString`** — не находит совпадений даже при побайтовом совпадении. Вероятная причина: разная нормализация Unicode между Read-выводом и параметром edit tool.

**Правило:** при редактировании файлов с кириллическими комментариями/строками — использовать **Write** (перезапись всего файла), а не Edit. В чистых `.ts`/`.tsx`/`.sql` файлах без кириллицы Edit работает нормально.

## Manual Pipeline Triggers

```bash
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-04-13"                      # KIP
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=2026-04-13&shift=shift1"      # Dump trucks
curl -X POST "http://localhost:3004/api/vs/sync"                                           # Vehicle status
```
