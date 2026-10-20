CREATE TABLE IF NOT EXISTS public.catchup_attempts (
  pipeline        text        NOT NULL,
  target_date     date        NOT NULL,
  shift_type      text,
  attempts        int         NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_result     text
);

CREATE UNIQUE INDEX IF NOT EXISTS catchup_attempts_uniq
  ON public.catchup_attempts (pipeline, target_date, COALESCE(shift_type, ''));
