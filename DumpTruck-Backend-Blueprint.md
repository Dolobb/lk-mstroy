# Backend Blueprint — Аналитика выработки самосвалов

> Модуль аналитики самосвалов. Часть монорепо проекта КИП техники.
> Формат: псевдокод + пояснения на русском. Документ пишется итерационно.

---

## 0. Место в монорепо

> **Геозоны и объекты строительства** хранятся в общей схеме `geo` (PostgreSQL).
> Модуль самосвалов только **читает** из `geo` — управление зонами через отдельный `geo-admin` модуль.
> КИП также мигрирует на схему `geo` (см. Geo-Admin-Blueprint.md).

```
repo/
├── server/          # существующий бэкенд КИП техники (не трогаем)
├── client/          # существующий фронтенд КИП техники (не трогаем)
├── dump-trucks/
│   ├── server/      # бэкенд самосвалов (этот документ)
│   └── client/      # фронтенд самосвалов (отдельное ТЗ)
└── config/          # общие конфиги (geozones.geojson и др.)
```

Модуль изолирован: своя БД (отдельная PostgreSQL-схема `dump_trucks`),
свой Express-сервер на отдельном порту, свой pipeline.
Общее с КИП: тот же TIS API, те же токены, тот же geozones.geojson (расширенный).

---

## 1. Конфиг-файлы

### 1.1. Конфигурация объектов и зон — хранится в БД

> `dump-trucks-config.json` **упразднён**. Объекты и зоны хранятся в схеме `geo`
> и управляются через `geo-admin` UI. Подробнее — в `Geo-Admin-Blueprint.md`.

**Теги зон для модуля самосвалов:**
- `dt_boundary` — общая граница объекта (определяет "машина на объекте")
- `dt_loading` — зона погрузки
- `dt_unloading` — зона выгрузки
- `dt_onsite` — зона "работа по месту"

Одна зона может иметь несколько тегов одновременно (например `dt_loading` + `dt_onsite`).

---

### 1.2. `config/dump-trucks-registry.json` — справочник самосвалов

```json
{
  "vehicles": [
    { "regNumber": "А446АТ172", "model": "КАМАЗ-6520",  "capacity": 20 },
    { "regNumber": "А525АТ172", "model": "КАМАЗ-65201", "capacity": 20 },
    { "regNumber": "Р028МС72",  "model": "Volvo FMX",   "capacity": 25 },
    { "regNumber": "Р424МС186", "model": "Shacman X3000","capacity": 25 }
  ]
}
```

**Поля:**
- `regNumber` — госномер (ключ сопоставления с данными TIS)
- `model` — марка/модель (отображается в таблице, колонка "Марка")
- `capacity` — грузоподъёмность в тоннах (умножается на кол-во рейсов)

**Загрузка:** При старте сервера читается в память как singleton (аналогично `vehicleRegistry.ts` в КИП).
Идентификация самосвала в телеметрии TIS: поле `nameMO` должно содержать слово "самосвал" (регистронезависимо).

---

### 1.3. `config/shifts.json` — общий с КИП, не меняем

```json
{
  "shift1": { "start": "07:30", "end": "19:30", "label": "1 смена" },
  "shift2": { "start": "19:30", "end": "07:30", "label": "2 смена" }
}
```

---

### 1.4. `config/geozones.geojson` — расширяем существующий

Файл общий с КИП. Для самосвалов никаких изменений в структуру не вносим —
все привязки зон к объектам и их типы хранятся в `dump-trucks-config.json`.
Геозоны используются только для получения координат полигонов по uid.

---

## 2. Схема базы данных

Отдельная PostgreSQL-схема `dump_trucks`. Все таблицы с префиксом в рамках схемы.

### 2.1. `dump_trucks.shift_records` — сводные данные за смену по каждому ТС

Главная таблица. Одна строка = одна машина × одна смена × один объект.
Это то, что отображается в основной таблице UI.

```sql
CREATE TABLE dump_trucks.shift_records (
  id                    SERIAL PRIMARY KEY,

  -- Идентификация записи
  report_date           DATE NOT NULL,
  shift_type            VARCHAR(10) NOT NULL,     -- 'shift1' | 'shift2'
  vehicle_id            VARCHAR(20) NOT NULL,     -- госномер ТС
  object_uid            VARCHAR(50) NOT NULL,     -- uid из dump-trucks-config.json

  -- Тип работы (определяется алгоритмом)
  work_type             VARCHAR(20) NOT NULL,     -- 'delivery' | 'onsite' | 'unknown'

  -- Данные из справочника (денормализованы для скорости отчётов)
  vehicle_model         VARCHAR(200),             -- из dump-trucks-registry.json
  vehicle_capacity      NUMERIC(6,2),             -- грузоподъёмность, т

  -- Данные из ПЛ + Заявки (план)
  request_number        INTEGER,                  -- номер заявки из TIS
  applicant             VARCHAR(200),             -- заявитель
  cost_object           VARCHAR(200),             -- объект затрат
  plan_volume           NUMERIC(10,2),            -- плановый объём, т

  -- KPI из телеметрии (общие для обоих типов работы)
  engine_on_time_min    NUMERIC(8,2),             -- время работы ДВС, мин
  moving_time_min       NUMERIC(8,2),             -- время в движении (speed>0), мин
  kip_pct               NUMERIC(6,2),             -- КИП % = engine_on_time / 600 * 100, макс 100
  moving_pct            NUMERIC(6,2),             -- В движении % = moving_time / 600 * 100, макс 100

  -- Факт: доставка
  trips_count           INTEGER,                  -- кол-во валидных рейсов (пар погрузка→выгрузка)
  fact_volume           NUMERIC(10,2),            -- trips_count * vehicle_capacity, т
  volume_remainder      NUMERIC(10,2),            -- plan_volume - fact_volume, т
  avg_loading_stay_min  NUMERIC(8,2),             -- среднее время в зоне погрузки, мин
  avg_unloading_stay_min NUMERIC(8,2),            -- среднее время в зоне выгрузки, мин

  -- Факт: по месту
  onsite_stay_min       NUMERIC(8,2),             -- время стоянки (speed=0) на объекте, мин
  onsite_moving_min     NUMERIC(8,2),             -- время движения на объекте, мин
  fuel_consumed         NUMERIC(10,4),            -- расход топлива, л (из TIS engineIdlingTime + расчёт)

  -- Служебные
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),

  UNIQUE(report_date, shift_type, vehicle_id, object_uid)
);
```

---

### 2.2. `dump_trucks.trips` — детализация рейсов (таблица Сингапай-формата)

Одна строка = один рейс (одна пара погрузка/выгрузка) или аномалия.
Открывается как дополнительная вкладка в UI.

```sql
CREATE TABLE dump_trucks.trips (
  id                    SERIAL PRIMARY KEY,

  -- Привязка к сводной записи
  shift_record_id       INTEGER REFERENCES dump_trucks.shift_records(id) ON DELETE CASCADE,
  vehicle_id            VARCHAR(20) NOT NULL,
  report_date           DATE NOT NULL,
  shift_type            VARCHAR(10) NOT NULL,
  object_uid            VARCHAR(50) NOT NULL,

  -- Порядок рейса
  trip_number           INTEGER NOT NULL,         -- порядковый номер рейса в смене

  -- Зона погрузки
  loading_zone_uid      VARCHAR(50),              -- uid зоны погрузки
  loading_entry_time    TIMESTAMP,                -- въезд в зону погрузки
  loading_exit_time     TIMESTAMP,                -- выезд из зоны погрузки
  loading_stay_min      NUMERIC(8,2),             -- exit - entry, мин

  -- Зона выгрузки
  unloading_zone_uid    VARCHAR(50),              -- uid зоны выгрузки
  unloading_entry_time  TIMESTAMP,                -- въезд в зону выгрузки
  unloading_exit_time   TIMESTAMP,                -- выезд из зоны выгрузки
  unloading_stay_min    NUMERIC(8,2),             -- exit - entry, мин

  -- Путь (время в пути, а не расстояние — из трека)
  travel_to_unload_min  NUMERIC(8,2),             -- от выезда погрузки до въезда выгрузки
  travel_to_load_min    NUMERIC(8,2),             -- от выезда выгрузки до следующего въезда погрузки

  -- Статус рейса
  is_valid              BOOLEAN NOT NULL DEFAULT TRUE,
  anomaly_type          VARCHAR(30),              -- NULL | 'no_unloading' | 'no_loading'
  comment               TEXT,                     -- текстовый комментарий для UI

  created_at            TIMESTAMP DEFAULT NOW()
);
```

---

### 2.3. `dump_trucks.zone_events` — сырые события пересечений геозон

Промежуточная таблица. Хранит все входы/выходы из всех зон за смену.
Используется для построения trips и отладки.
Может быть опущена в первой версии если хранить только агрегаты.

```sql
CREATE TABLE dump_trucks.zone_events (
  id              SERIAL PRIMARY KEY,
  vehicle_id      VARCHAR(20) NOT NULL,
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(10) NOT NULL,
  object_uid      VARCHAR(50) NOT NULL,
  zone_uid        VARCHAR(50) NOT NULL,     -- uid из geo.zones
  zone_type       VARCHAR(20) NOT NULL,    -- тег зоны: 'dt_boundary'|'dt_loading'|'dt_unloading'|'dt_onsite'
  event_type      VARCHAR(10) NOT NULL,    -- 'entry' | 'exit'
  event_time      TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON dump_trucks.zone_events (vehicle_id, report_date, shift_type);
```

---

### 2.4. `dump_trucks.requests` — заявки из TIS (аналог таблицы requests в КИП)

```sql
CREATE TABLE dump_trucks.requests (
  id              SERIAL PRIMARY KEY,
  request_id      INTEGER UNIQUE,
  number          INTEGER,
  status          VARCHAR(30),
  date_create     TIMESTAMP,
  applicant       VARCHAR(200),
  cost_object     VARCHAR(200),
  plan_volume     NUMERIC(10,2),           -- плановый объём в тоннах (из заявки)
  raw_json        JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

---

### 2.5. `dump_trucks._migrations` — журнал миграций

```sql
CREATE TABLE dump_trucks._migrations (
  name        VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMP DEFAULT NOW()
);
```

---

## 3. Структура файлов модуля

```
dump-trucks/server/src/
// Примечание: объекты и геозоны хранятся в схеме geo (общей для всего монорепо).
// Модуль самосвалов только читает из geo — не пишет.
// Управление зонами — через отдельный geo-admin модуль.
├── index.ts                      # Express-сервер, маршруты, запуск
├── migrate.ts                    # Скрипт миграций схемы dump_trucks
├── config/
│   ├── database.ts               # Пул соединений к схеме dump_trucks
│   └── env.ts                    # Переменные окружения (порт, токены и т.д.)
├── jobs/
│   ├── shiftFetchJob.ts          # Главный пайплайн: запуск после окончания смены
│   └── scheduler.ts              # Cron: запуск в 08:30 и 20:30 (через час после смены)
├── repositories/
│   ├── shiftRecordRepo.ts        # CRUD для shift_records
│   ├── tripRepo.ts               # CRUD для trips
│   ├── zoneEventRepo.ts          # CRUD для zone_events
│   ├── requestRepo.ts            # Upsert + запросы для requests
│   └── filterRepo.ts             # Фильтры для UI (объекты, регионы, СМУ)
├── services/
│   ├── tisClient.ts              # HTTP-клиент к TIS API (можно переиспользовать из КИП)
│   ├── tokenPool.ts              # Round-robin токены (переиспользовать из КИП)
│   ├── vehicleDetector.ts        # Определение самосвалов на объекте за смену
│   ├── workTypeClassifier.ts     # Классификация типа работы: delivery | onsite
│   ├── zoneAnalyzer.ts           # Анализ трека → события пересечений геозон (Turf.js)
│   ├── tripBuilder.ts            # Построение пар рейсов из событий зон
│   ├── kpiCalculator.ts          # Расчёт КИП, В движении из данных TIS
│   ├── requestParser.ts          # Парсинг заявок из TIS → plan_volume, applicant и т.д.
│   ├── dumpTruckRegistry.ts      # In-memory справочник самосвалов из JSON
│   └── objectConfigLoader.ts    # In-memory загрузка dump-trucks-config.json
├── types/
│   ├── domain.ts                 # Внутренние интерфейсы
│   └── tis-api.ts                # Типы ответов TIS (можно расшарить с КИП)
└── utils/
    ├── dateFormat.ts             # Работа с датами (переиспользовать из КИП)
    └── logger.ts                 # Логгер (переиспользовать из КИП)
```

---

## 4. Алгоритм определения самосвалов на объекте

> Запускается в начале пайплайна, до обработки объектов.
> Логика идентична блоку "тягачи": список ТС берётся из ПЛ, парсер переиспользуется оттуда же.

### 4.1. Получение списка самосвалов из ПЛ

```pseudocode
функция getActiveDumpTrucks(date):
  // Шаг 1: запросить ПЛ за 7 дней (как в тягачах)
  rawRouteLists = tisClient.getRouteListsByDateOut(
    from: date - 7 дней,
    to:   date
  )

  // Шаг 2: спарсить ПЛ — используем парсер из блока "тягачи" без изменений
  parsedLists = plParser.parse(rawRouteLists)

  // Шаг 3: извлечь уникальные ТС из всех ПЛ
  vehicles = extractVehiclesFromRouteLists(parsedLists)
  // vehicles: [{ idMo, regNumber, nameMO, ... }]

  // Шаг 4: фильтр — только самосвалы
  dumpTrucks = vehicles.filter(v →
    v.nameMO.toLowerCase().includes("самосвал")
  )

  вернуть dumpTrucks  // список { idMo, regNumber, nameMO }
```

### 4.2. Определение самосвалов на конкретном объекте

```pseudocode
функция detectVehiclesOnObject(dumpTrucks, objectUid, shiftWindow):
  // Загрузить полигон границы объекта из схемы geo (PostGIS)
  boundaryZone = db.query(`
    SELECT ST_AsGeoJSON(z.geom) AS geom
    FROM geo.zones z
    JOIN geo.objects o ON o.id = z.object_id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE o.uid = $1 AND zt.tag = 'dt_boundary'
    LIMIT 1
  `, [objectUid])
  boundaryPolygon = JSON.parse(boundaryZone.geom)

  result = []

  // Для каждого самосвала из ПЛ запросить мониторинг и проверить геозону
  // Запросы идут поштучно с rate limit (30 сек/ТС), ротация токенов — как в тягачах
  для каждого truck из dumpTrucks:
    monitoringData = tisClient.getMonitoringStats(
      idMo: truck.idMo,
      from: shiftWindow.start,
      to:   shiftWindow.end
    )

    trackPoints = monitoringData.track  // [{lon, lat, time, speed}, ...]

    wasOnObject = trackPoints.some(point →
      turf.booleanPointInPolygon([point.lon, point.lat], boundaryPolygon)
    )

    если wasOnObject:
      result.push({ ...truck, monitoringData })
      // monitoringData сохраняем сразу — он понадобится дальше в пайплайне,
      // чтобы не делать второй запрос к TIS для того же ТС

  вернуть result
```

**Замечание:** `getMonitoringStats` вызывается ровно один раз на каждое ТС из ПЛ — ответ сохраняется в памяти и переиспользуется на всех последующих шагах (классификация, анализ трека, расчёт KPI). Повторных запросов нет.

---

## 5. Алгоритм классификации типа работы

> Запускается после определения списка машин на объекте.
> Приоритет: сначала проверяем "по месту", потом "доставка".

```pseudocode
функция classifyWorkType(truck, objectConfig, track):
  // Шаг 1: загрузить полигоны onsite-зон объекта
  onsitePolygons = objectConfig.zones.onsite.map(uid → getPolygonByUid(uid))
  boundaryPolygon = getPolygonByUid(objectConfig.zones.boundary[0])

  // Шаг 2: посчитать общее время на объекте (внутри boundary)
  timeOnObject = calcTimeInsidePolygon(track, boundaryPolygon)  // мин

  если timeOnObject == 0: вернуть 'unknown'

  // Шаг 3: посчитать время в onsite-зонах
  timeInOnsiteZones = 0
  для каждого polygon из onsitePolygons:
    timeInOnsiteZones += calcTimeInsidePolygon(track, polygon)

  // Шаг 4: проверить порог 60%
  onsiteRatio = timeInOnsiteZones / timeOnObject
  если onsiteRatio >= 0.60: вернуть 'onsite'

  // Шаг 5: проверить наличие хотя бы одной пары погрузка/выгрузка
  loadingPolygons   = objectConfig.zones.loading.map(uid → getPolygonByUid(uid))
  unloadingPolygons = objectConfig.zones.unloading.map(uid → getPolygonByUid(uid))

  wasInLoading   = track.some(p → любой loadingPolygon содержит точку p)
  wasInUnloading = track.some(p → любой unloadingPolygon содержит точку p)

  если wasInLoading && wasInUnloading: вернуть 'delivery'

  вернуть 'unknown'  // был на объекте, но не подошёл ни под один тип
```

---

## 6. Алгоритм анализа трека и построения рейсов

> Только для type = 'delivery'.
> Вход: полный трек точек за смену + конфиг зон объекта.
> Выход: массив событий zone_events + массив рейсов trips.

### 6.1. Построение событий пересечений (`zoneAnalyzer.ts`)

```pseudocode
функция buildZoneEvents(track, objectConfig):
  // Собрать все зоны (все типы, кроме boundary)
  zones = [
    ...objectConfig.zones.loading.map(uid   → { uid, type: 'loading',   polygon: getPolygon(uid) }),
    ...objectConfig.zones.unloading.map(uid → { uid, type: 'unloading', polygon: getPolygon(uid) }),
    ...objectConfig.zones.onsite.map(uid    → { uid, type: 'onsite',    polygon: getPolygon(uid) })
  ]

  events = []
  // Для каждой зоны отдельно отслеживаем статус нахождения
  zoneStatus = Map<zoneUid, { inside: boolean, entryTime: Timestamp }>

  для каждой точки point из track (хронологически):
    для каждой zone из zones:
      isInside = turf.booleanPointInPolygon([point.lon, point.lat], zone.polygon)
      prevStatus = zoneStatus.get(zone.uid) ?? { inside: false }

      если !prevStatus.inside && isInside:
        // Событие ВЪЕЗДА
        events.push({ zone.uid, zone.type, type: 'entry', time: point.time })
        zoneStatus.set(zone.uid, { inside: true, entryTime: point.time })

      если prevStatus.inside && !isInside:
        // Событие ВЫЕЗДА
        events.push({ zone.uid, zone.type, type: 'exit', time: point.time })
        zoneStatus.set(zone.uid, { inside: false })

  // Закрыть незакрытые зоны (машина осталась внутри в конце смены)
  для каждого [uid, status] из zoneStatus:
    если status.inside:
      events.push({ uid, type: 'exit', time: shiftWindow.end })

  вернуть events.sort(по времени)
```

### 6.2. Построение пар рейсов (`tripBuilder.ts`)

```pseudocode
функция buildTrips(zoneEvents):
  trips = []
  tripNumber = 1

  // Берём только события загрузки и выгрузки
  loadingEvents   = zoneEvents.filter(e → e.zoneType == 'loading')
  unloadingEvents = zoneEvents.filter(e → e.zoneType == 'unloading')

  // Строим пары: для каждого выезда из погрузки ищем следующий выезд из выгрузки
  // при условии что между ними не было ещё одного въезда в погрузку

  // Алгоритм работает с хронологическим списком всех событий погрузки и выгрузки:
  allEvents = [...loadingEvents, ...unloadingEvents].sort(по времени)

  currentLoading = null   // текущий открытый рейс (зафиксирован въезд в погрузку)
  loadingVisits = 0       // счётчик посещений погрузки без выгрузки

  для каждого event из allEvents:
    если event.zoneType == 'loading' && event.eventType == 'entry':
      если currentLoading != null:
        // Повторный въезд в погрузку без выгрузки — аномалия предыдущего рейса
        trips.push({
          tripNumber: tripNumber++,
          loading: currentLoading,
          unloading: null,
          isValid: false,
          anomalyType: 'no_unloading'
        })
      currentLoading = { entryTime: event.time, zoneUid: event.zoneUid }

    если event.zoneType == 'loading' && event.eventType == 'exit':
      если currentLoading != null:
        currentLoading.exitTime = event.time
        currentLoading.stayMin = diffMinutes(currentLoading.entryTime, event.time)

    если event.zoneType == 'unloading' && event.eventType == 'entry':
      если currentLoading == null:
        // Выгрузка без погрузки — аномалия
        trips.push({
          tripNumber: tripNumber++,
          loading: null,
          unloading: { entryTime: event.time, zoneUid: event.zoneUid },
          isValid: false,
          anomalyType: 'no_loading'
        })
      иначе:
        currentUnloading = { entryTime: event.time, zoneUid: event.zoneUid }

    если event.zoneType == 'unloading' && event.eventType == 'exit':
      если currentLoading != null && currentUnloading != null:
        currentUnloading.exitTime = event.time
        currentUnloading.stayMin = diffMinutes(currentUnloading.entryTime, event.time)

        // Валидный рейс — закрываем пару
        trips.push({
          tripNumber: tripNumber++,
          loading:   currentLoading,
          unloading: currentUnloading,
          travelToUnloadMin:  diffMinutes(currentLoading.exitTime, currentUnloading.entryTime),
          travelToLoadMin:    null,  // заполнится при следующем рейсе
          isValid: true,
          anomalyType: null
        })
        // Заполнить travelToLoad предыдущего рейса
        если trips.length >= 2:
          prevTrip = trips[trips.length - 2]
          если prevTrip.isValid:
            prevTrip.travelToLoadMin = diffMinutes(prevTrip.unloading.exitTime, currentLoading.entryTime)

        currentLoading = null
        currentUnloading = null

  // Незакрытый рейс в конце смены
  если currentLoading != null:
    trips.push({
      tripNumber: tripNumber++,
      loading: currentLoading,
      unloading: null,
      isValid: false,
      anomalyType: 'no_unloading'
    })

  вернуть trips
```

---

## 7. Расчёт KPI

```pseudocode
функция calculateKpi(monitoringData):
  SHIFT_NORM_MIN = 600  // эталонные 10 часов

  engineOnMin  = monitoringData.engineTime / 60   // TIS даёт в секундах
  movingMin    = monitoringData.movingTime  / 60

  kipPct     = min(engineOnMin / SHIFT_NORM_MIN * 100, 100)
  movingPct  = min(movingMin   / SHIFT_NORM_MIN * 100, 100)

  вернуть { engineOnMin, movingMin, kipPct, movingPct }


функция calculateDeliveryFact(trips, vehicleCapacity):
  validTrips  = trips.filter(t → t.isValid)
  tripsCount  = validTrips.length
  factVolume  = tripsCount * vehicleCapacity

  avgLoadingStay   = среднее(validTrips.map(t → t.loading.stayMin))
  avgUnloadingStay = среднее(validTrips.map(t → t.unloading.stayMin))

  вернуть { tripsCount, factVolume, avgLoadingStay, avgUnloadingStay }


функция calculateOnsiteFact(track, boundaryPolygon):
  onsiteStayMin   = 0
  onsiteMovingMin = 0

  для каждой пары соседних точек [p1, p2] из track:
    если обе точки внутри boundaryPolygon:
      segmentMin = diffMinutes(p1.time, p2.time)
      если p1.speed == 0:
        onsiteStayMin   += segmentMin
      иначе:
        onsiteMovingMin += segmentMin

  вернуть { onsiteStayMin, onsiteMovingMin }
```

---

## 8. Главный пайплайн (`shiftFetchJob.ts`)

```pseudocode
функция runShiftPipeline(date, shiftType, options?):
  logger.info("Старт пайплайна", { date, shiftType })

  shiftWindow = getShiftWindow(date, shiftType)
  если options?.endOverride: shiftWindow.end = options.endOverride
  // Например: shiftType='shift2', date='2026-04-01'
  // → shiftWindow = { start: '2026-03-31 19:30', end: '2026-04-01 07:30' }

  // 1. Получить ПЛ + заявки из TIS
  // Используем парсер и логику актуализации из блока "тягачи" без изменений:
  //   - getRouteListsByDateOut за 7 дней
  //   - getRequests за 2 месяца (с актуализацией незакрытых заявок)
  //   - upsert в dump_trucks.requests
  //   - buildVehicleRequestMap → { regNumber → { requestNumber, applicant, costObject, planVolume } }
  { vehicleToRequestMap } = await fetchAndSyncRouteListsAndRequests(date)

  // 2. Получить список самосвалов из ПЛ + запросить мониторинг каждого
  // getMonitoringStats — поштучно с rate limit 30 сек/ТС, ротация токенов как в тягачах
  // monitoringData кешируется в памяти — повторных запросов к TIS не будет
  dumpTrucksWithData = getActiveDumpTrucks(date, shiftWindow)
  // [{ idMo, regNumber, nameMO, monitoringData: { track, engineTime, movingTime, fuelConsumed, ... } }]

  // 3. Загрузить объекты из geo схемы (вместо dump-trucks-config.json)
  objects = db.query(`
    SELECT o.uid, o.name, o.smu, o.region
    FROM geo.objects o
    JOIN geo.zones z ON z.object_id = o.id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE zt.tag LIKE 'dt_%'
    GROUP BY o.id
  `)
  // Только объекты у которых есть хотя бы одна зона с тегом dt_*

  для каждого objectConfig из objects:
    logger.info("Обрабатываем объект", { object: objectConfig.name })

    // 4. Определить самосвалы на объекте (фильтр по boundary-зоне, данные уже в памяти)
    vehiclesOnObject = detectVehiclesOnObject(dumpTrucksWithData, objectConfig.uid, shiftWindow)
    logger.info("Найдено ТС на объекте", { count: vehiclesOnObject.length })

    // 5. Для каждого самосвала на объекте
    для каждого truck из vehiclesOnObject:
      попытка:
        track = truck.monitoringData.track

        // 6. Классифицировать тип работы
        workType = classifyWorkType(truck, objectConfig, track)

        // 7. Посчитать KPI (engineTime, movingTime — в секундах из TIS)
        kpi = calculateKpi(truck.monitoringData)

        // 8. Данные из плана (из ПЛ + заявок)
        planData = vehicleToRequestMap.get(truck.regNumber) ?? {}

        // 9. Данные из справочника самосвалов
        registryInfo = dumpTruckRegistry.get(truck.regNumber)
        // { model, capacity }

        // 10. Расход топлива — напрямую из ответа мониторинга TIS
        fuelConsumed = truck.monitoringData.fuelConsumed ?? null

        // 11. Ветка расчётов по типу работы
        если workType == 'delivery':
          zoneEvents = buildZoneEvents(track, objectConfig.uid, db)
          // PostGIS делает всю геометрическую работу одним запросом
          upsertZoneEvents(zoneEvents, { vehicleId: truck.regNumber, date, shiftType, objectUid: objectConfig.uid })

          trips = buildTrips(zoneEvents)
          upsertTrips(trips, { vehicleId: truck.regNumber, date, shiftType, objectUid: objectConfig.uid })

          deliveryFact = calculateDeliveryFact(trips, registryInfo?.capacity ?? 0)

          upsertShiftRecord({
            ...kpi, ...planData, ...deliveryFact,
            fuelConsumed,
            workType: 'delivery',
            vehicleId: truck.regNumber,
            vehicleModel: registryInfo?.model,
            vehicleCapacity: registryInfo?.capacity,
            volumeRemainder: (planData.planVolume ?? 0) - deliveryFact.factVolume,
            reportDate: date,
            shiftType,
            objectUid: objectConfig.uid
          })

        если workType == 'onsite':
          boundaryPolygon = getPolygonByUid(objectConfig.zones.boundary[0])
          onsiteFact = calculateOnsiteFact(track, boundaryPolygon)

          upsertShiftRecord({
            ...kpi, ...planData, ...onsiteFact,
            fuelConsumed,
            workType: 'onsite',
            vehicleId: truck.regNumber,
            vehicleModel: registryInfo?.model,
            reportDate: date,
            shiftType,
            objectUid: objectConfig.uid
          })

        если workType == 'unknown':
          // Сохраняем с workType='unknown', факты пустые — виден в UI как "не определён"
          upsertShiftRecord({
            ...kpi, fuelConsumed, workType: 'unknown',
            vehicleId: truck.regNumber,
            vehicleModel: registryInfo?.model,
            reportDate: date, shiftType, objectUid: objectConfig.uid
          })

      ошибка (error):
        logger.error("Ошибка обработки ТС", { vehicleId: truck.regNumber, error })
        // Продолжаем следующий ТС, не прерываем весь пайплайн

  logger.info("Пайплайн завершён", { date, shiftType })


// Cron-расписание (scheduler.ts)
// shift1 (07:30–19:30) завершается в 19:30 → запуск через час в 20:30 того же дня
// shift2 (19:30–07:30) завершается в 07:30 → запуск через час в 08:30 следующего дня
cron.schedule('30 20 * * *', () → runShiftPipeline(сегодня, 'shift1'))
cron.schedule('30 8  * * *', () → runShiftPipeline(вчера,   'shift2'))
```

---

## 9. REST API эндпоинты

```pseudocode
GET /api/dt/health
  → { status: "ok", module: "dump-trucks" }


GET /api/dt/summary?date=YYYY-MM-DD&shift=shift1&objectUid=singapay
  // Сводные KPI для шапки UI: кол-во ТС, средние КИП и В движении по сменам
  records = getShiftRecords({ date, shift, objectUid })
  → {
      vehicleCount: records.length,
      shift1: { avgKip, avgMoving },
      shift2: { avgKip, avgMoving }
    }


GET /api/dt/records?from=YYYY-MM-DD&to=YYYY-MM-DD&shift=&objectUid=&smu=&region=
  // Основная таблица. Записи за период с фильтрами.
  // По умолчанию from=to=вчера.
  records = getShiftRecords({ from, to, shift, objectUid, smu, region })
  // Обогатить данными из справочника (model, capacity)
  → records[]


GET /api/dt/trips?date=YYYY-MM-DD&shift=shift1&vehicleId=А446АТ172&objectUid=singapay
  // Детализация рейсов для конкретного ТС — открывается отдельной вкладкой
  trips = getTrips({ date, shift, vehicleId, objectUid })
  → trips[]


GET /api/dt/filters
  // Каскадные фильтры для UI
  → {
      objects: [{ uid, name, smu, region }],   // из dump-trucks-config.json
      smuList: string[],
      regions: string[]
    }


GET /api/dt/geozones?objectUid=singapay
  // GeoJSON зон конкретного объекта для карты
  // Читает из geo.zones + geo.zone_tags, возвращает только dt_* зоны
  SELECT z.uid, z.name, ST_AsGeoJSON(z.geom) AS geom, array_agg(zt.tag) AS tags
  FROM geo.zones z
  JOIN geo.objects o ON o.id = z.object_id
  JOIN geo.zone_tags zt ON zt.zone_id = z.id
  WHERE o.uid = $objectUid AND zt.tag LIKE 'dt_%'
  GROUP BY z.id
  → GeoJSON FeatureCollection (с тегами в properties)


POST /api/dt/admin/fetch?date=YYYY-MM-DD&shift=shift1
  // Ручной запуск пайплайна (для конкретной даты и смены)
  runShiftPipeline(date, shift).catch(логировать)
  → { status: "started", date, shift }


POST /api/dt/admin/fetch-current
  // Запуск для текущей смены (например, в 13:00 — за период 07:30-13:00)
  // Определяет текущую смену и запускает пайплайн с shiftWindow.end = now()
  currentShift = getCurrentShift(now())
  runShiftPipeline(сегодня, currentShift, { endOverride: now() }).catch(логировать)
  → { status: "started", shift: currentShift, periodEnd: now() }
```

---

## 10. Переменные окружения (`.env`)

```
# Общие с КИП (можно переиспользовать)
TIS_API_URL=
TIS_API_TOKENS=token1,token2

# БД для модуля самосвалов
DT_DB_HOST=localhost
DT_DB_PORT=5432
DT_DB_NAME=
DT_DB_USER=postgres
DT_DB_PASSWORD=
DT_DB_SCHEMA=dump_trucks

# Сервер
DT_SERVER_PORT=3002

# Rate limit (мс между запросами к TIS на одно ТС)
DT_RATE_LIMIT_MS=30000
```

---

## 11. Поток данных (итоговая схема)

```
TIS API (внешний)
  │
  ├─ getRequests (2 месяца)
  │     ↓ parseRequests → upsertRequests → [dump_trucks.requests]
  │
  ├─ getRouteListsByDateOut (7 дней)
  │     ↓ buildVehicleRequestMap → { госномер → заявка }
  │
  └─ getMonitoringStats (все самосвалы за смену)
        ↓
      detectVehiclesOnObject  → фильтр: кто был в boundary-зоне
        ↓
      classifyWorkType        → 'delivery' | 'onsite' | 'unknown'
        ↓
      ┌─────────────────────────────────────────────┐
      │ delivery                │ onsite             │
      │                         │                    │
      │ buildZoneEvents (Turf)  │ calculateOnsiteFact│
      │       ↓                 │       ↓            │
      │ buildTrips              │ (stayMin, movingMin│
      │       ↓                 │  fuelConsumed)     │
      │ calculateDeliveryFact   │                    │
      └─────────────────────────────────────────────┘
              ↓                         ↓
        calculateKpi (engineTime, movingTime → %)
              ↓
        upsertShiftRecord → [dump_trucks.shift_records]
        upsertTrips       → [dump_trucks.trips]
        upsertZoneEvents  → [dump_trucks.zone_events]

                    ═══════════════════════

REST API (Express :3002)
  │
  GET /api/dt/records        ← основная таблица UI
  GET /api/dt/trips          ← детализация рейсов (доп. вкладка)
  GET /api/dt/summary        ← KPI-карточки в шапке
  GET /api/dt/filters        ← фильтры (объекты, регионы, СМУ)
  GET /api/dt/geozones       ← полигоны для карты (из geo схемы)
  POST /api/dt/admin/fetch   ← ручной запуск за дату/смену
  POST /api/dt/admin/fetch-current ← запуск для текущей смены
```

---

*Документ актуален на 18.02.2026. Следующий раздел: детализация `requestParser.ts` и формат данных заявок TIS.*

---

## 12. Репозитории

### 12.1. `shiftRecordRepo.ts` — основная таблица

```pseudocode
// Upsert одной записи (вызывается из пайплайна)
функция upsertShiftRecord(data):
  INSERT INTO dump_trucks.shift_records (
    report_date, shift_type, vehicle_id, object_uid,
    work_type, vehicle_model, vehicle_capacity,
    request_number, applicant, cost_object, plan_volume,
    engine_on_time_min, moving_time_min, kip_pct, moving_pct,
    trips_count, fact_volume, volume_remainder,
    avg_loading_stay_min, avg_unloading_stay_min,
    onsite_stay_min, onsite_moving_min, fuel_consumed,
    updated_at
  ) VALUES (...)
  ON CONFLICT (report_date, shift_type, vehicle_id, object_uid)
  DO UPDATE SET
    work_type              = EXCLUDED.work_type,
    vehicle_model          = EXCLUDED.vehicle_model,
    engine_on_time_min     = EXCLUDED.engine_on_time_min,
    moving_time_min        = EXCLUDED.moving_time_min,
    kip_pct                = EXCLUDED.kip_pct,
    moving_pct             = EXCLUDED.moving_pct,
    trips_count            = EXCLUDED.trips_count,
    fact_volume            = EXCLUDED.fact_volume,
    volume_remainder       = EXCLUDED.volume_remainder,
    avg_loading_stay_min   = EXCLUDED.avg_loading_stay_min,
    avg_unloading_stay_min = EXCLUDED.avg_unloading_stay_min,
    onsite_stay_min        = EXCLUDED.onsite_stay_min,
    onsite_moving_min      = EXCLUDED.onsite_moving_min,
    fuel_consumed          = EXCLUDED.fuel_consumed,
    updated_at             = NOW()
  вернуть вставленную/обновлённую запись


// Основной запрос для таблицы UI
функция getShiftRecords({ from, to, shiftType?, objectUid?, smu?, region? }):
  // Строим WHERE динамически
  conditions = ['sr.report_date BETWEEN $from AND $to']
  params     = [from, to]

  если shiftType: conditions.push('sr.shift_type = $N'),  params.push(shiftType)
  если objectUid: conditions.push('sr.object_uid = $N'),  params.push(objectUid)
  если smu:       conditions.push('o.smu = $N'),           params.push(smu)
  если region:    conditions.push('o.region = $N'),        params.push(region)

  SELECT
    sr.*,
    o.name    AS object_name,
    o.smu     AS object_smu,
    o.region  AS object_region
  FROM dump_trucks.shift_records sr
  JOIN geo.objects o ON o.uid = sr.object_uid
  WHERE {conditions}
  ORDER BY sr.report_date DESC, sr.vehicle_id

  // Приводим NUMERIC к Number() перед возвратом (особенность pg-драйвера)
  вернуть rows.map(coerceNumericFields)


// Для шапки UI: агрегат по сменам
функция getShiftSummary({ from, to, objectUid?, smu?, region? }):
  SELECT
    shift_type,
    COUNT(DISTINCT vehicle_id)    AS vehicle_count,
    ROUND(AVG(kip_pct), 1)        AS avg_kip_pct,
    ROUND(AVG(moving_pct), 1)     AS avg_moving_pct
  FROM dump_trucks.shift_records sr
  JOIN geo.objects o ON o.uid = sr.object_uid
  WHERE report_date BETWEEN $from AND $to
    AND (фильтры если заданы)
  GROUP BY shift_type

  вернуть {
    shift1: { vehicleCount, avgKipPct, avgMovingPct } | null,
    shift2: { vehicleCount, avgKipPct, avgMovingPct } | null,
    totalVehicleCount: кол-во уникальных vehicle_id
  }
```

---

### 12.2. `tripRepo.ts` — детализация рейсов

```pseudocode
// Upsert всех рейсов для ТС × смена (атомарно: сначала удаляем старые)
функция upsertTrips(trips, { vehicleId, reportDate, shiftType, objectUid }):
  BEGIN транзакция:
    // Удаляем старые рейсы для этой комбинации (при повторном запуске пайплайна)
    DELETE FROM dump_trucks.trips
    WHERE vehicle_id = $vehicleId
      AND report_date = $reportDate
      AND shift_type  = $shiftType
      AND object_uid  = $objectUid

    // Вставляем новые
    для каждого trip из trips:
      // Получить shift_record_id
      shiftRecordId = SELECT id FROM dump_trucks.shift_records
                      WHERE vehicle_id = $vehicleId
                        AND report_date = $reportDate
                        AND shift_type  = $shiftType
                        AND object_uid  = $objectUid

      INSERT INTO dump_trucks.trips (
        shift_record_id, vehicle_id, report_date, shift_type, object_uid,
        trip_number,
        loading_zone_uid, loading_entry_time, loading_exit_time, loading_stay_min,
        unloading_zone_uid, unloading_entry_time, unloading_exit_time, unloading_stay_min,
        travel_to_unload_min, travel_to_load_min,
        is_valid, anomaly_type, comment
      ) VALUES (...)
  COMMIT


// Запрос для вкладки детализации рейсов
функция getTrips({ vehicleId, reportDate, shiftType, objectUid }):
  SELECT
    t.*,
    lz.name AS loading_zone_name,
    uz.name AS unloading_zone_name
  FROM dump_trucks.trips t
  LEFT JOIN geo.zones lz ON lz.uid = t.loading_zone_uid
  LEFT JOIN geo.zones uz ON uz.uid = t.unloading_zone_uid
  WHERE t.vehicle_id  = $vehicleId
    AND t.report_date = $reportDate
    AND t.shift_type  = $shiftType
    AND t.object_uid  = $objectUid
  ORDER BY t.trip_number

  вернуть rows.map(coerceNumericFields)
```

---

### 12.3. `filterRepo.ts` — каскадные фильтры для UI

```pseudocode
// Все доступные фильтры для шапки страницы
// Источник: geo.objects (не из БД самосвалов — там только uid)
функция getFilterOptions():
  // Объекты — из geo схемы
  objects = SELECT uid, name, smu, region
            FROM geo.objects o
            WHERE EXISTS (
              SELECT 1 FROM geo.zone_tags zt
              JOIN geo.zones z ON z.id = zt.zone_id
              WHERE z.object_id = o.id AND zt.tag LIKE 'dt_%'
            )
            ORDER BY name

  // СМУ и регионы — уникальные значения из тех же объектов
  smuList = уникальные ненулевые values objects.map(o => o.smu)
  regions = уникальные ненулевые values objects.map(o => o.region)

  вернуть { objects, smuList, regions }


// Дополнительно: какие ТС работали за период (для динамического счётчика)
функция getActiveVehicleCount({ from, to, objectUid?, smu?, region? }):
  SELECT COUNT(DISTINCT sr.vehicle_id)
  FROM dump_trucks.shift_records sr
  JOIN geo.objects o ON o.uid = sr.object_uid
  WHERE sr.report_date BETWEEN $from AND $to
    AND (фильтры если заданы)
  → число
```

---

### 12.4. `requestRepo.ts` — заявки

```pseudocode
// Переиспользуем логику из блока "тягачи" полностью.
// Единственное отличие — схема dump_trucks вместо public.

// Upsert заявки
функция upsertRequest(parsed):
  INSERT INTO dump_trucks.requests (
    request_id, number, status, date_create,
    applicant, cost_object, plan_volume, raw_json
  )
  ON CONFLICT (request_id) DO UPDATE SET
    status      = EXCLUDED.status,
    plan_volume = EXCLUDED.plan_volume,
    raw_json    = EXCLUDED.raw_json
  // Актуализация незакрытых заявок — точно как в тягачах


// Получить данные заявки по номеру (для обогащения shift_record)
функция getRequestByNumber(number):
  SELECT number, applicant, cost_object, plan_volume
  FROM dump_trucks.requests
  WHERE number = $1
  → { requestNumber, applicant, costObject, planVolume } | null


// Построить маппинг госномер → заявка из ПЛ
// Используется в пайплайне для обогащения записей
функция buildVehicleRequestMap(parsedRouteLists):
  map = Map<regNumber, RequestData>
  для каждого pl из parsedRouteLists:
    для каждого vehicle из pl.vehicles:
      requestNumber = extractRequestNumber(pl.calcs)  // regex из тягачей
      если requestNumber:
        reqData = getRequestByNumber(requestNumber)
        если reqData:
          map.set(vehicle.regNumber, reqData)
  вернуть map
```

---

## 13. Формат ответов API для основной таблицы

> Одна строка таблицы — одна запись `shift_record`. Но формат колонок "Факт по навигации"
> зависит от `work_type`. Фронтенд должен уметь рендерить оба варианта.

```typescript
// Общие поля (присутствуют всегда)
interface ShiftRecordBase {
  id:             number
  reportDate:     string        // 'YYYY-MM-DD'
  shiftType:      'shift1' | 'shift2'
  vehicleId:      string        // госномер
  vehicleModel:   string | null // 'КАМАЗ-6520'
  objectUid:      string
  objectName:     string
  objectSmu:      string | null
  objectRegion:   string | null
  workType:       'delivery' | 'onsite' | 'unknown'

  // План (из заявки — может быть null если заявка не найдена)
  requestNumber:  number | null
  applicant:      string | null
  costObject:     string | null
  planVolume:     number | null  // тонны

  // KPI (всегда из телеметрии)
  engineOnTimeMin: number
  movingTimeMin:   number
  kipPct:          number        // макс 100
  movingPct:       number        // макс 100
  fuelConsumed:    number | null // литры
}

// Доставка — дополнительные поля
interface ShiftRecordDelivery extends ShiftRecordBase {
  workType:             'delivery'
  vehicleCapacity:      number        // грузоподъёмность из справочника
  tripsCount:           number
  factVolume:           number        // tripsCount * vehicleCapacity
  volumeRemainder:      number | null // planVolume - factVolume
  avgLoadingStayMin:    number | null // среднее время в зоне погрузки
  avgUnloadingStayMin:  number | null // среднее время в зоне выгрузки
}

// По месту — дополнительные поля
interface ShiftRecordOnsite extends ShiftRecordBase {
  workType:        'onsite'
  onsiteStayMin:   number  // время стоянки на объекте
  onsiteMovingMin: number  // время в движении на объекте
}

type ShiftRecord = ShiftRecordDelivery | ShiftRecordOnsite | ShiftRecordBase
```

**Пример ответа `GET /api/dt/records`:**

```json
{
  "records": [
    {
      "id": 1,
      "reportDate": "2026-02-17",
      "shiftType": "shift1",
      "vehicleId": "А446АТ172",
      "vehicleModel": "КАМАЗ-6520",
      "objectUid": "singapay",
      "objectName": "Сингапай",
      "objectSmu": "СМУ г. Тюмень",
      "workType": "delivery",
      "requestNumber": 1042,
      "applicant": "ТФ Мостоотряд-36",
      "costObject": "НПС Сингапай",
      "planVolume": 200,
      "kipPct": 87.3,
      "movingPct": 62.1,
      "fuelConsumed": 145.2,
      "vehicleCapacity": 20,
      "tripsCount": 4,
      "factVolume": 80,
      "volumeRemainder": 120,
      "avgLoadingStayMin": 62.5,
      "avgUnloadingStayMin": 24.5
    },
    {
      "id": 2,
      "reportDate": "2026-02-17",
      "shiftType": "shift1",
      "vehicleId": "Х331РХ72",
      "vehicleModel": "Volvo FMX",
      "objectUid": "singapay",
      "objectName": "Сингапай",
      "workType": "onsite",
      "requestNumber": 1041,
      "planVolume": null,
      "kipPct": 91.0,
      "movingPct": 45.3,
      "fuelConsumed": 98.4,
      "onsiteStayMin": 210,
      "onsiteMovingMin": 162
    }
  ],
  "total": 11
}
```

---

## 14. Формат ответа для вкладки рейсов

**Пример ответа `GET /api/dt/trips?vehicleId=А446АТ172&date=2026-02-17&shift=shift1&objectUid=singapay`:**

```json
{
  "vehicleId": "А446АТ172",
  "vehicleModel": "КАМАЗ-6520",
  "date": "2026-02-17",
  "shiftType": "shift1",
  "objectName": "Сингапай",
  "summary": {
    "tripsCount": 4,
    "validTripsCount": 4,
    "avgLoadingStayMin": 62.5,
    "avgUnloadingStayMin": 24.5,
    "avgTravelToUnloadMin": 34.2,
    "avgTravelToLoadMin": 36.0
  },
  "trips": [
    {
      "tripNumber": 1,
      "isValid": true,
      "anomalyType": null,
      "loading": {
        "zoneUid": "zone_abc123",
        "zoneName": "Карьер Сингапай",
        "entryTime": "2026-02-17T08:20:00",
        "exitTime":  "2026-02-17T09:22:00",
        "stayMin":   62
      },
      "unloading": {
        "zoneUid": "zone_def456",
        "zoneName": "Выгрузка на мосту",
        "entryTime": "2026-02-17T09:54:00",
        "exitTime":  "2026-02-17T10:07:00",
        "stayMin":   14
      },
      "travelToUnloadMin": 32,
      "travelToLoadMin":   36
    },
    {
      "tripNumber": 5,
      "isValid": false,
      "anomalyType": "no_unloading",
      "comment": "Нет выгрузки",
      "loading": {
        "zoneUid": "zone_abc123",
        "zoneName": "Карьер Сингапай",
        "entryTime": "2026-02-17T18:03:00",
        "exitTime":  "2026-02-17T18:07:00",
        "stayMin":   4
      },
      "unloading": null,
      "travelToUnloadMin": null,
      "travelToLoadMin":   null
    }
  ]
}
```


---

## 15. Точка входа для разработки — порядок реализации

> Этот раздел написан для AI-агента (Claude CLI) который будет реализовывать проект по данному Blueprint.
> Строго следуй порядку — каждый шаг зависит от предыдущего.

### Шаг 1 — Схема `geo` и миграции (фундамент)

Первым делом создаёшь схему `geo` — от неё зависят оба модуля.

```
1. Создать файл geo-admin/server/migrations/001_geo_schema.sql
   — схема geo, таблицы objects/zones/zone_tags (раздел 1 Geo-Admin-Blueprint)
   — CREATE EXTENSION postgis
   — CREATE INDEX GIST на geo.zones.geom

2. Создать geo-admin/server/src/migrate.ts
   — читает migrations/*.sql, применяет непримененные (раздел 4.2 Backend-Blueprint КИП как образец)

3. Запустить миграцию, убедиться что схема создана
```

### Шаг 2 — `geo-admin` сервер (API для зон)

Без зон в БД пайплайн самосвалов не знает что проверять.

```
1. geo-admin/server/src/config/database.ts  — пул соединений
2. geo-admin/server/src/config/env.ts       — переменные окружения
3. geo-admin/server/src/repositories/objectRepo.ts  — CRUD geo.objects
4. geo-admin/server/src/repositories/zoneRepo.ts    — CRUD geo.zones + zone_tags
5. geo-admin/server/src/utils/slugify.ts    — транслитерация name → uid
6. geo-admin/server/src/index.ts            — Express :3003, все маршруты (раздел 3 Geo-Admin-Blueprint)
7. Проверить: POST /api/geo/objects + POST /api/geo/zones работают
```

### Шаг 3 — Migration-скрипт из geojson файлов

Переносим существующие зоны из файлов в БД.

```
1. geo-admin/server/src/services/migrationService.ts (раздел 5 Geo-Admin-Blueprint)
2. Запустить скрипт на реальных файлах config/geozones.geojson
3. Проверить: GET /api/geo/objects возвращает объекты
4. Архивировать исходные файлы
```

### Шаг 4 — `geo-admin` UI

Нужен чтобы вручную добавить зоны самосвалов (dt_boundary, dt_loading и т.д.)
до того как запускать пайплайн.

```
1. geo-admin/client/index.html + main.ts    — скелет страницы
2. geo-admin/client/map.ts                  — Leaflet + OSM тайлы + Leaflet.draw
3. geo-admin/client/sidebar.ts              — список объектов и зон
4. geo-admin/client/api.ts                  — HTTP-клиент
5. Проверить полный флоу: нарисовать зону → сохранить → увидеть на карте
```

### Шаг 5 — Схема `dump_trucks` и миграции

```
1. dump-trucks/server/migrations/001_dump_trucks_schema.sql
   — схема dump_trucks
   — таблицы shift_records, trips, zone_events, requests, _migrations (раздел 2 DumpTruck-Blueprint)

2. dump-trucks/server/src/migrate.ts — по образцу из шага 1
3. Запустить миграцию
```

### Шаг 6 — Инфраструктура модуля самосвалов

```
1. dump-trucks/server/src/config/database.ts
2. dump-trucks/server/src/config/env.ts
3. dump-trucks/server/src/utils/dateFormat.ts  — переиспользовать из КИП
4. dump-trucks/server/src/utils/logger.ts       — переиспользовать из КИП
5. dump-trucks/server/src/services/tisClient.ts — переиспользовать из КИП
6. dump-trucks/server/src/services/tokenPool.ts — переиспользовать из КИП
7. dump-trucks/server/src/services/dumpTruckRegistry.ts
   — загрузка config/dump-trucks-registry.json в память
   — метод get(regNumber) → { model, capacity } | null
8. Создать config/dump-trucks-registry.json с реальными данными парка
```

### Шаг 7 — Парсеры и вспомогательные сервисы

```
1. dump-trucks/server/src/services/plParser.ts
   — ВЗЯТЬ ГОТОВЫЙ из блока "тягачи", адаптировать импорты

2. dump-trucks/server/src/repositories/requestRepo.ts (раздел 12.4)
   — upsertRequest, getRequestByNumber, buildVehicleRequestMap

3. dump-trucks/server/src/services/workTypeClassifier.ts (раздел 5)
   — classifyWorkType: 'delivery' | 'onsite' | 'unknown'

4. dump-trucks/server/src/services/zoneAnalyzer.ts (раздел 4 Geo-Admin-Blueprint)
   — buildZoneEvents: PostGIS SQL-запрос + построение entry/exit событий

5. dump-trucks/server/src/services/tripBuilder.ts (раздел 6.2)
   — buildTrips: матчинг пар погрузка/выгрузка, аномалии

6. dump-trucks/server/src/services/kpiCalculator.ts (раздел 7)
   — calculateKpi, calculateDeliveryFact, calculateOnsiteFact
```

### Шаг 8 — Репозитории

```
1. dump-trucks/server/src/repositories/shiftRecordRepo.ts (раздел 12.1)
2. dump-trucks/server/src/repositories/tripRepo.ts (раздел 12.2)
3. dump-trucks/server/src/repositories/zoneEventRepo.ts — по аналогии с tripRepo
4. dump-trucks/server/src/repositories/filterRepo.ts (раздел 12.3)
```

### Шаг 9 — Главный пайплайн

```
1. dump-trucks/server/src/jobs/shiftFetchJob.ts (раздел 8)
   — runShiftPipeline(date, shiftType, options?)
   — полная цепочка: ПЛ → детекция → классификация → анализ зон → расчёт → upsert

2. dump-trucks/server/src/jobs/scheduler.ts
   — cron 20:30 → shift1 сегодня
   — cron 08:30 → shift2 вчера

3. Тест: POST /api/dt/admin/fetch?date=YYYY-MM-DD&shift=shift1
   — запустить вручную на реальных данных
   — проверить что записи появились в dump_trucks.shift_records и trips
```

### Шаг 10 — REST API и финальная проверка

```
1. dump-trucks/server/src/index.ts — Express :3002, все маршруты (раздел 9)
2. Проверить все эндпоинты:
   — GET /api/dt/records      → данные основной таблицы
   — GET /api/dt/trips        → детализация рейсов
   — GET /api/dt/summary      → KPI для шапки
   — GET /api/dt/filters      → объекты/СМУ/регионы
   — GET /api/dt/geozones     → GeoJSON для карты
```

### Важные замечания для агента

**Переиспользование кода из КИП и тягачей:**
- `tisClient.ts`, `tokenPool.ts`, `rateLimiter.ts` — копировать как есть, только импорты
- `plParser.ts` — брать из тягачей (самый полный), адаптировать под схему dump_trucks
- `dateFormat.ts`, `logger.ts` — копировать из КИП

**NUMERIC из PostgreSQL:**
- pg-драйвер возвращает NUMERIC-поля как строки
- Везде где читаем из БД — применять `coerceNumericFields()` перед возвратом

**PostGIS и трек:**
- Трек из TIS приходит как массив объектов `{lon, lat, time, speed}`
- Перед передачей в SQL-запрос конвертировать в `JSONB[]`
- `lon/lat` в TIS — в формате WGS84, соответствует SRID 4326 в PostGIS

**Rate limit:**
- `getMonitoringStats` — один запрос на ТС, 30 сек между запросами
- Если самосвалов в ПЛ много (>20) — пайплайн будет работать 10+ минут, это нормально
- Не прерывать весь пайплайн при ошибке одного ТС — try/catch на уровне цикла

**Порядок тегов при классификации:**
- Сначала проверять `dt_onsite` (60% порог) — только потом смотреть на пары погрузка/выгрузка
- Зона может быть одновременно `dt_loading` и `dt_onsite` — это валидно
