CREATE TABLE IF NOT EXISTS vehicle_status.vehicles (
  id                  SERIAL PRIMARY KEY,
  plate_number        TEXT NOT NULL,
  branch              TEXT,
  vehicle_type        TEXT,
  brand               TEXT,
  construction_object TEXT,
  tech_status         TEXT,
  work_type           TEXT,
  category            TEXT NOT NULL,
  is_broken           BOOLEAN NOT NULL DEFAULT FALSE,
  last_check_date     DATE,
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vv_uk       ON vehicle_status.vehicles (plate_number, category);
CREATE INDEX IF NOT EXISTS idx_vv_plate           ON vehicle_status.vehicles (plate_number);
CREATE INDEX IF NOT EXISTS idx_vv_broken          ON vehicle_status.vehicles (is_broken);
CREATE INDEX IF NOT EXISTS idx_vv_category        ON vehicle_status.vehicles (category);
CREATE INDEX IF NOT EXISTS idx_vv_branch          ON vehicle_status.vehicles (branch);
CREATE INDEX IF NOT EXISTS idx_vv_check_date      ON vehicle_status.vehicles (last_check_date);
