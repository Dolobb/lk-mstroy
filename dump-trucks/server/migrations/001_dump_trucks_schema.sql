-- Migration 001: dump_trucks schema
-- Схема для аналитики самосвалов

CREATE SCHEMA IF NOT EXISTS dump_trucks;

-- Учёт применённых миграций
CREATE TABLE IF NOT EXISTS dump_trucks._migrations (
  name       VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- Запросы (заявки) из TIS API
CREATE TABLE IF NOT EXISTS dump_trucks.requests (
  request_id      INTEGER PRIMARY KEY,
  number          INTEGER NOT NULL,
  status          VARCHAR(100),
  date_create     TIMESTAMP,
  date_processed  TIMESTAMP,
  contact_person  VARCHAR(500),
  raw_json        JSONB,
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Сменные записи (основная таблица KPI)
-- Одна запись = один ТС × одна смена × один объект
CREATE TABLE IF NOT EXISTS dump_trucks.shift_records (
  id              BIGSERIAL PRIMARY KEY,
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(10) NOT NULL CHECK (shift_type IN ('shift1', 'shift2')),
  vehicle_id      INTEGER NOT NULL,       -- idMO из TIS
  reg_number      VARCHAR(50),
  name_mo         VARCHAR(500),
  object_uid      VARCHAR(100) NOT NULL,  -- uid из geo.objects
  object_name     VARCHAR(500),
  work_type       VARCHAR(20) CHECK (work_type IN ('delivery', 'onsite', 'unknown')),
  shift_start     TIMESTAMP NOT NULL,
  shift_end       TIMESTAMP NOT NULL,
  engine_time_sec INTEGER DEFAULT 0,
  moving_time_sec INTEGER DEFAULT 0,
  distance_km     NUMERIC(10,2) DEFAULT 0,
  onsite_min      INTEGER DEFAULT 0,      -- минут на объекте (в зоне dt_boundary)
  trips_count     INTEGER DEFAULT 0,      -- количество рейсов (пар погрузка/выгрузка)
  fact_volume_m3  NUMERIC(10,2) DEFAULT 0,
  kip_pct         NUMERIC(5,2) DEFAULT 0, -- % загрузки (engine_time / shift_duration)
  movement_pct    NUMERIC(5,2) DEFAULT 0, -- % движения от engine_time
  pl_id           INTEGER,                -- id путевого листа из TIS
  request_numbers INTEGER[],              -- номера заявок
  raw_monitoring  JSONB,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (report_date, shift_type, vehicle_id, object_uid)
);

CREATE INDEX IF NOT EXISTS idx_shift_records_date_shift
  ON dump_trucks.shift_records (report_date, shift_type);

CREATE INDEX IF NOT EXISTS idx_shift_records_vehicle
  ON dump_trucks.shift_records (vehicle_id, report_date);

CREATE INDEX IF NOT EXISTS idx_shift_records_object
  ON dump_trucks.shift_records (object_uid, report_date);

-- Рейсы (пары погрузка/выгрузка) привязанные к смене
CREATE TABLE IF NOT EXISTS dump_trucks.trips (
  id              BIGSERIAL PRIMARY KEY,
  shift_record_id BIGINT NOT NULL REFERENCES dump_trucks.shift_records(id) ON DELETE CASCADE,
  trip_number     INTEGER NOT NULL,  -- порядковый номер в смене
  loaded_at       TIMESTAMP,         -- время завершения погрузки
  unloaded_at     TIMESTAMP,         -- время завершения выгрузки
  loading_zone    VARCHAR(200),      -- название зоны погрузки
  unloading_zone  VARCHAR(200),      -- название зоны выгрузки
  duration_min    INTEGER,           -- длительность рейса в минутах
  distance_km     NUMERIC(8,2),
  volume_m3       NUMERIC(8,2),
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_shift_record
  ON dump_trucks.trips (shift_record_id);

-- События входа/выхода из зон
CREATE TABLE IF NOT EXISTS dump_trucks.zone_events (
  id              BIGSERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL,
  report_date     DATE NOT NULL,
  shift_type      VARCHAR(10) NOT NULL,
  zone_uid        VARCHAR(100) NOT NULL,
  zone_name       VARCHAR(200),
  zone_tag        VARCHAR(50),           -- dt_boundary, dt_loading, dt_unloading
  object_uid      VARCHAR(100),
  entered_at      TIMESTAMP NOT NULL,
  exited_at       TIMESTAMP,
  duration_sec    INTEGER,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_events_vehicle_date
  ON dump_trucks.zone_events (vehicle_id, report_date, shift_type);

CREATE INDEX IF NOT EXISTS idx_zone_events_zone
  ON dump_trucks.zone_events (zone_uid, report_date);
