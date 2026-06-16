-- Ingest ledger: реестр единиц работы всех пайплайнов выгрузки.
-- Контракт: INGEST_LEDGER_SPEC.md в корне монорепо.

CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE IF NOT EXISTS ingest.tasks (
  id            bigserial PRIMARY KEY,
  pipeline      text NOT NULL,
  unit_key      text NOT NULL,
  target_date   date NOT NULL,
  shift_type    text,
  vehicle_ref   text NOT NULL,
  vehicle_label text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','empty','failed')),
  reason_code   text,
  attempt       int  NOT NULL DEFAULT 0,
  max_attempts  int  NOT NULL DEFAULT 5,
  last_error    text,
  result        jsonb,
  run_id        text,
  planned_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  UNIQUE (pipeline, unit_key)
);

CREATE INDEX IF NOT EXISTS idx_ingest_tasks_date
  ON ingest.tasks (target_date, pipeline);
CREATE INDEX IF NOT EXISTS idx_ingest_tasks_open
  ON ingest.tasks (status)
  WHERE status IN ('pending','failed','running');
CREATE INDEX IF NOT EXISTS idx_ingest_tasks_vehicle
  ON ingest.tasks (vehicle_ref, target_date);

CREATE TABLE IF NOT EXISTS ingest.task_events (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES ingest.tasks(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL,
  reason_code text,
  error       text,
  meta        jsonb
);

CREATE INDEX IF NOT EXISTS idx_ingest_events_task
  ON ingest.task_events (task_id);
