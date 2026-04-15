CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name   VARCHAR(50)  NOT NULL,
  trigger_type    VARCHAR(20)  NOT NULL,
  target_date     DATE         NOT NULL,
  shift_type      VARCHAR(10),
  status          VARCHAR(20)  NOT NULL DEFAULT 'running',
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  total_vehicles  INT          NOT NULL DEFAULT 0,
  success_count   INT          NOT NULL DEFAULT 0,
  error_count     INT          NOT NULL DEFAULT 0,
  errors          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  config_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_name_date
  ON public.pipeline_runs (pipeline_name, target_date);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started
  ON public.pipeline_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status
  ON public.pipeline_runs (status)
  WHERE status IN ('running', 'failed');
