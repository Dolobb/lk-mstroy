CREATE TABLE IF NOT EXISTS public.admin_heartbeat (
  id        int PRIMARY KEY DEFAULT 1,
  last_seen timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_heartbeat_single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS public.alert_log (
  key      text        NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  subject  text,
  severity text
);

CREATE INDEX IF NOT EXISTS alert_log_key_sent
  ON public.alert_log (key, sent_at DESC);
