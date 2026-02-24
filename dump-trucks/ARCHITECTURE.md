# Архитектура подсистемы Самосвалы (dump-trucks)

> Документ для написания фронтенда. Описывает все данные — итоговые и промежуточные.

---

## Стек

- **Backend:** Express + TypeScript, порт `:3002`
- **БД:** PostgreSQL 17, порт `5433`, база `mstroy`, схема `dump_trucks`
- **Геозоны:** схема `geo` (объекты + зоны с тегами `dt_*`)
- **Внешний API:** TIS Online (ПЛ, заявки, мониторинг ГЛОНАСС)

---

## API Endpoints

### Публичные (данные для отображения)

#### `GET /api/dt/health`
```json
{ "status": "ok", "service": "dump-trucks", "time": "ISO8601" }
```

#### `GET /api/dt/objects`
Объекты, у которых есть зоны с тегами `dt_*` (только эти объекты имеют данные).
```json
{
  "data": [
    {
      "uid": "tobolsk-osnova",
      "name": "Тобольск основа",
      "smu": "СМУ-1",
      "region": "Тюменская область"
    }
  ]
}
```

#### `GET /api/dt/shift-records`
Основные KPI-записи по сменам.

**Query params:**
| Параметр   | Тип        | Описание |
|------------|------------|----------|
| `dateFrom` | YYYY-MM-DD | Дата начала (включительно) |
| `dateTo`   | YYYY-MM-DD | Дата конца (включительно) |
| `objectUid`| string     | Фильтр по объекту |
| `shiftType`| `shift1` / `shift2` | Фильтр по смене |

**Response:**
```json
{
  "data": [ShiftRecord],
  "total": 42
}
```

**ShiftRecord:**
```typescript
{
  id: number                  // PK
  reportDate: string          // YYYY-MM-DD — рабочая дата (не дата окончания смены)
  shiftType: "shift1"|"shift2"// shift1=07:30–19:30, shift2=19:30–07:30
  vehicleId: number           // idMO в TIS
  regNumber: string|null      // Гос. номер
  nameMO: string|null         // Наименование ТС в TIS
  objectUid: string           // UID объекта
  objectName: string|null     // Название объекта
  workType: "delivery"|"onsite"|"unknown"
  shiftStart: string          // ISO timestamp начала смены
  shiftEnd: string            // ISO timestamp конца смены
  engineTimeSec: number       // Время работы двигателя (секунды)
  movingTimeSec: number       // Время движения (секунды)
  distanceKm: string          // NUMERIC → строка! Оборачивать Number()
  onsiteMin: number           // Время на объекте (минуты), из dt_boundary зон
  tripsCount: number          // Кол-во рейсов (погрузка→выгрузка)
  factVolumeM3: string        // NUMERIC → строка! Объём факт (м³)
  kipPct: string              // NUMERIC → строка! КИП % = engine / shift_duration
  movementPct: string         // NUMERIC → строка! % движения = moving / engine
  plId: number|null           // ID путевого листа
  requestNumbers: number[]    // Массив номеров заявок
}
```

> ⚠️ Поля `distanceKm`, `factVolumeM3`, `kipPct`, `movementPct` — NUMERIC из PostgreSQL,
> приходят как **строки**. Всегда оборачивать `Number()` перед отображением/сравнением.

#### `GET /api/dt/trips`
Детальные рейсы по смене.

**Query params:**
| Параметр        | Тип    | Описание |
|-----------------|--------|----------|
| `shiftRecordId` | number | **Обязательный** — ID записи из shift_records |

**Response:**
```json
{ "data": [Trip] }
```

**Trip:**
```typescript
{
  id: number
  tripNumber: number          // Порядковый номер рейса (1, 2, 3...)
  loadedAt: string|null       // ISO timestamp — момент выхода из зоны погрузки
  unloadedAt: string|null     // ISO timestamp — момент выхода из зоны выгрузки
  loadingZone: string|null    // Название зоны погрузки (dt_loading)
  unloadingZone: string|null  // Название зоны выгрузки (dt_unloading)
  durationMin: number|null    // Длительность рейса (минуты)
  distanceKm: number|null     // Пробег за рейс (пока null)
  volumeM3: number|null       // Объём рейса (пока null)
  // Денормализованные поля для удобства:
  regNumber: string
  nameMO: string
  objectName: string
  reportDate: string
  shiftType: string
}
```

#### `GET /api/dt/zone-events`
События входа/выхода в геозоны.

**Query params:**
| Параметр    | Тип        | Описание |
|-------------|------------|----------|
| `vehicleId` | number     | idMO |
| `date`      | YYYY-MM-DD | Дата |
| `shiftType` | string     | `shift1` / `shift2` |

**Response:**
```json
{ "data": [ZoneEvent], "total": 12 }
```

**ZoneEvent:**
```typescript
{
  id: number
  vehicle_id: number
  report_date: string         // YYYY-MM-DD
  shift_type: string
  zone_uid: string            // UID зоны из geo.zones
  zone_name: string           // Название зоны
  zone_tag: "dt_boundary"|"dt_loading"|"dt_unloading"
  object_uid: string
  entered_at: string          // ISO timestamp входа
  exited_at: string|null      // ISO timestamp выхода (null если не вышел в смену)
  duration_sec: number|null   // Время в зоне (секунды)
}
```

### Экспорт CSV

| URL | Описание |
|-----|----------|
| `GET /api/dt/export/summary.csv` | Сводный отчёт по сменам |
| `GET /api/dt/export/trips.csv` | Детальные рейсы |
| `GET /api/dt/export/zone-events.csv` | События по зонам |

Все три принимают `dateFrom`, `dateTo`, `objectUid` в query.

**Колонки summary.csv:**
Дата, Смена, idMO, Гос. номер, Наименование, Объект, Вид работ, Моточасы, Движение (ч), Пробег (км), На объекте (мин), Рейсов, Объём факт (м³), КИП (%), Движение (%), Заявки

**Колонки trips.csv:**
Дата, Смена, idMO, Гос. номер, Объект, Рейс №, Зона погрузки, Зона выгрузки, Погружен в, Выгружен в, Длительность (мин), Пробег (км), Объём (м³)

**Колонки zone-events.csv:**
Дата, Смена, idMO, Гос. номер, Объект, Зона, Тег, Вход, Выход, Время в зоне (мин)

### Admin Endpoints

#### `POST /api/dt/admin/fetch?date=YYYY-MM-DD&shift=shift1`
Запускает ручной фетч данных за указанную дату/смену. Асинхронный — возвращает немедленно.
```json
{ "status": "started", "date": "2026-02-23", "shift": "shift1" }
```

#### `GET /api/dt/admin/config`
Текущая конфигурация сервера (для дебага).
```json
{
  "dbPort": 5433,
  "dbName": "mstroy",
  "serverPort": 3002,
  "testMode": false,
  "testIdMos": null,
  "tokensCount": 18,
  "tisApiUrl": "https://tt.tis-online.com/..."
}
```

---

## База данных

### Схема `dump_trucks`

#### `shift_records` — основная KPI-таблица
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `report_date` | DATE | Рабочая дата (дата начала смены) |
| `shift_type` | VARCHAR | `shift1` / `shift2` |
| `vehicle_id` | INTEGER | idMO из TIS |
| `reg_number` | VARCHAR | Гос. номер |
| `name_mo` | VARCHAR | Наименование ТС |
| `object_uid` | VARCHAR | UID объекта (из geo.objects) |
| `object_name` | VARCHAR | Название объекта |
| `work_type` | VARCHAR | `delivery` / `onsite` / `unknown` |
| `shift_start` | TIMESTAMP | 07:30 или 19:30 |
| `shift_end` | TIMESTAMP | 19:30 или 07:30 следующего дня |
| `engine_time_sec` | INTEGER | Моточасы (секунды) |
| `moving_time_sec` | INTEGER | Время движения (секунды) |
| `distance_km` | NUMERIC(10,2) | Пробег |
| `onsite_min` | INTEGER | Время на объекте в dt_boundary (минуты) |
| `trips_count` | INTEGER | Кол-во рейсов |
| `fact_volume_m3` | NUMERIC(10,2) | Объём факт |
| `kip_pct` | NUMERIC(5,2) | КИП % |
| `movement_pct` | NUMERIC(5,2) | % движения |
| `pl_id` | INTEGER | ID путевого листа |
| `request_numbers` | INTEGER[] | Массив номеров заявок |
| `raw_monitoring` | JSONB | Сырой ответ TIS мониторинга |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

**UNIQUE:** `(report_date, shift_type, vehicle_id, object_uid)`

#### `trips` — рейсы (погрузка → выгрузка)
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `shift_record_id` | BIGINT FK | → shift_records.id CASCADE |
| `trip_number` | INTEGER | Порядковый номер в смене |
| `loaded_at` | TIMESTAMP | Выход из зоны погрузки |
| `unloaded_at` | TIMESTAMP | Выход из зоны выгрузки |
| `loading_zone` | VARCHAR | Название зоны погрузки |
| `unloading_zone` | VARCHAR | Название зоны выгрузки |
| `duration_min` | INTEGER | Длительность рейса (мин) |
| `distance_km` | NUMERIC(8,2) | Пробег (пока не заполняется) |
| `volume_m3` | NUMERIC(8,2) | Объём (пока не заполняется) |

#### `zone_events` — события входа/выхода в геозоны
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | BIGSERIAL PK | |
| `vehicle_id` | INTEGER | idMO |
| `report_date` | DATE | |
| `shift_type` | VARCHAR | |
| `zone_uid` | VARCHAR | UID зоны из geo.zones |
| `zone_name` | VARCHAR | |
| `zone_tag` | VARCHAR | `dt_boundary` / `dt_loading` / `dt_unloading` |
| `object_uid` | VARCHAR | |
| `entered_at` | TIMESTAMP | Вход в зону |
| `exited_at` | TIMESTAMP NULL | Выход из зоны (null если не вышел) |
| `duration_sec` | INTEGER NULL | Время в зоне (секунды) |

#### `requests` — кеш заявок TIS
| Колонка | Тип | Описание |
|---------|-----|----------|
| `request_id` | INTEGER PK | ID из TIS |
| `number` | INTEGER | Отображаемый номер заявки |
| `status` | VARCHAR | Статус заявки |
| `date_create` | TIMESTAMP | Дата создания |
| `date_processed` | TIMESTAMP | Дата обработки |
| `contact_person` | VARCHAR | Контактное лицо |
| `raw_json` | JSONB | Полный ответ TIS |
| `updated_at` | TIMESTAMP | |

### Схема `geo` (только чтение из dump-trucks)

#### `geo.objects` — строительные объекты
Поля, используемые dump-trucks: `uid`, `name`, `smu`, `region`

#### `geo.zones` + `geo.zone_tags` — геозоны
Теги, относящиеся к dump-trucks:
| Тег | Назначение |
|-----|------------|
| `dt_boundary` | Граница объекта — для расчёта времени на объекте и определения объекта ТС |
| `dt_loading` | Зона погрузки — место получения груза |
| `dt_unloading` | Зона выгрузки — место доставки груза |

---

## Pipeline обработки данных

### Запуск

**Авто:** cron (Asia/Yekaterinburg):
- `08:30` → обрабатывает `shift2` вчерашнего дня (ночная смена)
- `20:30` → обрабатывает `shift1` сегодняшнего дня (дневная смена)

**Ручной:** `POST /api/dt/admin/fetch?date=...&shift=...`

### Шаги pipeline

```
TIS API
  ├─ getRouteListsByDateOut (7 дней)   → ParsedPL[]
  ├─ getRequests (2 месяца)           → upsert dump_trucks.requests
  └─ getMonitoringStats (per vehicle)  → TisMonitoringStats
                                           ↓
                                    ZoneAnalyzer
                                    (Turf.js point-in-polygon)
                                           ↓
                                    ZoneEvent[]
                                           ↓
                                    ObjectDetector
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
                            DB Transaction (upsert)
                            ├─ shift_records (UNIQUE upsert)
                            ├─ trips (delete + insert)
                            └─ zone_events (delete + insert)
```

### Промежуточные структуры данных

#### ParsedPL (из ПЛ TIS)
```typescript
{
  plId: number
  tsNumber: number
  dateOut: string           // DD.MM.YYYY
  dateOutPlan: Date
  dateInPlan: Date
  status: string            // ISSUED, COMPLETED и т.д.
  vehicles: [{ idMO, regNumber, nameMO }]
  requestNumbers: number[]  // Извлечены из calcs[].orderDescr regex ^\d+
  objectExpendList: string[]
}
```

#### FetchTask (задача на обработку одного ТС)
```typescript
{
  idMO: number
  regNumber: string
  nameMO: string
  shiftType: "shift1"|"shift2"
  shiftStart: Date          // 07:30 или 19:30
  shiftEnd: Date            // 19:30 или 07:30+1
  objectUid: string         // Определяется по ObjectDetector
  objectName: string
  plId?: number
  requestNumbers: number[]
}
```

#### TisMonitoringStats (сырой ответ TIS)
```typescript
{
  engineTime: number        // Секунды
  movingTime?: number       // Секунды
  engineIdlingTime: number  // Секунды холостого хода
  distance?: number         // Км
  track: [{                 // GPS-трек (хронологически)
    lat: number
    lon: number
    time: string            // DD.MM.YYYY HH:mm:ss (не timestamp!)
    speed?: number
    direction?: number
  }]
  parkings: [{
    lat: number, lon: number
    begin: string           // DD.MM.YYYY HH:mm:ss
    end: string             // DD.MM.YYYY HH:mm:ss
    address?: string
  }]
  fuels: TisFuel[]
}
```

#### GeoZone (загружается из geo.zones)
```typescript
{
  uid: string
  name: string
  objectUid: string
  tag: "dt_boundary"|"dt_loading"|"dt_unloading"
  geojson: GeoJSON.Feature<Polygon|MultiPolygon>
}
```

#### ZoneEvent (результат ZoneAnalyzer)
```typescript
{
  zoneUid: string
  zoneName: string
  zoneTag: "dt_boundary"|"dt_loading"|"dt_unloading"
  objectUid: string
  enteredAt: Date
  exitedAt: Date|null      // null если ТС в зоне на конец смены
  durationSec: number|null
}
```

Алгоритм: `booleanPointInPolygon` (Turf.js) на каждую точку трека → фиксация переходов inside/outside.

#### ObjectCandidate (результат ObjectDetector)
```typescript
{
  objectUid: string
  objectName: string
  boundaryZone: GeoZone
  pointsInside: number     // Кол-во точек трека внутри dt_boundary
}
```
Выбирается объект с **максимальным** `pointsInside`.

#### Trip (результат TripBuilder)
```typescript
{
  tripNumber: number        // 1, 2, 3...
  loadedAt: Date|null       // Выход из loading зоны
  unloadedAt: Date|null     // Выход из unloading зоны
  loadingZone: string|null
  unloadingZone: string|null
  durationMin: number|null
  distanceKm: number|null   // пока null
  volumeM3: number|null     // пока null
}
```

Правила TripBuilder:
- Учитываются только события с `duration >= 3 минуты` (защита от транзитных проездов)
- Максимальная длительность рейса: 4 часа
- Каждая зона выгрузки используется один раз (нет двойного матчинга)

#### ShiftKpi (результат KpiCalculator)
```typescript
{
  engineTimeSec: number
  movingTimeSec: number
  distanceKm: number
  onsiteMin: number          // = sum(zone_events dt_boundary) для object_uid
  tripsCount: number
  factVolumeM3: number       // = sum(trip.volumeM3), сейчас 0
  kipPct: number             // = (engineTimeSec / shiftDurationSec) * 100
  movementPct: number        // = (movingTimeSec / engineTimeSec) * 100
  workType: "delivery"|"onsite"|"unknown"
}
```

Классификация `workType`:
- `delivery` — если `tripsCount > 0`
- `onsite` — если `engineTime > 0` И `(onsiteSec / engineTime) >= 60%`
- `unknown` — иначе

---

## Конфигурация

### `dump-trucks-registry.json`
Справочник ТС самосвалов (не обязателен для pipeline, используется для метаданных):
```json
{
  "vehicles": [{
    "idMo": 6099,
    "regNumber": "А021АТ172",
    "model": "Самосвал SITRAK 6x4",
    "branch": "ДСУ",
    "volumeM3": 16.0,
    "weightT": 24.0,
    "nameMO": "Самосвал SITRACK C7H"
  }]
}
```

### `.env`
```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=mstroy
DB_USER=max
DB_PASSWORD=
TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=TOKEN1,TOKEN2,...   # 18 токенов через запятую
DT_SERVER_PORT=3002
# DT_TEST_ID_MOS=781,15,1581      # Тестовый режим: только эти idMO
```

---

## Цветовая кодировка KIP (аналогично КИП техники)

| KIP % | Цвет | Значение |
|-------|------|----------|
| < 50% | RED | Низкая утилизация |
| 50–75% | BLUE | Средняя |
| ≥ 75% | GREEN | Хорошая |

---

## Смены

| Смена | Период | report_date |
|-------|--------|-------------|
| `shift1` (дневная) | 07:30 – 19:30 | Дата начала |
| `shift2` (ночная) | 19:30 – 07:30 (+1 день) | Дата начала (вечера) |

**Пример:** смена shift2 с 23.02 19:30 по 24.02 07:30 → `report_date = 2026-02-23`

---

## Рекомендации для фронтенда

### Основные view

1. **Сводная таблица KPI** — фильтры: дата, объект, смена. Данные: `GET /api/dt/shift-records`
2. **Детальные рейсы** — раскрытие строки таблицы. Данные: `GET /api/dt/trips?shiftRecordId=...`
3. **События по зонам** — по клику на ТС. Данные: `GET /api/dt/zone-events?vehicleId=...&date=...&shiftType=...`
4. **Экспорт CSV** — три кнопки для трёх отчётов

### Admin mode

1. **Ручной запуск фетча** — форма: дата + смена → `POST /api/dt/admin/fetch`
   - Запуск асинхронный, нет WebSocket-уведомления — можно добавить polling или просто уведомить «запущено»
2. **Конфиг** — `GET /api/dt/admin/config` — отображение статуса подключений
3. **Тест-режим** — показывать предупреждение если `testMode: true` (данные только по тест-ТС)

### Числа из API

Все NUMERIC поля (`distanceKm`, `factVolumeM3`, `kipPct`, `movementPct`) приходят **строками**.
Обязательно конвертировать: `Number(record.kipPct)`.

### Временные зоны

Даты хранятся в UTC. При отображении учитывать разницу (Екатеринбург = UTC+5).
В CSV экспорте используется `Asia/Yekaterinburg`.

### Будущие поля (пока null)

В таблице `trips`: `distance_km` и `volume_m3` — пока не заполняются. Показывать «—» или скрывать колонки.

---

## Шпаргалка: что нужно для фронта

### Данные и откуда брать

| Что показываем | Endpoint | Ключевые поля |
|----------------|----------|---------------|
| Список объектов (фильтр) | `GET /api/dt/objects` | `uid`, `name`, `smu` |
| Таблица KPI по сменам | `GET /api/dt/shift-records` | см. ниже |
| Рейсы по ТС | `GET /api/dt/trips?shiftRecordId=N` | `tripNumber`, `loadingZone`, `unloadingZone`, `loadedAt`, `unloadedAt`, `durationMin` |
| Зоны входа/выхода | `GET /api/dt/zone-events?vehicleId=N&date=...&shiftType=...` | `zone_name`, `zone_tag`, `entered_at`, `exited_at`, `duration_sec` |
| Статус сервера | `GET /api/dt/admin/config` | `testMode`, `tokensCount` |
| Запустить фетч | `POST /api/dt/admin/fetch?date=...&shift=...` | ответ мгновенный |

### Ключевые поля ShiftRecord для отображения

```
regNumber       → гос. номер
nameMO          → название ТС
objectName      → объект
shiftType       → смена (shift1 / shift2)
reportDate      → дата
workType        → вид работ (delivery / onsite / unknown)
kipPct          → КИП % → Number() → цвет (< 50 RED, 50–75 BLUE, ≥ 75 GREEN)
movementPct     → % движения → Number()
engineTimeSec   → моточасы → делить на 3600 для часов
onsiteMin       → время на объекте
tripsCount      → рейсов
distanceKm      → пробег → Number()
factVolumeM3    → объём → Number()
requestNumbers  → массив номеров заявок (показать через запятую)
plId            → ссылка на ПЛ (если нужно)
```

### Типы-справочники (enum'ы)

```
shiftType:  "shift1" (07:30–19:30)  |  "shift2" (19:30–07:30)
workType:   "delivery" (рейсы)  |  "onsite" (на месте)  |  "unknown"
zone_tag:   "dt_boundary" (граница)  |  "dt_loading" (погрузка)  |  "dt_unloading" (выгрузка)
```

### Что точно нужно сконвертировать

```javascript
Number(record.kipPct)        // NUMERIC → string из pg
Number(record.movementPct)
Number(record.distanceKm)
Number(record.factVolumeM3)
```

### Фильтры в интерфейсе

- Диапазон дат (`dateFrom` / `dateTo`) — формат `YYYY-MM-DD`
- Объект (`objectUid`) — список из `GET /api/dt/objects`
- Смена (`shiftType`) — `shift1` / `shift2` / все
- Вид работ (`workType`) — для фильтрации на фронте (нет серверного параметра)

### Что пока не работает / заглушки

- `trips.distanceKm` — всегда `null`
- `trips.volumeM3` — всегда `null`, и `factVolumeM3` в shift_records тоже `0`
- Admin fetch не шлёт уведомления о завершении (нет WS) — достаточно тоста «запущено»
