import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { log } from './logger';
import { scanGaps, type Gap } from './catchup';

type Severity = 'info' | 'warning' | 'critical';
type AlertMode = 'sent' | 'dry-run' | 'suppressed' | 'disabled' | 'error';

export interface AlertInput {
  key: string;
  subject: string;
  body: string;
  severity: Severity;
}

export interface AlertResult {
  ok: boolean;
  mode: AlertMode;
  error?: string;
  throttledUntil?: string;
}

interface NotifyDeps {
  mainPool: Pool;
  boss?: any;
}

interface HeartbeatState {
  lastPingAt: string | null;
  lastPingOk: boolean | null;
  warnedMissingUrl: boolean;
}

const DIGEST_QUEUE = 'alerts-digest-cron';
const EK_OFFSET_MS = 5 * 60 * 60 * 1000;
const heartbeatState: HeartbeatState = {
  lastPingAt: null,
  lastPingOk: null,
  warnedMissingUrl: false,
};

let deps: NotifyDeps | null = null;

export function configureAlerts(config: NotifyDeps): void {
  deps = config;
}

function getDeps(): NotifyDeps {
  if (!deps) throw new Error('alerts are not configured');
  return deps;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function getConfig() {
  return {
    enabled: envBool('ALERT_ENABLED', true),
    dryRun: envBool('ALERT_DRY_RUN', true),
    to: process.env.ALERT_EMAIL_TO || 'pisarenkovmaxim@gmail.com',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: envInt('SMTP_PORT', 465),
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
    smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    throttleHours: envInt('ALERT_THROTTLE_HOURS', 6),
    downtimeAlertHours: envInt('DOWNTIME_ALERT_HOURS', 6),
    heartbeatUrl: process.env.HEARTBEAT_URL || '',
    heartbeatIntervalMs: envInt('HEARTBEAT_INTERVAL_MS', 900_000, 1_000),
    digestAlways: envBool('ALERT_DIGEST_ALWAYS', false),
    catchupMaxAttempts: envInt('CATCHUP_MAX_ATTEMPTS', 3),
  };
}

function ekTodayIso(): string {
  return new Date(Date.now() + EK_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatEk(ts: string | Date): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function gapKey(gap: Pick<Gap, 'pipeline' | 'date' | 'shift'>): string {
  return `${gap.pipeline}:${gap.date}:${gap.shift ?? ''}`;
}

function formatGap(gap: Gap): string {
  return `${gap.pipeline} ${gap.date}${gap.shift ? ` ${gap.shift}` : ''}: ${gap.reason} (${gap.found}/${gap.expected})`;
}

async function recentAlert(key: string, throttleHours: number): Promise<{ sent_at: string } | null> {
  const { mainPool } = getDeps();
  const res = await mainPool.query<{ sent_at: string }>(
    `SELECT sent_at::text
       FROM public.alert_log
      WHERE key = $1
        AND sent_at > now() - ($2::text || ' hours')::interval
      ORDER BY sent_at DESC
      LIMIT 1`,
    [key, throttleHours],
  );
  return res.rows[0] ?? null;
}

async function recordAlert(input: AlertInput): Promise<void> {
  const { mainPool } = getDeps();
  await mainPool.query(
    `INSERT INTO public.alert_log (key, subject, severity) VALUES ($1, $2, $3)`,
    [input.key, input.subject, input.severity],
  );
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function renderMessage(input: AlertInput, from: string, to: string): string {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
    '',
  ].join('\r\n');
}

async function sendViaNodemailer(input: AlertInput): Promise<void> {
  const config = getConfig();
  const requireFn = eval('require') as NodeRequire;
  const nodemailer = requireFn('nodemailer') as {
    createTransport: (options: unknown) => {
      sendMail: (message: unknown) => Promise<unknown>;
    };
  };
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({
    from: config.smtpFrom,
    to: config.to,
    subject: input.subject,
    text: input.body,
  });
}

async function sendViaCurl(input: AlertInput): Promise<void> {
  const config = getConfig();
  const stamp = `${process.pid}-${Date.now()}`;
  const messagePath = path.join(os.tmpdir(), `lk-alert-${stamp}.eml`);
  // Пароль НЕ передаём аргументом: командная строка процесса видна другим процессам
  // в системе. Кладём его в curl-конфиг, который удаляем сразу после отправки.
  const configPath = path.join(os.tmpdir(), `lk-alert-${stamp}.curlrc`);
  const message = renderMessage(input, config.smtpFrom, config.to);
  const curlRc = [
    `url = "smtps://${config.smtpHost}:${config.smtpPort}"`,
    'ssl-reqd',
    `mail-from = "${config.smtpFrom}"`,
    `mail-rcpt = "${config.to}"`,
    `user = "${config.smtpUser}:${config.smtpPassword}"`,
    `upload-file = "${messagePath.replace(/\\/g, '/')}"`,
    'silent',
    'show-error',
    'fail',
  ].join('\n');

  await fs.promises.writeFile(messagePath, message, 'utf8');
  await fs.promises.writeFile(configPath, curlRc, { encoding: 'utf8', mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('curl', ['--config', configPath], { windowsHide: true });

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `curl exited with code ${code}`));
      });
    });
  } finally {
    await fs.promises.rm(messagePath, { force: true }).catch(() => {});
    await fs.promises.rm(configPath, { force: true }).catch(() => {});
  }
}

function assertSmtpConfigured(): void {
  const config = getConfig();
  const missing = [
    ['SMTP_HOST', config.smtpHost],
    ['SMTP_USER', config.smtpUser],
    ['SMTP_PASSWORD', config.smtpPassword],
    ['SMTP_FROM', config.smtpFrom],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`SMTP config is incomplete: ${missing.join(', ')}`);
  }
}

export async function sendAlert(input: AlertInput): Promise<AlertResult> {
  const config = getConfig();
  if (!config.enabled) {
    log.info({ category: 'alert', msg: 'alert disabled', fields: { key: input.key, subject: input.subject } });
    return { ok: true, mode: 'disabled' };
  }

  const recent = await recentAlert(input.key, config.throttleHours);
  if (recent) {
    const throttledUntil = new Date(new Date(recent.sent_at).getTime() + config.throttleHours * 3600_000).toISOString();
    log.info({
      category: 'alert',
      msg: 'alert suppressed by throttle',
      fields: { key: input.key, subject: input.subject, lastSentAt: recent.sent_at, throttledUntil },
    });
    return { ok: true, mode: 'suppressed', throttledUntil };
  }

  if (config.dryRun) {
    log.info({
      category: 'alert',
      msg: 'dry-run alert rendered',
      fields: { key: input.key, severity: input.severity, subject: input.subject, body: input.body },
    });
    await recordAlert(input);
    return { ok: true, mode: 'dry-run' };
  }

  try {
    assertSmtpConfigured();
    try {
      await sendViaNodemailer(input);
    } catch (nodemailerErr) {
      log.warn({
        category: 'alert',
        msg: 'nodemailer failed, falling back to curl',
        fields: { key: input.key, error: String(nodemailerErr) },
      });
      await sendViaCurl(input);
    }
    await recordAlert(input);
    log.info({ category: 'alert', msg: 'alert sent', fields: { key: input.key, severity: input.severity, subject: input.subject } });
    return { ok: true, mode: 'sent' };
  } catch (err) {
    log.error({ category: 'alert', msg: 'alert send failed', fields: { key: input.key, error: String(err) } });
    return { ok: false, mode: 'error', error: String(err) };
  }
}

async function getLastSeen(): Promise<Date | null> {
  const { mainPool } = getDeps();
  const res = await mainPool.query<{ last_seen: Date }>(
    `SELECT last_seen FROM public.admin_heartbeat WHERE id = 1`,
  );
  return res.rows[0]?.last_seen ?? null;
}

async function touchHeartbeat(): Promise<void> {
  const { mainPool } = getDeps();
  await mainPool.query(
    `INSERT INTO public.admin_heartbeat (id, last_seen)
     VALUES (1, now())
     ON CONFLICT (id) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
  );
}

async function pingHealthcheck(): Promise<void> {
  const config = getConfig();
  if (!config.heartbeatUrl) {
    if (!heartbeatState.warnedMissingUrl) {
      heartbeatState.warnedMissingUrl = true;
      log.warn({ category: 'alert', msg: 'HEARTBEAT_URL is not set, external downtime watchdog disabled' });
    }
    return;
  }

  const started = new Date();
  heartbeatState.lastPingAt = started.toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(config.heartbeatUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    heartbeatState.lastPingOk = true;
    log.info({ category: 'alert', msg: 'healthchecks ping ok', fields: { status: res.status } });
  } catch (err) {
    heartbeatState.lastPingOk = false;
    log.warn({ category: 'alert', msg: 'healthchecks ping failed', fields: { error: String(err) } });
  }
}

async function sendDowntimeAlert(lastSeen: Date, now: Date, gapHours: number): Promise<void> {
  const from = addDays(ekTodayIso(), -14);
  const to = addDays(ekTodayIso(), -1);
  const gaps = await scanGaps(from, to);
  const roundedHours = Math.round(gapHours);
  const body = [
    `Система была недоступна с ${formatEk(lastSeen)} по ${formatEk(now)}.`,
    `Длительность простоя: ${gapHours.toFixed(1)} ч.`,
    '',
    `Дыры в данных за последние 14 дней: ${gaps.length}`,
    ...(gaps.length > 0 ? gaps.map((gap) => `- ${formatGap(gap)}`) : ['- не обнаружены']),
    '',
    'Автоматический догон запущен.',
  ].join('\n');

  await sendAlert({
    key: 'downtime',
    subject: `[ЛК Мстрой] Простой ${roundedHours} ч: система была недоступна`,
    body,
    severity: 'critical',
  });
}

async function checkDowntimeOnStart(): Promise<void> {
  const config = getConfig();
  const lastSeen = await getLastSeen();
  const now = new Date();
  if (lastSeen) {
    const gapHours = (now.getTime() - lastSeen.getTime()) / 3600_000;
    if (gapHours > config.downtimeAlertHours) {
      await sendDowntimeAlert(lastSeen, now, gapHours);
    }
  }
  await touchHeartbeat();
}

interface ExhaustedAttempt {
  pipeline: string;
  date: string;
  shift: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  lastResult: string | null;
}

interface FailedRun {
  runId: string;
  pipelineName: string;
  date: string;
  shift: string | null;
  startedAt: string;
  errors: unknown;
}

interface DigestData {
  range: { from: string; to: string };
  gaps: Gap[];
  exhausted: ExhaustedAttempt[];
  failedRuns: FailedRun[];
}

const PIPELINE_TO_GAP: Record<string, Gap['pipeline']> = {
  kip_daily: 'kip-shift',
  kip_segments: 'kip-segments',
  dt_daily: 'dt-shift',
  dt_segments: 'dt-segments',
  analytics_daily: 'analytics-track',
};

function failedRunHasCurrentGap(row: { pipeline_name: string; target_date: string; shift_type: string | null }, gapKeys: Set<string>): boolean {
  const pipeline = PIPELINE_TO_GAP[row.pipeline_name];
  if (!pipeline) return false;
  if (row.shift_type) return gapKeys.has(`${pipeline}:${row.target_date}:${row.shift_type}`);
  return [...gapKeys].some((key) => key === `${pipeline}:${row.target_date}:` || key.startsWith(`${pipeline}:${row.target_date}:`));
}

export async function collectDigestData(): Promise<DigestData> {
  const config = getConfig();
  const to = addDays(ekTodayIso(), -1);
  const from = addDays(to, -6);
  const gaps = await scanGaps(from, to);
  const gapKeys = new Set(gaps.map(gapKey));
  const { mainPool } = getDeps();

  const attemptsRes = await mainPool.query<{
    pipeline: string;
    date: string;
    shift: string | null;
    attempts: number;
    lastattemptat: string | null;
    lastresult: string | null;
  }>(
    `SELECT pipeline,
            target_date::text AS date,
            shift_type AS shift,
            attempts,
            last_attempt_at::text AS "lastattemptat",
            last_result AS "lastresult"
       FROM public.catchup_attempts
      WHERE attempts >= $1
      ORDER BY last_attempt_at DESC NULLS LAST
      LIMIT 100`,
    [config.catchupMaxAttempts],
  );
  const exhausted = attemptsRes.rows
    .filter((row) => gapKeys.has(`${row.pipeline}:${row.date}:${row.shift ?? ''}`))
    .map((row) => ({
      pipeline: row.pipeline,
      date: row.date,
      shift: row.shift,
      attempts: Number(row.attempts),
      lastAttemptAt: row.lastattemptat,
      lastResult: row.lastresult,
    }));

  const failedRes = await mainPool.query<{
    run_id: string;
    pipeline_name: string;
    target_date: string;
    shift_type: string | null;
    started_at: string;
    errors: unknown;
  }>(
    `SELECT run_id,
            pipeline_name,
            target_date::text,
            shift_type,
            started_at::text,
            errors
       FROM public.pipeline_runs
      WHERE status = 'failed'
        AND started_at >= now() - interval '24 hours'
      ORDER BY started_at DESC`,
  );
  const failedRuns = failedRes.rows
    .filter((row) => failedRunHasCurrentGap(row, gapKeys))
    .map((row) => ({
      runId: row.run_id,
      pipelineName: row.pipeline_name,
      date: row.target_date,
      shift: row.shift_type,
      startedAt: row.started_at,
      errors: row.errors,
    }));

  return { range: { from, to }, gaps, exhausted, failedRuns };
}

function buildDigestBody(data: DigestData): string {
  const lines = [
    `Период проверки: ${data.range.from} — ${data.range.to}.`,
    '',
    `Дыры в данных: ${data.gaps.length}`,
    ...(data.gaps.length > 0 ? data.gaps.map((gap) => `- ${formatGap(gap)}`) : ['- не обнаружены']),
    '',
    `Исчерпан лимит попыток догона: ${data.exhausted.length}`,
    ...(data.exhausted.length > 0
      ? data.exhausted.map((row) => `- ${row.pipeline} ${row.date}${row.shift ? ` ${row.shift}` : ''}: ${row.attempts} попыток, last=${row.lastResult ?? 'n/a'}`)
      : ['- нет']),
    '',
    `Упавшие прогоны за 24 часа с реально отсутствующими данными: ${data.failedRuns.length}`,
    ...(data.failedRuns.length > 0
      ? data.failedRuns.map((row) => `- ${row.pipelineName} ${row.date}${row.shift ? ` ${row.shift}` : ''}, started ${row.startedAt}, run ${row.runId}`)
      : ['- нет']),
  ];
  return lines.join('\n');
}

export async function sendDigestIfNeeded(): Promise<AlertResult> {
  const config = getConfig();
  const data = await collectDigestData();
  const hasContent = data.gaps.length > 0 || data.exhausted.length > 0 || data.failedRuns.length > 0;
  if (!hasContent && !config.digestAlways) {
    log.info({ category: 'alert', msg: 'digest skipped: no issues', fields: { range: data.range } });
    return { ok: true, mode: 'suppressed' };
  }
  return sendAlert({
    key: 'digest',
    subject: `[ЛК Мстрой] Дыры в данных: ${data.gaps.length} позиций`,
    body: buildDigestBody(data),
    severity: data.failedRuns.length > 0 || data.exhausted.length > 0 ? 'warning' : 'info',
  });
}

export async function registerAlertsCron(): Promise<void> {
  const boss = getDeps().boss;
  if (!boss) {
    log.warn({ category: 'alert', msg: 'pg-boss is not configured, alert digest cron disabled' });
    return;
  }
  await boss.createQueue(DIGEST_QUEUE);
  await boss.schedule(DIGEST_QUEUE, '30 8 * * *', {});
  await boss.work(DIGEST_QUEUE, async () => {
    await sendDigestIfNeeded();
  });
  log.info({
    category: 'alert',
    msg: 'alert digest cron registered',
    fields: { queue: DIGEST_QUEUE, cronUtc: '30 8 * * *', localTime: '13:30 Asia/Yekaterinburg' },
  });
}

export async function startAlerts(): Promise<void> {
  await checkDowntimeOnStart().catch((err) => {
    log.error({ category: 'alert', msg: 'startup downtime check failed', fields: { error: String(err) } });
  });

  setInterval(() => {
    touchHeartbeat().catch((err) => {
      log.warn({ category: 'alert', msg: 'admin heartbeat update failed', fields: { error: String(err) } });
    });
  }, 5 * 60_000).unref?.();

  await pingHealthcheck();
  setInterval(() => {
    pingHealthcheck().catch(() => {});
  }, getConfig().heartbeatIntervalMs).unref?.();
}

export function registerAlertRoutes(app: Express): void {
  app.post('/api/admin/alerts/test', async (_req: Request, res: Response) => {
    try {
      const result = await sendAlert({
        key: `test:${Date.now()}`,
        subject: '[ЛК Мстрой] Тестовое уведомление',
        body: `Тестовое уведомление admin от ${formatEk(new Date())}.`,
        severity: 'info',
      });
      if (result.mode === 'disabled' || result.mode === 'suppressed') {
        res.json({ ok: result.ok, mode: getConfig().dryRun ? 'dry-run' : 'sent' });
        return;
      }
      res.json({ ok: result.ok, mode: result.mode === 'error' ? 'error' : result.mode, error: result.error });
    } catch (err) {
      log.error({ category: 'alert', msg: 'test alert endpoint failed', fields: { error: String(err) } });
      res.status(500).json({ ok: false, mode: 'error', error: String(err) });
    }
  });

  app.get('/api/admin/alerts/status', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      const lastAlerts = await getDeps().mainPool.query(
        `SELECT key, sent_at::text AS "sentAt", subject, severity
           FROM public.alert_log
          ORDER BY sent_at DESC
          LIMIT 20`,
      );
      res.json({
        enabled: config.enabled,
        dryRun: config.dryRun,
        smtpHost: config.smtpHost || null,
        to: config.to,
        heartbeat: {
          url: Boolean(config.heartbeatUrl),
          lastPingAt: heartbeatState.lastPingAt,
          lastPingOk: heartbeatState.lastPingOk,
        },
        lastAlerts: lastAlerts.rows,
      });
    } catch (err) {
      log.error({ category: 'alert', msg: 'alert status endpoint failed', fields: { error: String(err) } });
      res.status(500).json({ error: String(err) });
    }
  });
}
