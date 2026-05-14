CREATE TABLE IF NOT EXISTS analytics.track_points (
  session_id uuid REFERENCES analytics.track_sessions(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed real,
  heading smallint,
  engine_on boolean,
  motion_status varchar,
  dwell_sec int,
  PRIMARY KEY (session_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_track_points_session_ts
  ON analytics.track_points (session_id, ts);
