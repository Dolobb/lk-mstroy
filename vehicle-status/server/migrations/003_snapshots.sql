CREATE TABLE IF NOT EXISTS vehicle_status.snapshots (
  id                  SERIAL PRIMARY KEY,
  snapshot_date       DATE NOT NULL,
  plate_number        TEXT NOT NULL,
  branch              TEXT,
  vehicle_type        TEXT,
  brand               TEXT,
  construction_object TEXT,
  tech_status         TEXT,
  work_type           TEXT,
  category            TEXT NOT NULL,
  is_broken           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vs_uk ON vehicle_status.snapshots (snapshot_date, plate_number, category);
CREATE INDEX IF NOT EXISTS idx_vs_date     ON vehicle_status.snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_vs_plate    ON vehicle_status.snapshots (plate_number);
