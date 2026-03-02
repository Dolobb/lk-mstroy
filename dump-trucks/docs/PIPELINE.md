# Dump Trucks — Pipeline Reference

## Общая схема

```
TIS API
  ├── getRouteListsByDateOut (7 дней)  →  ParsedPL[]
  ├── getRequests (2 месяца)           →  upsert dump_trucks.requests
  └── getMonitoringStats (per vehicle) →  TisMonitoringStats
                                             ↓
                                      ZoneAnalyzer
                                      (Turf.js booleanPointInPolygon)
                                             ↓
                                      ZoneEvent[]
                                             ↓
                                      ObjectDetector / VehicleDetector
                                      (max track points в dt_boundary)
                                             ↓
                                      TripBuilder
                                      (пары loading → unloading)
                                             ↓
                                      Trip[]
                                             ↓
                                      WorkTypeClassifier
                                             ↓
                                      KpiCalculator
                                             ↓
                              DB Transaction (upsert/replace)
                              ├── shift_records (INSERT ON CONFLICT DO UPDATE)
                              ├── trips (DELETE + INSERT)
                              └── zone_events (DELETE + INSERT)
```

---

## 1. Источник данных: TIS API

Клиент: `dump-trucks/server/src/services/tisClient.ts`

- **Протокол:** POST с пустым телом, все параметры в query string
- **URL:** `POST {TIS_API_URL}?token=...&format=json&command={cmd}&{params}`
- **Токены:** пул из 18 токенов, ротация round-robin (класс `TokenPool`)
- **Rate limit:** 1 запрос / 30 сек на один idMO (класс `PerVehicleRateLimiter`)
- **Retry 429:** до 5 попыток с backoff (base 10 сек × номер попытки)
- **Retry timeout:** до 3 попыток с экспоненциальным backoff (1, 2, 4 сек)
- **404:** возвращает `null` без ошибки

### Используемые команды

| Команда | Параметры | Описание |
|---------|-----------|----------|
| `getRouteListsByDateOut` | `fromDate`, `toDate` (DD.MM.YYYY) | Путевые листы |
| `getRequests` | `fromDate`, `toDate` (DD.MM.YYYY) | Заявки TIS |
| `getMonitoringStats` | `idMO`, `fromDate`, `toDate` (DD.MM.YYYY HH:mm) | Мониторинг + трек |

> Формат дат для `getMonitoringStats` — `DD.MM.YYYY HH:mm` (не DD.MM.YYYY!).
> Формат дат для ПЛ и заявок — `DD.MM.YYYY`.

---

## 2. Планировщик (`scheduler.ts`)

Автоматический запуск через `node-cron`, часовой пояс `Asia/Yekaterinburg`:

| Время | Действие |
|-------|----------|
| `08:30` | `runShiftFetch(вчера, 'shift2')` — закрытие ночной смены |
| `20:30` | `runShiftFetch(сегодня, 'shift1')` — закрытие дневной смены |

---

## 3. ShiftFetchJob (`shiftFetchJob.ts`)

Основной pipeline для одной даты + смены. Точка входа: `runShiftFetch(dateStr, shiftType)`.

**Шаг 1: Fetch ПЛ за 7 дней**

```
fromDate = dateStr − 7 дней
toDate   = dateStr
→ client.getRouteListsByDateOut(fromDate, toDate) → TisRouteList[]
```

При ошибке: pipeline прерывается, возвращает результат с `errors`.

**Шаг 2: Парсинг ПЛ (`plParser.ts`)**

Функция `parsePLs(routeLists, testIdMos)`:
- Фильтрует ТС: в тест-режиме по `testIdMos`, в обычном — по `nameMO.toLowerCase().includes('самосвал')`
- Извлекает `requestNumbers` из `calcs[].orderDescr` через regex `^(\d+)` (после удаления ведущего `№`)
- Пример: `"№120360/1 от 31.12.2025..."` → `120360`
- ПЛ без подходящих ТС пропускаются

**Шаг 3: Fetch заявок за 2 месяца**

```
reqFrom = dateStr − 2 месяца
→ client.getRequests(reqFrom, toDate) → TisRequest[]
→ parseRequests() → upsertRequests(pool, ...)
```

Ошибка не критична: логируется, pipeline продолжается.

**Шаг 4: Загрузка dt_* зон**

```
→ getAllDtZones(pool) → GeoZone[]
```

Зоны с тегами `dt_boundary`, `dt_loading`, `dt_unloading` из схемы `geo`. Геометрия через `ST_AsGeoJSON`, парсится в GeoJSON Feature.

При ошибке или 0 зон: pipeline прерывается.

**Шаг 5: Формирование списка ТС**

В **тест-режиме** (`DT_TEST_ID_MOS` задан):
- Берутся idMO из конфига, метаданные `TestVehicle-{idMO}`
- Если ТС найдено в ПЛ — данные обновляются реальными значениями (regNumber, nameMO, plId, requestNumbers)

В **обычном режиме**:
- Перебираются ПЛ → ТС из ПЛ, у которых есть нужная смена (через `splitIntoShifts`)
- Первый ПЛ для idMO используется (дубликаты пропускаются)

**Шаг 6: Обработка каждого ТС (последовательно)**

Для каждого idMO:

1. `getMonitoringStats(idMO, shiftStart, shiftEnd)` → `TisMonitoringStats | null`
2. `analyzeZones(track, allZones)` → `ZoneEvent[]`
3. `detectObject(track, allZones)` → `ObjectCandidate | null`
4. Если нет объекта и нет zone events → ТС пропускается
5. Фильтр zone events по `objectUid`
6. `buildTrips(objectZoneEvents)` → `Trip[]`
7. `calcOnsiteSec(objectZoneEvents, objectUid)` → `onsiteSec`
8. `classifyWorkType(engineTime, onsiteSec, trips)` → `WorkType`
9. `calculateKpi(...)` → `ShiftKpi`
10. DB-транзакция: `upsertShiftRecord` + `replaceTrips` + `replaceZoneEvents`

---

## 4. ZoneAnalyzer (`zoneAnalyzer.ts`)

**Назначение:** определение периодов нахождения ТС в каждой геозоне на основе GPS-трека.

**Алгоритм:**

Для каждой зоны итерируется трек по точкам:
- Вход: `booleanPointInPolygon(point, zone.geojson) = true` при `insideFrom === null` → фиксируется `enteredAt`
- Выход: условие меняется на `false` → вычисляется `durationSec`, создаётся `ZoneEvent`
- Трек закончился внутри зоны: создаётся event с `exitedAt = lastTrackPointTime`

Результат сортируется по `enteredAt`.

Вспомогательная функция `calcOnsiteSec(events, objectUid)`: суммирует `durationSec` для событий с тегом `dt_boundary` по нужному объекту.

> Библиотека: `@turf/boolean-point-in-polygon` (Turf.js). Координаты: `[lon, lat]` (GeoJSON-порядок).

---

## 5. VehicleDetector / ObjectDetector (`vehicleDetector.ts`)

**Назначение:** определение, на каком строительном объекте работал ТС в данную смену.

**Алгоритм (`detectObject`):**

1. Берутся все зоны с тегом `dt_boundary`
2. Для каждой зоны считается кол-во трек-точек внутри неё (`booleanPointInPolygon`)
3. Возвращается объект с **максимальным** `pointsInside`
4. Если ни одна точка не попала ни в одну зону — возвращается `null`

**Возвращает `ObjectCandidate`:**
```typescript
{ objectUid, objectName, boundaryZone: GeoZone, pointsInside: number }
```

> ⚠️ **ObjectDetector: может ошибиться на границе двух объектов.** Если ТС работало между двумя объектами и у каждого одинаковое кол-во точек трека в `dt_boundary`, выбор становится неопределённым (берётся первый по порядку итерации). Реальный сценарий ошибки: ТС переехало с одного объекта на другой внутри одной смены — будет присвоен тот объект, где ТС провело больше времени. (`vehicleDetector.ts:30–60`)

---

## 6. TripBuilder (`tripBuilder.ts`)

**Назначение:** построение рейсов (пар погрузка → выгрузка) из событий зон.

**Алгоритм:**

1. Фильтрация событий погрузки: `zoneTag === 'dt_loading'` И `durationSec >= 180` (3 мин)
2. Фильтрация событий выгрузки: `zoneTag === 'dt_unloading'` И `durationSec >= 180` (3 мин)
3. Сортировка погрузок по `exitedAt` (выход из зоны погрузки = момент отправки)
4. Для каждой погрузки ищется ближайшая неиспользованная выгрузка после неё:
   - `unloading.enteredAt > loading.exitedAt`
   - Длительность рейса от `loading.enteredAt` до `unloading.exitedAt` <= 4 часа
   - Берётся первая подходящая (по порядку)
5. Найденная выгрузка помечается как использованная (`usedUnloadings: Set<number>`)

**Пороги (захардкожены в `tripBuilder.ts:21-23`):**

| Константа | Значение | Смысл |
|-----------|----------|-------|
| `MIN_LOADING_DWELL_SEC` | 180 (3 мин) | Минимальное время в зоне погрузки |
| `MIN_UNLOADING_DWELL_SEC` | 180 (3 мин) | Минимальное время в зоне выгрузки |
| `MAX_TRIP_DURATION_MIN` | 240 (4 ч) | Максимальная длительность рейса |

Поля `Trip.distanceKm` и `Trip.volumeM3` всегда `null` — не реализованы.

> ⚠️ **TripBuilder "каждая зона выгрузки 1 раз":** каждое событие выгрузки может быть использовано в максимум одном рейсе (`usedUnloadings: Set`). Если ТС посетило одну и ту же зону выгрузки дважды в рамках одной смены, второй визит не попадёт в рейс. Это намеренное ограничение против двойного матчинга, но оно приводит к потере реального рейса при повторном посещении одной зоны выгрузки. (`tripBuilder.ts:37-68`)

> Примечание: фильтр 3 минут в зонах выгрузки защищает от транзитных проездов (специфика Тобольска — зона выгрузки стоит между зонами погрузки, ТС проезжает через неё).

---

## 7. WorkTypeClassifier (`workTypeClassifier.ts`)

**Назначение:** классификация типа работы ТС за смену.

**Логика:**

```
if trips.length > 0:
    → "delivery"
else if engineTimeSec > 0 AND (onsiteSec / engineTimeSec) * 100 >= 60:
    → "onsite"
else:
    → "unknown"
```

Порог `onsite`: 60% времени двигателя в зоне `dt_boundary`. Настраивается параметром `onsitePctThreshold` (дефолт 60).

---

## 8. KpiCalculator (`kpiCalculator.ts`)

**Формулы:**

```
shiftDurationSec = max(1, shiftEnd - shiftStart)
kipPct           = min(100, (engineTimeSec / shiftDurationSec) * 100)
movementPct      = min(100, (movingTimeSec / engineTimeSec) * 100)   [0 если engineTimeSec == 0]
onsiteMin        = round(onsiteSec / 60)
tripsCount       = trips.length
factVolumeM3     = sum(trip.volumeM3 ?? 0)  [всегда 0, т.к. volumeM3 = null]
```

**Цветовая кодировка КИП (из ARCHITECTURE.md):**

| КИП % | Цвет | Значение |
|-------|------|----------|
| < 50 | RED | Низкая утилизация |
| 50–75 | BLUE | Средняя |
| >= 75 | GREEN | Хорошая |

---

## 9. База данных

**PostgreSQL 17, порт 5433, база `mstroy`, пользователь `max`**

### Схема `dump_trucks`

#### `shift_records` — основная KPI-таблица

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `report_date` | DATE | Рабочая дата (дата начала смены) |
| `shift_type` | VARCHAR | `shift1` / `shift2` |
| `vehicle_id` | INTEGER | idMO из TIS |
| `reg_number` | VARCHAR | Гос. номер |
| `name_mo` | VARCHAR | Наименование ТС в TIS |
| `object_uid` | VARCHAR | UID объекта (из geo.objects) |
| `object_name` | VARCHAR | Название объекта |
| `work_type` | VARCHAR | `delivery` / `onsite` / `unknown` |
| `shift_start` | TIMESTAMP | Начало смены (07:30 или 19:30) |
| `shift_end` | TIMESTAMP | Конец смены (19:30 или 07:30+1) |
| `engine_time_sec` | INTEGER | Моточасы (секунды) |
| `moving_time_sec` | INTEGER | Время движения (секунды) |
| `distance_km` | NUMERIC(10,2) | Пробег |
| `onsite_min` | INTEGER | Время на объекте в dt_boundary (минуты) |
| `trips_count` | INTEGER | Кол-во рейсов |
| `fact_volume_m3` | NUMERIC(10,2) | Объём факт (всегда 0) |
| `kip_pct` | NUMERIC(5,2) | КИП % |
| `movement_pct` | NUMERIC(5,2) | % движения |
| `pl_id` | INTEGER | ID путевого листа TIS |
| `request_numbers` | INTEGER[] | Массив номеров заявок |
| `raw_monitoring` | JSONB | Сводка мониторинга: `{engineTime, movingTime, distance, trackPoints}` |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | Обновляется при каждом upsert |

**UNIQUE constraint:** `(report_date, shift_type, vehicle_id, object_uid)`

#### `trips` — рейсы

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `shift_record_id` | BIGINT FK | → `shift_records.id` ON DELETE CASCADE |
| `trip_number` | INTEGER | Порядковый номер рейса в смене (1, 2, 3...) |
| `loaded_at` | TIMESTAMP | Выход из зоны погрузки |
| `unloaded_at` | TIMESTAMP | Выход из зоны выгрузки |
| `loading_zone` | VARCHAR | Название зоны погрузки |
| `unloading_zone` | VARCHAR | Название зоны выгрузки |
| `duration_min` | INTEGER | Длительность рейса (мин) |
| `distance_km` | NUMERIC(8,2) | Пробег (всегда null) |
| `volume_m3` | NUMERIC(8,2) | Объём (всегда null) |

#### `zone_events` — события зон

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `vehicle_id` | INTEGER | idMO |
| `report_date` | DATE | |
| `shift_type` | VARCHAR | |
| `zone_uid` | VARCHAR | UID зоны из `geo.zones` |
| `zone_name` | VARCHAR | |
| `zone_tag` | VARCHAR | `dt_boundary` / `dt_loading` / `dt_unloading` |
| `object_uid` | VARCHAR | |
| `entered_at` | TIMESTAMP | Вход в зону |
| `exited_at` | TIMESTAMP NULL | Выход из зоны (null если ТС в зоне на конец смены) |
| `duration_sec` | INTEGER NULL | Время в зоне (секунды) |

#### `requests` — кеш заявок TIS

| Колонка | Тип | Описание |
|---------|-----|----------|
| `request_id` | INTEGER PK | ID из TIS |
| `number` | INTEGER | Отображаемый номер заявки |
| `status` | VARCHAR | Статус заявки |
| `date_create` | TIMESTAMP | |
| `date_processed` | TIMESTAMP | |
| `contact_person` | VARCHAR | |
| `raw_json` | JSONB | Полный ответ TIS |
| `updated_at` | TIMESTAMP | |

#### `repairs` — ремонты (миграция 002)

Таблица заполняется вручную. Поля: `id`, `reg_number`, `name_mo`, `type` (`repair`/`maintenance`), `reason`, `date_from`, `date_to`, `object_name`, `notes`.

#### `_migrations` — версии миграций

### Схема `geo` (только чтение)

- `geo.objects` — поля: `uid`, `name`, `smu`, `region`
  - ⚠️ Поле называется `smu`, не `smu_name`
- `geo.zones` + `geo.zone_tags` — геозоны с тегами `dt_boundary`, `dt_loading`, `dt_unloading`
- Объекты с dt_* зонами: «Тобольск основа», «Екатеринбург», «г. Тюмень, станция Новотуринская Бетонный завод»

### Upsert-логика

**shift_records:** `INSERT ... ON CONFLICT (report_date, shift_type, vehicle_id, object_uid) DO UPDATE SET ...` — все поля обновляются при повторном фетче. (`shiftRecordRepo.ts:38-101`)

**trips:** сначала `DELETE WHERE shift_record_id = $1`, затем INSERT каждого рейса. Выполняется в транзакции вместе с upsert shift_record. (`tripRepo.ts:10-43`)

**zone_events:** аналогично — DELETE по `(vehicle_id, report_date, shift_type)`, затем INSERT. (`zoneEventRepo.ts`)

---

## 10. API Endpoints (из `index.ts`)

### Публичные

| Метод | Путь | Параметры | Описание |
|-------|------|-----------|----------|
| GET | `/api/dt/health` | — | Статус сервиса |
| GET | `/api/dt/objects` | — | Объекты с dt_* зонами |
| GET | `/api/dt/shift-records` | `dateFrom`, `dateTo`, `objectUid`, `shiftType` | KPI-записи смен |
| GET | `/api/dt/trips` | `shiftRecordId` (обязательный) | Рейсы смены с JOIN на shift_records |
| GET | `/api/dt/zone-events` | `vehicleId`, `date`, `shiftType` | События зон (все необязательные) |
| GET | `/api/dt/orders` | `dateFrom`, `dateTo` | Заявки с реальной активностью ТС |
| GET | `/api/dt/orders/:number/gantt` | — | Активность ТС по заявке (для Ганта) |
| GET | `/api/dt/repairs` | `objectName`, `dateFrom`, `dateTo` | Ремонты ТС |
| GET | `/api/dt/shift-detail` | `shiftRecordId` (обязательный) | trips + zone_events смены |

### CSV-экспорт

| Метод | Путь | Параметры |
|-------|------|-----------|
| GET | `/api/dt/export/summary.csv` | `dateFrom`, `dateTo`, `objectUid` |
| GET | `/api/dt/export/trips.csv` | `dateFrom`, `dateTo`, `objectUid` |
| GET | `/api/dt/export/zone-events.csv` | `dateFrom`, `dateTo`, `objectUid` |

Временная зона в CSV: `Asia/Yekaterinburg`.

### Admin

| Метод | Путь | Параметры |
|-------|------|-----------|
| POST | `/api/dt/admin/fetch` | `date` (YYYY-MM-DD), `shift` (`shift1`/`shift2`) |
| GET | `/api/dt/admin/config` | — |

`POST /api/dt/admin/fetch` — запуск **асинхронный**: ответ `{ status: 'started' }` возвращается немедленно. Нет WebSocket-уведомления о завершении.

---

## 11. Привязка API → UI

| Поле API | Компонент | Отображение |
|----------|-----------|-------------|
| `kipPct` | `AnalyticsTab`, `WeeklySidebar` | Цветовой класс `kipColor()`, столбцы КИП 1/2 смены |
| `movementPct` | `WeeklySidebar` | `MiniDonut` — процент движения за смену |
| `tripsCount` | `WeeklySidebar`, `AnalyticsTab` | Столбец «Рейсы», счётчик в боковой панели |
| `engineTimeSec` | `AnalyticsTab` | Столбец «Двиг.» через `fmtHours(engineSec)` |
| `movingTimeSec` | `AnalyticsTab` | Столбец «Движ.» |
| `workType === 'delivery'` | `AnalyticsTab` | Базовый фильтр (showOnsite = false) |
| `requestNumbers` | `AnalyticsTab` | Группировка по первому номеру заявки |
| `objectName` | `WeeklySidebar` | Группировка по объекту в боковой панели |
| `avgLoadingDwellSec` | `AnalyticsTab` | Столбец «Ср.П» (среднее время в зоне погрузки) |
| `avgUnloadingDwellSec` | `AnalyticsTab` | Столбец «Ср.В» (среднее время в зоне выгрузки) |
| `trips[].loaded_at` + `zone_events` | `ShiftSubTable` | Детальная таблица рейсов с временами |
| `repairs` | `WeeklySidebar` | Карточки ремонтов под KPI объекта |
| `orders[].rawJson` | `OrderCardView` | Cargo, маршрут, тоннаж/объём из TIS |

---

## Промежуточные структуры данных (domain.ts)

### ParsedPL
```typescript
{
  plId: number, tsNumber: number, dateOut: string,  // DD.MM.YYYY
  dateOutPlan: Date, dateInPlan: Date, status: string,
  vehicles: [{ idMO, regNumber, nameMO }],
  requestNumbers: number[],  // из calcs[].orderDescr regex ^(\d+)
  objectExpendList: string[]
}
```

### FetchTask
```typescript
{
  idMO: number, regNumber: string, nameMO: string,
  shiftType: 'shift1'|'shift2', shiftStart: Date, shiftEnd: Date,
  objectUid: string, objectName: string,
  plId?: number, requestNumbers: number[]
}
```

### ZoneEvent (domain)
```typescript
{
  zoneUid: string, zoneName: string,
  zoneTag: 'dt_boundary'|'dt_loading'|'dt_unloading',
  objectUid: string,
  enteredAt: Date, exitedAt: Date|null, durationSec: number|null
}
```

### Trip (domain)
```typescript
{
  tripNumber: number,
  loadedAt: Date|null,     // выход из зоны погрузки
  unloadedAt: Date|null,   // выход из зоны выгрузки
  loadingZone: string|null, unloadingZone: string|null,
  durationMin: number|null, distanceKm: null, volumeM3: null
}
```

### ShiftKpi
```typescript
{
  engineTimeSec, movingTimeSec, distanceKm, onsiteMin,
  tripsCount, factVolumeM3,  // = 0 (volumeM3 = null)
  kipPct, movementPct, workType
}
```
