CREATE SCHEMA IF NOT EXISTS vehicle_status;

CREATE TABLE IF NOT EXISTS vehicle_status.status_history (
  id              SERIAL PRIMARY KEY,
  plate_number    TEXT NOT NULL,
  status_text     TEXT,
  is_repairing    BOOLEAN NOT NULL DEFAULT FALSE,
  date_start      DATE NOT NULL,
  date_end        DATE,
  days_in_repair  INTEGER DEFAULT 0,
  category        TEXT,
  last_check_date DATE
);

CREATE INDEX IF NOT EXISTS idx_vsh_plate  ON vehicle_status.status_history (plate_number);
CREATE INDEX IF NOT EXISTS idx_vsh_repair ON vehicle_status.status_history (is_repairing);
CREATE INDEX IF NOT EXISTS idx_vsh_date   ON vehicle_status.status_history (last_check_date);
