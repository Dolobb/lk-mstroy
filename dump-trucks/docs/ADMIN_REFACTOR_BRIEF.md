# Admin Panel Refactor — Техническая справка (dump-trucks)

> Документ для планирования улучшения admin-панели.
> Подготовлен из контекста dump-trucks, но описывает кросс-сервисную архитектуру.

---

## 1. Карта файлов: dump-trucks ↔ admin ↔ frontend

### dump-trucks/server/src/ — внутренние файлы

| Файл | Ключевые экспорты | Роль в admin-панели |
|------|-------------------|---------------------|
| **index.ts:65-87** | `POST /api/dt/admin/fetch` | Ручной триггер pipeline (async, fire-and-forget) |
| **index.ts:643-665** | `POST /api/dt/admin/fetch-segments` | Триггер загрузки 30-мин сегментов |
| **index.ts:670-696** | `POST /api/dt/admin/recalculate` | Пересчёт из raw_monitoring (**sync**, ждёт ответ) |
| **index.ts:599-638** | `GET /api/dt/admin/segment-results` | Результаты загрузки сегментов за дату |
| **index.ts:701-713** | `GET /api/dt/admin/config` | Debug: testMode, tokenCount, dbPort |
| **jobs/shiftFetchJob.ts** | `runShiftFetch(date, shift)` | Главный pipeline: TIS → parse → analyze → upsert |
| **jobs/recalculateJob.ts** | `recalculateShift(pool, date, shift)` | Пересчёт без TIS (из stored raw_monitoring) |
| **jobs/segmentFetchJob.ts** | `runSegmentFetch(opts)` | 24×30мин сегменты для onsite-ТС |
| **jobs/scheduler.ts** | `startScheduler()` | Cron: 08:30 shift2/yesterday, 20:30 shift1/today |
| **repositories/shiftRecordRepo.ts** | `upsertShiftRecord()`, `queryShiftRecords()` | Основной upsert с UNIQUE (date, shift, vehicle, object) |
| **repositories/tripRepo.ts** | `replaceTrips()` | DELETE + INSERT в транзакции |
| **repositories/zoneEventRepo.ts** | `replaceZoneEvents()` | DELETE по (vehicleId, date, shift) + INSERT |
| **repositories/segmentRepo.ts** | `replaceSegments()`, `getRecordIdsWithSegments()` | Сегменты + проверка "уже загружены" |
| **repositories/filterRepo.ts** | `getAllDtZones()`, `getDtZonesForObject()` | Чтение geo.zones + geo.zone_tags + geo.objects |
| **services/zoneAnalyzer.ts** | `analyzeZones(track, zones)` | GPS → ZoneEvent[] (теперь с min_duration_sec фильтрацией) |
| **services/vehicleDetector.ts** | `detectObject(track, zones)` | Определение объекта (max points in dt_boundary) |
| **services/tripBuilder.ts** | `buildTrips(events)` | ZoneEvent[] → Trip[] (пары loading/unloading) |
| **services/kpiCalculator.ts** | `calculateKpi(params)` | Формула КИП% |

### admin/server.ts — admin-бэкенд (управление всем)

| Блок (строки) | Функция | Что делает для dump-trucks |
|---------------|---------|---------------------------|
| **197-209** | `getKipDates(from, to)` | *Только KIP* — SELECT DISTINCT report_date |
| **211-238** | `getKipRawDates(from, to)` | *Только KIP* — покрытие monitoring_raw |
| **240-252** | `getDumpTrucksDates(from, to)` | `SELECT DISTINCT report_date FROM dump_trucks.shift_records` |
| **254-276** | `FetchProgress` state machine | Очередь дат для загрузки (общая KIP/DT) |
| **423-465** | `runDTQueue(dates)` | Для каждой даты: POST shift1, ждать 2с, POST shift2, poll 8мин |
| **537-579** | `runDTRecalc(dates)` | Для каждой даты: POST recalculate shift1 + shift2 параллельно (sync) |
| **581-738** | Segment fetch queue | POST fetch-segments + poll segment count stability |
| **746-1183** | Express routes | `/api/admin/data-coverage`, `/api/admin/fetch/:service`, `/api/admin/recalc/:service` |

### frontend/src/features/admin/

| Файл | Что рисует |
|------|-----------|
| **AdminPage.tsx** (~1055 строк) | Вся admin-панель: сервисы, покрытие, fetch/recalc/segments, DB viewer |
| **types.ts** | DataCoverage, FetchStatus, RecalcStatus, SegmentFetchStatus, DbQueryResult |

---

## 2. Текущая логика покрытия данных

### Что показывает admin-панель сейчас

Покрытие — это **календарная сетка дней** за выбранный диапазон. Для каждого дня определяется цвет:

```
Для KIP:
  ● Зелёный — есть в vehicle_records (любое кол-во)
  ● Зелёный с пунктиром — есть в monitoring_raw ≥90%
  ● Жёлтый с пунктиром — monitoring_raw >0% но <90%
  ○ Серый/пустой — нет данных

Для Dump-trucks:
  ● Зелёный — есть в shift_records (любое кол-во)
  ○ Серый/пустой — нет данных
```

### Проблема: никакой детализации

**Dump-trucks coverage не показывает:**
- Сколько ТС обработано за день
- Какие смены загружены (shift1/shift2/обе)
- Сколько рейсов найдено
- Есть ли сегменты (для onsite-машин)
- Были ли ошибки при обработке
- Какой объект покрыт

**Проблема "криво-косо":** Покрытие KIP имеет 3 уровня (vehicle_records + raw full + raw partial), а DT имеет 1 уровень (shift_records exist/not). При этом UI построен вокруг KIP-паттерна, и DT-блок выглядит как "довесок".

### Источник данных покрытия

```
GET /api/admin/data-coverage?from=2026-04-01&to=2026-04-14

Ответ:
{
  kip: ["2026-04-01", ...],         // даты с vehicle_records
  dumpTrucks: ["2026-04-01", ...],  // даты с shift_records
  rawDates: [...],                   // KIP: monitoring_raw ≥90%
  rawPartial: [...],                 // KIP: monitoring_raw <90%
  errors: { kip: null, dumpTrucks: null },
  config: { kip: "localhost:5432/kip_vehicles", main: "localhost:5432/mstroy" }
}
```

---

## 3. Три способа обновления данных dump-trucks

### 3.1. Fetch (полная загрузка из TIS)

```
Кнопка UI: "Загрузить самосвалы"
Endpoint: POST /api/admin/fetch/dump-trucks?from=...&to=...
```

**Что происходит:**
1. Admin определяет даты без shift_records в диапазоне
2. Для каждой даты последовательно:
   - `POST :3002/api/dt/admin/fetch?date=X&shift=shift1` (async)
   - Пауза 2 сек
   - `POST :3002/api/dt/admin/fetch?date=X&shift=shift2` (async)
   - Poll shift_records каждые 20с, timeout 8 мин
3. Pipeline внутри dump-trucks: fetch ПЛ → requests → мониторинг → zones → trips → KPI → upsert

**Когда использовать:** первичная загрузка данных за новые даты.

**Время:** ~10-15 мин на день (20 ТС × 30с rate limit × 2 смены).

### 3.2. Refresh (перезагрузка с перезаписью)

```
Кнопка UI: тогл "Перезагрузить", затем "Загрузить"
Endpoint: POST /api/admin/fetch/dump-trucks?from=...&to=...&refresh=true
```

**Что происходит:**
1. Admin берёт ВСЕ даты в диапазоне (не только missing)
2. Далее как Fetch — заново вызывает TIS API
3. Upsert перезаписывает существующие shift_records

**Когда использовать:** после изменения геозон в geo-admin, после fix багов в pipeline.

**Gotcha:** тогл refreshMode хранится в React state — при обновлении страницы сбрасывается.

### 3.3. Recalculate (пересчёт без TIS)

```
Кнопка UI: "Пересчитать"
Endpoint: POST /api/admin/recalc/dump-trucks?from=...&to=...
```

**Что происходит:**
1. Admin определяет даты С shift_records в диапазоне
2. Для каждой даты: `POST :3002/api/dt/admin/recalculate?date=X&shift=shift1|2`
3. DT-бэкенд **синхронно** ждёт завершения (в отличие от KIP!)
4. Recalculate берёт `raw_monitoring` из shift_records, заново прогоняет:
   - `analyzeZones(track, freshZones)` → новые ZoneEvent[]
   - `detectObject(track, freshZones)` → возможно другой объект
   - `buildTrips()` → новые Trip[]
   - `calculateKpi()` → новый КПИ

**Когда использовать:** после изменения геозон (добавление/удаление/перемещение), после изменения min_duration_sec, после fix tripBuilder.

**Ограничение:** `raw_monitoring` хранит только мета (`trackPoints: count`), НЕ полный трек. Если трек нужен — только Refresh (повторный fetch из TIS).

### 3.4. Segment Fetch (отдельная загрузка сегментов)

```
Кнопка UI: "Загрузить сегменты" / "Перезагрузить сегменты (force)"
Endpoint: POST /api/admin/fetch-segments?from=...&to=...&force=true|false
```

**Что происходит:**
1. Находит onsite shift_records без сегментов (или все если force)
2. 24 вызова TIS getMonitoringStats на 30-мин окна × кол-во ТС
3. Сохраняет в shift_segments

**Время:** ~12 мин на все onsite-ТС (параллельно до 18 машин).

---

## 4. Порядок операций после значительных изменений

### Сценарий A: Изменили геозоны в geo-admin

```
1. Recalculate (пересчёт) — достаточно если raw_monitoring хранит трек
   → НО raw_monitoring хранит только мета! Трек не сохраняется!

2. ⚠️ ЗНАЧИТ: нужен Refresh (полная перевыгрузка из TIS)
   → Заново fetch мониторинга → analyzeZones с новыми зонами → новые trips/KPI

3. После Refresh: Segment Fetch (force) для onsite-ТС
   → Сегменты тоже зависят от in_boundary → нужны новые зоны
```

**Gotcha:** Recalculate БЕСПОЛЕЗЕН для dump-trucks если изменились зоны, потому что `raw_monitoring` НЕ содержит GPS-трек (только `{trackPoints: N}`). В отличие от KIP, где monitoring_raw хранит полные данные. Это КРИТИЧЕСКАЯ разница между KIP и DT recalculate!

### Сценарий B: Изменили min_duration_sec для зоны

```
Та же проблема — нужен Refresh, не Recalculate
```

### Сценарий C: Добавили новый объект с зонами

```
1. Fetch за нужные даты — pipeline автоматически подхватит новый объект
2. Если даты уже загружены — Refresh
```

### Сценарий D: Fix бага в tripBuilder/kpiCalculator

```
1. Если raw_monitoring содержит track → Recalculate достаточно
2. Если нет track в raw_monitoring → Refresh
```

---

## 5. Gotchas и тонкости

### 5.1. raw_monitoring НЕ хранит GPS-трек (КРИТИЧНО)

```typescript
// shiftFetchJob.ts — что сохраняется:
rawMonitoring: {
  engineTime: monitoring.engineTime,
  movingTime: monitoring.movingTime,
  distance: monitoring.distance,
  trackPoints: monitoring.track?.length ?? 0,  // ТОЛЬКО ЧИСЛО!
  // track: monitoring.track   ← НЕ СОХРАНЯЕТСЯ
}
```

**Следствие:** `recalculateShift()` может пересчитать КПИ из метрик, но НЕ может заново запустить `analyzeZones()` (нет трека). Recalculate полезен только для пересчёта формул, не для пере-анализа зон.

**Рекомендация для рефакторинга:** Сохранять `track` в `raw_monitoring` (увеличение размера JSONB, но даёт полноценный Recalculate).

### 5.2. Recalculate DT — синхронный, KIP — асинхронный

```
DT:  POST /api/dt/admin/recalculate  → ждёт завершения, возвращает результат
KIP: POST /api/kip/admin/recalculate → возвращает сразу, нужен polling status
```

Admin-бэкенд обрабатывает это по-разному:
- `runKipRecalc()` — fire + poll `/api/admin/recalculate/status` каждые 10с
- `runDTRecalc()` — await fetch() напрямую (оба shift параллельно)

### 5.3. DT Fetch: 2 смены последовательно, не параллельно

```typescript
// admin/server.ts:runDTQueue
await fetch(`...?date=${date}&shift=shift1`);
await new Promise(r => setTimeout(r, 2000)); // HARDCODED 2s pause
await fetch(`...?date=${date}&shift=shift2`);
```

**Почему:** вероятно чтобы не перегружать TIS API. Но rate limiter уже есть per-vehicle.

### 5.4. Timeout различается: KIP 30 мин, DT 8 мин

```typescript
// admin/server.ts
KIP:  deadline = 30 * 60 * 1000  // 30 min
DT:   deadline = 8 * 60 * 1000   // 8 min
```

DT-pipeline для 20 ТС × 30с = 10 мин > 8 мин timeout. **Может timeout'иться на больших объектах!**

### 5.5. zone_events НЕ имеют FK на shift_records

```sql
-- zone_events — NO FOREIGN KEY!
-- DELETE по (vehicle_id, report_date, shift_type) — может оставлять orphans
```

При удалении shift_record из БД — trips каскадно удалятся (FK CASCADE), segments тоже (FK CASCADE), но zone_events останутся сиротами.

### 5.6. UNIQUE constraint в shift_records: 4 поля

```sql
UNIQUE (report_date, shift_type, vehicle_id, object_uid)
```

**Тонкость:** если ТС сменило объект при повторном fetch (ObjectDetector определил другой объект из-за новых зон) — создастся НОВАЯ запись, а старая останется. Получится 2 записи для одного ТС за одну смену.

### 5.7. Segment fetch fire-and-forget из shiftFetchJob

```typescript
// shiftFetchJob.ts — после основного pipeline:
runSegmentFetch({ shiftRecordIds, force: false })
  .catch(err => logger.error('Segment background error', err));
// Никакого уведомления о завершении!
```

UI не знает что сегменты загружаются автоматически после fetch. Нужен manual polling или автоматический запрос.

### 5.8. Refresh mode теряется при обновлении страницы

```typescript
// AdminPage.tsx
const [refreshMode, setRefreshMode] = useState(false);
// НЕ сохраняется в URL, localStorage или sessionStorage
```

### 5.9. DT coverage показывает только наличие, не полноту

```sql
-- Текущий запрос:
SELECT DISTINCT report_date FROM dump_trucks.shift_records WHERE ...
```

Не показывает:
- Сколько ТС обработано vs ожидалось
- Какие смены загружены
- Были ли ошибки
- Есть ли сегменты
- Какие объекты покрыты

### 5.10. Формат дат TIS API — ДВА РАЗНЫХ формата

```
getRouteListsByDateOut: DD.MM.YYYY
getRequests:            DD.MM.YYYY
getMonitoringStats:     DD.MM.YYYY HH:mm  ← С ВРЕМЕНЕМ!
```

### 5.11. Координаты: GeoJSON [lon,lat] vs TIS {lat,lon}

Код правильно конвертирует: `point([pt.lon, pt.lat])`. Но при добавлении нового кода — частый источник ошибок.

### 5.12. TripBuilder: каждая зона выгрузки только 1 раз

```typescript
// tripBuilder.ts — usedUnloadings: Set<number>
// Второй визит в ту же зону выгрузки → рейс теряется
```

### 5.13. ObjectDetector: на границе двух объектов — недетерминирован

Если одинаковое кол-во точек в двух dt_boundary — берётся первый по порядку итерации (зависит от SQL ORDER BY z.name).

### 5.14. TIS API 429 retry — до 150с backoff

```
5 попыток: 10с + 20с + 30с + 40с + 50с = 150с на один запрос
```

При массовой загрузке это может растянуть pipeline значительно.

---

## 6. Кросс-сервисные сессии (dump-trucks → geo-admin)

### Текущая сессия (sprint5-unified-analytics)

**Изменения в geo-admin из dump-trucks контекста:**

1. `geo-admin/server/migrations/003_zone_min_duration.sql` — новая колонка `min_duration_sec`
2. `geo-admin/server/src/repositories/zoneRepo.ts` — min_duration_sec в CRUD
3. `geo-admin/server/src/index.ts` — minDurationSec в POST/PUT routes
4. `geo-admin/client/src/api.ts` — min_duration_sec в типах и API calls
5. `geo-admin/client/src/sidebar.ts` — формы с minDurationSec, кнопки edit geometry/redraw
6. `geo-admin/client/src/map.ts` — startEditZone/stopEditZone/cancelEditZone
7. `geo-admin/client/src/main.ts` — wiring geometry edit + redraw flows
8. `geo-admin/client/src/leaflet-draw.d.ts` — типы для polygon.editing
9. `geo-admin/client/src/styles.css` — edit-controls floating bar

### Зависимость dump-trucks от geo-admin

```
dump-trucks (read-only) ──→ geo.objects  (uid, name, smu, timezone)
                         ──→ geo.zones   (geom, min_duration_sec)
                         ──→ geo.zone_tags (dt_boundary, dt_loading, dt_unloading)
```

**5 SQL-запросов в filterRepo.ts** читают из geo-схемы:
1. `getDtObjects()` — все объекты с dt_* зонами
2. `getDtZonesForObject(objectUid)` — зоны конкретного объекта
3. `getAllDtZones()` — все dt_* зоны (используется в pipeline)
4. `getObjectTimezones()` — Map<uid, timezone>
5. `getVehicleLastObjects()` — последний объект каждого ТС

### Зависимость admin от обоих

```
admin/server.ts ──→ PG: dump_trucks.shift_records (coverage check)
                ──→ PG: kip.vehicle_records + monitoring_raw
                ──→ HTTP: localhost:3002/api/dt/admin/* (trigger pipelines)
                ──→ HTTP: localhost:3001/api/admin/* (trigger KIP pipelines)
```

---

## 7. Схема данных покрытия (для рефакторинга)

### Что можно показать по dump-trucks за каждый день

Из существующих данных в shift_records:

```sql
SELECT
  report_date,
  shift_type,
  COUNT(*) AS vehicle_count,
  COUNT(*) FILTER (WHERE work_type = 'delivery') AS delivery_count,
  COUNT(*) FILTER (WHERE work_type = 'onsite') AS onsite_count,
  COUNT(*) FILTER (WHERE work_type = 'unknown') AS unknown_count,
  SUM(trips_count) AS total_trips,
  AVG(kip_pct)::numeric(5,1) AS avg_kip,
  array_agg(DISTINCT object_name) AS objects,
  -- Есть ли сегменты:
  COUNT(*) FILTER (WHERE id IN (
    SELECT DISTINCT shift_record_id FROM dump_trucks.shift_segments
  )) AS with_segments
FROM dump_trucks.shift_records
WHERE report_date BETWEEN $1 AND $2
GROUP BY report_date, shift_type
ORDER BY report_date, shift_type
```

### Предлагаемая структура покрытия

```typescript
interface DtDayCoverage {
  date: string;             // YYYY-MM-DD
  shift1: DtShiftCoverage | null;
  shift2: DtShiftCoverage | null;
}

interface DtShiftCoverage {
  vehicleCount: number;     // всего ТС
  deliveryCount: number;    // delivery
  onsiteCount: number;      // onsite
  unknownCount: number;     // unknown
  totalTrips: number;       // сумма рейсов
  avgKip: number;           // средний КПИ%
  objects: string[];        // названия объектов
  withSegments: number;     // ТС с загруженными сегментами
  hasErrors: boolean;       // были ли ошибки при загрузке
}
```

---

## 8. Рекомендации для рефакторинга admin-панели

### 8.1. Разделить покрытие KIP и DT на независимые блоки

Сейчас: единый календарь с наложенными индикаторами → путаница.
Предложение: два отдельных блока со своей семантикой.

### 8.2. Детализация DT-покрытия по кликабельным дням

Клик на день → popup/sidebar:
- shift1: N ТС, M рейсов, avg KIP X%, объекты [...]
- shift2: N ТС, M рейсов, avg KIP X%, объекты [...]
- Сегменты: загружены/нет
- Ошибки: список (из последнего fetch)

### 8.3. Документировать методы обновления прямо в UI

```
Помощь по кнопкам:
┌──────────────────────────────────────────────────────┐
│ 📥 Загрузить — первичная загрузка новых дат из TIS  │
│ 🔄 Перезагрузить — заново из TIS (после изменения   │
│    зон, исправления багов). Перезаписывает данные.   │
│ ♻️ Пересчитать — пересчёт формул БЕЗ запросов TIS   │
│    ⚠️ Для DT: работает только с метриками, трек     │
│    не сохраняется → для зон нужна Перезагрузка!      │
│ 📊 Сегменты — 30-мин детализация для onsite-ТС      │
│    Force: перезагрузить даже существующие сегменты   │
└──────────────────────────────────────────────────────┘
```

### 8.4. Сохранять GPS-трек в raw_monitoring

Текущий `raw_monitoring` хранит только `{engineTime, movingTime, distance, trackPoints: count}`.

Если сохранять `track: TisTrackPoint[]`, тогда Recalculate станет полноценным (пере-анализ зон без TIS). Это ~100KB на ТС/смену, ~2MB на день (20 ТС × 2 смены).

### 8.5. Унифицировать async/sync паттерн

DT recalculate — sync (blocking), KIP recalculate — async (polling). Admin-бэкенд вынужден обрабатывать их по-разному. Лучше: оба async + status polling.

### 8.6. Увеличить DT fetch timeout

Текущий 8 мин может timeout'иться при >16 ТС (16 × 30с = 8 мин). Рекомендация: 15-20 мин или адаптивный на основе кол-ва ТС.

### 8.7. Показывать pipeline progress в реальном времени

Сейчас admin polling видит только "shift_records появились". Нет информации о прогрессе (3/20 ТС обработано). Варианты:
- Progress endpoint на DT: `GET /api/dt/admin/fetch-status` → `{total: 20, processed: 3, current: "А021АТ172"}`
- SSE/WebSocket stream

### 8.8. Логирование ошибок fetch в БД

Сейчас ошибки pipeline попадают только в stdout (логи сервера). Для admin UI нужна таблица `dump_trucks.pipeline_runs`:

```sql
CREATE TABLE dump_trucks.pipeline_runs (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  shift_type VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status VARCHAR NOT NULL, -- 'running', 'ok', 'error'
  vehicles_total INT,
  vehicles_processed INT,
  vehicles_skipped INT,
  errors JSONB,
  triggered_by VARCHAR -- 'cron', 'admin-fetch', 'admin-refresh'
);
```

---

## 9. Текущее состояние очередей в admin

### Fetch queue (одна на все сервисы)

```typescript
fetchProgress = {
  active: boolean,
  service: 'kip' | 'dump-trucks' | null,  // только один сервис одновременно!
  queue: string[],      // ожидающие даты
  current: string,      // текущая дата
  startedAt: number,    // unix ms
  done: string[],       // завершённые
  errors: string[],     // ошибки
  cancelRequested: boolean
}
```

**Ограничение:** нельзя одновременно загружать KIP и DT. Нужно ждать завершения одного.

### Recalc queue (одна на все сервисы)

```typescript
recalcProgress = {
  active, service, queue, current, done, errors, cancelRequested
}
```

### Segment queue (только DT)

```typescript
segmentProgress = {
  active, current, startedAt, queue, done, errors, cancelRequested,
  results: SegmentDateResult[]  // per-date results after completion
}
```

---

## 10. Полный flow данных при "всё заново"

```
1. Создать/обновить зоны в geo-admin
   └→ geo.zones + geo.zone_tags

2. Admin → Refresh (перезагрузить) dump-trucks за диапазон
   └→ POST /api/admin/fetch/dump-trucks?from=...&to=...&refresh=true
   └→ admin:runDTQueue → для каждой даты:
      └→ POST :3002/api/dt/admin/fetch?date=X&shift=shift1
      └→ POST :3002/api/dt/admin/fetch?date=X&shift=shift2
      └→ DT pipeline × 2 смены:
         └→ TIS: getRouteListsByDateOut
         └→ TIS: getRequests
         └→ DB: getAllDtZones()  ← ЗДЕСЬ читаются новые зоны
         └→ Per vehicle: TIS getMonitoringStats → analyzeZones → detectObject → buildTrips → KPI
         └→ DB: upsert shift_records + replace trips + replace zone_events
         └→ fire-and-forget: runSegmentFetch() для onsite

3. Admin → Segment Fetch (force) — если нужны свежие сегменты
   └→ POST /api/admin/fetch-segments?from=...&to=...&force=true

4. Обновить страницу → проверить покрытие
```

**Полный цикл для 7 дней, 20 ТС: ~2-3 часа.**
