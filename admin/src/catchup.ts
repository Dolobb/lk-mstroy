import type { Express, Request, Response } from 'express';
import { Pool } from 'pg';
import { log } from './logger';

export type CatchupPipeline =
  | 'kip-shift'
  | 'kip-segments'
  | 'dt-shift'
  | 'dt-segments'
  | 'analytics-track';

export type ShiftType = 'shift1' | 'shift2';

export interface Gap {
  pipeline: CatchupPipeline;
  date: string;
  shift?: ShiftType;
  reason: string;
  found: number;
  expected: number;
}

interface GapView extends Gap {
  attempts: number;
  maxAttempts: number;
  status: 'pending' | 'exhausted';
  lastAttemptAt?: string | null;
  lastResult?: string | null;
}

interface CatchupDeps {
  mainPool: Pool;
  kipPool: Pool;
  boss?: any;
}

interface NormalizedRange {
  from: string;
  to: string;
  empty: boolean;
}

export interface CatchupRunOptions {
  from?: string;
  to?: string;
  trigger?: 'startup' | 'cron' | 'manual';
  maxPerRun?: number;
  // Отложенный повтор для зависимых дыр. Внутренний флаг: follow-up сам follow-up не плодит.
  allowFollowUp?: boolean;
}

export interface CatchupRunResult {
  startedAt: string;
  finishedAt: string;
  trigger: 'startup' | 'cron' | 'manual';
  range: { from: string; to: string };
  disabled?: boolean;
  gapsFound: number;
  exhausted: GapView[];
  enqueued: Array<Gap & { queue: string; singletonKey: string; payload: unknown }>;
  deferred: GapView[];
  limited: number;
}

const PIPELINE_RUN_NAMES: Record<CatchupPipeline, string> = {
  'kip-shift': 'kip_daily',
  'kip-segments': 'kip_segments',
  'dt-shift': 'dt_daily',
  'dt-segments': 'dt_segments',
  'analytics-track': 'analytics_daily',
};

const QUEUES: Record<CatchupPipeline, string> = {
  'kip-shift': 'fetch-kip-date',
  'kip-segments': 'fetch-kip-segments',
  'dt-shift': 'fetch-dt-shift',
  'dt-segments': 'fetch-dt-segments',
  'analytics-track': 'fetch-analytics-date',
};

let deps: CatchupDeps | null = null;
let ownedMainPool: Pool | null = null;
let ownedKipPool: Pool | null = null;
let lastRun: CatchupRunResult | null = null;

export function configureCatchup(config: CatchupDeps): void {
  deps = config;
}

function getConfig() {
  return {
    enabled: process.env.CATCHUP_ENABLED !== 'false',
    lookbackDays: envInt('CATCHUP_LOOKBACK_DAYS', 14),
    maxPerRun: envInt('CATCHUP_MAX_PER_RUN', 10),
    maxAttempts: envInt('CATCHUP_MAX_ATTEMPTS', 3),
    startupDelayMs: envInt('CATCHUP_STARTUP_DELAY_MS', 60_000, 0),
    followUpMs: envInt('CATCHUP_FOLLOWUP_MS', 60 * 60_000, 0),
  };
}

// Сегменты считаются ИЗ сменных данных, а каскада «смены → сегменты» в системе нет.
// Если смен за дату ещё нет, задание на сегменты отработает по пустому источнику,
// ничего не найдёт и впустую сожжёт попытку. Такие дыры откладываем до следующего
// прогона — к тому времени предусловие уже закрыто.
const PREREQUISITE: Partial<Record<CatchupPipeline, CatchupPipeline>> = {
  'dt-segments': 'dt-shift',
  'kip-segments': 'kip-shift',
};

// Треки аналитики живут ограниченный срок: analytics-backend/src/jobs/retentionJob.ts
// удаляет track_sessions старше RETENTION_DAYS (CASCADE). Тянуть их за пределами
// этого окна бессмысленно — данные удалит чистилка, а догон будет долбить TIS вечно
// и вытеснять из очереди по-настоящему нужную работу.
function maxLookbackDays(pipeline: CatchupPipeline): number | null {
  if (pipeline === 'analytics-track') return envInt('ANALYTICS_RETENTION_DAYS', 7);
  return null;
}

function isWithinRetention(pipeline: CatchupPipeline, date: string): boolean {
  const limit = maxLookbackDays(pipeline);
  if (limit === null) return true;
  return date >= addDays(ekTodayIso(), -limit);
}

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function getDeps(): CatchupDeps {
  if (deps) return deps;

  ownedMainPool ??= new Pool({
    host: process.env.MAIN_DB_HOST || 'localhost',
    port: Number(process.env.MAIN_DB_PORT || 5433),
    database: process.env.MAIN_DB_NAME || 'mstroy',
    user: process.env.MAIN_DB_USER || 'max',
    password: process.env.MAIN_DB_PASSWORD,
  });
  ownedKipPool ??= new Pool({
    host: process.env.KIP_DB_HOST || 'localhost',
    port: Number(process.env.KIP_DB_PORT || 5432),
    database: process.env.KIP_DB_NAME || 'kip_vehicles',
    user: process.env.KIP_DB_USER || 'max',
    password: process.env.KIP_DB_PASSWORD,
  });

  return { mainPool: ownedMainPool, kipPool: ownedKipPool };
}

function ekTodayIso(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeRange(from?: string, to?: string): NormalizedRange {
  const { lookbackDays } = getConfig();
  const today = ekTodayIso();
  const earliest = addDays(today, -lookbackDays);
  const latest = addDays(today, -1);
  const requestedFrom = from || earliest;
  const requestedTo = to || latest;

  if (!isIsoDate(requestedFrom) || !isIsoDate(requestedTo)) {
    throw new Error('from/to must be YYYY-MM-DD');
  }

  const clampedFrom = requestedFrom < earliest ? earliest : requestedFrom;
  const cappedTo = requestedTo >= today ? latest : requestedTo;
  const clampedTo = cappedTo > latest ? latest : cappedTo;

  return {
    from: clampedFrom,
    to: clampedTo,
    empty: clampedFrom > clampedTo,
  };
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

async function count(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const res = await pool.query<{ cnt: number }>(sql, params);
  return Number(res.rows[0]?.cnt ?? 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

async function getKipBaseline(date: string): Promise<number> {
  const { kipPool } = getDeps();
  const res = await kipPool.query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT vehicle_id)::int AS cnt
       FROM vehicle_records
      WHERE report_date >= ($1::date - INTERVAL '14 days')
        AND report_date < $1::date
        AND COALESCE(is_gap_filled,false)=false
      GROUP BY report_date
     HAVING COUNT(DISTINCT vehicle_id) > 0`,
    [date],
  );
  const counts = res.rows.map((r) => Number(r.cnt)).filter((n) => n > 0);
  return counts.length > 0 ? median(counts) : 0;
}

async function getActivePipelineKeys(from: string, to: string): Promise<Set<string>> {
  const { mainPool } = getDeps();
  const res = await mainPool.query<{ pipeline_name: string; date: string }>(
    `SELECT pipeline_name, target_date::text AS date
       FROM public.pipeline_runs
      WHERE target_date BETWEEN $1 AND $2
        AND (
          status = 'running'
          OR (status = 'completed' AND completed_at > now() - INTERVAL '3 hours')
        )`,
    [from, to],
  );

  const keys = new Set<string>();
  for (const row of res.rows) {
    for (const [pipeline, runName] of Object.entries(PIPELINE_RUN_NAMES)) {
      if (row.pipeline_name === runName) keys.add(`${pipeline}:${row.date}`);
    }
  }
  return keys;
}

function activeKey(pipeline: CatchupPipeline, date: string): string {
  return `${pipeline}:${date}`;
}

function attemptKey(gap: Pick<Gap, 'pipeline' | 'date' | 'shift'>): string {
  return `${gap.pipeline}:${gap.date}:${gap.shift ?? ''}`;
}

export async function scanGaps(from?: string, to?: string): Promise<Gap[]> {
  const range = normalizeRange(from, to);
  if (range.empty) return [];

  const { mainPool, kipPool } = getDeps();
  const active = await getActivePipelineKeys(range.from, range.to);
  const gaps: Gap[] = [];

  for (const date of dateRange(range.from, range.to)) {
    const kipShiftFound = await count(
      kipPool,
      `SELECT COUNT(DISTINCT vehicle_id)::int AS cnt
         FROM vehicle_records
        WHERE report_date=$1 AND COALESCE(is_gap_filled,false)=false`,
      [date],
    );
    const kipBaseline = await getKipBaseline(date);
    if (
      kipBaseline > 0 &&
      kipShiftFound < kipBaseline * 0.85 &&
      !active.has(activeKey('kip-shift', date))
    ) {
      gaps.push({
        pipeline: 'kip-shift',
        date,
        reason: `vehicle_records below 85% of 14-day non-zero median (${kipShiftFound}/${kipBaseline})`,
        found: kipShiftFound,
        expected: kipBaseline,
      });
    }

    const kipSegmentsFound = await count(
      kipPool,
      `SELECT COUNT(*)::int AS cnt FROM kip_shift_segments WHERE report_date=$1`,
      [date],
    );
    if (
      kipSegmentsFound === 0 &&
      kipShiftFound > 0 &&
      !active.has(activeKey('kip-segments', date))
    ) {
      gaps.push({
        pipeline: 'kip-segments',
        date,
        reason: 'kip_shift_segments empty while vehicle_records exist',
        found: kipSegmentsFound,
        expected: 1,
      });
    }

    let hasDtShiftGap = false;
    for (const shift of ['shift1', 'shift2'] as const) {
      const dtShiftFound = await count(
        mainPool,
        `SELECT COUNT(*)::int AS cnt
           FROM dump_trucks.shift_records
          WHERE report_date=$1 AND shift_type=$2`,
        [date, shift],
      );
      if (dtShiftFound === 0 && !active.has(activeKey('dt-shift', date))) {
        hasDtShiftGap = true;
        gaps.push({
          pipeline: 'dt-shift',
          date,
          shift,
          reason: `dump_trucks.shift_records empty for ${shift}`,
          found: dtShiftFound,
          expected: 1,
        });
      }
    }

    const dtRecordsForDate = await count(
      mainPool,
      `SELECT COUNT(*)::int AS cnt FROM dump_trucks.shift_records WHERE report_date=$1`,
      [date],
    );
    const dtSegmentsFound = await count(
      mainPool,
      `SELECT COUNT(*)::int AS cnt
         FROM dump_trucks.shift_segments ss
         JOIN dump_trucks.shift_records sr ON sr.id=ss.shift_record_id
        WHERE sr.report_date=$1`,
      [date],
    );
    if (
      dtSegmentsFound === 0 &&
      (dtRecordsForDate > 0 || hasDtShiftGap) &&
      !active.has(activeKey('dt-segments', date))
    ) {
      gaps.push({
        pipeline: 'dt-segments',
        date,
        reason: dtRecordsForDate > 0
          ? 'dump_trucks.shift_segments empty while shift_records exist'
          : 'dump_trucks.shift_segments empty and source dt shifts are missing',
        found: dtSegmentsFound,
        expected: 1,
      });
    }

    const analyticsFound = await count(
      mainPool,
      `SELECT COUNT(*)::int AS cnt FROM analytics.track_sessions WHERE date=$1`,
      [date],
    );
    if (
      analyticsFound === 0 &&
      isWithinRetention('analytics-track', date) &&
      !active.has(activeKey('analytics-track', date))
    ) {
      gaps.push({
        pipeline: 'analytics-track',
        date,
        reason: 'analytics.track_sessions empty',
        found: analyticsFound,
        expected: 1,
      });
    }
  }

  return gaps;
}

async function getAttemptViews(gaps: Gap[]): Promise<{ pending: GapView[]; exhausted: GapView[] }> {
  if (gaps.length === 0) return { pending: [], exhausted: [] };
  const { mainPool } = getDeps();
  const { maxAttempts } = getConfig();
  const dates = gaps.map((g) => g.date);
  const res = await mainPool.query<{
    pipeline: CatchupPipeline;
    date: string;
    shift_type: ShiftType | null;
    attempts: number;
    last_attempt_at: string | null;
    last_result: string | null;
  }>(
    `SELECT pipeline,
            target_date::text AS date,
            shift_type,
            attempts,
            last_attempt_at::text,
            last_result
       FROM public.catchup_attempts
      WHERE target_date = ANY($1::date[])`,
    [dates],
  );
  const attempts = new Map(
    res.rows.map((r) => [
      `${r.pipeline}:${r.date}:${r.shift_type ?? ''}`,
      r,
    ]),
  );

  const pending: GapView[] = [];
  const exhausted: GapView[] = [];
  for (const gap of gaps) {
    const row = attempts.get(attemptKey(gap));
    const view: GapView = {
      ...gap,
      attempts: row?.attempts ?? 0,
      maxAttempts,
      status: (row?.attempts ?? 0) >= maxAttempts ? 'exhausted' : 'pending',
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastResult: row?.last_result ?? null,
    };
    if (view.status === 'exhausted') exhausted.push(view);
    else pending.push(view);
  }
  return { pending, exhausted };
}

function buildPayload(gap: Gap): unknown {
  switch (gap.pipeline) {
    case 'kip-shift':
      return { date: gap.date, mode: 'refresh', triggerType: 'cron' };
    case 'kip-segments':
      return { date: gap.date, force: false, triggerType: 'cron' };
    case 'dt-shift':
      return { date: gap.date, shift: gap.shift, mode: 'refresh', triggerType: 'cron' };
    case 'dt-segments':
      return { date: gap.date, force: false, triggerType: 'cron' };
    case 'analytics-track':
      return { date: gap.date, mode: 'normal', triggerType: 'cron' };
  }
}

async function recordAttempt(gap: Gap, result: string): Promise<void> {
  const { mainPool } = getDeps();
  await mainPool.query(
    `INSERT INTO public.catchup_attempts (pipeline, target_date, shift_type, attempts, last_attempt_at, last_result)
     VALUES ($1, $2, $3, 1, now(), $4)
     ON CONFLICT (pipeline, target_date, COALESCE(shift_type, ''))
     DO UPDATE SET
       attempts = public.catchup_attempts.attempts + 1,
       last_attempt_at = now(),
       last_result = EXCLUDED.last_result`,
    [gap.pipeline, gap.date, gap.shift ?? null, result],
  );
}

function summarize(gaps: Gap[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const gap of gaps) {
    const key = gap.pipeline;
    result[key] ??= [];
    result[key].push(gap.shift ? `${gap.date}/${gap.shift}` : gap.date);
  }
  return result;
}

export async function runCatchup(opts: CatchupRunOptions = {}): Promise<CatchupRunResult> {
  const config = getConfig();
  const trigger = opts.trigger ?? 'manual';
  const range = normalizeRange(opts.from, opts.to);
  const startedAt = new Date().toISOString();

  if (!config.enabled) {
    const disabled: CatchupRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      trigger,
      range: { from: range.from, to: range.to },
      disabled: true,
      gapsFound: 0,
      exhausted: [],
      enqueued: [],
      deferred: [],
      limited: 0,
    };
    lastRun = disabled;
    log.info({ category: 'catchup', msg: 'catchup disabled', fields: { trigger } });
    return disabled;
  }

  const boss = getDeps().boss;
  if (!boss) throw new Error('catchup boss dependency is not configured');

  const gaps = range.empty ? [] : await scanGaps(range.from, range.to);
  const { pending, exhausted } = await getAttemptViews(gaps);

  // Дыра с незакрытым предусловием (сегменты без смен за ту же дату) в очередь не идёт
  // и попытку не тратит — её подберёт следующий прогон.
  const unmetPrereq = new Set(gaps.map((g) => `${g.pipeline}:${g.date}`));
  const isBlocked = (gap: Gap): boolean => {
    const prereq = PREREQUISITE[gap.pipeline];
    return prereq !== undefined && unmetPrereq.has(`${prereq}:${gap.date}`);
  };

  const deferred = pending.filter(isBlocked);
  const ready = pending.filter((g) => !isBlocked(g));
  const maxPerRun = opts.maxPerRun ?? config.maxPerRun;
  const selected = ready.slice(0, maxPerRun);
  const enqueued: CatchupRunResult['enqueued'] = [];

  log.info({
    category: 'catchup',
    msg: 'scan completed',
    fields: {
      trigger,
      range,
      gapsFound: gaps.length,
      exhausted: exhausted.length,
      pending: pending.length,
      deferred: deferred.length,
      byPipeline: summarize(gaps),
    },
  });

  for (const gap of selected) {
    const queue = QUEUES[gap.pipeline];
    const payload = buildPayload(gap);
    const singletonKey = `catchup:${gap.pipeline}:${gap.date}:${gap.shift ?? ''}`;
    await boss.send(queue, payload, { singletonKey });
    await recordAttempt(gap, 'enqueued');
    enqueued.push({ ...gap, queue, singletonKey, payload });
    log.info({
      category: 'catchup',
      pipeline: PIPELINE_RUN_NAMES[gap.pipeline],
      date: gap.date,
      shift: gap.shift,
      msg: 'job enqueued',
      fields: { queue, singletonKey, payload },
    });
  }

  const result: CatchupRunResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    trigger,
    range: { from: range.from, to: range.to },
    gapsFound: gaps.length,
    exhausted,
    enqueued,
    deferred,
    limited: Math.max(0, ready.length - selected.length),
  };
  lastRun = result;

  // Мы только что закрыли предусловия для отложенных дыр — вернёмся за ними,
  // когда сменные данные приедут. Ровно один повтор: follow-up сам follow-up не плодит.
  if (deferred.length > 0 && enqueued.length > 0 && opts.allowFollowUp !== false && config.followUpMs > 0) {
    log.info({
      category: 'catchup',
      msg: 'follow-up scheduled for deferred gaps',
      fields: { deferred: deferred.length, delayMs: config.followUpMs },
    });
    setTimeout(() => {
      runCatchup({ from: opts.from, to: opts.to, trigger, allowFollowUp: false }).catch((err) => {
        log.error({ category: 'catchup', msg: 'follow-up run failed', fields: { error: String(err) } });
      });
    }, config.followUpMs).unref?.();
  }

  log.info({
    category: 'catchup',
    msg: 'run completed',
    fields: {
      trigger,
      gapsFound: gaps.length,
      exhausted: exhausted.length,
      enqueued: enqueued.length,
      deferred: deferred.length,
      limited: result.limited,
      byPipeline: summarize(enqueued),
    },
  });

  return result;
}

function parseRange(req: Request): { from?: string; to?: string } {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  return { from, to };
}

export function registerCatchupRoutes(app: Express): void {
  app.get('/api/admin/catchup/preview', async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const range = normalizeRange(from, to);
      const gaps = range.empty ? [] : await scanGaps(range.from, range.to);
      const { pending, exhausted } = await getAttemptViews(gaps);
      res.json({ range: { from: range.from, to: range.to }, gaps: pending, exhausted });
    } catch (err) {
      log.error({ category: 'catchup', msg: 'preview failed', fields: { error: String(err) } });
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/admin/catchup/run', async (req: Request, res: Response) => {
    try {
      const { from, to } = parseRange(req);
      const result = await runCatchup({ from, to, trigger: 'manual' });
      res.json(result);
    } catch (err) {
      log.error({ category: 'catchup', msg: 'manual run failed', fields: { error: String(err) } });
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/admin/catchup/status', async (_req: Request, res: Response) => {
    try {
      const { mainPool } = getDeps();
      const attempts = await mainPool.query(
        `SELECT pipeline,
                target_date::text AS date,
                shift_type AS shift,
                attempts,
                last_attempt_at::text AS lastAttemptAt,
                last_result AS lastResult
           FROM public.catchup_attempts
          ORDER BY last_attempt_at DESC NULLS LAST
          LIMIT 50`,
      );
      res.json({ lastRun, config: getConfig(), attempts: attempts.rows });
    } catch (err) {
      log.error({ category: 'catchup', msg: 'status failed', fields: { error: String(err) } });
      res.status(500).json({ error: String(err), lastRun });
    }
  });
}

export async function registerCatchupCron(): Promise<void> {
  const config = getConfig();
  if (!config.enabled) {
    log.info({ category: 'catchup', msg: 'catchup cron disabled by config' });
    return;
  }
  const boss = getDeps().boss;
  if (!boss) throw new Error('catchup boss dependency is not configured');

  await boss.createQueue('catchup-cron');
  await boss.schedule('catchup-cron', '0 8 * * *', {});
  await boss.work('catchup-cron', async () => {
    await runCatchup({ trigger: 'cron' });
  });
  log.info({
    category: 'catchup',
    msg: 'catchup cron registered',
    fields: { queue: 'catchup-cron', cronUtc: '0 8 * * *', localTime: '13:00 Asia/Yekaterinburg' },
  });
}

export function scheduleStartupCatchup(): void {
  const config = getConfig();
  if (!config.enabled) {
    log.info({ category: 'catchup', msg: 'startup catchup disabled by config' });
    return;
  }

  setTimeout(() => {
    runCatchup({ trigger: 'startup' }).catch((err) => {
      log.error({ category: 'catchup', msg: 'startup catchup failed', fields: { error: String(err) } });
    });
  }, config.startupDelayMs);

  log.info({
    category: 'catchup',
    msg: 'startup catchup scheduled',
    fields: { delayMs: config.startupDelayMs },
  });
}
