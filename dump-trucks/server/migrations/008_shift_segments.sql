-- 008: Shift segments for onsite vehicles (30-min Gantt slices)

CREATE TABLE IF NOT EXISTS dump_trucks.shift_segments (
  id                 BIGSERIAL PRIMARY KEY,
  shift_record_id    BIGINT NOT NULL
    REFERENCES dump_trucks.shift_records(id) ON DELETE CASCADE,
  segment_index      SMALLINT NOT NULL,  -- 0..23
  segment_start      TIMESTAMPTZ NOT NULL,
  segment_end        TIMESTAMPTZ NOT NULL,
  engine_time_sec    INTEGER NOT NULL DEFAULT 0,
  moving_time_sec    INTEGER NOT NULL DEFAULT 0,
  in_boundary        BOOLEAN NOT NULL DEFAULT false,
  distance_km        NUMERIC(8,2) DEFAULT 0,
  track_points_count INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_segments_record
  ON dump_trucks.shift_segments(shift_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_segments_unique
  ON dump_trucks.shift_segments(shift_record_id, segment_index);
