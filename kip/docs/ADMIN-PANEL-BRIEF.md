# КИП: Брифинг по Admin Panel и пайплайнам обновления данных

> Документ подготовлен для совещания по улучшению admin-panel.
> Формат: инженерный справочник — файлы, методы, gotcha-и, кросс-сервисные зависимости.

---

## 1. Файлы и методы KIP, связанные с Admin Panel

### 1.1 Admin-эндпоинты KIP-сервера (`kip/server/src/index.ts`)

| Endpoint | Метод | Параметры | Что делает | Async | Статус-трекинг |
|----------|-------|-----------|------------|-------|----------------|
| `/api/admin/fetch` | POST | `date=YYYY-MM-DD` | Запуск полного пайплайна (TIS API → БД) | Да | Нет (fire-and-forget) |
| `/api/admin/recalculate` | POST | `date=YYYY-MM-DD` | Пересчёт КИП из `monitoring_raw` (без TIS) | Да | In-memory `recalcJobStatus` Map |
| `/api/admin/recalculate/status` | GET | `date=YYYY-MM-DD` | Поллинг статуса пересчёта | — | `running`/`done`/`not_found` |
| `/api/admin/gap-fill` | POST | `date=YYYY-MM-DD` | Ручной gap-fill для даты | Да | Нет (fire-and-forget) |

**Важно:** статус-трекинг fetch и gap-fill — **отсутствует** на стороне KIP-сервера. Admin-сервер компенсирует это поллингом БД.

### 1.2 Пайплайн Daily Fetch (`kip/server/src/jobs/dailyFetchJob.ts`)

`runDailyFetch(dateStr?)` — основной пайплайн, 8 шагов:

```
1. Fetch route lists (7 дней назад) → route_lists, pl_calcs, vehicles
2. Фильтрация ТС по vehicle-registry.json (~170 машин)
3. Разбивка на смены (morning 07:30-19:30, evening 19:30-07:30)
4. Interleave задач по idMO (round-robin для rate limit)
5. Fetch requests (2 месяца назад) → requests
6. Monitoring: 5 параллельных воркеров для каждого ТС-смены:
   a. TIS API getMonitoringStats → parsing
   b. Сохранение в monitoring_raw (для recalculate без TIS)
   c. Geozone analysis (fillTrackGaps → point-in-polygon → zone time)
   d. Изменение B: cap totalStayTime до 12ч если firstZone === lastZone
   e. Условие 1: датчик расхода = 0, двигатель > 0
   f. calculateKpi → upsertVehicleRecord
7. Gap-fill: цикл по [targetDate - 10, targetDate]
8. Логирование итогов
```

### 1.3 Recalculate Job (`kip/server/src/jobs/recalculateJob.ts`)

`recalculateForDate(pool, date)` — пересчёт из сохранённых raw-данных:

- Читает `monitoring_raw` за дату
- Прогоняет через те же формулы (geozone → kpi → upsert)
- Условие 1: датчик расхода
- Условие 3: создание 0%-записей для отсутствующих смен
- Gap-fill в конце
- **Не вызывает TIS API** — только локальные данные

### 1.4 Gap Fill Job (`kip/server/src/jobs/gapFillJob.ts`)

`fillGapsForDate(pool, date)` — создание синтетических записей:

- Батч-запрос: какие смены уже есть за дату
- Для каждого ТС из registry без полного комплекта смен:
  - Найти lastRecord (до 10 дней назад), nextRecord (до 10 дней вперёд)
  - GPS-проверка: `haversine < 500м`
  - Топливо: `|fuel_value_end - fuel_value_begin| < 10л` (абсолютно)
  - Если ок → upsert с `is_gap_filled = true`, КИП=0%, engine=0

### 1.5 Scheduler (`kip/server/src/jobs/scheduler.ts`)

```
cron: 08:30 Asia/Yekaterinburg (UTC+5), ежедневно
Почему 08:30: вечерняя смена заканчивается 07:30, +1ч для обработки TIS API
```

### 1.6 TIS API Client (`kip/server/src/services/tisClient.ts`)

- **Протокол:** POST с пустым body, все параметры в query string
- **Команды:** `getRouteListsByDateOut`, `getRequests`, `getMonitoringStats`
- **Rate limit:** 1 запрос / 30с на idMO (`rateLimiter.ts`)
- **Token pool:** 18 токенов, round-robin (`tokenPool.ts`)
- **Retry:** до (totalTokens + 1) попыток × 3 retry на timeout, exponential backoff

### 1.7 KPI Calculator (`kip/server/src/services/kpiCalculator.ts`)

- `calculateKpi()` — все формулы КИП
- Условие 1: rate=0 + engine>0 → проверка бака / зажигания за неделю
- Условие 2: клампинг 0-100%
- Формулы: `utilization_ratio = engine_on_time / total_stay_time * 100`

### 1.8 Geozone Analyzer (`kip/server/src/services/geozoneAnalyzer.ts`)

- `fillTrackGaps()` — заполнение пропусков трека (GPS < 500м → синтетические точки)
- `analyzeTrackGeozones()` — point-in-polygon (Turf.js), накопление времени по зонам
- Возвращает: `totalStayTime`, `departmentUnit`, `firstZoneId`, `lastZoneId`
- Источник зон: `config/geozones.geojson` (экспорт из fleetradar)

### 1.9 Repositories (БД)

| Файл | Таблица | Ключевые функции |
|------|---------|-----------------|
| `vehicleRecordRepo.ts` | `vehicle_records` | `upsertVehicleRecord`, `getWeeklyAggregated`, `getVehicleDetails`, `hadEngineOffInPastWeek`, `getGhostVehicles` |
| `monitoringRawRepo.ts` | `monitoring_raw` | `upsertMonitoringRaw`, `getAllMonitoringRaw`, `listDatesWithRaw` |
| `routeListRepo.ts` | `route_lists`, `pl_calcs`, `vehicles` | `upsertRouteLists` |
| `requestRepo.ts` | `requests` | `upsertRequests`, `getRequestsForVehicle` |

---

## 2. Кросс-сервисные взаимодействия

### 2.1 KIP ↔ Admin Server (`admin/server.ts`)

Admin-сервер — **единственный** внешний потребитель KIP admin-API.

**Как Admin управляет KIP:**

| Действие | Admin вызывает | Как ждёт завершения |
|----------|---------------|---------------------|
| Fetch (normal) | `POST :3001/api/admin/fetch?date=X` | Поллинг `vehicle_records` каждые 20с, таймаут 30мин |
| Fetch (force) | `POST :3001/api/admin/fetch?date=X` | Поллинг `monitoring_raw` (count стабильна 2 проверки подряд ~30с) |
| Recalculate | `POST :3001/api/admin/recalculate?date=X` | Поллинг `/api/admin/recalculate/status` каждые 10с, таймаут 20мин |
| Gap-fill | `POST :3001/api/admin/gap-fill?date=X` | Нет поллинга (fire-and-forget) |

**Admin БД-пулы (прямой доступ к БД):**
```
kipPool → localhost:5432/kip_vehicles (user: max)
mainPool → localhost:5433/mstroy (user: max)
```

**Admin SQL-запросы к KIP БД:**
- `getKipDates()` — `SELECT DISTINCT report_date FROM vehicle_records`
- `getKipRawDates()` — JOIN `vehicle_records` + `monitoring_raw`, подсчёт coverage %
- DB Viewer presets: `kip.vehicle_records`, `kip.monitoring_raw`

### 2.2 KIP ↔ Geo-Admin

**Прямых вызовов нет.** Связь — через общий файл:

```
kip/config/geozones.geojson  ← экспорт из fleetradar (ручной)
                              ← НЕ синхронизирован с geo-admin
```

- KIP загружает `geozones.geojson` **один раз** при старте (кэш в памяти)
- Geo-admin управляет зонами в PostGIS (`mstroy` БД), но KIP **не читает** из PostGIS
- Обновление зон для KIP: ручной экспорт из fleetradar → замена файла → рестарт KIP
- **Потенциальное улучшение**: KIP мог бы читать зоны из geo-admin API или из общей БД

### 2.3 KIP ↔ Другие сервисы

**Полная изоляция:**
- Отдельная БД: `kip_vehicles` (PostgreSQL 16, порт 5432)
- Нет HTTP-вызовов к dump-trucks, vehicle-status, tyagachi
- Нет общих таблиц
- Общее: TIS API (те же токены), frontend (общий UI)

### 2.4 Frontend Admin UI (`frontend/src/features/admin/AdminPage.tsx`)

Единый UI для всех сервисов (~1055 строк). KIP-специфичные секции:

| Секция | Что делает | API-вызовы |
|--------|-----------|------------|
| Service Management | Start/stop/restart КИП | `POST /api/admin/services/kip/{start,stop,restart}` |
| Data Coverage | Показ дат с vehicle_records + monitoring_raw coverage | `GET /api/admin/data-coverage?from=&to=` |
| Fetch Queue | Выбор mode (normal/force/refresh), запуск очереди | `POST /api/admin/fetch/kip?from=&to=&force=&refresh=` |
| Recalc Queue | Запуск пересчёта, поллинг статуса | `POST /api/admin/recalc/kip?from=&to=` |
| DB Viewer | Просмотр `vehicle_records`, `monitoring_raw` | `GET /api/admin/db-query?table=kip.*` |

---

## 3. Три режима обновления данных (fetch)

| Режим | Когда использовать | Что происходит | Как Admin ждёт |
|-------|-------------------|----------------|----------------|
| **Normal** | Заполнение пропусков | Фетч только дат без `vehicle_records` | Поллинг `vehicle_records` (20с, 30мин) |
| **Force** | Перевыгрузка raw-данных | Даты с `vehicle_records` но без `monitoring_raw` → повторный fetch | Поллинг `monitoring_raw` count (стабильность ~30с) |
| **Refresh** | Полная перезагрузка | ВСЕ даты в диапазоне, перезапись | Как Normal |

**После fetch обязательно recalculate?** Нет — `dailyFetchJob` сам вычисляет КИП и пишет `vehicle_records`. Recalculate нужен только:
- После изменения формул/условий КИП
- После обновления `vehicle-registry.json` (fuelNorm)
- После обновления `geozones.geojson` (зоны)

---

## 4. Gotcha-и и тонкости

### 4.1 Порядок пайплайнов имеет значение

```
Правильный порядок при масштабных изменениях:
1. Fetch (normal/force) — выгрузить данные из TIS
2. Recalculate — пересчитать КИП из monitoring_raw
3. Gap-fill — заполнить дыры (автоматически в конце recalculate)
```

**Нельзя** recalculate без fetch: monitoring_raw должен быть заполнен.
**Нельзя** gap-fill без данных по соседним датам: нужны boundary records для GPS/fuel проверки.

### 4.2 Отсутствие статус-трекинга fetch

KIP-сервер `/api/admin/fetch` — fire-and-forget. Admin-сервер **сам** поллит БД чтобы определить завершение. Это хрупко:
- Если пайплайн упал с ошибкой — Admin будет ждать до таймаута (30 мин)
- Нет way to distinguish "пайплайн работает" от "пайплайн упал"
- Gap-fill endpoint — аналогично, нет статус-трекинга

**Рекомендация:** добавить in-memory status map для fetch и gap-fill (аналогично `recalcJobStatus`).

### 4.3 Кэширование геозон

`geozoneAnalyzer.ts` загружает `geozones.geojson` **один раз** (`cachedZones`). Обновление файла требует рестарт KIP-сервера. Это неочевидно из UI.

### 4.4 Кэширование vehicle-registry

`vehicleRegistry.ts` загружает `vehicle-registry.json` при первом вызове и кэширует. Добавление/удаление ТС требует рестарт.

### 4.5 PostgreSQL NUMERIC → string

Все числовые колонки из PostgreSQL возвращаются как строки в Node.js. `coerceNumericFields()` конвертирует их в `Number()`. Новые числовые колонки **обязательно** добавлять в `NUMERIC_FIELDS` массив, иначе арифметика ломается ("12" + "12" = "1212").

### 4.6 Timing: cron vs manual

- Cron: 08:30 Ykb (UTC+5) — вечерняя смена заканчивается 07:30
- Manual fetch: можно запускать для любой даты
- **Конфликт:** если manual fetch запущен одновременно с cron — два пайплайна параллельно. Rate limiter по idMO защитит TIS API, но upsert-ы могут перезаписывать друг друга.

### 4.7 Coverage calculation в Admin

Coverage = `count(monitoring_raw) / count(vehicle_records)` за дату.
- ≥ 90% → зелёный (полные raw-данные)
- < 90% → жёлтый (partial)
- 0% → нет raw-данных

**Проблема:** gap-filled записи (`is_gap_filled = true`) увеличивают `count(vehicle_records)`, но у них нет `monitoring_raw`. Это занижает coverage %. Нужно фильтровать: `WHERE is_gap_filled = false`.

### 4.8 Recalculate in-memory status теряется при рестарте

`recalcJobStatus` — `Map` в памяти KIP-сервера. При рестарте KIP (или crash) — статус теряется. Admin увидит `status: 'not_found'` → "job lost (server restart?)".

### 4.9 Force fetch: waitForRawComplete логика

Admin ждёт стабилизации count `monitoring_raw` (2 проверки по 15с подряд). Если пайплайн делает паузу между ТС (rate limit 30с) — count может показаться стабильным преждевременно. Текущая реализация работает, но на грани.

### 4.10 Shift edge case: 00:00-07:30

Период 00:00-07:30 относится к **вечерней смене предыдущего дня**. `report_date` вечерней смены = день начала (19:30), не конца (07:30 следующего дня). Это неочевидно при ручном анализе данных.

### 4.11 Токены TIS API

18 токенов в `TIS_API_TOKENS`, round-robin. Все сервисы (KIP, dump-trucks, tyagachi) используют **один и тот же** пул. Параллельные fetch-и из разных сервисов конкурируют за rate limit, но у каждого сервиса свой `TokenPool` instance (не shared state).

### 4.12 Windows: порты PostgreSQL

На Windows оба кластера PG (16 и 17) на **порту 5432**. В документации (Mac) — 5432 и 5433. Admin-сервер по умолчанию: `kipPool = :5432`, `mainPool = :5433`. На Windows `mainPool` конфигурируется через `.env`.

---

## 5. Что нужно для улучшения Admin Panel (конкретно по KIP)

### 5.1 Текущие проблемы UX

1. **Coverage непонятен:** «зелёный/жёлтый/пустой» без деталей. Нет breakdown по ТС.
2. **Три режима fetch** сложно объяснить пользователю. Документации в UI нет.
3. **Gap-fill не отслеживается:** нет прогресса, нет результатов (сколько заполнено).
4. **После fetch надо recalculate?** Непонятно когда. Нет подсказки.
5. **Рестарт = потеря status:** recalculate status теряется при рестарте KIP.
6. **Coverage врёт:** gap-filled записи занижают % raw-покрытия.

### 5.2 Рекомендуемые API-изменения в KIP-сервере

| Изменение | Файл | Суть |
|-----------|------|------|
| Status-трекинг для fetch | `index.ts` | In-memory Map аналогично `recalcJobStatus` |
| Status-трекинг для gap-fill | `index.ts` | Аналогично, возвращать `{ filled, skipped }` |
| Coverage endpoint | Новый или расширить health | `is_gap_filled` фильтрация в подсчёте |
| Pipeline info endpoint | Новый | Текущее состояние: что запущено, какая дата, сколько осталось |

### 5.3 Рекомендуемые изменения Admin-сервера

| Изменение | Файл | Суть |
|-----------|------|------|
| Coverage с деталями по дню | `admin/server.ts` | Breakdown: сколько ТС, сколько raw, сколько gap-filled |
| Документация в UI | `AdminPage.tsx` | Тултипы / help-блок: когда какой режим, порядок действий |
| Gap-fill в очереди | `admin/server.ts` + `AdminPage.tsx` | Добавить gap-fill как третий тип очереди с прогрессом |

---

## 6. Полный список файлов

| Файл | Роль в контексте Admin |
|------|----------------------|
| `kip/server/src/index.ts` | Admin API endpoints (fetch, recalculate, gap-fill) |
| `kip/server/src/jobs/dailyFetchJob.ts` | Основной пайплайн (запускается из admin) |
| `kip/server/src/jobs/recalculateJob.ts` | Пересчёт (запускается из admin) |
| `kip/server/src/jobs/gapFillJob.ts` | Gap-fill (запускается из admin + автоматически) |
| `kip/server/src/jobs/scheduler.ts` | Cron (08:30 Ykb) |
| `kip/server/src/services/tisClient.ts` | TIS API клиент (rate limit, retry, token rotation) |
| `kip/server/src/services/tokenPool.ts` | Пул токенов TIS |
| `kip/server/src/services/rateLimiter.ts` | Rate limit 30с/idMO |
| `kip/server/src/services/kpiCalculator.ts` | Формулы КИП |
| `kip/server/src/services/geozoneAnalyzer.ts` | Geozone analysis + gap fill трека |
| `kip/server/src/services/vehicleRegistry.ts` | Реестр ТС (кэш) |
| `kip/server/src/services/vehicleFilter.ts` | Фильтрация + fuelNorm |
| `kip/server/src/services/shiftSplitter.ts` | Границы смен |
| `kip/server/src/services/plParser.ts` | Построение задач + interleave |
| `kip/server/src/services/monitoringParser.ts` | Парсинг мониторинга TIS |
| `kip/server/src/repositories/vehicleRecordRepo.ts` | БД vehicle_records |
| `kip/server/src/repositories/monitoringRawRepo.ts` | БД monitoring_raw |
| `kip/server/src/repositories/routeListRepo.ts` | БД route_lists, pl_calcs |
| `kip/server/src/repositories/requestRepo.ts` | БД requests |
| `kip/server/src/repositories/filterRepo.ts` | Каскадные фильтры |
| `kip/config/vehicle-registry.json` | ~170 ТС, fuelNorm, type, branch |
| `kip/config/geozones.geojson` | Полигоны зон (экспорт fleetradar, ручной) |
| `kip/config/shifts.json` | Границы смен (07:30/19:30) |
| `kip/server/migrations/005_add_fuel_levels_and_gap_flag.sql` | Миграция KIP-3 |
| `admin/server.ts` | Оркестратор: spawn сервисов, fetch/recalc очереди, coverage, DB viewer |
| `frontend/src/features/admin/AdminPage.tsx` | UI: управление сервисами, очереди, coverage, DB viewer |
