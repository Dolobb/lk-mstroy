ALTER TABLE analytics.track_points ADD COLUMN IF NOT EXISTS vehicle_id varchar;

UPDATE analytics.track_points tp
SET vehicle_id = ts.vehicle_id
FROM analytics.track_sessions ts
WHERE tp.session_id = ts.id AND tp.vehicle_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_track_points_vehicle_ts
  ON analytics.track_points (vehicle_id, ts DESC);
