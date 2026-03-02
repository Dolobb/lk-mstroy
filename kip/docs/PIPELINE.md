# KIP — Pipeline Reference

## Схема

```
TIS API
  ↓ getRouteListsByDateOut (7 дней назад)
DailyFetchJob (kip/server/src/jobs/dailyFetchJob.ts)
  ↓ upsertRouteLists → route_lists, pl_calcs, vehicles
  ↓ buildVehicleTasks + interleaveTasks (plParser.ts)
  ↓ getRequests (2 месяца назад) → upsertRequests → requests
  ↓ for each VehicleTask:
       getMonitoringStats(idMO, shift.from, shift.to)
         ↓ parseMonitoringStats (monitoringParser.ts)
         ↓ analyzeTrackGeozones (geozoneAnalyzer.ts)
         ↓ matchFuelNorm (vehicleFilter.ts / vehicleRegistry.ts)
         ↓ calculateKpi (kpiCalculator.ts)
         ↓ upsertVehicleRecord → vehicle_records
PostgreSQL 16 (kip_vehicles)
  ↓ GET /api/vehicles/weekly
API (kip/server/src/index.ts)
  ↓
React UI (VehicleMap + VehicleDetailTable)
```

---

## 1. Источник данных: TIS API

### Протокол

Все запросы — **POST с пустым телом**, параметры только в query string:

```
POST {TIS_API_URL}?token=...&format=json&command={cmd}&{params}
```

Реализация: `kip/server/src/services/tisClient.ts:39–97`

### Команды

| Команда | Параметры | Формат дат |
|---------|-----------|-----------|
| `getRequests` | `fromDate`, `toDate` | `DD.MM.YYYY` |
| `getRouteListsByDateOut` | `fromDate`, `toDate` | `DD.MM.YYYY` |
| `getMonitoringStats` | `idMO`, `fromDate`, `toDate` | `DD.MM.YYYY HH:MM` |

> Формат дат для `getMonitoringStats` отличается! Реализация: `tisClient.ts:128–132` использует `formatDateTimeParam()`.

### Ответ

Все команды возвращают `{ list: [...] }`, кроме `getMonitoringStats` — она возвращает объект напрямую.

### Rate Limiting

- **1 запрос/30с на один `idMO`** (ТС)
- 18 токенов, round-robin ротация (`TokenPool`, `kip/server/src/services/tokenPool.ts`)
- На 429 — линейный backoff: 10s, 20s, 30s, ... до 5 попыток (`tisClient.ts:19`)
- На таймаут — экспоненциальный backoff: 1s, 2s, 4s до 3 попыток (`tisClient.ts:21`)
- На 404 — возвращает `null` (ТС не в мониторинге), не является ошибкой

**Per-vehicle rate limiter** (`kip/server/src/services/rateLimiter.ts`): хранит `Map<idMO, lastCallTimestamp>`, перед каждым запросом выдерживает интервал.

---

## 2. DailyFetchJob (`kip/server/src/jobs/dailyFetchJob.ts:17`)

### Запуск

Автоматически в **07:30 Asia/Yekaterinburg** (UTC+5) через node-cron (`kip/server/src/jobs/scheduler.ts:7`):
```ts
cron.schedule('30 7 * * *', async () => { ... }, { timezone: 'Asia/Yekaterinburg' });
```

Вручную: `POST /api/admin/fetch?date=YYYY-MM-DD` — запускает асинхронно, возвращает `{ status: 'started' }` сразу (`index.ts:189–203`).

### Порядок шагов (`dailyFetchJob.ts:34–152`)

**Шаг 1** — Fetch ПЛ за 7 дней назад от targetDate (`dailyFetchJob.ts:35–39`):
```ts
const plFrom = dayjs(targetDate).subtract(7, 'day').toDate();
const routeLists = await client.getRouteListsByDateOut(plFrom, plTo);
```

**Шаг 2** — Сохранить ПЛ в БД: `upsertRouteLists(routeLists)` → `route_lists`, `pl_calcs`, `vehicles`

**Шаг 3** — Построить задачи (`dailyFetchJob.ts:46–48`):
```ts
const tasks = buildVehicleTasks(routeLists);   // filter → split shifts
const interleaved = interleaveTasks(tasks);    // round-robin by idMO
```
`interleaveTasks` перемежает задачи разных ТС: `[A, B, C, A, B, C, ...]` вместо `[A, A, B, B, C, C]` — это минимизирует ожидание rate limiter.

**Шаг 4** — Fetch заявок за 2 месяца (`dailyFetchJob.ts:55–73`), сохранить в `requests`. Ошибка здесь не останавливает обработку ТС.

**Шаг 5** — Последовательная обработка каждого VehicleTask (`dailyFetchJob.ts:80–148`):
1. `getMonitoringStats(idMO, shift.from, shift.to)`
2. `parseMonitoringStats(stats)` → `engineOnTime`, `fuelConsumedTotal`, `lastLat/Lon`, `fullTrack`
3. `analyzeTrackGeozones(fullTrack)` → `totalStayTime`, `departmentUnit`
4. Fallback геозоны (см. ниже ⚠️)
5. `matchFuelNorm(regNumber)` → норма топлива из vehicle-registry
6. `calculateKpi({total_stay_time, engine_on_time, fuel_consumed_total, fuel_rate_norm})`
7. `upsertVehicleRecord(...)` → `vehicle_records`

Ошибка отдельного ТС логируется, но не останавливает цикл.

---

## 3. VehicleFilter + PlParser (`kip/server/src/services/plParser.ts`, `vehicleFilter.ts`)

### Фильтрация ТС (`vehicleFilter.ts:8–10`)

Только ТС из `vehicle-registry.json` проходят через pipeline:
```ts
export function filterVehicles(vehicles): TisRouteListVehicle[] {
  return vehicles.filter(v => isRegistered(v.regNumber));
}
```

### Извлечение номера заявки (`plParser.ts:11–23`)

Из поля `calcs[].orderDescr` (формат: `"№121613/1 от 26.01.2026. ДСУ..."`) извлекается номер заявки:
```ts
const REQUEST_NUMBER_REGEX = /(?:заявк[аеиу]\s*(?:№|#|N)?\s*(\d+))|(?:(?:№|#)\s*(\d+))/i;
```
Fallback: первое число из 3+ цифр в строке.

---

## 4. ShiftSplitter (`kip/server/src/services/shiftSplitter.ts:32`)

**Смены:**
- Утренняя (`morning`): 07:30 – 19:30 (report_date = тот же день)
- Вечерняя (`evening`): 19:30 – 07:30 следующего дня (report_date = день начала вечерней смены)

**Логика (`shiftSplitter.ts:37–72`):**
- Старт с дня ДО `dateOutPlan` (чтобы поймать вечернюю смену, пересекающую полночь)
- Для каждого дня в диапазоне проверяет пересечение PL-периода с утренним и вечерним окнами
- Если есть пересечение (`from < to`) — создаёт `ShiftWindow`

```ts
// Пример: ПЛ с 08.02 08:00 по 09.02 08:00 → 3 смены:
// morning 08.02: 08:00 → 19:30
// evening 08.02: 19:30 → 07:30 (09.02)
// morning 09.02: 07:30 → 08:00
```

**Правило полуночи (`shiftSplitter.ts:29`):** Период 00:00–07:30 относится к вечерней смене **предыдущего** дня — это обрабатывается естественно, т.к. evening всегда 19:30 день X → 07:30 день X+1.

Границы смен загружаются из `kip/config/shifts.json` через `loadShiftConfig()`.

---

## 5. MonitoringParser (`kip/server/src/services/monitoringParser.ts:54`)

**Назначение:** Парсинг ответа `getMonitoringStats` в структурированный `ParsedMonitoringRecord`.

**Ключевые поля ответа TIS API:**
- `stats.engineTime` (секунды) → `engineOnTime` (часы): `secondsToHours(stats.engineTime)`
- `stats.fuels[].rate` — расход топлива в литрах за период; суммируется по всем бакам (`monitoringParser.ts:60–63`)
- `stats.track[]` — GPS-точки, поле `time` (не `timestamp`!) формата `"DD.MM.YYYY HH:mm:ss"`
- `stats.parkings[]` — стоянки, поля `begin`/`end` (не `start`/`end`!)

**Упрощение трека (`monitoringParser.ts:18–52`):**
Функция `simplifyTrack` оставляет точки с интервалом >= 20 минут + первую и последнюю точку. Упрощённый трек сохраняется в `vehicle_records.track_simplified` для отображения на карте без перегрузки.

**fullTrack** — полный трек (все точки) — используется для геозонного анализа, в БД не хранится.

**Последняя GPS-точка** (`monitoringParser.ts:65–68`): последняя точка трека → `lastLat`/`lastLon` → координаты маркера на карте.

---

## 6. GeozoneAnalyzer (`kip/server/src/services/geozoneAnalyzer.ts:103`)

**Назначение:** Анализ нахождения ТС в рабочих геозонах. Определяет суммарное время в зонах (`totalStayTime`) и подразделение (`departmentUnit`).

**Библиотека:** Turf.js (`@turf/boolean-point-in-polygon`, `@turf/helpers`)

**Загрузка геозон (`geozoneAnalyzer.ts:34–72`):**
Из `kip/config/geozones.geojson` загружаются зоны с фильтром:
```ts
f.properties?.controlType === 1 &&
f.geometry?.type === 'Polygon' &&
f.properties?.zoneName?.startsWith('СМУ')
```
Геозоны кешируются в памяти (`cachedZones`, `geozoneAnalyzer.ts:24`).

**Координаты (`geozoneAnalyzer.ts:79`):** GeoJSON — `[longitude, latitude]`, TIS-трек — `{lat, lon}`. Turf ожидает `[lon, lat]`:
```ts
const pt = point([lon, lat]); // GeoJSON: [longitude, latitude]
```

**Алгоритм анализа (`geozoneAnalyzer.ts:129–167`):**

Для каждой пары соседних точек трека (интервал `i` → `i+1`):
1. Оба в одной зоне → весь интервал засчитывается зоне
2. Оба в разных зонах → интервал делится 50/50 между зонами
3. Вошли в зону (z0=null, z1=zone) → 50% зоне, 50% вне
4. Вышли из зоны (z0=zone, z1=null) → 50% зоне, 50% вне, регистрируется `zoneExit`
5. Оба вне зон → весь интервал `outsideMs`

> ⚠️ **50/50 split при пересечении границы геозоны** (`geozoneAnalyzer.ts:146–160`): При переходе ТС через границу геозоны точное время пересечения неизвестно, поэтому интервал делится поровну. Это приближение — чем реже точки трека, тем выше погрешность. При интервале трека 20 минут (после simplifyTrack) максимальная погрешность на одно пересечение может достигать 10 минут.

**Результат:**
- `totalStayTime` — сумма часов во всех зонах
- `departmentUnit` — зона с наибольшим временем (по `zoneBreakdown[0]`)
- `zoneBreakdown` — детализация по зонам, отсортировано по убыванию времени
- `zoneExits` — события выхода из зон (timestamp + название зоны)

**Fallback при пустом треке / зонах не найдено:**

`geozoneAnalyzer.ts` возвращает `totalStayTime = 0` когда:
- `zones.length === 0` (файл геозон не найден) — условие `geozoneAnalyzer.ts:116`
- `track.length < 2` (меньше 2 точек GPS) — условие `geozoneAnalyzer.ts:116`
- Трек есть, но ни одна точка не попала ни в одну зону — `totalStayTime` будет 0

В этих случаях в `dailyFetchJob.ts:98–100` применяется fallback:

> ⚠️ **Fallback геозоны** (`dailyFetchJob.ts:98–100`): Если геозонный анализ вернул `totalStayTime = 0` (нет треков, трек слишком короткий, или ТС не пересекало ни одну зону), то `totalStayTime` заменяется на `monitoring.engineOnTime`:
> ```ts
> const totalStayTime = geozoneResult.totalStayTime > 0
>   ? geozoneResult.totalStayTime
>   : monitoring.engineOnTime; // fallback if no zones matched or track empty
> ```
> Это приводит к `utilization_ratio = 100%` (в `calculateKpi`: `engine_on_time / total_stay_time = 1`). Таким образом ТС без GPS-покрытия в геозонах получают завышенный КИП.

---

## 7. KpiCalculator (`kip/server/src/services/kpiCalculator.ts:12`)

**Назначение:** Расчёт всех KPI-показателей из входных параметров одной смены.

**Входные параметры:**
| Параметр | Единица | Источник |
|---------|---------|---------|
| `total_stay_time` | часы | `geozoneResult.totalStayTime` или fallback `engineOnTime` |
| `engine_on_time` | часы | `stats.engineTime / 3600` |
| `fuel_consumed_total` | литры | `sum(stats.fuels[].rate)` |
| `fuel_rate_norm` | л/ч | из `vehicle-registry.json` через `matchFuelNorm()` |

**Формулы (`kpiCalculator.ts:20–50`):**

```ts
// Фактический расход топлива (л/ч)
fuel_rate_fact = engine_on_time > 0
  ? fuel_consumed_total / engine_on_time
  : 0;

// Максимально допустимое рабочее время (учитывает 2 ч/день на ТО)
max_work_allowed = total_stay_time * (22 / 24);

// Максимальный расход при нормативном потреблении
fuel_max_calc = engine_on_time * fuel_rate_norm;

// Соотношение факт/норма топлива
fuel_variance = fuel_rate_norm > 0
  ? fuel_rate_fact / fuel_rate_norm
  : 0;

// ЗАГРУЗКА (load_efficiency_pct) — % от нормативного расхода
load_efficiency_pct = fuel_rate_norm > 0
  ? (fuel_rate_fact / fuel_rate_norm) * 100
  : 0;

// КИП (utilization_ratio) — % использования времени в зоне
utilization_ratio = total_stay_time > 0
  ? Math.min(engine_on_time / total_stay_time, 1) * 100
  : 0;

// Простой
idle_time = Math.max(0, total_stay_time - engine_on_time);
```

Все значения зажаты в `Math.max(0, ...)`.

### Цветовые пороги

#### Карта — `VehicleMap` + `FilterPanel` (3 цвета)

Используется `getKpiColor()` из `kip/client/src/utils/kpi.ts:3`:

| Цвет | Код | Условие (utilization_ratio) |
|------|-----|-----------------------------|
| GREEN | `#00C853` | >= 75% |
| BLUE | `#0000FF` | >= 50% и < 75% |
| RED | `#FF0000` | < 50% |

Применяется: маркеры на карте, цветные точки в поиске ТС, средний КИП в FilterPanel.

#### Таблица — `VehicleDetailTable` (4 цвета)

Используется `getKipColor()` из `kip/client/src/components/VehicleDetailTable.tsx:33`:

| Цвет | Код | Условие (utilization_ratio) |
|------|-----|-----------------------------|
| GREEN | `#22c55e` | >= 75% |
| BLUE | `#3b82f6` | >= 50% и < 75% |
| YELLOW | `#eab308` | >= 25% и < 50% |
| RED | `#ef4444` | < 25% |

Применяется: ячейки КИП в сводной таблице по дням/сменам.

> ⚠️ **Две разные цветовые схемы**: карта использует 3 цвета (порог RED на 50%), таблица — 4 цвета (порог RED на 25%). Это намеренно: карта даёт быстрый обзор, таблица — детализированный анализ. Не унифицировать без обсуждения.

**Загрузка (load_efficiency_pct)** в таблице окрашивается бинарно (`VehicleDetailTable.tsx:43`):
- < 50% → RED `#ef4444`
- >= 50% → GREEN `#22c55e`

---

## 8. База данных (PostgreSQL 16, `kip_vehicles`)

### Подключение

```bash
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles
```

Конфигурация БД: `kip/server/src/config/database.ts`, переменные из `.env`.

### Таблицы (001_init.sql)

| Таблица | PK | Назначение |
|---------|-----|-----------|
| `requests` | SERIAL, `UNIQUE(request_id)` | Заявки из TIS API (raw_json JSONB) |
| `route_lists` | SERIAL, `UNIQUE(pl_id)` | Путевые листы |
| `pl_calcs` | SERIAL, FK→route_lists | Задания ПЛ (extracted_request_number) |
| `vehicles` | SERIAL, FK→route_lists | ТС в ПЛ (id_mo, reg_number) |
| `vehicle_records` | SERIAL, `UNIQUE(report_date, shift_type, vehicle_id)` | Расчётные KPI по сменам |
| `_migrations` | name | Tracking применённых миграций |

### Схема `vehicle_records`

```sql
report_date         DATE
shift_type          VARCHAR(20)        -- 'morning' / 'evening'
vehicle_id          VARCHAR(20)        -- reg_number (госномер)
vehicle_model       VARCHAR(200)
company_name        VARCHAR(200)
department_unit     VARCHAR(200)       -- из геозоны (СМУ название)
total_stay_time     NUMERIC(8,4)       -- часы (геозоны или fallback)
engine_on_time      NUMERIC(8,4)       -- часы
idle_time           NUMERIC(8,4)       -- часы
fuel_consumed_total NUMERIC(10,4)      -- литры
fuel_rate_fact      NUMERIC(10,4)      -- л/ч
max_work_allowed    NUMERIC(8,4)       -- часы
fuel_rate_norm      NUMERIC(10,4)      -- л/ч (из vehicle-registry)
fuel_max_calc       NUMERIC(10,4)      -- литры
fuel_variance       NUMERIC(10,4)      -- коэффициент
load_efficiency_pct NUMERIC(6,2)       -- %
utilization_ratio   NUMERIC(6,2)       -- % (КИП)
latitude            NUMERIC(10,7)      -- последняя GPS-точка
longitude           NUMERIC(10,7)
track_simplified    JSONB              -- [{lat, lon, timestamp}, ...]
```

### Upsert логика

`vehicle_records` использует `ON CONFLICT (report_date, shift_type, vehicle_id) DO UPDATE SET ...` — при повторном запуске pipeline данные перезаписываются. Реализация: `vehicleRecordRepo.ts:248–302`.

`route_lists` — `ON CONFLICT (pl_id) DO NOTHING` (ПЛ не меняются после создания).

`requests` — `ON CONFLICT (request_id) DO UPDATE SET ...` (статус заявки может измениться).

### ⚠️ NUMERIC → Number()

> ⚠️ **PostgreSQL NUMERIC возвращается как string в Node.js** (`vehicleRecordRepo.ts:35–42`): PostgreSQL тип `NUMERIC` (точная десятичная арифметика) возвращается драйвером `pg` как JavaScript-строка, а не число. Если не конвертировать — любые арифметические операции дадут `NaN` или конкатенацию строк вместо чисел.
>
> Решение — функция `coerceNumericFields`:
> ```ts
> function coerceNumericFields(row: Record<string, unknown>): VehicleRecordRow {
>   for (const field of NUMERIC_FIELDS) {
>     if (row[field] != null) {
>       row[field] = Number(row[field]);  // ← строка → число
>     }
>   }
>   return row as unknown as VehicleRecordRow;
> }
> ```
> Список `NUMERIC_FIELDS` (`vehicleRecordRepo.ts:27–33`): `total_stay_time`, `engine_on_time`, `idle_time`, `fuel_consumed_total`, `fuel_rate_fact`, `max_work_allowed`, `fuel_rate_norm`, `fuel_max_calc`, `fuel_variance`, `load_efficiency_pct`, `utilization_ratio`, `latitude`, `longitude`.
>
> Аналогичная функция `coerceWeeklyRow` (`vehicleRecordRepo.ts:119–124`) применяется к агрегированным данным.

---

## 9. API Endpoints (`kip/server/src/index.ts`)

| Метод | Путь | Параметры | Описание |
|-------|------|-----------|---------|
| `GET` | `/api/health` | — | Health check: `{ status: 'ok' }` |
| `GET` | `/api/vehicles` | `date`, `shift?` | Устаревший: записи за одну дату |
| `GET` | `/api/vehicles/weekly` | `from`, `to`, `shift?`, `branch[]?`, `type[]?`, `department[]?`, `kpiRange[]?` | Агрегированные данные ТС для карты (основной) |
| `GET` | `/api/vehicles/:id/details` | `from`, `to` | Детальные записи по дням/сменам для ТС |
| `GET` | `/api/vehicles/:id/requests` | `from`, `to` | Заявки для ТС |
| `GET` | `/api/filters` | `from`, `to`, `branch[]?`, `type[]?` | Варианты для каскадных фильтров |
| `GET` | `/api/geozones` | — | GeoJSON геозон для карты |
| `POST` | `/api/admin/fetch` | `date` (YYYY-MM-DD) | Ручной запуск pipeline (async) |

### `/api/vehicles/weekly` — основной эндпоинт

Агрегирует `vehicle_records` за период с усреднением KPI (`AVG`). Последние координаты берутся из самой свежей записи с не-null координатами. Фильтрация по branch/type происходит в памяти через vehicle-registry (эти поля не хранятся в БД).

Обогащение ответа:
- `vehicle_type`, `branch` — из `vehicle-registry.json`
- `request_numbers` — JOIN через `vehicles → route_lists → pl_calcs`

---

## 10. Конфигурация (`kip/config/`)

| Файл | Назначение |
|------|-----------|
| `vehicle-registry.json` | ~170 ТС: `{regNumber, type, branch, fuelNorm}`. Основной регистр. |
| `geozones.geojson` | Полигоны рабочих площадок (экспорт из fleetradar). Фильтр: `controlType=1, zoneName.startsWith('СМУ')`. |
| `vehicle-types.json` | Типы ТС с ключевыми словами — использовался для фильтрации (сейчас фильтрация через registry) |
| `shifts.json` | Границы смен: `morning: {start: "07:30", end: "19:30"}`, `evening: {start: "19:30", end: "19:30"}` |
| `fuel-norms.json` | Устаревший файл норм топлива по модели ТС. Заменён полем `fuelNorm` в vehicle-registry. |

---

## 11. Ссылки

- Примеры TIS API запросов: `kip/API_REQUEST_EXAMPLES.md`
- Схема БД и SQL-примеры: `kip/референсы и работа с агентом/DatabaseStructure.md`
- Полная архитектура: `kip/референсы и работа с агентом/Architecture.md`
