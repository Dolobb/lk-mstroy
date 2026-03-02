# ЛК Мстрой — Навигация по коду

> Быстрый поиск нужного места в коде. Все 6 сервисов в одном файле.

---

## Сервисная карта

| Сервис | Папка | Порт | БД | Язык | Статус |
|--------|-------|------|----|------|--------|
| Единый фронтенд | `frontend/` | 5173 | — | React 18 / TypeScript / Vite | Работает |
| КИП техники | `kip/` | 3001 | PostgreSQL 16, `kip_vehicles` | Node.js / Express | Работает |
| Тягачи | `tyagachi/` | 8000 | SQLite (`archive.db`) | Python / FastAPI | Работает |
| Самосвалы | `dump-trucks/` | 3002 | PG17, `mstroy`, схема `dump_trucks` | Node.js / Express | Работает |
| Состояние ТС | `vehicle-status/` | 3004 | PG17, `mstroy`, схема `vehicle_status` | Node.js / Express | Работает |
| Гео-Администратор | `geo-admin/` | 3003 | PG17, `mstroy`, схема `geo` | Node.js / Express | Работает |

---

## Сценарии разработчика

### "Хочу изменить формулу КИП"
→ `kip/server/src/services/kpiCalculator.ts`
→ `kip/docs/PIPELINE.md` — документированный pipeline с номерами строк

### "Хочу изменить цвета маркеров на карте КИП"
→ `kip/client/src/VehicleMap.tsx` — цвета маркеров (3 порога: RED <50%, BLUE 50–75%, GREEN >=75%)
→ `kip/client/src/VehicleDetailTable.tsx` — цвета таблицы (4 порога: RED <25%, YELLOW 25–50%, BLUE 50–75%, GREEN >=75%)
⚠️ Два разных набора порогов — карта и таблица различаются!

### "Хочу добавить новое ТС в реестр КИП"
→ `kip/config/vehicle-registry.json` — добавить объект `{regNumber, type, branch, fuelNorm}`
→ `kip/server/src/services/vehicleRegistry.ts` — `getVehicleInfo(regNumber)` (in-memory кэш)

### "Хочу изменить логику split смен"
→ КИП: `kip/server/src/services/shiftSplitter.ts`
→ Тягачи: `tyagachi/src/web/shifts.py`
→ Самосвалы: те же временные рамки, логика в `shiftFetchJob.ts`
→ Смены: утро 07:30–19:30, вечер 19:30–07:30

### "Хочу добавить вкладку/лист Excel в Состояние ТС"
→ `vehicle-status/server/src/services/sheetsSyncService.ts` — константа `SHEET_TABS`
→ Добавить новый объект `{sheetName, displayName}` в массив `SHEET_TABS`
→ Добавить поле в таблицу через SQL-миграцию в `vehicle-status/server/migrations/`
⚠️ Excel при сохранении удаляет символ `/` из имён вкладок — `sheetName` в конфиге должен быть без слешей, `displayName` может содержать

### "Хочу изменить HTML-отчёт тягачей"
→ `tyagachi/src/output/html_generator_v2.py` — ОСНОВНОЙ генератор (~4600 строк)
→ Ключевые функции: `_build_request_card_v2()`, `_build_vehicle_fact_panel_v2()`, `_build_pl_html()`, `build_hierarchy()`
⚠️ Монолит! Изменения в одной функции могут задеть CSS-переменные или JS в других секциях

### "Хочу добавить новый раздел в единый фронтенд"
→ `frontend/src/App.tsx` — добавить `<Route>`
→ `frontend/src/components/TopNavBar.tsx` — добавить пункт навигации (использует `Link` + `useLocation`)
→ `frontend/vite.config.ts` — добавить proxy-правило, если новый бэкенд
→ Создать `frontend/src/features/<новый-раздел>/` с файлами: `api.ts`, `types.ts`, `Page.tsx`, `index.ts`

### "Хочу изменить геозоны для КИП"
→ `kip/config/geozones.geojson` — полигоны, экспортированные из fleetradar
→ Фильтр: только зоны с `controlType === 1`
→ `kip/server/src/services/geozoneAnalyzer.ts` — Turf.js point-in-polygon + 50/50 split при пересечении
→ `geo-admin/` — веб-интерфейс просмотра/редактирования (:3003/admin); зоны хранятся в `geo.zones` (PG17 :5433)

### "Хочу разобраться в TIS API"
→ `kip/API_REQUEST_EXAMPLES.md` — curl-примеры для всех команд
→ `kip/server/src/services/tisClient.ts` — Node.js клиент (строки 39–97)
→ `tyagachi/src/api/client.py` — Python клиент (те же endpoints)
→ Протокол: **POST с пустым телом**, все параметры в query string
→ Rate limit: **1 запрос / 30с на idMO**; 18 токенов round-robin (`TokenPool`)
→ На 429 — линейный backoff: 10s, 20s, 30s… до 5 попыток; на таймаут — экспоненциальный: 1s, 2s, 4s

### "Хочу добавить новый тип зоны для самосвалов"
→ `dump-trucks/server/src/services/zoneAnalyzer.ts` — логика типов зон (Turf.js)
→ Зоны в `geo.zones`: поле `name` начинается с `dt_` (например `dt_loading`, `dt_unloading`, `dt_boundary`)

### "Хочу понять логику сборки рейсов самосвалов"
→ `dump-trucks/server/src/services/tripBuilder.ts` — основной алгоритм: трек → ZoneEvent[] → пары loading/unloading → Trip[]
→ `dump-trucks/server/src/services/zoneAnalyzer.ts` — построение ZoneEvent из трек-точек
⚠️ Ограничение TripBuilder: "каждая зона выгрузки 1 раз" — может пропустить повторные визиты в одну зону

### "Хочу запустить ручную синхронизацию данных"
→ КИП: `curl -X POST "http://localhost:3001/api/admin/fetch?date=YYYY-MM-DD"` → ответ `{ status: 'started' }`, pipeline асинхронный
→ Самосвалы: `curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=YYYY-MM-DD&shift=shift1"`
→ Тягачи: кнопка Sync в UI (период 1д/3д/1н/2н) или `POST http://localhost:8000/api/sync {period_days: N}`
→ Состояние ТС: кнопка «Синхронизировать» в UI или `POST http://localhost:3004/api/vs/sync`

### "Хочу подключиться к PostgreSQL"
→ PG16 (kip): `/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles`
→ PG17 (mstroy): `/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy`

### "Хочу дебажить проблему с геозонами в КИП"
→ `kip/server/src/services/geozoneAnalyzer.ts` — анализ треков
→ Fallback: если ни одна геозона не совпала — `total_stay_time = engineOnTime` (КИП будет 100%)
→ Проверить в БД: `SELECT department_unit, total_stay_time FROM vehicle_records WHERE ...`
⚠️ КИП = 100% при нулевом треке — ожидаемое поведение fallback, не баг

### "Хочу разобраться в логике isBroken для Состояния ТС"
→ `vehicle-status/server/src/services/sheetsSyncService.ts` — функция `isBroken(statusText)`
→ `false` (не сломан): «исправен», «частично исправен», «требует ремонта»
→ `true` (сломан): «неисправен», «ремонт», «авария», «не на ходу»
→ `false` по умолчанию: пустой/неизвестный статус считается исправным
⚠️ «требует ремонта» = исправен (плановое ТО, машина работает)

### "Хочу добавить новый объект/геозону через Гео-Администратор"
→ `geo-admin/` — веб-интерфейс: http://localhost:3003/admin (Leaflet SPA)
→ `geo-admin/server/src/` — Express API + PostGIS запросы
→ БД: схема `geo` в `mstroy` (PG17 :5433): таблицы `objects`, `zones`, `zone_tags`
→ Импорт из geojson: `npm run migrate-geo` из `geo-admin/server/`

### "Хочу понять, почему самосвал определён на неверный объект"
→ `dump-trucks/server/src/services/zoneAnalyzer.ts` — `ObjectDetector`
→ Объект определяется по максимальному количеству трек-точек в зоне `dt_boundary`
→ Если ТС работало на границе двух объектов — побеждает тот, в чьей `dt_boundary` больше точек

---

## Схема баз данных

### PostgreSQL 16 (порт 5432) — kip_vehicles

| Таблица | Ключевые поля | Назначение |
|---------|--------------|-----------|
| `vehicle_records` | `report_date`, `shift_type`, `vehicle_id` (PK) + `kpi`, `utilization_pct`, `load_pct`, `engine_on_time`, `total_stay_time`, `fuel_consumed`, `last_lat`, `last_lon` | KPI результаты для UI (основная) |
| `route_lists` | `id`, `idMO`, `reg_number`, `date_out`, `driver_name`, `status` | Путевые листы из TIS API |
| `pl_calcs` | `id`, `route_list_id`, `order_descr`, `id_order`, `request_number` | Строки ПЛ (привязка к заявкам) |
| `vehicles` | `id_mo`, `reg_number`, `name_mo` | Справочник ТС (из TIS API) |
| `requests` | `number`, `date_from`, `date_to`, `status`, `object_name`, `vehicle_id` | Заявки TIS |

Миграция: `npm run migrate --workspace=server` из `kip/`

---

### PostgreSQL 17 (порт 5433) — mstroy

#### Схема `geo`

| Таблица | Ключевые поля | Назначение |
|---------|--------------|-----------|
| `objects` | `uid`, `name`, `smu`, `address`, `geom` (PostGIS) | Строительные объекты |
| `zones` | `uid`, `object_uid`, `name`, `geom` (PostGIS) | Геозоны объектов |
| `zone_tags` | `zone_uid`, `tag` | Теги зон (`dt_loading`, `dt_unloading`, `dt_boundary`) |
| `_migrations` | `name`, `applied_at` | История миграций |

#### Схема `dump_trucks`

| Таблица | Ключевые поля | Назначение |
|---------|--------------|-----------|
| `shift_records` | `id`, `report_date`, `shift_type`, `id_mo`, `reg_number`, `object_name`, `trips_count`, `kpi`, `raw_monitoring` | KPI смены + сырой мониторинг |
| `trips` | `id`, `shift_record_id`, `loading_zone`, `unloading_zone`, `start_time`, `end_time`, `duration_min` | Рейсы: пары погрузка→выгрузка |
| `zone_events` | `id`, `shift_record_id`, `zone_name`, `zone_type`, `enter_time`, `exit_time`, `duration_min` | Факты нахождения в геозонах |
| `requests` | `number`, `status`, `object_name`, `cargo_type`, `plan_trips` | Заявки TIS (для самосвалов) |
| `_migrations` | `name`, `applied_at` | История миграций |

Миграция: `npm run migrate` из `dump-trucks/server/`

#### Схема `vehicle_status`

| Таблица | Ключевые поля | Назначение |
|---------|--------------|-----------|
| `status_history` | `id`, `plate_number` (UPPER), `status_text`, `is_repairing`, `date_start`, `date_end`, `days_in_repair`, `category`, `last_check_date` | История состояний ТС из Excel |

Миграция: `vehicle-status/server/migrations/001_vehicle_status.sql`

---

### SQLite — tyagachi/archive.db

| Таблица | Ключевые поля | Назначение |
|---------|--------------|-----------|
| `vehicles` | `id_mo`, `reg_number`, `name_mo` | Справочник тягачей |
| `tracked_requests` | `request_number`, `status`, `stability`, `matched_data_json` | Заявки + иерархия для отчёта |
| `pl_records` | `id`, `request_number`, `pl_date`, `driver`, `engine_hours`, `mileage` | Путевые листы |
| `sync_log` | `id`, `started_at`, `finished_at`, `status`, `error` | Журнал синхронизаций |
| `reports` | `id`, `request_number`, `html_content`, `created_at` | Кэш сгенерированных HTML-отчётов |
| `shift_cache` | `id_mo`, `shift_date`, `shift_type`, `monitoring_json` | Кэш мониторинга по сменам |

---

## Потоки данных по ключевым кнопкам UI

### "Синхронизировать" в Состоянии ТС

```
Кнопка → POST /api/vs/sync
  → sheetsSyncService.ts: Drive API files.get (alt=media) → скачать .xlsx как Buffer
  → XLSX.read() (SheetJS) → 8 вкладок по SHEET_TABS
  → findHeaderRow() → поиск колонок «Гос. №» и «Тех. состояние» в первых 30 строках
  → isBroken() → транзакционный upsert в vehicle_status.status_history (PG17)
  → GET /api/vs/vehicle-status (polling из UI) → обновить таблицу
```

### "Синхронизировать" в Тягачах

```
Кнопка (период 1д/3д/1н/2н) → POST /api/sync {period_days: N}
  → sync.py: TIS API getRouteListsByDateOut (7д) + getRequests (2 мес.)
  → PLParser + RequestParser → матчинг по request_number
  → upsert Vehicle / TrackedRequest / PLRecord в SQLite
  → getMonitoringStats для ПЛ без кэша → shift_cache
  → GET /api/sync/status (polling) → обновить UI
```

### Клик на заявку в Тягачах

```
Клик → GET /api/request/{number}/data
  → build_hierarchy(matched_data_json из SQLite)
  → hierarchical JSON: запрос → ПЛ → смены → трек-точки + стоянки
  → TyagachiReportView (3 колонки):
    левая:  список ПЛ
    центр:  react-leaflet карта (трек синий + стоянки красными маркерами)
    правая: факт-панель (пробег, топливо, стоянки)
```

### "Запустить" pipeline КИП (ручной)

```
POST /api/admin/fetch?date=YYYY-MM-DD
  → dailyFetchJob.ts: getRouteListsByDateOut (7д) → upsert route_lists / pl_calcs / vehicles
  → buildVehicleTasks() (filter по vehicle-types.json) → interleaveTasks() (round-robin)
  → getRequests (2 мес.) → upsert requests
  → для каждого VehicleTask (последовательно, rate-limit):
      getMonitoringStats → parseMonitoringStats → analyzeTrackGeozones (Turf.js)
      → matchFuelNorm → calculateKpi → upsert vehicle_records (PG16)
```

### Загрузка страницы КИП в iframe

```
/kip роут → <iframe src="http://hostname:3001">
  → kip/client: определить embedding (window.self !== window.top)
  → скрыть TopNavBar
  → GET /api/vehicles/weekly → агрегированные средние по ТС
  → VehicleMap (маркеры, треки, геозоны) + VehicleDetailTable
```

### Загрузка вкладки Самосвалы

```
/samosvaly роут → DumpTrucksPage (React)
  → GET /api/dt/orders?dateFrom=...&dateTo=... → список заявок по городам
  → клик на карточку → GET /api/dt/orders/:number/gantt → таблица Ганта
  → GET /api/dt/repairs → карточки ремонтов (таблица dump_trucks.repairs)
```

---

## Ключевые алгоритмы

| Алгоритм | Файл | Суть |
|----------|------|------|
| КИП расчёт | `kip/server/src/services/kpiCalculator.ts` | load_pct × utilization_pct |
| Геозонный анализ (КИП) | `kip/server/src/services/geozoneAnalyzer.ts` | Turf.js point-in-polygon; fallback: total_stay_time = engineOnTime |
| Сплит смен (КИП) | `kip/server/src/services/shiftSplitter.ts` | 07:30–19:30 / 19:30–07:30 |
| Interleave задач | `kip/server/src/jobs/dailyFetchJob.ts` | `interleaveTasks()` — [A,B,C,A,B,C] вместо [A,A,B,B] для rate-limit |
| TIS API клиент (Node) | `kip/server/src/services/tisClient.ts` | POST + query string; 18 токенов round-robin; backoff на 429 |
| TIS API клиент (Python) | `tyagachi/src/api/client.py` | Те же endpoints, те же правила |
| extract_request_number | `tyagachi/src/parsers/pl_parser.py` + `kip/server/src/services/plParser.ts` | regex из `orderDescr`: `^(\d+)` после удаления `«№»` |
| build_hierarchy | `tyagachi/src/output/html_generator_v2.py` | matched_data_json → иерархия заявок для отчёта |
| ZoneAnalyzer | `dump-trucks/server/src/services/zoneAnalyzer.ts` | Turf.js; трек-точки → ZoneEvent[] |
| TripBuilder | `dump-trucks/server/src/services/tripBuilder.ts` | ZoneEvent[] → пары loading→unloading → Trip[] |
| ObjectDetector | `dump-trucks/server/src/services/zoneAnalyzer.ts` | объект = max точек в `dt_boundary` |
| isBroken | `vehicle-status/server/src/services/sheetsSyncService.ts` | «требует ремонта» = false (исправен!), «неисправен» = true |

---

## Переменные окружения (сводная)

| Сервис | Файл | Переменные |
|--------|------|-----------|
| КИП | `kip/.env` | `TIS_API_URL`, `TIS_API_TOKENS` (18 через запятую), `DB_NAME=kip_vehicles`, `DB_HOST`, `DB_PORT=5432`, `TZ=Asia/Yekaterinburg` |
| Тягачи | `tyagachi/config.yaml` | `api.base_url`, `api.token(s)`, `paths.input`, `paths.output`, `logging` |
| Самосвалы | `dump-trucks/server/.env` | `DB_HOST`, `DB_PORT=5433`, `DB_NAME=mstroy`, `TIS_API_URL`, `TIS_API_TOKENS`, `DT_TEST_ID_MOS` (опционально) |
| Состояние ТС | `vehicle-status/server/.env` | `DB_HOST`, `DB_PORT=5433`, `DB_NAME=mstroy`, `DB_USER=max`, `GOOGLE_CREDS_PATH=creds.json`, `GOOGLE_FILE_ID` |
| Гео-Администратор | `geo-admin/server/.env` | `DB_HOST`, `DB_PORT=5433`, `DB_NAME=mstroy`, `DB_USER=max` |
| Единый фронтенд | `frontend/.env` (если нужно) | Vite proxy настроен в `vite.config.ts`, .env не требуется для локальной разработки |

Важно: `creds.json` (`vehicle-status/server/creds.json`) — Service Account для Google Drive API — **в .gitignore, не коммитить**.

---

## Инфраструктура

### Роуты фронтенда

| Путь | Компонент | Файл |
|------|-----------|------|
| `/` | Dashboard | `frontend/src/features/dashboard/` |
| `/kip` | iframe → :3001 | `frontend/src/features/kip/` |
| `/tyagachi` | TyagachiDashboard | `frontend/src/features/tyagachi/TyagachiDashboard.tsx` |
| `/tyagachi/requests/:requestNumber` | TyagachiReportView | `frontend/src/features/tyagachi/TyagachiReportView.tsx` |
| `/samosvaly` | DumpTrucksPage | `frontend/src/features/samosvaly/DumpTrucksPage.tsx` |
| `/vehicle-status` | VehicleStatusPage | `frontend/src/features/vehicle-status/VehicleStatusPage.tsx` |

### Vite proxy (`frontend/vite.config.ts`)

| Префикс | Цель |
|---------|------|
| `/api/kip` | `http://localhost:3001/api` |
| `/api/tyagachi` | `http://localhost:8000/api` |
| `/api/dt` | `http://localhost:3002` |
| `/api/vs` | `http://localhost:3004` |

### Запуск всех сервисов

```bash
# PostgreSQL 16 (kip)
brew services start postgresql@16

# PostgreSQL 17 (mstroy)
brew services start postgresql@17

# Сервисы (каждый в отдельном терминале)
cd kip/ && npm run dev:server                          # :3001 (API + статика)
cd tyagachi/ && python main.py --web --port 8000       # :8000
cd dump-trucks/server && npm run dev                   # :3002
cd geo-admin/server && npm run dev                     # :3003
cd vehicle-status/server && npm run dev                # :3004
cd frontend && npm run dev                             # :5173
```

### Деплой (планируется)

- VPS reg.ru: Ubuntu 22.04, 2 vCPU / 4 GB RAM / 40 GB SSD
- nginx reverse proxy:
  - `/` → frontend :5173
  - `/api/kip/*` → Node :3001
  - `/api/transport/*` → FastAPI :8000
  - `/api/dt/*` → Node :3002
  - `/api/vs/*` → Node :3004
  - `/geo-admin` → Node :3003

---

## Документация по подпроектам

| Подпроект | FRONTEND.md | PIPELINE.md | HISTORY.md | DEVGUIDE.md |
|-----------|------------|-------------|------------|-------------|
| КИП | `kip/docs/FRONTEND.md` | `kip/docs/PIPELINE.md` | `kip/docs/HISTORY.md` | `kip/docs/DEVGUIDE.md` |
| Тягачи | `tyagachi/docs/FRONTEND.md` | `tyagachi/docs/PIPELINE.md` | `tyagachi/docs/HISTORY.md` | `tyagachi/docs/DEVGUIDE.md` |
| Самосвалы | `dump-trucks/docs/FRONTEND.md` | `dump-trucks/docs/PIPELINE.md` | `dump-trucks/docs/HISTORY.md` | `dump-trucks/docs/DEVGUIDE.md` |
| Состояние ТС | `vehicle-status/docs/FRONTEND.md` | `vehicle-status/docs/PIPELINE.md` | `vehicle-status/docs/HISTORY.md` | `vehicle-status/docs/DEVGUIDE.md` |
| Гео-Администратор | `geo-admin/docs/FRONTEND.md` | `geo-admin/docs/PIPELINE.md` | `geo-admin/docs/HISTORY.md` | `geo-admin/docs/DEVGUIDE.md` |
| Единый фронтенд | `frontend/docs/FRONTEND.md` | `frontend/docs/PIPELINE.md` | `frontend/docs/HISTORY.md` | `frontend/docs/DEVGUIDE.md` |
