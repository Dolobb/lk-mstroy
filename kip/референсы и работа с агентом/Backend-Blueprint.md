# Backend Blueprint — КИП техники

> Этот файл описывает **всю логику бэкенда** так, чтобы другой ИИ-агент мог воспроизвести архитектуру с нуля. Формат: псевдокод + пояснения на русском.

---

## 1. Общая идея

Система собирает данные о строительной технике из внешнего API (TIS Online), рассчитывает KPI (загрузка, утилизация, расход топлива) и отдаёт результаты через REST API для фронтенда (карта + таблица).

**Стек**: Node.js + Express + TypeScript + PostgreSQL 16 + Axios + dayjs + Turf.js + node-cron.

---

## 2. Структура файлов

```
server/src/
├── index.ts                    # Express-сервер, все маршруты, запуск
├── migrate.ts                  # Скрипт миграций БД
├── config/
│   ├── database.ts             # Пул соединений pg.Pool (singleton)
│   └── env.ts                  # Чтение .env, конфиг-объект (singleton)
├── jobs/
│   ├── dailyFetchJob.ts        # Главный data pipeline
│   └── scheduler.ts            # Cron-расписание (node-cron)
├── repositories/
│   ├── vehicleRecordRepo.ts    # CRUD + агрегации для vehicle_records
│   ├── requestRepo.ts          # Upsert + запросы для requests
│   ├── routeListRepo.ts        # Upsert route_lists + pl_calcs + vehicles
│   └── filterRepo.ts           # Каскадные фильтры для UI
├── services/
│   ├── tisClient.ts            # HTTP-клиент к TIS API с ретраями
│   ├── tokenPool.ts            # Round-robin ротация токенов
│   ├── rateLimiter.ts          # Rate limit: 1 запрос/30сек на ТС
│   ├── plParser.ts             # Парсинг ПЛ, нарезка на смены, interleave
│   ├── shiftSplitter.ts        # Период ПЛ → массив ShiftWindow[]
│   ├── monitoringParser.ts     # Ответ мониторинга → ParsedMonitoringRecord
│   ├── requestParser.ts        # Ответ заявок → ParsedRequest
│   ├── vehicleFilter.ts        # Фильтр ТС через реестр
│   ├── vehicleRegistry.ts      # In-memory справочник ТС из JSON
│   ├── kpiCalculator.ts        # Формулы KPI
│   └── geozoneAnalyzer.ts      # Анализ трека по геозонам (Turf.js)
├── types/
│   ├── domain.ts               # Внутренние интерфейсы
│   └── tis-api.ts              # Типы ответов TIS API
└── utils/
    ├── dateFormat.ts            # dayjs-обёртки для парсинга/форматирования дат
    └── logger.ts               # Логгер с таймстемпами

config/                         # В корне репо, читается сервером
├── vehicle-registry.json       # ~170 ТС: regNumber, type, branch, fuelNorm
├── geozones.geojson            # Полигоны рабочих зон (экспорт из fleetradar)
├── shifts.json                 # Границы смен: утро 07:30–19:30, вечер 19:30–07:30
├── vehicle-types.json          # Legacy-ключевые слова (не используется pipeline)
├── customers.json              # idOwnCustomer → название заказчика
└── fuel-norms.json             # Legacy нормы (заменён vehicle-registry)
```

---

## 3. Конфигурация и подключение к БД

### 3.1. Переменные окружения (`config/env.ts`)

```pseudocode
функция getEnvConfig():
  если конфиг уже загружен → вернуть кэш
  прочитать .env из корня проекта (../../.env от dist/)
  вернуть объект:
    tisApiUrl        = TIS_API_URL (обязательно)
    tisApiTokens     = TIS_API_TOKENS.split(",") (обязательно, ≥1 токен)
    dbHost           = DB_HOST || "localhost"
    dbPort           = DB_PORT || 5432
    dbName           = DB_NAME (обязательно)
    dbUser           = DB_USER || "postgres"
    dbPassword       = DB_PASSWORD || ""
    serverPort       = SERVER_PORT || 3001
    nodeEnv          = NODE_ENV || "development"
    rateLimitPerVehicleMs = RATE_LIMIT_PER_VEHICLE_MS || 30000
```

### 3.2. Пул соединений (`config/database.ts`)

```pseudocode
переменная _pool = null

функция getPool():
  если _pool !== null → вернуть _pool
  config = getEnvConfig()
  _pool = new pg.Pool({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPassword,
    max: 10,
    idleTimeoutMillis: 30000,
  })
  _pool.on("error") → логировать (НЕ крашить)
  вернуть _pool
```

---

## 4. База данных

### 4.1. Схема таблиц

```sql
-- Главная таблица KPI (то, что видит UI)
CREATE TABLE vehicle_records (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  shift_type VARCHAR(20) NOT NULL,        -- 'morning' | 'evening'
  vehicle_id VARCHAR(20) NOT NULL,        -- госномер ТС
  vehicle_model VARCHAR(200),             -- nameMO из TIS
  company_name VARCHAR(200),              -- tsType из ПЛ
  department_unit VARCHAR(200),           -- название геозоны с макс. временем
  total_stay_time NUMERIC(8,4),           -- часы в рабочих зонах
  engine_on_time NUMERIC(8,4),            -- часы работы двигателя
  idle_time NUMERIC(8,4),                 -- total_stay - engine_on
  fuel_consumed_total NUMERIC(10,4),      -- литры
  fuel_rate_fact NUMERIC(10,4),           -- литры/час факт
  max_work_allowed NUMERIC(8,4),          -- total_stay * 22/24
  fuel_rate_norm NUMERIC(10,4),           -- литры/час норма (из справочника)
  fuel_max_calc NUMERIC(10,4),            -- engine_on * fuel_rate_norm
  fuel_variance NUMERIC(10,4),            -- fuel_rate_fact / fuel_rate_norm
  load_efficiency_pct NUMERIC(6,2),       -- (fact/norm)*100
  utilization_ratio NUMERIC(6,2),         -- min(engine/total, 1)*100
  latitude NUMERIC(10,7),                 -- последняя GPS-точка
  longitude NUMERIC(10,7),
  track_simplified JSONB,                 -- прореженный трек (интервал 20 мин)
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(report_date, shift_type, vehicle_id)  -- ← ключ для upsert
);

-- Путевые листы из TIS
CREATE TABLE route_lists (
  id SERIAL PRIMARY KEY,
  pl_id BIGINT UNIQUE NOT NULL,           -- TIS API id
  ts_number BIGINT,
  ts_type VARCHAR(30),                    -- используется как company_name
  date_out DATE,
  date_out_plan TIMESTAMP,                -- начало периода ПЛ
  date_in_plan TIMESTAMP,                 -- конец периода ПЛ
  status VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Калькуляции ПЛ (задачи/наряды)
CREATE TABLE pl_calcs (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER REFERENCES route_lists(id) ON DELETE CASCADE,
  order_descr TEXT,                        -- описание задачи (содержит номер заявки)
  extracted_request_number INTEGER,        -- извлечённый номер заявки (regex)
  object_expend VARCHAR(50),
  driver_task TEXT,
  id_order INTEGER                         -- прямая связь с order в заявке
);

-- ТС привязанные к ПЛ
CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER REFERENCES route_lists(id) ON DELETE CASCADE,
  id_mo INTEGER,                           -- TIS monitoring object ID
  reg_number VARCHAR(20),                  -- госномер
  name_mo VARCHAR(200),
  category VARCHAR(10),
  garage_number VARCHAR(30)
);

-- Заявки из TIS
CREATE TABLE requests (
  id SERIAL PRIMARY KEY,
  request_id INTEGER UNIQUE,               -- TIS API id
  number INTEGER,                          -- номер заявки (ключ для matching)
  status VARCHAR(30),
  date_create TIMESTAMP,
  date_processed TIMESTAMP,
  contact_person VARCHAR(200),
  raw_json JSONB,                          -- полный ответ API (orders, маршрут и т.д.)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Журнал миграций
CREATE TABLE _migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);
```

### 4.2. Система миграций (`migrate.ts`)

```pseudocode
функция main():
  pool = getPool()
  CREATE TABLE IF NOT EXISTS _migrations (name, applied_at)
  files = прочитать server/migrations/*.sql (отсортированные по имени)
  для каждого file:
    если file.name уже есть в _migrations → пропустить
    выполнить SQL из файла
    INSERT INTO _migrations(name) VALUES (file.name)
  закрыть pool
```

### 4.3. Важный подвох PostgreSQL

**NUMERIC-колонки возвращаются как строки** через pg-драйвер. Каждый репозиторий должен вызывать `Number()` на всех числовых полях перед возвратом:

```pseudocode
функция coerceNumericFields(row):
  для каждого числового поля из списка:
    если row[field] != null → row[field] = Number(row[field])
  вернуть row
```

---

## 5. Внешнее API — TIS Online

### 5.1. Формат запросов (КРИТИЧНО)

**Все запросы — POST с пустым телом, параметры в query string:**

```
POST {baseUrl}?token=abc123&format=json&command=getRouteListsByDateOut&fromDate=01.02.2026&toDate=07.02.2026
Content-Length: 0
```

Три команды:
| Команда | Даты формат | Ответ |
|---------|-------------|-------|
| `getRouteListsByDateOut` | `DD.MM.YYYY` | `{ list: TisRouteList[] }` |
| `getRequests` | `DD.MM.YYYY` | `{ list: TisRequest[] }` |
| `getMonitoringStats` | `DD.MM.YYYY HH:mm` | объект TisMonitoringStats |

### 5.2. Пул токенов (`tokenPool.ts`)

```pseudocode
класс TokenPool:
  tokens: string[]
  index: number = 0

  next():
    token = tokens[index % tokens.length]
    index++
    вернуть token
```

18 токенов из `.env` (через запятую). Round-robin: каждый вызов берёт следующий токен.

### 5.3. Rate limiter (`rateLimiter.ts`)

```pseudocode
класс PerVehicleRateLimiter:
  lastCallMap: Map<idMO → timestamp>
  intervalMs: 30000

  async waitForSlot(idMO):
    lastCall = lastCallMap.get(idMO) || 0
    elapsed = Date.now() - lastCall
    если elapsed < intervalMs:
      await sleep(intervalMs - elapsed)
    lastCallMap.set(idMO, Date.now())
```

### 5.4. HTTP-клиент с ретраями (`tisClient.ts`)

```pseudocode
класс TisClient:
  baseUrl, tokenPool, rateLimiter

  async requestWithRetry(command, params):
    token = tokenPool.next()
    url = "{baseUrl}?token={token}&format=json&command={command}&{params}"

    для attempt429 от 0 до 5:
      для attemptTimeout от 0 до 3:
        попробовать:
          response = POST url (пустое тело, timeout 30сек)
          вернуть response.data
        поймать ошибку:
          404 → вернуть null (нет данных — это нормально)
          429 → ждать (attempt429+1)*10сек, break внутренний цикл
          timeout → ждать 2^attemptTimeout * 1сек, continue
          другое → throw

  async getRequests(from, to):
    result = requestWithRetry("getRequests", {fromDate: DD.MM.YYYY, toDate: DD.MM.YYYY})
    вернуть result?.list ?? []

  async getRouteListsByDateOut(from, to):
    result = requestWithRetry("getRouteListsByDateOut", {fromDate: DD.MM.YYYY, toDate: DD.MM.YYYY})
    вернуть result?.list ?? []

  async getMonitoringStats(idMO, from, to):
    await rateLimiter.waitForSlot(idMO)  // ← ждём rate limit
    result = requestWithRetry("getMonitoringStats", {
      idMO,
      fromDate: DD.MM.YYYY HH:mm,  // ← формат с часами!
      toDate: DD.MM.YYYY HH:mm
    })
    вернуть result  // объект или null
```

---

## 6. Справочник ТС (`vehicleRegistry.ts`)

```pseudocode
// Файл: config/vehicle-registry.json
// Структура: { "vehicles": [{ regNumber, type, branch, fuelNorm }, ...] }
// ~170 записей

_registry: RegistryEntry[] = null
_lookupMap: Map<string(upperCase) → RegistryEntry> = null

функция loadRegistry():
  если _registry !== null → return
  data = JSON.parse(readFile("config/vehicle-registry.json"))
  _registry = data.vehicles
  _lookupMap = new Map()
  для каждого entry в _registry:
    _lookupMap.set(entry.regNumber.toUpperCase(), entry)

функция getVehicleInfo(regNumber):
  loadRegistry()
  вернуть _lookupMap.get(regNumber.toUpperCase()) || null
  // { type: "Бульдозер", branch: "БСМ-мост", fuelNorm: 15.5 }

функция isRegistered(regNumber):
  вернуть _lookupMap.has(regNumber.toUpperCase())

функция getDistinctBranches():
  вернуть уникальные значения branch из _registry

функция getDistinctTypes():
  вернуть уникальные значения type из _registry
```

**Роль справочника:**
- Pipeline: `isRegistered()` фильтрует ТС (только зарегистрированные обрабатываются)
- API: `getVehicleInfo()` обогащает ответ полями `type` и `branch`
- KPI: `fuelNorm` (литры/час) из справочника используется в расчётах

---

## 7. Парсинг путевых листов (`plParser.ts`)

### 7.1. Извлечение номера заявки

```pseudocode
функция extractRequestNumber(orderDescr):
  если orderDescr пустой → null

  // Попробовать: "заявка №123", "заявке #456", "заявку N789"
  regex1 = /заявк[аеиу]\s*(?:№|#|N)?\s*(\d+)/i
  // Попробовать: "№123", "#456"
  regex2 = /(?:№|#)\s*(\d+)/

  match = orderDescr.match(regex1) || orderDescr.match(regex2)
  если match → вернуть parseInt(match[1])

  // Fallback: первое число из 3+ цифр
  numMatch = orderDescr.match(/(\d{3,})/)
  вернуть numMatch ? parseInt(numMatch[1]) : null
```

### 7.2. Нарезка на смены (`shiftSplitter.ts`)

```pseudocode
// Файл: config/shifts.json
// { "morning": { "start": "07:30", "end": "19:30" },
//   "evening": { "start": "19:30", "end": "07:30" } }

функция splitIntoShifts(dateOutPlan, dateInPlan) → ShiftWindow[]:
  результат = []

  начатьСДня = dateOutPlan минус 1 день  // ловим ночную смену предыдущего дня
  для каждого calendarDay от начатьСДня до dateInPlan:

    утроОкно = { from: calendarDay 07:30, to: calendarDay 19:30 }
    вечерОкно = { from: calendarDay 19:30, to: calendarDay+1 07:30 }

    если ПЛ-период [dateOutPlan, dateInPlan] пересекается с утроОкно:
      результат.push({
        shiftType: "morning",
        date: calendarDay (YYYY-MM-DD),   // ← report_date
        from: max(dateOutPlan, утроОкно.from),
        to: min(dateInPlan, утроОкно.to)
      })

    если ПЛ-период пересекается с вечерОкно:
      результат.push({
        shiftType: "evening",
        date: calendarDay (YYYY-MM-DD),   // ← вечер привязан к дню НАЧАЛА
        from: max(dateOutPlan, вечерОкно.from),
        to: min(dateInPlan, вечерОкно.to)
      })

  вернуть результат
```

### 7.3. Сборка задач

```pseudocode
функция buildVehicleTasks(routeLists) → VehicleTask[]:
  tasks = []
  для каждого ПЛ в routeLists:
    dateOutPlan = parse(pl.dateOutPlan)   // "DD.MM.YYYY HH:mm:ss"
    dateInPlan = parse(pl.dateInPlan)

    shifts = splitIntoShifts(dateOutPlan, dateInPlan)
    vehicles = filterVehicles(pl.ts)      // только зарегистрированные в реестре
    requestNumbers = pl.calcs.map(c → extractRequestNumber(c.orderDescr)).filter(не null)

    // Декартово произведение: каждое ТС × каждая смена
    для каждого vehicle в vehicles:
      для каждого shift в shifts:
        tasks.push({
          idMO: vehicle.idMO,
          regNumber: vehicle.regNumber,
          nameMO: vehicle.nameMO,
          category, garageNumber,
          plId: pl.id,
          companyName: pl.tsType,
          shift,
          requestNumbers
        })

  вернуть tasks
```

### 7.4. Чередование задач (interleave)

```pseudocode
функция interleaveTasks(tasks) → VehicleTask[]:
  // Группируем по idMO
  groups = Map<idMO, VehicleTask[]>

  // Round-robin: берём по одной задаче из каждой группы
  // [A1,A2,B1,B2,C1] → [A1,B1,C1,A2,B2]
  // Зачем: чтобы последовательные API-запросы шли к разным ТС,
  // максимизируя пользу от per-vehicle rate limit (30сек между запросами к одному ТС)

  result = []
  пока есть непустые группы:
    для каждой группы:
      если группа не пуста:
        result.push(group.shift())
  вернуть result
```

---

## 8. Парсинг мониторинга (`monitoringParser.ts`)

```pseudocode
функция parseMonitoringStats(stats: TisMonitoringStats) → ParsedMonitoringRecord:
  engineOnTime = stats.engineTime / 3600    // секунды → часы

  fuelConsumedTotal = stats.fuels.reduce(sum, fuel.rate)  // сумма по всем бакам

  lastPoint = stats.track[последний]
  lastLat = lastPoint?.lat ?? null
  lastLon = lastPoint?.lon ?? null

  // Прореженный трек: оставляем точки через ≥20 минут + первую + последнюю
  trackSimplified = simplifyTrack(stats.track)

  // Полный трек: все точки для анализа геозон
  fullTrack = stats.track.map(p → { lat, lon, timestamp: p.time })
  // ВАЖНО: поле называется "time" (не "timestamp") в API!

  вернуть { engineOnTime, fuelConsumedTotal, lastLat, lastLon, trackSimplified, fullTrack }
```

---

## 9. Анализ геозон (`geozoneAnalyzer.ts`)

### 9.1. Загрузка зон

```pseudocode
функция loadGeozones():
  если кэш не пуст → вернуть кэш

  data = JSON.parse(readFile("config/geozones.geojson"))

  // Фильтр: controlType === 1 И zoneName начинается с "СМУ"
  кэш = data.features.filter(f →
    f.properties.controlType === 1
    AND f.geometry.type === "Polygon"
    AND f.properties.zoneName.startsWith("СМУ")
  ).map(f → {
    id: f.properties.uid,
    name: f.properties.zoneName,
    departmentUnit: f.properties.zoneName,   // полное имя зоны
    feature: f
  })

  вернуть кэш
```

### 9.2. Анализ трека по зонам

```pseudocode
функция analyzeTrackGeozones(track) → GeozoneResult:
  zones = loadGeozones()
  если зон нет ИЛИ track.length < 2 → вернуть пустой результат

  // 1. Классификация: для каждой точки → в какой она зоне (или null)
  pointZones = track.map(p → findZone(p.lat, p.lon, zones))
  // findZone: Turf.js booleanPointInPolygon(point([lon, lat]), zone.feature)
  // ВНИМАНИЕ: GeoJSON = [longitude, latitude] (не наоборот!)

  // 2. Расчёт времени: идём по парам соседних точек
  zoneTimeMs = Map<zoneId → milliseconds>
  outsideMs = 0
  zoneExits = []

  для i от 0 до track.length-2:
    interval = timestamp[i+1] - timestamp[i]    // миллисекунды
    z0 = pointZones[i]
    z1 = pointZones[i+1]

    если z0 == z1 && z0 != null:
      zoneTimeMs[z0.id] += interval              // обе в одной зоне

    если z0 != null && z1 != null && z0.id != z1.id:
      zoneTimeMs[z0.id] += interval/2            // переход между зонами
      zoneTimeMs[z1.id] += interval/2
      zoneExits.push({ из z0 })

    если z0 != null && z1 == null:
      zoneTimeMs[z0.id] += interval/2            // выезд из зоны
      outsideMs += interval/2
      zoneExits.push({ из z0 })

    если z0 == null && z1 != null:
      zoneTimeMs[z1.id] += interval/2            // въезд в зону
      outsideMs += interval/2

    если z0 == null && z1 == null:
      outsideMs += interval                       // обе вне зон

  // 3. Итог
  zoneBreakdown = [{zoneId, zoneName, departmentUnit, timeHours}...]  // сортировка по убыванию времени
  totalStayTime = сумма zoneBreakdown[].timeHours
  departmentUnit = зона с максимальным временем (или "" если нет зон)

  вернуть { totalStayTime, departmentUnit, outsideZoneTime, zoneBreakdown, zoneExits }
```

---

## 10. Расчёт KPI (`kpiCalculator.ts`)

```pseudocode
функция calculateKpi({ total_stay_time, engine_on_time, fuel_consumed_total, fuel_rate_norm }):

  fuel_rate_fact = fuel_consumed_total / engine_on_time    // литры/час факт
                   (0 если engine_on_time = 0)

  max_work_allowed = total_stay_time * (22/24)             // макс. допустимое время работы

  fuel_max_calc = engine_on_time * fuel_rate_norm           // макс. допустимый расход

  fuel_variance = fuel_rate_fact / fuel_rate_norm            // отклонение расхода
                  (0 если fuel_rate_norm = 0)

  load_efficiency_pct = (fuel_rate_fact / fuel_rate_norm) * 100  // % загрузки

  utilization_ratio = min(engine_on_time / total_stay_time, 1) * 100  // % использования
                      (0 если total_stay_time = 0)

  idle_time = max(0, total_stay_time - engine_on_time)      // простой

  // Все значения ≥ 0 через Math.max(0, ...)
  вернуть { fuel_rate_fact, max_work_allowed, fuel_max_calc,
            fuel_variance, load_efficiency_pct, utilization_ratio, idle_time }
```

---

## 11. Главный pipeline (`dailyFetchJob.ts`)

```pseudocode
функция runDailyFetch(dateStr?):
  config = getEnvConfig()
  targetDate = dateStr ? parse(dateStr) : вчера

  // === Инициализация клиентов ===
  tokenPool = new TokenPool(config.tisApiTokens)        // 18 токенов
  rateLimiter = new PerVehicleRateLimiter(30000)         // 30сек на ТС
  client = new TisClient({ baseUrl, tokenPool, rateLimiter })

  // === ШАГ 1: Путевые листы (7 дней назад) ===
  routeLists = await client.getRouteListsByDateOut(targetDate - 7д, targetDate)
  await upsertRouteLists(routeLists)
  // Сохраняет в БД: route_lists + pl_calcs + vehicles (через транзакцию)

  // === ШАГ 2: Нарезка на задачи ===
  tasks = buildVehicleTasks(routeLists)
  // Внутри: фильтр ТС через реестр → нарезка на смены → декартово произведение

  interleaved = interleaveTasks(tasks)
  // Чередование: [A1,A2,B1,B2] → [A1,B1,A2,B2]

  // === ШАГ 3: Заявки (2 месяца назад) ===
  allReqNumbers = уникальные requestNumbers из всех задач
  если есть номера заявок:
    requests = await client.getRequests(targetDate - 2мес, targetDate)
    parsed = parseRequests(requests)
    await upsertRequests(parsed)
    // upsert по request_id (ON CONFLICT DO UPDATE)

  // === ШАГ 4: Мониторинг + KPI для каждой задачи (ПОСЛЕДОВАТЕЛЬНО) ===
  successCount = 0, skipCount = 0, errorCount = 0

  для каждой task в interleaved:
    попробовать:
      // 4a. Запрос мониторинга (с rate-limit ожиданием)
      stats = await client.getMonitoringStats(task.idMO, task.shift.from, task.shift.to)

      если stats == null:
        skipCount++
        continue    // нет данных — пропускаем ТС

      // 4b. Парсинг ответа мониторинга
      monitoring = parseMonitoringStats(stats)
      // → engineOnTime (часы), fuelConsumedTotal (литры), fullTrack, trackSimplified

      // 4c. Анализ геозон
      geozoneResult = analyzeTrackGeozones(monitoring.fullTrack)

      // FALLBACK: если геозоны не дали результат → используем время двигателя
      totalStayTime = geozoneResult.totalStayTime > 0
        ? geozoneResult.totalStayTime
        : monitoring.engineOnTime
      departmentUnit = geozoneResult.departmentUnit

      // 4d. Норма расхода из справочника
      fuelRateNorm = matchFuelNorm(task.regNumber)  // vehicle-registry.json

      // 4e. Расчёт KPI
      kpi = calculateKpi({
        total_stay_time: totalStayTime,
        engine_on_time: monitoring.engineOnTime,
        fuel_consumed_total: monitoring.fuelConsumedTotal,
        fuel_rate_norm: fuelRateNorm
      })

      // 4f. Сохранение в БД (upsert по report_date + shift_type + vehicle_id)
      await upsertVehicleRecord({
        report_date: task.shift.date,
        shift_type: task.shift.shiftType,
        vehicle_id: task.regNumber,
        vehicle_model: task.nameMO,
        company_name: task.companyName,
        department_unit: departmentUnit,
        ...kpi,                             // все KPI-поля
        total_stay_time: totalStayTime,
        engine_on_time: monitoring.engineOnTime,
        fuel_consumed_total: monitoring.fuelConsumedTotal,
        fuel_rate_norm: fuelRateNorm,
        latitude: monitoring.lastLat,
        longitude: monitoring.lastLon,
        track_simplified: monitoring.trackSimplified,
      })

      successCount++

    поймать ошибку:
      errorCount++
      логировать ошибку
      // НЕ прерываем цикл — ошибка одного ТС не останавливает весь pipeline

  логировать итог: "{success} success, {skip} skipped, {error} errors"
```

---

## 12. Cron-расписание (`scheduler.ts`)

```pseudocode
функция startScheduler():
  cron.schedule("30 7 * * *", () → runDailyFetch(), {
    timezone: "Asia/Yekaterinburg"  // UTC+5
  })
  // Каждый день в 07:30 по Екатеринбургу
  // runDailyFetch() без аргумента → обрабатывает вчерашний день
```

---

## 13. Репозитории (работа с БД)

### 13.1. Путевые листы (`routeListRepo.ts`)

```pseudocode
функция upsertRouteLists(routeLists):
  для каждого pl:
    BEGIN TRANSACTION

    // 1. Upsert route_lists по pl_id
    INSERT INTO route_lists (pl_id, ts_number, ts_type, date_out, ...)
    ON CONFLICT (pl_id) DO UPDATE SET ...
    RETURNING id

    // 2. Пересоздание связанных записей (delete + insert)
    DELETE FROM pl_calcs WHERE route_list_id = id
    DELETE FROM vehicles WHERE route_list_id = id

    // 3. Insert pl_calcs с извлечёнными номерами заявок
    для каждого calc в pl.calcs:
      INSERT INTO pl_calcs (route_list_id, order_descr,
        extracted_request_number,   // ← extractRequestNumber(calc.orderDescr)
        object_expend, driver_task,
        id_order)                   // ← calc.idOrder (прямая связь)

    // 4. Insert vehicles
    для каждого vehicle в pl.ts:
      INSERT INTO vehicles (route_list_id, id_mo, reg_number, name_mo, ...)

    COMMIT (или ROLLBACK при ошибке)
```

### 13.2. Заявки (`requestRepo.ts`)

```pseudocode
функция upsertRequests(requests):
  для каждого req:
    INSERT INTO requests (request_id, number, status, date_create, date_processed, contact_person, raw_json)
    ON CONFLICT (request_id) DO UPDATE SET status, date_processed, contact_person, raw_json

функция getRequestsForVehicle(vehicleId, from, to):
  // 1. Найти номера заявок для ТС через цепочку таблиц
  SELECT pc.extracted_request_number, pc.id_order
  FROM pl_calcs pc
  JOIN route_lists rl ON rl.id = pc.route_list_id
  JOIN vehicles v ON v.route_list_id = rl.id
  WHERE v.reg_number = vehicleId
    AND rl.date_out BETWEEN from AND to
    AND pc.extracted_request_number IS NOT NULL

  // 2. Найти заявки по номерам
  SELECT * FROM requests WHERE number = ANY(номера)

  // 3. Обогатить: найти нужный order внутри raw_json.orders[]
  //    используя id_order для точного совпадения
  //    Fallback: первый order если id_order не совпал

  // 4. Подставить имя заказчика из config/customers.json
  //    по ключу order.idOwnCustomer → "Маурер-Мостострой-11"
```

### 13.3. Агрегация для UI (`vehicleRecordRepo.ts`)

```pseudocode
функция getWeeklyAggregated({ from, to, shift?, branches?, types?, departments?, kpiRanges? }):

  // SQL: средние KPI за период, сгруппированные по vehicle_id
  WITH agg AS (
    SELECT
      vehicle_id,
      MAX(vehicle_model) AS vehicle_model,
      MAX(company_name) AS company_name,
      -- department_unit: с наибольшим total_stay_time
      (ARRAY_AGG(department_unit ORDER BY total_stay_time DESC))[1] AS department_unit,
      AVG(total_stay_time) AS avg_total_stay_time,
      AVG(engine_on_time) AS avg_engine_on_time,
      GREATEST(AVG(idle_time), 0) AS avg_idle_time,
      AVG(fuel_consumed_total) AS avg_fuel,
      AVG(load_efficiency_pct) AS avg_load_efficiency_pct,
      AVG(utilization_ratio) AS avg_utilization_ratio,
      -- координаты: самые свежие ненулевые
      (ARRAY_AGG(latitude ORDER BY report_date DESC, shift_type DESC)
        FILTER (WHERE latitude IS NOT NULL))[1] AS latitude,
      (ARRAY_AGG(longitude ORDER BY report_date DESC, shift_type DESC)
        FILTER (WHERE longitude IS NOT NULL))[1] AS longitude,
      COUNT(*) AS record_count
    FROM vehicle_records
    WHERE report_date BETWEEN $from AND $to
      AND (shift IS NULL OR shift_type = shift)
      AND (departments пусты OR department_unit IN departments)
    GROUP BY vehicle_id
  )
  SELECT * FROM agg ORDER BY vehicle_id

  // Post-фильтры в JS (не в SQL — данные в справочнике, не в БД):

  // Фильтр по branch/type:
  если branches или types заданы:
    rows = rows.filter(r → {
      info = getVehicleInfo(r.vehicle_id)
      проверить info.branch ∈ branches И info.type ∈ types
    })

  // Фильтр по KPI-диапазонам (e.g. ["0-25", "50-75"]):
  если kpiRanges заданы:
    ranges = kpiRanges.map("0-25" → {lo:0, hi:25})
    rows = rows.filter(r → any range: r.avg_utilization_ratio ∈ [lo, hi])

  вернуть rows  // с Number() на всех NUMERIC-полях!
```

### 13.4. Каскадные фильтры (`filterRepo.ts`)

```pseudocode
функция getFilterOptions(from, to, branches?, types?) → { branches, types, departments }:
  // branches и types — из справочника (in-memory), НЕ из БД
  branches = getDistinctBranches()   // vehicleRegistry
  types = getDistinctTypes()          // vehicleRegistry

  // departments — из БД (уникальные за период)
  SELECT DISTINCT vehicle_id, department_unit
  FROM vehicle_records WHERE report_date BETWEEN from AND to

  // Если указаны branches/types → фильтровать departments через реестр
  если branches или types заданы:
    departments = departments.filter(d →
      getVehicleInfo(d.vehicle_id) совпадает по branch/type
    )

  вернуть { branches, types, departments: уникальные отсортированные }
```

---

## 14. Express-сервер (`index.ts`)

### 14.1. Запуск

```pseudocode
dotenv.config()
app = express()
app.use(cors())
app.use(express.json())

// Раздача клиентского билда
app.use(express.static("client/dist"))

// ... маршруты (см. ниже) ...

// SPA-fallback: всё, что не /api/* → client/dist/index.html
app.get("*", → res.sendFile("client/dist/index.html"))

app.listen(PORT)        // PORT = SERVER_PORT || 3001
startScheduler()        // запуск cron-задачи
```

### 14.2. API-маршруты

```pseudocode
GET /api/health
  → { status: "ok" }

GET /api/vehicles?date=YYYY-MM-DD&shift=morning
  // Legacy-эндпоинт. Получает записи за 1 день.
  records = getVehicleRecords(date, shift)
  reqMap = getRequestNumbersForDate(date, shift)
  → records с добавленным полем request_numbers[]

GET /api/vehicles/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD&shift=&branch[]=&type[]=&department[]=&kpiRange[]=
  // Основной эндпоинт. Средние KPI за период для карты.
  rows = getWeeklyAggregated({ from, to, shift, branches, types, departments, kpiRanges })
  reqMap = getRequestNumbersForDateRange(from, to)

  // Обогащение из справочника ТС
  enriched = rows.map(r → {
    info = getVehicleInfo(r.vehicle_id)
    ...r,
    vehicle_type: info?.type ?? "",
    branch: info?.branch ?? "",
    request_numbers: reqMap.get(r.vehicle_id) ?? []
  })
  → enriched

GET /api/vehicles/:id/details?from=&to=
  // Детализация по дням/сменам для конкретного ТС
  → getVehicleDetails(id, from, to)

GET /api/vehicles/:id/requests?from=&to=
  // Заявки привязанные к ТС
  → getRequestsForVehicle(id, from, to)

GET /api/filters?from=&to=&branch[]=&type[]=
  // Каскадные фильтры для UI
  → getFilterOptions(from, to, branches, types)
  → { branches[], types[], departments[] }

GET /api/geozones
  // GeoJSON для отрисовки зон на карте
  → getFilteredGeozonesGeoJson()

POST /api/admin/fetch?date=YYYY-MM-DD
  // Ручной запуск pipeline (async — отвечает сразу)
  runDailyFetch(date).catch(логировать)
  → { status: "started", date }
```

---

## 15. Утилиты

### 15.1. Работа с датами (`dateFormat.ts`)

```pseudocode
// Библиотека: dayjs с плагином customParseFormat

parseDdMmYyyy("01.02.2026") → Date         // строгий парсинг "DD.MM.YYYY"
parseDdMmYyyyHhmm("01.02.2026 07:30:00") → Date  // "DD.MM.YYYY HH:mm:ss" или "DD.MM.YYYY HH:mm"
formatDateParam(date) → "DD.MM.YYYY"        // для TIS API (getRequests, getRouteListsByDateOut)
formatDateTimeParam(date) → "DD.MM.YYYY HH:mm"  // для TIS API (getMonitoringStats)
formatDateIso(date) → "YYYY-MM-DD"          // для БД
secondsToHours(3600) → 1.0
```

### 15.2. Логгер (`logger.ts`)

```pseudocode
logger.info(msg, data?)    // [2026-02-17T07:30:00.000Z] [INFO] message {data}
logger.warn(msg, data?)
logger.error(msg, data?)
logger.debug(msg, data?)   // подавляется в production
```

---

## 16. Ключевые конфиг-файлы

### `config/vehicle-registry.json`
```json
{
  "vehicles": [
    { "regNumber": "8914РА77", "type": "Бульдозер", "branch": "БСМ-мост", "fuelNorm": 15.5 },
    { "regNumber": "А123ВС77", "type": "Автокран", "branch": "СМУ-1", "fuelNorm": 22.0 }
  ]
}
```

### `config/shifts.json`
```json
{
  "morning": { "start": "07:30", "end": "19:30" },
  "evening": { "start": "19:30", "end": "07:30" }
}
```

### `config/customers.json`
```json
{
  "-1760149554": "Маурер-Мостострой-11",
  "721754389": "ТФ \"Мостоотряд-87\""
}
```

### `config/geozones.geojson`
GeoJSON FeatureCollection<Polygon> с properties: `{ zoneName, uid, zoneGroup, controlType }`.
Используются только зоны с `controlType === 1` и `zoneName.startsWith("СМУ")`.

---

## 17. Зависимости (package.json сервера)

| Пакет | Зачем |
|-------|-------|
| `express` | HTTP-сервер |
| `cors` | CORS middleware |
| `dotenv` | Загрузка .env |
| `pg` + `pg-pool` | PostgreSQL-клиент |
| `axios` | HTTP-запросы к TIS API |
| `dayjs` | Парсинг/форматирование дат |
| `node-cron` | Cron-расписание |
| `@turf/boolean-point-in-polygon` + `@turf/helpers` | Point-in-polygon для геозон |

Dev: `tsx` (live reload), `typescript`, `ts-node` (миграции), `jest` + `ts-jest`.

---

## 18. Поток данных (итоговая схема)

```
TIS API (внешний)
  │
  ├─ getRouteListsByDateOut (7 дней)
  │     ↓
  │   upsertRouteLists → [route_lists] + [pl_calcs] + [vehicles]
  │     ↓
  │   buildVehicleTasks → фильтр ТС по реестру + нарезка на смены
  │     ↓
  │   interleaveTasks → чередование для rate limit
  │
  ├─ getRequests (2 месяца)
  │     ↓
  │   parseRequests → upsertRequests → [requests]
  │
  └─ getMonitoringStats (по одному на ТС×смена, с rate limit)
        ↓
      parseMonitoringStats → engineOnTime, fuelConsumed, track
        ↓
      analyzeTrackGeozones (Turf.js + geozones.geojson)
        ↓                     → totalStayTime, departmentUnit
      calculateKpi            → все KPI-показатели
        ↓
      upsertVehicleRecord → [vehicle_records]

                    ═══════════════════════

REST API (Express :3001)
  │
  GET /api/vehicles/weekly   ← основной: средние KPI за период + координаты
  GET /api/vehicles/:id/details  ← детализация по дням
  GET /api/vehicles/:id/requests ← привязанные заявки
  GET /api/filters           ← каскадные фильтры (branch → type → department)
  GET /api/geozones          ← полигоны для карты
  POST /api/admin/fetch      ← ручной запуск pipeline
```
