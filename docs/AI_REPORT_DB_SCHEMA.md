# AI Reports — Полная схема баз данных

> Верифицировано по миграциям и коду. Используется для tools и system prompt.

---

## PostgreSQL — kip_vehicles (порт 5432)

### vehicle_records — КИП по ТС/дате/смене

```sql
CREATE TABLE vehicle_records (
  id                      SERIAL PRIMARY KEY,
  report_date             DATE NOT NULL,
  shift_type              VARCHAR(20) NOT NULL,
  vehicle_id              VARCHAR(20) NOT NULL,       -- госномер (НЕ idMO!)
  vehicle_model           VARCHAR(200) NOT NULL,       -- "Бульдозер Liebherr PR 734 L GP"
  company_name            VARCHAR(200) NOT NULL,       -- "АО Мостострой-11"
  department_unit         VARCHAR(200) NOT NULL,       -- "ТФ Мостоотряд-87"
  total_stay_time         NUMERIC(8,4) NOT NULL,       -- часы на объекте
  engine_on_time          NUMERIC(8,4) NOT NULL,       -- часы работы двигателя
  idle_time               NUMERIC(8,4) NOT NULL,       -- часы простоя
  fuel_consumed_total     NUMERIC(10,4) NOT NULL,      -- расход топлива факт (литры)
  fuel_rate_fact          NUMERIC(10,4) NOT NULL,      -- фактический расход
  max_work_allowed        NUMERIC(8,4) NOT NULL,       -- макс. допустимое время работы
  fuel_rate_norm          NUMERIC(10,4) NOT NULL,      -- нормативный расход
  fuel_max_calc           NUMERIC(10,4) NOT NULL,
  fuel_variance           NUMERIC(10,4) NOT NULL,      -- отклонение факт/норма
  load_efficiency_pct     NUMERIC(6,2) NOT NULL,       -- нагрузка %
  utilization_ratio       NUMERIC(6,2) NOT NULL,       -- КИП %
  latitude                NUMERIC(10,7),
  longitude               NUMERIC(10,7),
  track_simplified        JSONB,
  created_at              TIMESTAMP DEFAULT NOW(),
  UNIQUE (report_date, shift_type, vehicle_id)
);
```

**Маппинг на шаблон КИП:**
| Столбец шаблона | Поле БД | Формат |
|----------------|---------|--------|
| Марка/гос.№ | `vehicle_model` + `vehicle_id` | текст |
| КИП% | `utilization_ratio` | 0-100 |
| Время на объекте | `total_stay_time` | часы (NUMERIC) |
| Время работы двигателя | `engine_on_time` | часы |
| Работа под нагрузкой% | `load_efficiency_pct` | 0-100 |
| Тип ТС (группировка) | парсить из `vehicle_model` | "Бульдозер", "Экскаватор"... |
| Подразделение | `department_unit` | текст |
| Компания | `company_name` | текст |

### monitoring_raw — сырые данные мониторинга

```sql
CREATE TABLE monitoring_raw (
  id              SERIAL PRIMARY KEY,
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(20) NOT NULL,
  vehicle_id      VARCHAR(20) NOT NULL,
  id_mo           INTEGER NOT NULL,
  vehicle_model   VARCHAR(200),
  company_name    VARCHAR(200),
  engine_time_sec INTEGER,
  fuel_json       JSONB,     -- {rate, fuelName, valueBegin, valueEnd, charges, discharges}
  track_json      JSONB,     -- [{lat, lon, time, speed, direction}]
  fetched_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(report_date, shift_type, vehicle_id)
);
```

### Вспомогательные таблицы КИП

```sql
-- Заявки
CREATE TABLE requests (
  id              SERIAL PRIMARY KEY,
  request_id      INTEGER UNIQUE NOT NULL,
  number          INTEGER NOT NULL,
  status          VARCHAR(30),
  date_create     TIMESTAMP,
  date_processed  TIMESTAMP,
  contact_person  VARCHAR(200),
  raw_json        JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Путевые листы
CREATE TABLE route_lists (
  id              SERIAL PRIMARY KEY,
  pl_id           BIGINT UNIQUE NOT NULL,
  ts_number       BIGINT,
  ts_type         VARCHAR(30),
  date_out        DATE,
  date_out_plan   TIMESTAMP,
  date_in_plan    TIMESTAMP,
  status          VARCHAR(30),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Расчёты путевых листов
CREATE TABLE pl_calcs (
  id                       SERIAL PRIMARY KEY,
  route_list_id            INTEGER FK → route_lists(id),
  order_descr              TEXT,
  extracted_request_number INTEGER,
  id_order                 INTEGER,
  object_expend            VARCHAR(50),
  driver_task              TEXT
);

-- ТС из путевых листов
CREATE TABLE vehicles (
  id              SERIAL PRIMARY KEY,
  route_list_id   INTEGER FK → route_lists(id),
  id_mo           INTEGER NOT NULL,
  reg_number      VARCHAR(20) NOT NULL,
  name_mo         VARCHAR(200),
  category        VARCHAR(10),
  garage_number   VARCHAR(30)
);
```

---

## PostgreSQL — mstroy (порт 5432 Windows / 5433 Mac)

### dump_trucks.shift_records — смены самосвалов

```sql
CREATE TABLE dump_trucks.shift_records (
  id              BIGSERIAL PRIMARY KEY,
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(10) NOT NULL,              -- 'shift1' | 'shift2'
  vehicle_id      INTEGER NOT NULL,                   -- idMO из TIS (НЕ госномер!)
  reg_number      VARCHAR(50),                        -- госномер
  name_mo         VARCHAR(500),                       -- "Самосвал Volvo FM Truck 6х4"
  object_uid      VARCHAR(100) NOT NULL,              -- FK → geo.objects.uid
  object_name     VARCHAR(500),
  work_type       VARCHAR(20),                        -- 'delivery' | 'onsite' | 'unknown'
  shift_start     TIMESTAMP NOT NULL,
  shift_end       TIMESTAMP NOT NULL,
  engine_time_sec INTEGER DEFAULT 0,                  -- секунды работы двигателя
  moving_time_sec INTEGER DEFAULT 0,                  -- секунды в движении
  distance_km     NUMERIC(10,2) DEFAULT 0,            -- пробег
  onsite_min      INTEGER DEFAULT 0,                  -- время на объекте (мин)
  trips_count     INTEGER DEFAULT 0,
  fact_volume_m3  NUMERIC(10,2) DEFAULT 0,
  kip_pct         NUMERIC(5,2) DEFAULT 0,             -- КИП % (engine/shift)
  movement_pct    NUMERIC(5,2) DEFAULT 0,             -- движение % (moving/engine)
  pl_id           INTEGER,
  request_numbers INTEGER[],
  object_timezone TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg',
  raw_monitoring  JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (report_date, shift_type, vehicle_id, object_uid)
);
```

**Маппинг на шаблон самосвалов (сводный):**
| Столбец шаблона | Поле БД | Формат |
|----------------|---------|--------|
| Марка/гос.№ | `name_mo` или `reg_number` | текст |
| Время работы двигателя | `engine_time_sec` | секунды → ЧЧ:ММ |
| Время в движении | `moving_time_sec` | секунды → ЧЧ:ММ |
| Простой (хол. ход) | `engine_time_sec - moving_time_sec` | вычисляемое |
| Выработка% от двигателя | `kip_pct` | 0-100 |
| Выработка% от движения | `movement_pct` | 0-100 |
| Кол-во рейсов | `trips_count` | целое |
| Пробег | `distance_km` | км |

### dump_trucks.trips — рейсы

```sql
CREATE TABLE dump_trucks.trips (
  id                   BIGSERIAL PRIMARY KEY,
  shift_record_id      BIGINT FK NOT NULL → shift_records(id),
  trip_number          INTEGER NOT NULL,
  loaded_at            TIMESTAMP,             -- время погрузки
  unloaded_at          TIMESTAMP,             -- время выгрузки
  loading_zone         VARCHAR(200),          -- название зоны погрузки
  unloading_zone       VARCHAR(200),          -- название зоны выгрузки
  duration_min         INTEGER,               -- длительность рейса (мин)
  distance_km          NUMERIC(8,2),
  volume_m3            NUMERIC(8,2),
  travel_to_unload_min INTEGER,               -- время в пути П→В (мин)
  return_to_load_min   INTEGER,               -- время возврата В→П (мин)
  created_at           TIMESTAMP DEFAULT NOW()
);
```

**Маппинг на шаблон рейсов (детальный):**
| Столбец шаблона | Поле БД | Примечание |
|----------------|---------|------------|
| Погрузка въезд/выезд | `loaded_at` | Один timestamp. Для въезд/выезд → zone_events |
| Выгрузка въезд/выезд | `unloaded_at` | Один timestamp. Для въезд/выезд → zone_events |
| Ср. путь П→В | `travel_to_unload_min` | минуты |
| Ср. путь В→П | `return_to_load_min` | минуты |
| Зона погрузки | `loading_zone` | название |
| Зона выгрузки | `unloading_zone` | название |

### dump_trucks.zone_events — факты нахождения в геозонах

```sql
CREATE TABLE dump_trucks.zone_events (
  id              BIGSERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL,           -- idMO (НЕ госномер!)
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(10) NOT NULL,
  zone_uid        VARCHAR(100) NOT NULL,      -- FK → geo.zones.uid
  zone_name       VARCHAR(200),
  zone_tag        VARCHAR(50),                -- dt_boundary | dt_loading | dt_unloading | dt_onsite
  object_uid      VARCHAR(100),               -- FK → geo.objects.uid
  entered_at      TIMESTAMP NOT NULL,         -- время въезда в зону
  exited_at       TIMESTAMP,                  -- время выезда из зоны
  duration_sec    INTEGER,                    -- длительность пребывания (сек)
  created_at      TIMESTAMP DEFAULT NOW()
);
-- ВАЖНО: НЕТ shift_record_id! Связь через (vehicle_id, report_date, shift_type, object_uid)
```

**Для детального отчёта рейсов — именно zone_events даёт въезд/выезд/стоянку:**
| Столбец шаблона | Источник |
|----------------|---------|
| Погрузка въезд | `entered_at` WHERE `zone_tag = 'dt_loading'` |
| Погрузка выезд | `exited_at` WHERE `zone_tag = 'dt_loading'` |
| Погрузка стоянка | `duration_sec` WHERE `zone_tag = 'dt_loading'` |
| Выгрузка въезд | `entered_at` WHERE `zone_tag = 'dt_unloading'` |
| Выгрузка выезд | `exited_at` WHERE `zone_tag = 'dt_unloading'` |
| Выгрузка стоянка | `duration_sec` WHERE `zone_tag = 'dt_unloading'` |

### dump_trucks.requests — заявки

```sql
CREATE TABLE dump_trucks.requests (
  request_id      INTEGER PRIMARY KEY,
  number          INTEGER NOT NULL,
  status          VARCHAR(100),
  date_create     TIMESTAMP,
  date_processed  TIMESTAMP,
  contact_person  VARCHAR(500),
  raw_json        JSONB,
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### dump_trucks.repairs — ремонты

```sql
CREATE TABLE dump_trucks.repairs (
  id          SERIAL PRIMARY KEY,
  reg_number  VARCHAR(50) NOT NULL,
  name_mo     VARCHAR(500),
  type        VARCHAR(20) DEFAULT 'repair',   -- 'repair' | 'maintenance'
  reason      VARCHAR(500),
  date_from   DATE NOT NULL,
  date_to     DATE,
  object_name VARCHAR(500),
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
```

### dump_trucks.route_lists — путевые листы

```sql
CREATE TABLE dump_trucks.route_lists (
  id              INTEGER PRIMARY KEY,        -- pl.id из TIS
  ts_number       INTEGER,
  date_out        DATE,
  date_out_plan   TIMESTAMP NOT NULL,
  date_in_plan    TIMESTAMP NOT NULL,
  status          VARCHAR(50) NOT NULL,
  vehicle_ids     INTEGER[] NOT NULL DEFAULT '{}',
  request_numbers INTEGER[] NOT NULL DEFAULT '{}',
  object_expends  TEXT[] NOT NULL DEFAULT '{}',
  raw_json        JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### dump_trucks.order_norms — нормы рейсов

```sql
CREATE TABLE dump_trucks.order_norms (
  request_number  INTEGER PRIMARY KEY,
  trips_per_shift INTEGER NOT NULL,
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### geo.objects — объекты строительства

```sql
CREATE TABLE geo.objects (
  id         SERIAL PRIMARY KEY,
  uid        VARCHAR(50) UNIQUE NOT NULL,
  name       VARCHAR(200) NOT NULL,
  smu        VARCHAR(200),                   -- ВАЖНО: поле "smu", НЕ "smu_name"!
  region     VARCHAR(200),
  timezone   TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### geo.zones — геозоны

```sql
CREATE TABLE geo.zones (
  id         SERIAL PRIMARY KEY,
  uid        VARCHAR(50) UNIQUE NOT NULL,
  object_id  INTEGER FK NOT NULL → geo.objects(id),  -- ВАЖНО: integer FK, НЕ object_uid!
  name       VARCHAR(200) NOT NULL,
  geom       GEOMETRY(Polygon, 4326) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### geo.zone_tags — теги геозон

```sql
CREATE TABLE geo.zone_tags (
  zone_id INTEGER FK NOT NULL → geo.zones(id),
  tag     VARCHAR(30) NOT NULL,              -- dt_boundary | dt_loading | dt_unloading | dt_onsite
  PRIMARY KEY (zone_id, tag)
);
```

---

## SQLite — tyagachi/archive.db

### tracked_requests — заявки тягачей

```sql
CREATE TABLE tracked_requests (
  id                  INTEGER PRIMARY KEY,
  request_number      INTEGER UNIQUE NOT NULL,
  request_status      VARCHAR(50),
  stability_status    VARCHAR(20),           -- 'stable' | 'in_progress'
  route_start_address VARCHAR(500),
  route_end_address   VARCHAR(500),
  route_start_date    VARCHAR(50),           -- формат "DD.MM.YYYY"
  route_end_date      VARCHAR(50),
  route_distance      VARCHAR(50),
  object_expend_code  VARCHAR(100),
  object_expend_name  VARCHAR(200),
  order_name_cargo    VARCHAR(200),
  matched_data_json   TEXT,                  -- JSON
  first_synced_at     TIMESTAMP DEFAULT NOW(),
  last_synced_at      TIMESTAMP DEFAULT NOW()
);
```

### pl_records — путевые листы тягачей

```sql
CREATE TABLE pl_records (
  id              INTEGER PRIMARY KEY,
  vehicle_id      INTEGER FK NOT NULL → vehicles(id),
  request_number  INTEGER,
  pl_id           VARCHAR(100) UNIQUE NOT NULL,
  pl_ts_number    VARCHAR(50),
  pl_date_out     VARCHAR(50),               -- "DD.MM.YYYY HH:mm"
  pl_date_out_plan VARCHAR(50),
  pl_date_in_plan VARCHAR(50),
  pl_status       VARCHAR(50),
  pl_close_list   VARCHAR(50),
  has_monitoring  BOOLEAN DEFAULT FALSE,
  synced_at       TIMESTAMP DEFAULT NOW()
);
```

### vehicles — ТС тягачей

```sql
CREATE TABLE vehicles (
  id              INTEGER PRIMARY KEY,
  ts_id_mo        INTEGER UNIQUE NOT NULL,
  ts_reg_number   VARCHAR(50),
  ts_name_mo      VARCHAR(200),
  first_seen_at   TIMESTAMP DEFAULT NOW(),
  last_seen_at    TIMESTAMP DEFAULT NOW()
);
```

---

## Важные различия между БД

| Аспект | kip_vehicles | dump_trucks (mstroy) |
|--------|-------------|---------------------|
| vehicle_id означает | **госномер** (VARCHAR) | **idMO** (INTEGER) из TIS |
| Госномер | `vehicle_id` | `reg_number` |
| Время | часы (NUMERIC) | секунды (INTEGER) |
| КИП поле | `utilization_ratio` (0-100) | `kip_pct` (0-100) |
| Нагрузка | `load_efficiency_pct` | `movement_pct` |
| Тип ТС | парсить из `vehicle_model` | парсить из `name_mo` |
| Подразделение | `department_unit` | через `geo.objects.smu` |
