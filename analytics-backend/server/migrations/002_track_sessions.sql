CREATE TABLE IF NOT EXISTS analytics.track_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id varchar NOT NULL,
  date date NOT NULL,
  shift varchar,
  fetched_at timestamptz DEFAULT now(),
  source varchar NOT NULL,
  UNIQUE (vehicle_id, date, shift, source)
);

CREATE INDEX IF NOT EXISTS idx_track_sessions_vehicle_date
  ON analytics.track_sessions (vehicle_id, date);
