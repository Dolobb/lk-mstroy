CREATE TABLE IF NOT EXISTS kip_shift_segments (
  id BIGSERIAL PRIMARY KEY,
  vehicle_id VARCHAR(20) NOT NULL,
  report_date DATE NOT NULL,
  shift_type VARCHAR(20) NOT NULL,
  segment_index SMALLINT NOT NULL,
  segment_start TIMESTAMPTZ NOT NULL,
  segment_end TIMESTAMPTZ NOT NULL,
  engine_time_sec INTEGER DEFAULT 0,
  moving_time_sec INTEGER DEFAULT 0,
  distance_km NUMERIC(8,2) DEFAULT 0,
  track_points_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vehicle_id, report_date, shift_type, segment_index)
);
