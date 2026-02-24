# Architecture — КИП техники

> Последнее обновление: 2026-02-16

## Общая цель проекта

Система мониторинга и расчёта КИП (ключевых показателей использования) строительной техники.
Данные забираются из TIS Online v3 API (путевые листы, заявки, GPS-мониторинг), рассчитываются KPI по сменам и сохраняются в PostgreSQL. Фронтенд — интерактивная карта с маркерами ТС + детальные таблицы + фильтры.

---

## Стек технологий

| Слой | Технологии |
|------|-----------|
| Frontend | React 18, TypeScript, Leaflet, Material-UI v5, Axios |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 (локально через Homebrew) |
| Геоаналитика | Turf.js (point-in-polygon) |
| Инфра | npm workspaces (monorepo), Docker Compose (опционально) |
| Внешний API | TIS Online v3 (REST, token auth, 18 токенов в пуле) |
| Публикация | Single-port serving (Express раздаёт React build + API на :3001) |

---тиы 

## Структура проекта

```
КИП техники/
├── .env                              # Конфиг (НЕ в git): DB, TIS API, порт
├── .env.example                      # Шаблон .env
├── package.json                      # Root: npm workspaces [client, server]
├── docker-compose.yml                # Docker: db + server + client
├── API_REQUEST_EXAMPLES.md           # Справочник TIS API (примеры всех команд)
├── CLAUDE.md                         # Инструкции для AI-агента
│
├── config/                           # Конфиги (читаются сервером при старте)
│   ├── shifts.json                   # Границы смен: morning 07:30-19:30, evening 19:30-07:30
│   ├── vehicle-types.json            # Типы ТС + keywords для фильтрации по nameMO из API
│   ├── vehicle-registry.json         # Реестр ~170 ТС: regNumber, type, branch, fuelNorm
│   ├── fuel-norms.json               # Нормы расхода (л/ч) — legacy, заменён vehicle-registry
│   └── geozones.geojson              # Геозоны объектов (GeoJSON из fleetradar)
│
├── client/                           # React frontend
│   ├── src/
│   │   ├── App.tsx                   # Layout: 2-col grid (65%/35%), state management
│   │   ├── index.tsx                 # Entry point
│   │   ├── components/
│   │   │   ├── FilterPanel.tsx       # Фильтры: период, смена, филиал/тип/СМУ (multi-select)
│   │   │   ├── VehicleMap.tsx        # Leaflet карта: маркеры ТС, треки, геозоны
│   │   │   ├── GeozoneLayer.tsx      # Leaflet-слой: полигоны геозон из /api/geozones
│   │   │   ├── DetailPanel.tsx       # Правая панель: карточка ТС + таблица + заявки
│   │   │   └── VehicleDetailTable.tsx # Таблица по дням/сменам для выбранного ТС
│   │   ├── services/
│   │   │   └── api.ts                # Axios: fetchWeeklyVehicles, fetchVehicleDetails, etc.
│   │   ├── types/
│   │   │   └── vehicle.ts            # WeeklyVehicle, VehicleDetailRow, VehicleRequest, FilterState
│   │   └── utils/
│   │       └── kpi.ts                # getKpiColor, KPI_COLORS (RED/BLUE/GREEN)
│   ├── build/                        # Production build (source maps отключены)
│   └── package.json
│
├── server/                           # Node.js backend
│   ├── src/
│   │   ├── index.ts                  # Express app + static serving + все API routes
│   │   ├── migrate.ts                # Запуск миграций
│   │   ├── config/
│   │   │   ├── env.ts                # Загрузка .env → EnvConfig (singleton)
│   │   │   └── database.ts           # pg Pool (singleton)
│   │   ├── services/
│   │   │   ├── tisClient.ts          # HTTP-клиент TIS API (POST + query string + retry)
│   │   │   ├── tokenPool.ts          # Round-robin по 18 API-токенам
│   │   │   ├── rateLimiter.ts        # Per-vehicle 30s rate limit для idMO
│   │   │   ├── plParser.ts           # buildVehicleTasks, extractRequestNumber, interleave
│   │   │   ├── shiftSplitter.ts      # splitIntoShifts (morning/evening windows)
│   │   │   ├── vehicleFilter.ts      # matchesVehicleType по keywords
│   │   │   ├── vehicleRegistry.ts    # getVehicleInfo(regNumber) → type, branch, fuelNorm
│   │   │   ├── monitoringParser.ts   # parseMonitoringStats → engineOnTime, fuel, track
│   │   │   ├── requestParser.ts      # parseRequests → structured data
│   │   │   ├── geozoneAnalyzer.ts    # point-in-polygon → totalStayTime, departmentUnit
│   │   │   └── kpiCalculator.ts      # calculateKpi → все KPI-показатели
│   │   ├── repositories/
│   │   │   ├── vehicleRecordRepo.ts  # UPSERT vehicle_records + query functions
│   │   │   ├── routeListRepo.ts      # UPSERT route_lists + pl_calcs + vehicles
│   │   │   ├── requestRepo.ts        # UPSERT requests
│   │   │   └── filterRepo.ts         # Каскадные фильтры (branch → type → department)
│   │   ├── jobs/
│   │   │   ├── dailyFetchJob.ts      # Оркестратор data-pipeline
│   │   │   └── scheduler.ts          # node-cron: 07:30 Asia/Yekaterinburg
│   │   ├── types/
│   │   │   ├── tis-api.ts            # Интерфейсы ответов TIS API
│   │   │   └── domain.ts             # ShiftWindow, VehicleTask, ParsedMonitoringRecord
│   │   └── utils/
│   │       ├── dateFormat.ts          # dayjs + customParseFormat, DD.MM.YYYY
│   │       └── logger.ts             # Консольный логгер [timestamp] [LEVEL]
│   ├── migrations/
│   │   ├── 001_init.sql              # 5 таблиц + индексы
│   │   ├── 002_add_id_order.sql      # Добавление id_order в pl_calcs
│   │   └── 003_drop_requests_number_unique.sql  # Снятие UNIQUE с requests.number
│   └── package.json
│
├── docker/
│   ├── Dockerfile.server
│   └── Dockerfile.client
│
└── референсы и работа с агентом/     # Документация и референсы
    ├── Architecture.md               # ← этот файл
    ├── DatabaseStructure.md          # Структура данных и БД
    ├── Описание таблицы.md           # Детальное описание колонок КИП-таблицы
    ├── Полное описание проекта.md    # Исходное ТЗ проекта
    ├── API_MIGRATION_GUIDE.md        # Гайд по миграции с Python на Node.js
    └── референс интерфейса.png       # Скриншот целевого UI
```

---

## Как запустить

### Локально (основной способ)

```bash
# 1. PostgreSQL (должен быть запущен)
brew services start postgresql@16

# 2. Создать .env из шаблона
cp .env.example .env
# Заполнить: DB_NAME, TIS_API_URL, TIS_API_TOKENS

# 3. Установить зависимости
npm install

# 4. Миграции БД
npm run migrate --workspace=server

# 5. Собрать клиент (для single-port mode)
npm run build --workspace=client

# 6. Запустить сервер (раздаёт и API, и клиент на :3001)
npm run dev:server

# 7. (Опционально) Запустить клиент отдельно на :3000 для hot-reload
npm run dev:client
```

### Ручная загрузка данных за дату

```bash
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-02-10"
```

### PostgreSQL доступ

```bash
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles
```

---

## Single-Port Serving

В production сервер Express раздаёт:
- `/api/*` — API endpoints
- `*` (всё остальное) — `client/build/index.html` (SPA fallback)

Source maps в production build отключены (`GENERATE_SOURCEMAP=false` в .env).
Leaflet attribution отключена (политика компании).

---

## API Endpoints (Express, порт 3001)

| Метод | Path | Query-параметры | Описание |
|-------|------|----------------|----------|
| GET | `/api/health` | — | Health check → `{ status: "ok" }` |
| GET | `/api/vehicles` | `date` (YYYY-MM-DD), `shift?` | Legacy: записи за одну дату |
| GET | `/api/vehicles/weekly` | `from`, `to`, `shift?`, `branch[]?`, `type[]?`, `department[]?`, `kpiRange[]?` | Агрегированные средние за период для карты |
| GET | `/api/vehicles/:id/details` | `from`, `to` | Детализация по дням/сменам для одного ТС |
| GET | `/api/vehicles/:id/requests` | `from`, `to` | Заявки, привязанные к ТС через ПЛ |
| GET | `/api/filters` | `from`, `to`, `branch[]?`, `type[]?` | Каскадные варианты фильтров |
| GET | `/api/geozones` | — | GeoJSON геозон для отображения на карте |
| POST | `/api/admin/fetch` | `date` (YYYY-MM-DD) | Ручной запуск pipeline (async) |

---

## Data Pipeline (dailyFetchJob.ts)

Основной процесс — запускается по cron (07:30 Asia/Yekaterinburg) или вручную через `/api/admin/fetch`.

```
1. getRouteListsByDateOut(7 дней назад → targetDate)
   → TisRouteList[]

2. upsertRouteLists(routeLists)
   → route_lists + pl_calcs + vehicles (транзакция)

3. buildVehicleTasks(routeLists)
   → фильтр по keywords (vehicle-types.json)
   → splitIntoShifts (morning/evening)
   → interleaveTasks (round-robin по idMO для rate limit)

4. getRequests(2 месяца назад → targetDate)
   → upsertRequests

5. FOR EACH task (последовательно, с rate limiting):
   a. getMonitoringStats(idMO, shift.from, shift.to)
   b. parseMonitoringStats(stats) → engineOnTime, fuel, track
   c. analyzeTrackGeozones(fullTrack) → totalStayTime, departmentUnit
   d. vehicleRegistry.getVehicleInfo(regNumber) → fuelNorm, type, branch
   e. calculateKpi(params) → все KPI-показатели
   f. upsertVehicleRecord(record) → vehicle_records

6. Логирование итогов: N success / N skipped / N errors
```

Ошибки отдельных ТС **не останавливают** процесс — логируются и обработка продолжается.

---

## TIS API Client (tisClient.ts)

### Критично: формат запросов

Все запросы — `POST` с **пустым телом**, все параметры в **query string**:

```
POST https://tt.tis-online.com/tt/api/v3?token=XXX&format=json&command=getMonitoringStats&idMO=123&fromDate=01.02.2026%2007:30&toDate=01.02.2026%2019:30
```

### Команды

| Команда | Параметры | Формат дат |
|---------|-----------|------------|
| `getRequests` | `dateFrom`, `dateTo` | `DD.MM.YYYY` |
| `getRouteListsByDateOut` | `dateOut` | `DD.MM.YYYY` |
| `getMonitoringStats` | `idMO`, `fromDate`, `toDate` | `DD.MM.YYYY HH:mm` |

Ответ: `{ list: [...] }` для списков, объект для мониторинга.

### Token Pool

- 18 токенов в `TIS_API_TOKENS` (.env, comma-separated)
- Round-robin: каждый запрос берёт следующий токен
- Rate limit: 30 секунд между запросами к одному `idMO`
- Interleave round-robin по idMO минимизирует простой

### Retry стратегия

| Ошибка | Backoff | Попытки |
|--------|---------|---------|
| 429 Rate Limit | Линейный: 10с, 20с, 30с, 40с, 50с | 5 |
| Timeout | Экспоненциальный: 1с, 2с, 4с | 3 |
| 404 | Возврат `null` (нет данных) | — |

---

## Смены (shiftSplitter.ts)

| Смена | Период | report_date |
|-------|--------|-------------|
| morning | 07:30 – 19:30 | тот же день |
| evening | 19:30 – 07:30 (след. день) | день начала вечерней смены |

**Правило:** период 00:00–07:30 относится к **вечерней смене предыдущего дня**.

Один ПЛ может охватывать несколько смен → создаётся отдельная задача на каждую пару (vehicle × shift).

---

## KPI расчёт (kpiCalculator.ts)

Входные параметры: `total_stay_tанime`, `engine_on_time`, `fuel_consumed_total`, `fuel_rate_norm`

| Показатель | Формула | Описание |
|-----------|---------|----------|
| `fuel_rate_fact` | fuel_consumed / engine_on_time | Фактический расход, л/ч |
| `max_work_allowed` | total_stay_time × (22/24) | Максимально допустимое время работы |
| `fuel_max_calc` | engine_on_time × fuel_rate_norm | Максимальный расход по норме |
| `fuel_variance` | fuel_rate_fact / fuel_rate_norm | Отношение факт/норма |
| `load_efficiency_pct` | (fuel_rate_fact / fuel_rate_norm) × 100 | **КИП нагрузки**, % |
| `utilization_ratio` | min(engine_on_time / total_stay_time, 1) × 100 | **КИП использования**, % |
| `idle_time` | total_stay_time − engine_on_time | Время простоя, часы |

### Цвета KPI на фронтенде

| Диапазон | Цвет | Hex |
|----------|------|-----|
| < 50% | Красный | `#FF0000` |
| 50–75% | Синий | `#0000FF` |
| >= 75% | Зелёный | `#00C853` |

---

## Геозоны (geozoneAnalyzer.ts)

### Источник

- `config/geozones.geojson` — экспорт из fleetradar (GeoJSON FeatureCollection)
- Фильтр: `controlType === 1` (рабочие геозоны), пропуск городских (3) и прочих (0)
- Кеширование: файл читается один раз при первом вызове

### Алгоритм

1. Для каждой точки трека → определение зоны (Turf.js point-in-polygon)
2. Для каждой пары последовательных точек:
   - Обе в одной зоне → полный интервал к зоне
   - В разных зонах → по половине к каждой
   - Одна в зоне, другая нет → половина к зоне
   - Обе вне зон → «вне зон»
3. **total_stay_time** = сумма времени во всех зонах (часы)
4. **department_unit** = зона с максимальным временем → извлечение СМУ из `zoneName`
5. **Fallback**: зоны не найдены или трек пуст → `total_stay_time = engine_on_time`

### Извлечение department_unit

`"СМУ г. Тюмень, Путепровод ПК..."` → `"СМУ г. Тюмень"` (всё до первой запятой)

---

## Vehicle Registry (vehicleRegistry.ts)

Реестр ~170 ТС в `config/vehicle-registry.json`:

```json
{
  "vehicles": [
    {
      "regNumber": "Х123АА72",
      "type": "Экскаватор гусеничный",
      "branch": "БСМ",
      "fuelNorm": 15.0
    }
  ]
}
```

**Типы ТС**: бульдозер, каток (асфальтный/грунтовый), погрузчик, экскаватор (гусеничный/колесный), экскаватор-погрузчик, краны (гусеничные/автомобильные/пневмоколёсные разных грузоподъёмностей)

**Филиалы**: БСМ, БСМ-мост, ДСУ, МО15, МО29, МО36, МО87, СКТ

Используется для:
- Обогащения ответов API полями `vehicle_type`, `branch`
- Нормы расхода `fuelNorm` (л/ч) — заменяет legacy `fuel-norms.json`
- In-memory фильтрации в `getWeeklyAggregated` по филиалу/типу

---

## Фронтенд — Layout и компоненты

### Общий layout (App.tsx)

CSS Grid: 2 колонки (65% / 35%), 2 строки (auto / 1fr):

```
┌────────────────────────────────┬──────────────────┐
│  FilterPanel                   │  Средний КИП +   │
│  (период, смена, фильтры)      │  KPI-кнопки      │
├────────────────────────────────┼──────────────────┤
│                                │                  │
│  VehicleMap                    │  DetailPanel     │
│  (карта Leaflet + маркеры)     │  (карточка ТС +  │
│                                │   таблица +      │
│                                │   заявки)        │
└────────────────────────────────┴──────────────────┘
```

### FilterPanel.tsx

- **Период**: пресеты (Месяц/Неделя) + date inputs (с/по)
- **Смена**: День / Вечер (toggle)
- **Multi-select фильтры**: Филиал, Тип ТС, СМУ — каскадные (сервер отдаёт варианты)
- Фон: `#000A76`, активные элементы: `#2600FF`

### VehicleMap.tsx

- Leaflet карта, центр — Тюмень
- CircleMarker для каждого ТС, цвет по utilization_ratio
- При клике → загрузка деталей + выделение
- Отображение трека выбранного ТС (polyline)
- GeozoneLayer — полигоны рабочих зон

### DetailPanel.tsx

- Карточка выбранного ТС: модель, гос.номер, филиал, СМУ
- VehicleDetailTable — pivoted таблица по дням (1 смена / 2 смена)
- Навигатор заявок, привязанных к ТС

---

## Matching: Заявка ↔ ПЛ ↔ ТС

```
Заявка (requests.number)
   ↕ matching через extractRequestNumber(pl_calcs.orderDescr)
Путевой лист (route_lists)
   → содержит calcs (pl_calcs) + vehicles
      → vehicle.regNumber = vehicle_records.vehicle_id
```

- `extractRequestNumber` извлекает номер заявки из текста задания в ПЛ
- Regex: `заявк[аеиу] №/# число` → fallback: первое 3+ значное число
- `pl_calcs.id_order` также используется для связи

---

## Переменные окружения (.env)

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kip_vehicles
DB_USER=max
DB_PASSWORD=

TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=token1,token2,...  # 18 штук, comma-separated

SERVER_PORT=3001
NODE_ENV=development
GENERATE_SOURCEMAP=false          # Безопасность: отключение source maps
```

---

## TODO (по приоритету)

### Приоритет 1 — для production

- [ ] Расширить `vehicle-registry.json` по мере добавления новой техники
- [ ] Полный `fuel-norms.json` (или окончательно перейти на registry)

### Приоритет 2 — улучшения UI

- [ ] Кластеризация маркеров (leaflet.markercluster уже установлен)
- [ ] Адаптивный layout (мобильный вид)

### Приоритет 3 — инфра и качество

- [ ] Docker: финализация Dockerfile.server/client
- [ ] Тесты (Jest настроен, тестов 0)
- [ ] Логирование в файл (сейчас stdout)
- [ ] Batch upsert для ускорения загрузки

---

## Зависимости

### Server (runtime)

express, pg, dotenv, node-cron, axios, cors, dayjs, @turf/helpers, @turf/boolean-point-in-polygon

### Server (dev)

typescript, tsx, ts-node, jest, ts-jest, @types/*

### Client (runtime)

react, react-dom, @mui/material, leaflet, react-leaflet, axios, d3

### Client (dev)

typescript, react-scripts, @types/*
