CREATE TABLE IF NOT EXISTS vehicle_status.sync_log (
  id              SERIAL PRIMARY KEY,
  started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMP,
  status          TEXT NOT NULL DEFAULT 'in_progress',
  trigger         TEXT NOT NULL,
  processed       INTEGER DEFAULT 0,
  errors          TEXT[],
  error_message   TEXT,
  download_ms     INTEGER,
  parse_ms        INTEGER,
  write_ms        INTEGER,
  snapshot_date   DATE
);

CREATE INDEX IF NOT EXISTS idx_vsl_date ON vehicle_status.sync_log (started_at);
CREATE INDEX IF NOT EXISTS idx_vsl_status ON vehicle_status.sync_log (status);