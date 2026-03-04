-- Migration 004: raw monitoring storage for recalculation without TIS API
CREATE TABLE IF NOT EXISTS monitoring_raw (
  id              SERIAL PRIMARY KEY,
  report_date     DATE         NOT NULL,
  shift_type      VARCHAR(20)  NOT NULL,
  vehicle_id      VARCHAR(20)  NOT NULL,
  id_mo           INTEGER      NOT NULL,
  vehicle_model   VARCHAR(200),
  company_name    VARCHAR(200),
  engine_time_sec INTEGER,
  fuel_json       JSONB,   -- fuels[] из TIS: [{rate, fuelName, valueBegin, valueEnd, ...}]
  track_json      JSONB,   -- track[] полный: [{lat, lon, time, speed?, direction?}]
  fetched_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(report_date, shift_type, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_raw_date
  ON monitoring_raw(report_date);
