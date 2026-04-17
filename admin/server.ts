import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn, execSync, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { createPipelineRunRepo, type PipelineRun } from './src/repositories/pipelineRunRepo';

dotenv.config();

// Локальные запросы к бэкендам не должны идти через системный прокси.
// Node.js built-in fetch() НЕ уважает NO_PROXY — удаляем http_proxy/https_proxy целиком.
// Admin-сервер общается только с localhost-бэкендами, внешний прокси не нужен.
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const PORT = Number(process.env.ADMIN_PORT || 3005);
const ROOT = path.resolve(__dirname, '..');

// ─── Service definitions ──────────────────────────────────────────────────────

interface ServiceConfig {
  id: string;
  name: string;
  cmd: string;
  args: string[];
  cwd: string;
  port: number;
}

const SERVICES: ServiceConfig[] = [
  {
    id: 'kip',
    name: 'КИП техники',
    cmd: 'npm',
    args: ['run', 'dev:server'],
    cwd: path.join(ROOT, 'kip'),
    port: 3001,
  },
  {
    id: 'dump-trucks',
    name: 'Самосвалы',
    cmd: 'npm',
    args: ['run', 'dev'],
    cwd: path.join(ROOT, 'dump-trucks/server'),
    port: 3002,
  },
  {
    id: 'geo-admin',
    name: 'Гео-Администратор',
    cmd: 'npm',
    args: ['run', 'dev'],
    cwd: path.join(ROOT, 'geo-admin/server'),
    port: 3003,
  },
  {
    id: 'vehicle-status',
    name: 'Состояние ТС',
    cmd: 'npm',
    args: ['run', 'dev'],
    cwd: path.join(ROOT, 'vehicle-status/server'),
    port: 3004,
  },
  {
    id: 'tyagachi',
    name: 'Тягачи',
    cmd: 'python',
    args: ['main.py', '--web', '--port', '8000'],
    cwd: path.join(ROOT, 'tyagachi'),
    port: 8000,
  },
  {
    id: 'ai-reports',
    name: 'AI Отчёты',
    cmd: 'npm',
    args: ['run', 'dev'],
    cwd: path.join(ROOT, 'ai-reports/server'),
    port: 3006,
  },
];

// ─── Process state ────────────────────────────────────────────────────────────

const processes: Record<string, ChildProcess | null> = {};
const logs: Record<string, string[]> = {};
const LOG_LIMIT = 300;

function appendLog(id: string, line: string) {
  if (!logs[id]) logs[id] = [];
  logs[id].push(line);
  if (logs[id].length > LOG_LIMIT) logs[id].shift();
}

// ─── Port health check ────────────────────────────────────────────────────────

function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host: 'localhost' });
    const cleanup = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(800);
    socket.on('connect', () => cleanup(true));
    socket.on('error', () => cleanup(false));
    socket.on('timeout', () => cleanup(false));
  });
}

// ─── Process management ───────────────────────────────────────────────────────

function startService(cfg: ServiceConfig) {
  if (processes[cfg.id]) {
    try { processes[cfg.id]!.kill(); } catch {}
  }

  appendLog(cfg.id, `[admin] Запуск: ${cfg.cmd} ${cfg.args.join(' ')}`);

  const isWin = process.platform === 'win32';
  const childEnv = { ...process.env, FORCE_COLOR: '1', NO_PROXY: 'localhost,127.0.0.1', CRON_DISABLED: 'true' };
  const child = isWin
    ? spawn(`${cfg.cmd} ${cfg.args.join(' ')}`, [], {
        cwd: cfg.cwd,
        env: childEnv,
        shell: true,
      })
    : spawn(cfg.cmd, cfg.args, {
        cwd: cfg.cwd,
        env: childEnv,
        shell: false,
      });

  processes[cfg.id] = child;

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(l => appendLog(cfg.id, l));
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(l => appendLog(cfg.id, `[err] ${l}`));
  });

  child.on('exit', (code) => {
    appendLog(cfg.id, `[admin] Процесс завершён (код ${code})`);
    if (processes[cfg.id] === child) {
      processes[cfg.id] = null;
    }
  });

  child.on('error', (err) => {
    appendLog(cfg.id, `[admin] Ошибка запуска: ${err.message}`);
    processes[cfg.id] = null;
  });
}

function stopService(id: string) {
  const child = processes[id];
  const cfg = SERVICES.find(s => s.id === id);
  if (!child && !cfg) return;
  appendLog(id, '[admin] Остановка...');

  if (process.platform === 'win32') {
    if (child?.pid) {
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: false });
    }
    if (cfg?.port) {
      setTimeout(() => {
        try {
          const out = execSync(`netstat -ano | findstr :${cfg.port} | findstr LISTENING`, { encoding: 'utf8' });
          const match = out.match(/(\d+)\s*$/m);
          if (match && match[1]) {
            const pid = parseInt(match[1], 10);
            if (pid && pid !== process.pid) {
              appendLog(id, `[admin] Killing leftover PID ${pid} on port ${cfg.port}`);
              spawn('taskkill', ['/F', '/PID', String(pid)], { shell: false });
            }
          }
        } catch {}
      }, 1000);
    }
  } else {
    if (child) child.kill('SIGTERM');
    setTimeout(() => {
      if (processes[id] === child) {
        try { child?.kill('SIGKILL'); } catch {}
      }
    }, 3000);
  }
}

// ─── DB connections ───────────────────────────────────────────────────────────

const kipPool = new Pool({
  host: process.env.KIP_DB_HOST || 'localhost',
  port: Number(process.env.KIP_DB_PORT || 5432),
  database: process.env.KIP_DB_NAME || 'kip_vehicles',
  user: process.env.KIP_DB_USER || 'max',
  password: process.env.KIP_DB_PASSWORD,
});

const mainPool = new Pool({
  host: process.env.MAIN_DB_HOST || 'localhost',
  port: Number(process.env.MAIN_DB_PORT || 5433),
  database: process.env.MAIN_DB_NAME || 'mstroy',
  user: process.env.MAIN_DB_USER || 'max',
  password: process.env.MAIN_DB_PASSWORD,
});

// ─── Pipeline Run Tracking ────────────────────────────────────────────────────

const pipelineRepo = createPipelineRunRepo(mainPool);

// ─── pg-boss ──────────────────────────────────────────────────────────────────

const boss = new PgBoss({
  host: process.env.MAIN_DB_HOST || 'localhost',
  port: Number(process.env.MAIN_DB_PORT || 5433),
  database: process.env.MAIN_DB_NAME || 'mstroy',
  user: process.env.MAIN_DB_USER || 'max',
  password: process.env.MAIN_DB_PASSWORD,
  schema: 'pgboss',
});

boss.on('error', (err: Error) => console.error('[pg-boss] Error:', err));

// ─── Run migration ───────────────────────────────────────────────────────────

async function runMigration(): Promise<void> {
  const migrationPath = path.join(__dirname, 'migrations', '001_pipeline_runs.sql');
  try {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    await mainPool.query(sql);
    console.log('[admin] Migration 001_pipeline_runs applied successfully');
  } catch (err) {
    console.error('[admin] Migration error (non-fatal):', err);
  }
}

// ─── pg-boss job definitions ─────────────────────────────────────────────────

interface FetchJobPayload {
  date: string;
  mode: 'normal' | 'force' | 'refresh';
  triggerType: 'cron' | 'manual' | 'cascade';
}

interface RecalcJobPayload {
  date: string;
  triggerType: 'cron' | 'manual' | 'cascade';
}

interface SegmentJobPayload {
  date: string;
  force: boolean;
  triggerType: 'manual' | 'cascade';
}

async function registerWorkers(): Promise<void> {
  // pg-boss v12: queues must be created before workers can subscribe
  const queues = [
    'fetch-kip-date', 'fetch-dt-date',
    'recalc-kip-date', 'recalc-dt-date',
    'fetch-dt-segments',
  ];
  for (const q of queues) {
    await boss.createQueue(q);
  }

  // Helper: pg-boss v12 handlers receive Job[] (batch), we process first item
  type Handler<T> = (jobs: { id: string; name: string; data: T }[]) => Promise<void>;

  // fetch-kip-date worker
  const kipFetchHandler: Handler<FetchJobPayload> = async (jobs) => {
    const { date, mode, triggerType } = jobs[0].data;
    const runId = await pipelineRepo.createRun({ pipelineName: 'kip_daily', triggerType, targetDate: date });
    try {
      await fetch(`http://localhost:3001/api/admin/fetch?date=${date}`, { method: 'POST' });
      if (mode === 'force') {
        const fireTime = new Date().toISOString();
        await waitForRawComplete(kipPool, date, fireTime, () => false);
      } else {
        const result = await waitForDate(kipPool, `SELECT 1 FROM vehicle_records WHERE report_date = $1 LIMIT 1`, [date], 35 * 60 * 1000, () => false);
        if (result === 'timeout') throw new Error(`Timeout waiting for KIP data: ${date}`);
      }
      // Record vehicle count metrics
      const countRes = await kipPool.query(
        `SELECT COUNT(DISTINCT vehicle_id)::int AS cnt FROM vehicle_records WHERE report_date = $1 AND COALESCE(is_gap_filled, false) = false`,
        [date],
      );
      const cnt = countRes.rows[0]?.cnt ?? 0;
      await pipelineRepo.completeRun(runId, { totalVehicles: cnt, successCount: cnt, errorCount: 0 });
    } catch (err) {
      await pipelineRepo.failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
  await boss.work('fetch-kip-date', { batchSize: 1 }, kipFetchHandler as any);

  // fetch-dt-date worker
  const dtFetchHandler: Handler<FetchJobPayload> = async (jobs) => {
    const { date, triggerType } = jobs[0].data;
    const runId = await pipelineRepo.createRun({ pipelineName: 'dt_daily', triggerType, targetDate: date });
    try {
      await fetch(`http://localhost:3002/api/dt/admin/fetch?date=${date}&shift=shift1`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 2000));
      await fetch(`http://localhost:3002/api/dt/admin/fetch?date=${date}&shift=shift2`, { method: 'POST' });
      const result = await waitForDate(mainPool, `SELECT 1 FROM dump_trucks.shift_records WHERE report_date = $1 LIMIT 1`, [date], 20 * 60 * 1000, () => false);
      if (result === 'timeout') throw new Error(`Timeout waiting for DT data: ${date}`);
      // Record vehicle count metrics
      const dtCountRes = await mainPool.query(
        `SELECT COUNT(DISTINCT vehicle_id)::int AS cnt FROM dump_trucks.shift_records WHERE report_date = $1`,
        [date],
      );
      const dtCnt = dtCountRes.rows[0]?.cnt ?? 0;
      await pipelineRepo.completeRun(runId, { totalVehicles: dtCnt, successCount: dtCnt, errorCount: 0 });
    } catch (err) {
      await pipelineRepo.failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
  await boss.work('fetch-dt-date', { batchSize: 1 }, dtFetchHandler as any);

  // recalc-kip-date worker
  const kipRecalcHandler: Handler<RecalcJobPayload> = async (jobs) => {
    const { date, triggerType } = jobs[0].data;
    const runId = await pipelineRepo.createRun({ pipelineName: 'kip_recalc', triggerType, targetDate: date });
    try {
      const startRes = await fetch(`http://localhost:3001/api/admin/recalculate?date=${date}`, { method: 'POST' });
      if (!startRes.ok) throw new Error(`KIP recalc start failed: HTTP ${startRes.status}`);
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 10_000));
        const statusRes = await fetch(`http://localhost:3001/api/admin/recalculate/status?date=${date}`);
        if (!statusRes.ok) continue;
        const body = await statusRes.json() as { status: string; errors?: string[] };
        if (body.status === 'done') { await pipelineRepo.completeRun(runId, { errors: body.errors }); return; }
        if (body.status === 'not_found') throw new Error('Job lost (server restart?)');
      }
      throw new Error(`Timeout (25 min)`);
    } catch (err) {
      await pipelineRepo.failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
  await boss.work('recalc-kip-date', { batchSize: 1 }, kipRecalcHandler as any);

  // recalc-dt-date worker
  const dtRecalcHandler: Handler<RecalcJobPayload> = async (jobs) => {
    const { date, triggerType } = jobs[0].data;
    const runId = await pipelineRepo.createRun({ pipelineName: 'dt_recalc', triggerType, targetDate: date });
    try {
      const [r1, r2] = await Promise.all([
        fetch(`http://localhost:3002/api/dt/admin/recalculate?date=${date}&shift=shift1`, { method: 'POST' }),
        fetch(`http://localhost:3002/api/dt/admin/recalculate?date=${date}&shift=shift2`, { method: 'POST' }),
      ]);
      const [b1, b2] = await Promise.all([
        r1.json() as Promise<{ status: string; errors?: string[] }>,
        r2.json() as Promise<{ status: string; errors?: string[] }>,
      ]);
      const errs: string[] = [];
      if (!r1.ok || b1.status === 'error') errs.push(`shift1: ${b1.errors?.join(', ') ?? r1.status}`);
      if (!r2.ok || b2.status === 'error') errs.push(`shift2: ${b2.errors?.join(', ') ?? r2.status}`);
      if (errs.length > 0) { await pipelineRepo.failRun(runId, errs.join(' | ')); }
      else { await pipelineRepo.completeRun(runId, {}); }
    } catch (err) {
      await pipelineRepo.failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
  await boss.work('recalc-dt-date', { batchSize: 1 }, dtRecalcHandler as any);

  // fetch-dt-segments worker
  const dtSegHandler: Handler<SegmentJobPayload> = async (jobs) => {
    const { date, force, triggerType } = jobs[0].data;
    const runId = await pipelineRepo.createRun({ pipelineName: 'dt_segments', triggerType, targetDate: date });
    try {
      const forceParam = force ? '&force=true' : '';
      await fetch(`http://localhost:3002/api/dt/admin/fetch-segments?date=${date}&shift=shift1${forceParam}`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 1000));
      await fetch(`http://localhost:3002/api/dt/admin/fetch-segments?date=${date}&shift=shift2${forceParam}`, { method: 'POST' });

      if (force) {
        const deadline = Date.now() + 15 * 60 * 1000;
        let lastCount = -1;
        let stableChecks = 0;
        await new Promise(r => setTimeout(r, 10_000));
        while (Date.now() < deadline) {
          const res = await mainPool.query(
            `SELECT COUNT(*)::int AS cnt FROM dump_trucks.shift_segments ss JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id WHERE sr.report_date = $1`,
            [date],
          );
          const count: number = res.rows[0]?.cnt ?? 0;
          if (count > 0 && count === lastCount) { stableChecks++; if (stableChecks >= 2) break; }
          else { stableChecks = 0; }
          lastCount = count;
          await new Promise(r => setTimeout(r, 30_000));
        }
      } else {
        await waitForDate(mainPool, `SELECT 1 FROM dump_trucks.shift_segments ss JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id WHERE sr.report_date = $1 LIMIT 1`, [date], 20 * 60 * 1000, () => false, 30_000);
      }
      await pipelineRepo.completeRun(runId, {});
    } catch (err) {
      await pipelineRepo.failRun(runId, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
  await boss.work('fetch-dt-segments', { batchSize: 1 }, dtSegHandler as any);

  // ─── Cron schedules via pg-boss (timezone-aware) ──────────────────────────

  // Known timezone → UTC offset map for cron scheduling
  const TZ_OFFSETS: Record<string, number> = {
    'Asia/Yekaterinburg': 5,
    'Asia/Irkutsk': 8,
    'Asia/Krasnoyarsk': 7,
    'Asia/Novosibirsk': 7,
    'Europe/Moscow': 3,
  };

  // Query distinct timezones from geo.objects
  let objectTimezones: string[] = ['Asia/Yekaterinburg'];
  try {
    const tzRes = await mainPool.query(`SELECT DISTINCT timezone FROM geo.objects WHERE timezone IS NOT NULL`);
    if (tzRes.rows.length > 0) {
      objectTimezones = tzRes.rows.map((r: { timezone: string }) => r.timezone);
    }
  } catch { /* fallback to default */ }

  console.log(`[pg-boss] Timezones from geo.objects: ${objectTimezones.join(', ')}`);

  // Register per-timezone KIP cron (shift2 ends 07:30 local → fetch at 08:30 local)
  for (const tz of objectTimezones) {
    const offset = TZ_OFFSETS[tz] ?? 5;
    const utcHour = (8 - offset + 24) % 24; // 08:30 local → UTC hour
    const cronName = `kip-cron-${tz.replace(/\//g, '-').toLowerCase()}`;
    await boss.createQueue(cronName);
    await boss.schedule(cronName, `30 ${utcHour} * * *`, { timezone: tz });
    await boss.work(cronName, async () => {
      const now = new Date();
      const local = new Date(now.getTime() + offset * 60 * 60 * 1000);
      const yesterday = new Date(local.getTime() - 24 * 60 * 60 * 1000);
      const date = yesterday.toISOString().slice(0, 10);
      console.log(`[pg-boss cron] KIP fetch for ${date} (${tz})`);
      await boss.send('fetch-kip-date', { date, mode: 'normal', triggerType: 'cron' });
    });
  }

  // DT shift2 at 08:30 Yekaterinburg = 03:30 UTC (DT currently only uses Yekaterinburg)
  await boss.createQueue('dt-shift2-cron');
  await boss.schedule('dt-shift2-cron', '30 3 * * *', {});
  await boss.work('dt-shift2-cron', async () => {
    const now = new Date();
    const ykb = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const yesterday = new Date(ykb.getTime() - 24 * 60 * 60 * 1000);
    const date = yesterday.toISOString().slice(0, 10);
    console.log(`[pg-boss cron] DT shift2 fetch for ${date}`);
    await boss.send('fetch-dt-date', { date, mode: 'normal', triggerType: 'cron' });
  });

  // DT shift1 at 20:30 Yekaterinburg = 15:30 UTC
  await boss.createQueue('dt-shift1-cron');
  await boss.schedule('dt-shift1-cron', '30 15 * * *', {});
  await boss.work('dt-shift1-cron', async () => {
    const now = new Date();
    const ykb = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const date = ykb.toISOString().slice(0, 10);
    console.log(`[pg-boss cron] DT shift1 fetch for ${date}`);
    await boss.send('fetch-dt-date', { date, mode: 'normal', triggerType: 'cron' });
  });

  console.log('[pg-boss] Workers and cron schedules registered');
}

// ─── Data queries ─────────────────────────────────────────────────────────────

async function getKipDates(from: string, to: string): Promise<{ dates: string[]; error?: string }> {
  try {
    const res = await kipPool.query(
      `SELECT DISTINCT report_date::text FROM vehicle_records
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date`,
      [from, to]
    );
    return { dates: res.rows.map(r => r.report_date) };
  } catch (e) {
    return { dates: [], error: String(e) };
  }
}

async function getKipRawDates(from: string, to: string): Promise<{ dates: string[]; partial: string[]; error?: string }> {
  try {
    const res = await kipPool.query(
      `SELECT
         vr.report_date::text,
         COUNT(DISTINCT vr.vehicle_id || '|' || vr.shift_type)
           FILTER (WHERE COALESCE(vr.is_gap_filled, false) = false) AS vr_count,
         COUNT(DISTINCT mr.vehicle_id || '|' || mr.shift_type)  AS raw_count
       FROM vehicle_records vr
       LEFT JOIN monitoring_raw mr
         ON mr.report_date = vr.report_date
         AND mr.vehicle_id = vr.vehicle_id
         AND mr.shift_type = vr.shift_type
       WHERE vr.report_date BETWEEN $1 AND $2
       GROUP BY vr.report_date`,
      [from, to],
    );
    const dates: string[] = [];
    const partial: string[] = [];
    for (const row of res.rows) {
      const pct = row.vr_count > 0 ? row.raw_count / row.vr_count : 0;
      if (pct >= 0.9) dates.push(row.report_date);
      else if (row.raw_count > 0) partial.push(row.report_date);
    }
    return { dates, partial };
  } catch (e) {
    return { dates: [], partial: [], error: String(e) };
  }
}

async function getDumpTrucksDates(from: string, to: string): Promise<{ dates: string[]; error?: string }> {
  try {
    const res = await mainPool.query(
      `SELECT DISTINCT report_date::text FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date`,
      [from, to]
    );
    return { dates: res.rows.map(r => r.report_date) };
  } catch (e) {
    return { dates: [], error: String(e) };
  }
}

// ─── Fetch queue ──────────────────────────────────────────────────────────────

interface FetchProgress {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  queue: string[];        // даты ожидающие загрузки
  current: string | null; // дата в процессе
  startedAt: number | null; // unix ms когда текущая дата начала загружаться
  done: string[];         // успешно загруженные
  errors: string[];       // ошибки по датам
  cancelRequested: boolean;
}

const fetchProgress: FetchProgress = {
  active: false,
  service: null,
  queue: [],
  current: null,
  startedAt: null,
  done: [],
  errors: [],
  cancelRequested: false,
};

// ─── Recalc queue ──────────────────────────────────────────────────────────────

interface RecalcProgress {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  queue: string[];        // даты ожидающие пересчёта
  current: string | null;
  done: string[];
  errors: string[];
  cancelRequested: boolean;
}

const recalcProgress: RecalcProgress = {
  active: false,
  service: null,
  queue: [],
  current: null,
  done: [],
  errors: [],
  cancelRequested: false,
};

// Генерация всех дат в диапазоне
function allDatesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Ожидать завершения force-пайплайна: считаем новые записи в monitoring_raw (fetched_at >= fireTime).
// Пайплайн считается завершённым, когда счётчик не меняется 2 проверки подряд (~30с).
async function waitForRawComplete(
  pool: Pool,
  date: string,
  fireTime: string,
  isCancelled: () => boolean,
): Promise<'ok' | 'timeout' | 'cancelled'> {
  const deadline = Date.now() + 30 * 60 * 1000; // 30 мин макс
  let lastCount = -1;
  let stableChecks = 0;

  while (Date.now() < deadline) {
    if (isCancelled()) return 'cancelled';
    await new Promise(r => setTimeout(r, 15_000));
    if (isCancelled()) return 'cancelled';

    try {
      const res = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM monitoring_raw WHERE report_date = $1 AND fetched_at >= $2`,
        [date, fireTime],
      );
      const count: number = res.rows[0]?.cnt ?? 0;

      if (count > 0 && count === lastCount) {
        stableChecks++;
        if (stableChecks >= 2) return 'ok'; // счётчик не менялся ~30с → пайплайн завершён
      } else {
        stableChecks = 0;
      }
      lastCount = count;
    } catch { /* ignore poll errors */ }
  }

  return 'timeout';
}

// Ожидать появления даты в БД (поллинг каждые intervalMs, таймаут timeoutMs)
async function waitForDate(
  pool: Pool,
  query: string,
  params: string[],
  timeoutMs: number,
  isCancelled: () => boolean = () => fetchProgress.cancelRequested,
  intervalMs: number = 20_000,
): Promise<'ok' | 'timeout' | 'cancelled'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled()) return 'cancelled';
    await new Promise(r => setTimeout(r, intervalMs));
    if (isCancelled()) return 'cancelled';
    try {
      const res = await pool.query(query, params);
      if ((res.rowCount ?? 0) > 0) return 'ok';
    } catch { /* игнорируем ошибки поллинга */ }
  }
  return 'timeout';
}

async function runKipQueue(dates: string[], pollRaw = false) {
  fetchProgress.active = true;
  fetchProgress.service = 'kip';
  fetchProgress.done = [];
  fetchProgress.errors = [];
  fetchProgress.cancelRequested = false;
  fetchProgress.queue = [...dates];

  for (const date of dates) {
    if (fetchProgress.cancelRequested) break;

    fetchProgress.current = date;
    fetchProgress.startedAt = Date.now();
    fetchProgress.queue = fetchProgress.queue.filter(d => d !== date);

    try {
      await fetch(`http://localhost:3001/api/admin/fetch?date=${date}`, { method: 'POST' });

      if (pollRaw) {
        // force-режим: ждём пока monitoring_raw перестанет пополняться (~30с стабильности).
        // Естественный темп — один пайплайн за раз, никаких hard minimum.
        const fireTime = new Date().toISOString();
        const result = await waitForRawComplete(kipPool, date, fireTime, () => fetchProgress.cancelRequested);
        if (result === 'cancelled') break;
        // timeout тоже считается done (пайплайн запущен, данные придут в фоне)
      } else {
        // normal mode: ждём vehicle_records (30 мин, поллинг 20с)
        const result = await waitForDate(
          kipPool,
          `SELECT 1 FROM vehicle_records WHERE report_date = $1 LIMIT 1`,
          [date],
          30 * 60 * 1000,
        );
        if (result === 'cancelled') break;
        if (result === 'timeout') {
          fetchProgress.errors.push(`${date}: таймаут (30 мин)`);
          continue;
        }
      }

      fetchProgress.done.push(date);
    } catch (e) {
      fetchProgress.errors.push(`${date}: ${e}`);
    }
  }

  fetchProgress.active = false;
  fetchProgress.current = null;
  fetchProgress.startedAt = null;
  fetchProgress.service = null;
}

async function runDTQueue(dates: string[]) {
  fetchProgress.active = true;
  fetchProgress.service = 'dump-trucks';
  fetchProgress.done = [];
  fetchProgress.errors = [];
  fetchProgress.cancelRequested = false;
  fetchProgress.queue = [...dates];

  for (const date of dates) {
    if (fetchProgress.cancelRequested) break;

    fetchProgress.current = date;
    fetchProgress.queue = fetchProgress.queue.filter(d => d !== date);

    try {
      // Запускаем обе смены
      await fetch(`http://localhost:3002/api/dt/admin/fetch?date=${date}&shift=shift1`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 2000)); // небольшая пауза между сменами
      await fetch(`http://localhost:3002/api/dt/admin/fetch?date=${date}&shift=shift2`, { method: 'POST' });

      // DT pipeline быстрее — таймаут 8 минут
      const result = await waitForDate(
        mainPool,
        `SELECT 1 FROM dump_trucks.shift_records WHERE report_date = $1 LIMIT 1`,
        [date],
        8 * 60 * 1000
      );

      if (result === 'cancelled') break;
      if (result === 'timeout') {
        fetchProgress.errors.push(`${date}: таймаут (8 мин)`);
      } else {
        fetchProgress.done.push(date);
      }
    } catch (e) {
      fetchProgress.errors.push(`${date}: ${e}`);
    }
  }

  fetchProgress.active = false;
  fetchProgress.current = null;
  fetchProgress.service = null;
}

// Пересчёт KIP: endpoint асинхронный (возвращает сразу), поллим статус каждые 10с
async function runKipRecalc(dates: string[]) {
  recalcProgress.active = true;
  recalcProgress.service = 'kip';
  recalcProgress.done = [];
  recalcProgress.errors = [];
  recalcProgress.cancelRequested = false;
  recalcProgress.queue = [...dates];

  for (const date of dates) {
    if (recalcProgress.cancelRequested) break;

    recalcProgress.current = date;
    recalcProgress.queue = recalcProgress.queue.filter(d => d !== date);

    try {
      // Запускаем пересчёт — endpoint возвращает сразу
      const startRes = await fetch(`http://localhost:3001/api/admin/recalculate?date=${date}`, { method: 'POST' });
      if (!startRes.ok) {
        recalcProgress.errors.push(`${date}: HTTP ${startRes.status}`);
        continue;
      }

      // Поллим статус (таймаут 20 минут)
      const deadline = Date.now() + 20 * 60 * 1000;
      let finished = false;
      while (Date.now() < deadline) {
        if (recalcProgress.cancelRequested) break;
        await new Promise(r => setTimeout(r, 10_000));
        if (recalcProgress.cancelRequested) break;

        try {
          const statusRes = await fetch(`http://localhost:3001/api/admin/recalculate/status?date=${date}`);
          if (!statusRes.ok) continue;
          const body = await statusRes.json() as { status: string; errors?: string[] };

          if (body.status === 'done') {
            if (body.errors && body.errors.length > 0) {
              recalcProgress.errors.push(`${date}: ${body.errors.join(', ')}`);
            } else {
              recalcProgress.done.push(date);
            }
            finished = true;
            break;
          }
          if (body.status === 'not_found') {
            // Сервер перезапустился — job потерян
            recalcProgress.errors.push(`${date}: job lost (server restart?)`);
            finished = true;
            break;
          }
          // status === 'running' → ждём
        } catch {
          // poll failed → продолжаем ждать
        }
      }

      if (!finished && !recalcProgress.cancelRequested) {
        recalcProgress.errors.push(`${date}: timeout (20 min)`);
      }
    } catch (e) {
      recalcProgress.errors.push(`${date}: ${e}`);
    }
  }

  recalcProgress.active = false;
  recalcProgress.current = null;
  recalcProgress.service = null;
}

// Пересчёт Самосвалов: две смены на дату, оба endpoint синхронные
async function runDTRecalc(dates: string[]) {
  recalcProgress.active = true;
  recalcProgress.service = 'dump-trucks';
  recalcProgress.done = [];
  recalcProgress.errors = [];
  recalcProgress.cancelRequested = false;
  recalcProgress.queue = [...dates];

  for (const date of dates) {
    if (recalcProgress.cancelRequested) break;

    recalcProgress.current = date;
    recalcProgress.queue = recalcProgress.queue.filter(d => d !== date);

    try {
      const [r1, r2] = await Promise.all([
        fetch(`http://localhost:3002/api/dt/admin/recalculate?date=${date}&shift=shift1`, { method: 'POST' }),
        fetch(`http://localhost:3002/api/dt/admin/recalculate?date=${date}&shift=shift2`, { method: 'POST' }),
      ]);
      const [b1, b2] = await Promise.all([
        r1.json() as Promise<{ status: string; errors?: string[] }>,
        r2.json() as Promise<{ status: string; errors?: string[] }>,
      ]);

      const errs: string[] = [];
      if (!r1.ok || b1.status === 'error') errs.push(`shift1: ${b1.errors?.join(', ') ?? r1.status}`);
      if (!r2.ok || b2.status === 'error') errs.push(`shift2: ${b2.errors?.join(', ') ?? r2.status}`);

      if (errs.length > 0) {
        recalcProgress.errors.push(`${date}: ${errs.join(' | ')}`);
      } else {
        recalcProgress.done.push(date);
      }
    } catch (e) {
      recalcProgress.errors.push(`${date}: ${e}`);
    }
  }

  recalcProgress.active = false;
  recalcProgress.current = null;
  recalcProgress.service = null;
}

// ─── Segment fetch queue ──────────────────────────────────────────────────────

interface SegmentDateResult {
  date: string;
  totalVehicles: number;
  vehiclesWithSegments: number;
  totalSegments: number;
  vehicles: Array<{
    regNumber: string;
    shiftType: string;
    segmentCount: number;
  }>;
}

interface SegmentProgress {
  active: boolean;
  queue: string[];
  current: string | null;
  startedAt: number | null;
  done: string[];
  errors: string[];
  cancelRequested: boolean;
  results: SegmentDateResult[];
}

const segmentProgress: SegmentProgress = {
  active: false,
  queue: [],
  current: null,
  startedAt: null,
  done: [],
  errors: [],
  cancelRequested: false,
  results: [],
};

async function runDTSegmentQueue(dates: string[], force: boolean) {
  segmentProgress.active = true;
  segmentProgress.done = [];
  segmentProgress.errors = [];
  segmentProgress.cancelRequested = false;
  segmentProgress.queue = [...dates];
  segmentProgress.results = [];

  for (const date of dates) {
    if (segmentProgress.cancelRequested) break;

    segmentProgress.current = date;
    segmentProgress.startedAt = Date.now();
    segmentProgress.queue = segmentProgress.queue.filter(d => d !== date);

    try {
      const forceParam = force ? '&force=true' : '';

      // Fire both shifts — catch individual fetch errors
      let shift1Ok = false;
      let shift2Ok = false;
      try {
        const r1 = await fetch(`http://localhost:3002/api/dt/admin/fetch-segments?date=${date}&shift=shift1${forceParam}`, { method: 'POST' });
        shift1Ok = r1.ok;
      } catch (e) {
        segmentProgress.errors.push(`${date}/shift1: Самосвалы (:3002) не отвечают — ${e instanceof Error ? e.message : String(e)}`);
      }

      if (segmentProgress.cancelRequested) break;
      await new Promise(r => setTimeout(r, 1000));

      try {
        const r2 = await fetch(`http://localhost:3002/api/dt/admin/fetch-segments?date=${date}&shift=shift2${forceParam}`, { method: 'POST' });
        shift2Ok = r2.ok;
      } catch (e) {
        segmentProgress.errors.push(`${date}/shift2: Самосвалы (:3002) не отвечают — ${e instanceof Error ? e.message : String(e)}`);
      }

      if (!shift1Ok && !shift2Ok) {
        // Both shifts failed to even start — skip polling
        continue;
      }

      // Segment fetch is async (~12 min), poll for completion.
      // For force mode: count segments and wait until count stabilizes.
      // For normal mode: wait until at least 1 segment appears.
      if (force) {
        // Force: segments may already exist. Fire-and-forget with a short wait.
        // The DT server does the heavy lifting; just wait a reasonable time to track progress.
        const deadline = Date.now() + 15 * 60 * 1000;
        let lastCount = -1;
        let stableChecks = 0;
        await new Promise(r => setTimeout(r, 10_000)); // initial wait
        while (Date.now() < deadline) {
          if (segmentProgress.cancelRequested) break;
          try {
            const res = await mainPool.query(
              `SELECT COUNT(*)::int AS cnt FROM dump_trucks.shift_segments ss
               JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id
               WHERE sr.report_date = $1`,
              [date],
            );
            const count: number = res.rows[0]?.cnt ?? 0;
            if (count > 0 && count === lastCount) {
              stableChecks++;
              if (stableChecks >= 2) break; // stable for ~60s → done
            } else {
              stableChecks = 0;
            }
            lastCount = count;
          } catch { /* ignore poll errors */ }
          await new Promise(r => setTimeout(r, 30_000));
        }
      } else {
        // Normal: wait for first segment to appear
        const result = await waitForDate(
          mainPool,
          `SELECT 1 FROM dump_trucks.shift_segments ss
           JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id
           WHERE sr.report_date = $1 LIMIT 1`,
          [date],
          15 * 60 * 1000,
          () => segmentProgress.cancelRequested,
          30_000,
        );
        if (result === 'cancelled') break;
      }

      segmentProgress.done.push(date);

      // Fetch detailed results for this date
      try {
        const detailRes = await fetch(`http://localhost:3002/api/dt/admin/segment-results?date=${date}`);
        if (detailRes.ok) {
          const detail = await detailRes.json() as {
            totalVehicles: number;
            vehiclesWithSegments: number;
            totalSegments: number;
            vehicles: Array<{ regNumber: string; shiftType: string; segmentCount: number }>;
          };
          segmentProgress.results.push({
            date,
            totalVehicles: detail.totalVehicles,
            vehiclesWithSegments: detail.vehiclesWithSegments,
            totalSegments: detail.totalSegments,
            vehicles: detail.vehicles.map(v => ({
              regNumber: v.regNumber,
              shiftType: v.shiftType,
              segmentCount: v.segmentCount,
            })),
          });
        }
      } catch { /* don't fail the queue for a results query */ }
    } catch (e) {
      segmentProgress.errors.push(`${date}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  segmentProgress.active = false;
  segmentProgress.current = null;
  segmentProgress.startedAt = null;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// GET all services with status
app.get('/api/admin/services', async (_req, res) => {
  const statuses = await Promise.all(
    SERVICES.map(async (cfg) => {
      const running = processes[cfg.id] !== null && processes[cfg.id] !== undefined;
      const portOpen = await checkPort(cfg.port);
      return {
        id: cfg.id,
        name: cfg.name,
        port: cfg.port,
        pid: processes[cfg.id]?.pid ?? null,
        running,
        portOpen,
      };
    })
  );
  res.json(statuses);
});

// POST start/stop/restart
app.post('/api/admin/services/:id/:action', (req, res) => {
  const { id, action } = req.params;
  const cfg = SERVICES.find(s => s.id === id);
  if (!cfg) {
    res.status(404).json({ error: 'Сервис не найден' });
    return;
  }

  switch (action) {
    case 'start':
      startService(cfg);
      res.json({ ok: true, action: 'start', id });
      break;
    case 'stop':
      stopService(id);
      res.json({ ok: true, action: 'stop', id });
      break;
    case 'restart':
      stopService(id);
      setTimeout(() => startService(cfg), 1500);
      res.json({ ok: true, action: 'restart', id });
      break;
    default:
      res.status(400).json({ error: 'Неизвестное действие' });
  }
});

// GET logs
app.get('/api/admin/services/:id/logs', (req, res) => {
  const { id } = req.params;
  const lines = Number(req.query.lines || 100);
  const buf = logs[id] ?? [];
  res.json({ lines: buf.slice(-lines) });
});

// GET data coverage
app.get('/api/admin/data-coverage', async (req, res) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }

  const [kipResult, dtResult, kipRawResult] = await Promise.all([
    getKipDates(from, to),
    getDumpTrucksDates(from, to),
    getKipRawDates(from, to),
  ]);

  res.json({
    kip: kipResult.dates,
    dumpTrucks: dtResult.dates,
    rawDates: kipRawResult.dates,
    rawPartial: kipRawResult.partial,
    errors: {
      kip: kipResult.error ?? null,
      dumpTrucks: dtResult.error ?? null,
    },
    config: {
      kip: `${process.env.KIP_DB_HOST || 'localhost'}:${process.env.KIP_DB_PORT || 5432}/${process.env.KIP_DB_NAME || 'kip_vehicles'} user=${process.env.KIP_DB_USER || 'max'}`,
      main: `${process.env.MAIN_DB_HOST || 'localhost'}:${process.env.MAIN_DB_PORT || 5433}/${process.env.MAIN_DB_NAME || 'mstroy'} user=${process.env.MAIN_DB_USER || 'max'}`,
    },
  });
});

// GET fetch status
app.get('/api/admin/fetch/status', (_req, res) => {
  res.json({
    active: fetchProgress.active,
    service: fetchProgress.service,
    current: fetchProgress.current,
    startedAt: fetchProgress.startedAt,
    queue: fetchProgress.queue,
    done: fetchProgress.done,
    errors: fetchProgress.errors,
  });
});

// POST cancel fetch (должен быть ДО /fetch/:service, иначе Express перехватит service=cancel)
app.post('/api/admin/fetch/cancel', (_req, res) => {
  if (!fetchProgress.active) {
    res.json({ ok: true, message: 'Нет активной загрузки' });
    return;
  }
  fetchProgress.cancelRequested = true;
  res.json({ ok: true, message: 'Отмена запрошена' });
});

// POST start fetch for kip or dump-trucks
app.post('/api/admin/fetch/:service', async (req, res) => {
  const { service } = req.params;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (service !== 'kip' && service !== 'dump-trucks') {
    res.status(400).json({ error: 'service должен быть kip или dump-trucks' });
    return;
  }
  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }
  if (fetchProgress.active) {
    res.status(409).json({ error: 'Уже выполняется загрузка' });
    return;
  }

  const force = req.query.force === 'true';
  const refresh = req.query.refresh === 'true';

  // Вычислить недостающие даты
  const allDates = allDatesInRange(from, to).reverse(); // от последней к ранней
  let missing: string[];

  if (refresh) {
    // refresh-режим: фетчить ВСЕ даты в диапазоне, включая уже загруженные
    missing = allDates;
    if (missing.length === 0) {
      res.json({ ok: true, message: 'Нет дат в диапазоне', missing: 0 });
      return;
    }
  } else if (force && service === 'kip') {
    // force-режим: перевыгружаем только даты у которых есть vehicle_records, но нет monitoring_raw
    const [kipResult, rawResult] = await Promise.all([
      getKipDates(from, to),
      getKipRawDates(from, to),
    ]);
    const kipSet = new Set(kipResult.dates);
    const rawSet = new Set(rawResult.dates);
    missing = allDates.filter(d => kipSet.has(d) && !rawSet.has(d));
    if (missing.length === 0) {
      res.json({ ok: true, message: 'Все даты уже есть в monitoring_raw', missing: 0 });
      return;
    }
  } else {
    // обычный режим: только даты без vehicle_records
    const existingResult = service === 'kip'
      ? await getKipDates(from, to)
      : await getDumpTrucksDates(from, to);
    const existingSet = new Set(existingResult.dates);
    missing = allDates.filter(d => !existingSet.has(d));
    if (missing.length === 0) {
      res.json({ ok: true, message: 'Все даты уже загружены', missing: 0 });
      return;
    }
  }

  res.json({ ok: true, started: true, missing: missing.length, dates: missing });

  // Запускаем в фоне — отправляем pg-boss jobs + запускаем legacy queue для UI-прогресса
  const mode = force ? 'force' : refresh ? 'refresh' : 'normal';
  for (const date of missing) {
    const jobName = service === 'kip' ? 'fetch-kip-date' : 'fetch-dt-date';
    boss.send(jobName, { date, mode, triggerType: 'manual' as const }).catch(() => {});
  }

  if (service === 'kip') {
    runKipQueue(missing, force).catch(console.error);
  } else {
    runDTQueue(missing).catch(console.error);
  }
});

// ─── Recalc endpoints ─────────────────────────────────────────────────────────

// GET recalc status
app.get('/api/admin/recalc/status', (_req, res) => {
  res.json({
    active:   recalcProgress.active,
    service:  recalcProgress.service,
    current:  recalcProgress.current,
    queue:    recalcProgress.queue,
    done:     recalcProgress.done,
    errors:   recalcProgress.errors,
  });
});

// POST cancel recalc (должен быть ДО /recalc/:service, иначе Express не дойдёт до него)
app.post('/api/admin/recalc/cancel', (_req, res) => {
  if (!recalcProgress.active) {
    res.json({ ok: true, message: 'Нет активного пересчёта' });
    return;
  }
  recalcProgress.cancelRequested = true;
  res.json({ ok: true, message: 'Отмена пересчёта запрошена' });
});

// POST start recalc for kip or dump-trucks
app.post('/api/admin/recalc/:service', async (req, res) => {
  const { service } = req.params;
  const from = req.query.from as string;
  const to   = req.query.to   as string;

  if (service !== 'kip' && service !== 'dump-trucks') {
    res.status(400).json({ error: 'service должен быть kip или dump-trucks' });
    return;
  }
  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }
  if (recalcProgress.active) {
    res.status(409).json({ error: 'Уже выполняется пересчёт' });
    return;
  }

  // Пересчитываем только даты, для которых есть данные в БД
  const existingResult = service === 'kip'
    ? await getKipDates(from, to)
    : await getDumpTrucksDates(from, to);

  const dates = existingResult.dates.sort().reverse(); // от последней к ранней

  if (dates.length === 0) {
    res.json({ ok: true, message: 'Нет данных в выбранном периоде для пересчёта', count: 0 });
    return;
  }

  res.json({ ok: true, started: true, count: dates.length, dates });

  // Send pg-boss jobs for tracking + run legacy queue for UI progress
  for (const date of dates) {
    const jobName = service === 'kip' ? 'recalc-kip-date' : 'recalc-dt-date';
    boss.send(jobName, { date, triggerType: 'manual' as const }).catch(() => {});
  }

  if (service === 'kip') {
    runKipRecalc(dates).catch(console.error);
  } else {
    runDTRecalc(dates).catch(console.error);
  }
});

// ─── Segment fetch endpoints ──────────────────────────────────────────────────

app.get('/api/admin/fetch-segments/status', (_req, res) => {
  res.json({
    active:    segmentProgress.active,
    current:   segmentProgress.current,
    startedAt: segmentProgress.startedAt,
    queue:     segmentProgress.queue,
    done:      segmentProgress.done,
    errors:    segmentProgress.errors,
    results:   segmentProgress.results,
  });
});

app.post('/api/admin/fetch-segments/cancel', (_req, res) => {
  if (!segmentProgress.active) {
    res.json({ ok: true, message: 'Нет активной загрузки сегментов' });
    return;
  }
  segmentProgress.cancelRequested = true;
  res.json({ ok: true, message: 'Отмена загрузки сегментов запрошена' });
});

app.post('/api/admin/fetch-segments', async (req, res) => {
  const from  = req.query.from as string;
  const to    = req.query.to as string;
  const force = req.query.force === 'true';

  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }
  if (segmentProgress.active) {
    res.status(409).json({ error: 'Уже выполняется загрузка сегментов' });
    return;
  }

  // Use dates that have onsite shift_records
  const existingResult = await getDumpTrucksDates(from, to);
  const dates = existingResult.dates.sort().reverse();

  if (dates.length === 0) {
    res.json({ ok: true, message: 'Нет данных самосвалов в выбранном периоде', count: 0 });
    return;
  }

  res.json({ ok: true, started: true, count: dates.length, dates, force });
  runDTSegmentQueue(dates, force).catch(console.error);
});

// ─── KIP Segments proxy ──────────────────────────────────────────────────────

app.get('/api/admin/kip-segments/status', async (_req, res) => {
  try {
    const r = await fetch('http://localhost:3001/api/segments/progress');
    if (!r.ok) { res.status(r.status).json({ error: `KIP returned ${r.status}` }); return; }
    res.json(await r.json());
  } catch (e) {
    res.status(502).json({ error: `KIP не отвечает: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// Bulk KIP segment fetch — iterate dates × shifts, enqueue all vehicles
interface KipSegBulkProgress {
  active: boolean;
  queue: string[];       // dates pending
  current: string | null;
  done: string[];
  errors: string[];
  cancelRequested: boolean;
  totalEnqueued: number;
  totalSkipped: number;
}

const kipSegBulk: KipSegBulkProgress = {
  active: false, queue: [], current: null, done: [], errors: [],
  cancelRequested: false, totalEnqueued: 0, totalSkipped: 0,
};

async function runKipSegBulk(dates: string[], force: boolean) {
  kipSegBulk.active = true;
  kipSegBulk.done = [];
  kipSegBulk.errors = [];
  kipSegBulk.cancelRequested = false;
  kipSegBulk.queue = [...dates];
  kipSegBulk.totalEnqueued = 0;
  kipSegBulk.totalSkipped = 0;

  for (const date of dates) {
    if (kipSegBulk.cancelRequested) break;

    kipSegBulk.current = date;
    kipSegBulk.queue = kipSegBulk.queue.filter(d => d !== date);

    const forceQ = force ? '&force=true' : '';
    for (const shift of ['morning', 'evening']) {
      if (kipSegBulk.cancelRequested) break;
      try {
        const r = await fetch(`http://localhost:3001/api/segments/fetch-all?date=${date}&shift=${shift}${forceQ}`, { method: 'POST' });
        if (r.ok) {
          const body = await r.json() as { enqueued: number; skipped: number };
          kipSegBulk.totalEnqueued += body.enqueued;
          kipSegBulk.totalSkipped += body.skipped;
        } else {
          kipSegBulk.errors.push(`${date}/${shift}: HTTP ${r.status}`);
        }
      } catch (e) {
        kipSegBulk.errors.push(`${date}/${shift}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    kipSegBulk.done.push(date);
  }

  kipSegBulk.active = false;
  kipSegBulk.current = null;
}

app.get('/api/admin/kip-segments/bulk-status', (_req, res) => {
  res.json({
    active: kipSegBulk.active,
    current: kipSegBulk.current,
    queue: kipSegBulk.queue,
    done: kipSegBulk.done,
    errors: kipSegBulk.errors,
    totalEnqueued: kipSegBulk.totalEnqueued,
    totalSkipped: kipSegBulk.totalSkipped,
  });
});

app.post('/api/admin/kip-segments/fetch', async (req, res) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  const force = req.query.force === 'true';

  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны' });
    return;
  }
  if (kipSegBulk.active) {
    res.status(409).json({ error: 'Уже выполняется выгрузка КИП-сегментов' });
    return;
  }

  // Get dates that have vehicle_records in KIP
  const existing = await getKipDates(from, to);
  const dates = existing.dates.sort().reverse();

  if (dates.length === 0) {
    res.json({ ok: true, message: 'Нет данных КИП за этот период', count: 0 });
    return;
  }

  res.json({ ok: true, started: true, count: dates.length, dates, force });
  runKipSegBulk(dates, force).catch(console.error);
});

app.post('/api/admin/kip-segments/cancel', (_req, res) => {
  if (!kipSegBulk.active) {
    res.json({ ok: true, message: 'Нет активной выгрузки' });
    return;
  }
  kipSegBulk.cancelRequested = true;
  res.json({ ok: true, message: 'Отмена запрошена' });
});

// ─── Pipeline Health & Runs ──────────────────────────────────────────────────

app.get('/api/admin/pipeline-health', async (_req, res) => {
  try {
    const rows = await pipelineRepo.getCronHealth();
    const cards = rows.map(row => {
      const hoursSince = row.last_success
        ? (Date.now() - new Date(row.last_success).getTime()) / 3_600_000
        : null;
      let status: 'green' | 'yellow' | 'red' = 'green';
      if (hoursSince === null || hoursSince > 50) status = 'red';
      else if (hoursSince > 26) status = 'yellow';
      return { ...row, status, hours_since_success: hoursSince ? Math.round(hoursSince * 10) / 10 : null };
    });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/admin/pipeline-runs', async (req, res) => {
  try {
    const runs = await pipelineRepo.getRunsByRange({
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      pipelineName: req.query.service as string | undefined,
      status: req.query.status as string | undefined,
      limit: Number(req.query.limit || 20),
    });
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/admin/pipeline-runs/start', async (req, res) => {
  const { pipelineName, triggerType, targetDate, shiftType, configSnapshot } = req.body as {
    pipelineName?: string;
    triggerType?: string;
    targetDate?: string;
    shiftType?: string | null;
    configSnapshot?: unknown;
  };
  if (!pipelineName || !triggerType || !targetDate) {
    res.status(400).json({ error: 'pipelineName, triggerType, targetDate required' });
    return;
  }
  try {
    const runId = await pipelineRepo.createRun({
      pipelineName,
      triggerType: triggerType as 'cron' | 'manual' | 'cascade',
      targetDate,
      shiftType: shiftType ?? null,
      configSnapshot,
    });
    res.json({ runId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/admin/pipeline-runs/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { totalVehicles, successCount, errorCount, errors } = req.body as {
    totalVehicles?: number;
    successCount?: number;
    errorCount?: number;
    errors?: unknown[];
  };
  try {
    await pipelineRepo.completeRun(id, { totalVehicles, successCount, errorCount, errors });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/admin/pipeline-runs/:id/fail', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: 'message required' });
    return;
  }
  try {
    await pipelineRepo.failRun(id, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/admin/pipeline-runs/:id/errors', async (req, res) => {
  const { id } = req.params;
  const { message, vehicleId } = req.body as { message?: string; vehicleId?: string };
  if (!message) {
    res.status(400).json({ error: 'message required' });
    return;
  }
  try {
    await pipelineRepo.addError(id, { message, vehicleId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/admin/pipeline-runs/last-success', async (req, res) => {
  const pipeline = req.query.pipeline as string;
  if (!pipeline) {
    res.status(400).json({ error: 'pipeline query param required' });
    return;
  }
  try {
    const run = await pipelineRepo.getLastSuccess(pipeline);
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Auto-cascade: zone change webhook ──────────────────────────────────────

app.post('/api/admin/zone-changed', async (req, res) => {
  const { zoneUid, objectUid, action, tags } = req.body as {
    zoneUid?: string; objectUid?: string; action?: string; tags?: string[];
  };

  console.log(`[cascade] Zone changed: ${zoneUid} action=${action} tags=${tags?.join(',')}`);

  const affectedTags = new Set(tags ?? []);
  const cascadeDates: string[] = [];

  // Determine last 7 days with data
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    cascadeDates.push(d.toISOString().slice(0, 10));
  }

  const jobs: string[] = [];

  if (affectedTags.has('dst_zone')) {
    // KIP: invalidate zone cache + recalculate
    try {
      await fetch('http://localhost:3001/api/admin/invalidate-zones', { method: 'POST' });
    } catch { /* KIP might not be running */ }

    for (const date of cascadeDates) {
      await boss.send('recalc-kip-date', { date, triggerType: 'cascade' as const });
      jobs.push(`recalc-kip-date:${date}`);
    }
  }

  if (affectedTags.has('dt_boundary') || affectedTags.has('dt_loading') || affectedTags.has('dt_unloading') || affectedTags.has('dt_onsite')) {
    for (const date of cascadeDates) {
      await boss.send('fetch-dt-date', { date, mode: 'refresh' as const, triggerType: 'cascade' as const });
      jobs.push(`fetch-dt-date:${date}`);
    }
  }

  res.json({ ok: true, cascade: { zoneUid, objectUid, action, jobs } });
});

// ─── Enhanced Coverage ──────────────────────────────────────────────────────

app.get('/api/admin/data-coverage/detailed', async (req, res) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }

  try {
    // DT detailed coverage per shift
    const dtRes = await mainPool.query(
      `SELECT report_date::text, shift_type,
              COUNT(*)::int AS vehicle_count,
              COUNT(*) FILTER (WHERE work_type = 'delivery')::int AS delivery_count,
              COUNT(*) FILTER (WHERE work_type = 'onsite')::int AS onsite_count,
              COALESCE(SUM(trips_count), 0)::int AS total_trips,
              AVG(kip_pct)::numeric(5,1) AS avg_kip,
              array_agg(DISTINCT object_name) FILTER (WHERE object_name IS NOT NULL) AS objects
       FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2
       GROUP BY report_date, shift_type
       ORDER BY report_date, shift_type`,
      [from, to],
    );

    // KIP coverage (excluding gap-filled)
    const kipRes = await kipPool.query(
      `SELECT
         vr.report_date::text,
         COUNT(DISTINCT vr.vehicle_id || '|' || vr.shift_type) FILTER (WHERE vr.is_gap_filled = false)::int AS vr_count,
         COUNT(DISTINCT mr.vehicle_id || '|' || mr.shift_type)::int AS raw_count,
         EXISTS(
           SELECT 1 FROM kip_shift_segments kss
           WHERE kss.report_date = vr.report_date LIMIT 1
         ) AS has_segments
       FROM vehicle_records vr
       LEFT JOIN monitoring_raw mr
         ON mr.report_date = vr.report_date
         AND mr.vehicle_id = vr.vehicle_id
         AND mr.shift_type = vr.shift_type
       WHERE vr.report_date BETWEEN $1 AND $2
       GROUP BY vr.report_date`,
      [from, to],
    );

    // DT segments check
    const dtSegRes = await mainPool.query(
      `SELECT DISTINCT sr.report_date::text
       FROM dump_trucks.shift_segments ss
       JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id
       WHERE sr.report_date BETWEEN $1 AND $2`,
      [from, to],
    );
    const dtSegDates = new Set(dtSegRes.rows.map((r: { report_date: string }) => r.report_date));

    // Last run status per date
    const runsRes = await mainPool.query(
      `SELECT DISTINCT ON (target_date)
         target_date::text, status
       FROM pipeline_runs
       WHERE target_date BETWEEN $1 AND $2
       ORDER BY target_date, started_at DESC`,
      [from, to],
    );
    const runStatusMap = new Map<string, string>();
    for (const row of runsRes.rows) {
      runStatusMap.set(row.target_date, row.status);
    }

    // Build per-day response
    const kipMap = new Map<string, { vr_count: number; raw_count: number; has_segments: boolean }>();
    for (const row of kipRes.rows) {
      kipMap.set(row.report_date, {
        vr_count: row.vr_count,
        raw_count: row.raw_count,
        has_segments: row.has_segments,
      });
    }

    const dtMap = new Map<string, { shifts: typeof dtRes.rows; has_segments: boolean }>();
    for (const row of dtRes.rows) {
      if (!dtMap.has(row.report_date)) {
        dtMap.set(row.report_date, { shifts: [], has_segments: dtSegDates.has(row.report_date) });
      }
      dtMap.get(row.report_date)!.shifts.push(row);
    }

    // Generate all days
    const days: unknown[] = [];
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const kip = kipMap.get(dateStr);
      const dt = dtMap.get(dateStr);

      days.push({
        date: dateStr,
        kip: kip ? {
          vehicle_count: kip.vr_count,
          raw_count: kip.raw_count,
          raw_pct: kip.vr_count > 0 ? Math.round(kip.raw_count / kip.vr_count * 100) : 0,
          has_segments: kip.has_segments,
        } : null,
        dt: dt ? {
          shifts: dt.shifts.map(s => ({
            report_date: s.report_date,
            shift_type: s.shift_type,
            vehicle_count: s.vehicle_count,
            delivery_count: s.delivery_count,
            onsite_count: s.onsite_count,
            total_trips: s.total_trips,
            avg_kip: s.avg_kip ? Number(s.avg_kip) : null,
            objects: s.objects ?? [],
          })),
          has_segments: dt.has_segments,
        } : null,
        last_run_status: runStatusMap.get(dateStr) ?? null,
      });
      cur.setDate(cur.getDate() + 1);
    }

    res.json(days);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── DB Viewer ────────────────────────────────────────────────────────────────

interface DbPreset {
  key: string;
  label: string;
  pool: 'kip' | 'main';
  sql: (dateFrom: string, dateTo: string, limit: number) => { text: string; values: (string | number)[] };
}

const DB_PRESETS: DbPreset[] = [
  {
    key: 'kip.vehicle_records',
    label: 'КИП записи',
    pool: 'kip',
    sql: (from, to, limit) => ({
      text: `SELECT report_date::text, shift_type, vehicle_id, vehicle_model, company_name,
                    load_efficiency_pct, utilization_ratio, engine_on_time, fuel_consumed_total, fuel_rate_fact
             FROM vehicle_records
             WHERE report_date BETWEEN $1 AND $2
             ORDER BY report_date DESC, vehicle_id
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'kip.monitoring_raw',
    label: 'КИП raw (мета)',
    pool: 'kip',
    sql: (from, to, limit) => ({
      text: `SELECT report_date::text, shift_type, vehicle_id, id_mo, vehicle_model,
                    fetched_at::text, engine_time_sec
             FROM monitoring_raw
             WHERE report_date BETWEEN $1 AND $2
             ORDER BY report_date DESC, vehicle_id
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'kip.segments',
    label: 'КИП сегменты',
    pool: 'kip',
    sql: (from, to, limit) => ({
      text: `SELECT vehicle_id, report_date::text, shift_type, segment_index,
                    segment_start::text, segment_end::text,
                    engine_time_sec, moving_time_sec, distance_km, track_points_count
             FROM kip_shift_segments
             WHERE report_date BETWEEN $1 AND $2
             ORDER BY report_date DESC, vehicle_id, segment_index
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'dt.shift_records',
    label: 'Смены самосвалов',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT id, report_date::text, shift_type, vehicle_id, reg_number, name_mo,
                    object_name, work_type, kip_pct, trips_count, distance_km,
                    engine_time_sec, onsite_min, pl_id, request_numbers
             FROM dump_trucks.shift_records
             WHERE report_date BETWEEN $1 AND $2
             ORDER BY report_date DESC, vehicle_id
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'dt.trips',
    label: 'Рейсы',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT t.id, sr.report_date::text, sr.shift_type, sr.reg_number,
                    t.loading_zone, t.unloading_zone, t.loaded_at::text, t.unloaded_at::text,
                    t.duration_min, t.travel_to_unload_min, t.return_to_load_min, t.volume_m3
             FROM dump_trucks.trips t
             JOIN dump_trucks.shift_records sr ON sr.id = t.shift_record_id
             WHERE sr.report_date BETWEEN $1 AND $2
             ORDER BY sr.report_date DESC, t.loaded_at DESC
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'dt.zone_events',
    label: 'События зон',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT id, report_date::text, shift_type, vehicle_id,
                    zone_name, zone_tag, object_uid,
                    entered_at::text, exited_at::text, duration_sec
             FROM dump_trucks.zone_events
             WHERE report_date BETWEEN $1 AND $2
             ORDER BY report_date DESC, entered_at DESC
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'dt.requests',
    label: 'Заявки TIS',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT request_id, number, status, date_create::text, date_processed::text,
                    contact_person
             FROM dump_trucks.requests
             WHERE date_create BETWEEN $1::timestamp AND ($2::date + 1)::timestamp
             ORDER BY date_create DESC, number
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'dt.repairs',
    label: 'Ремонты',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT id, reg_number, name_mo, type, reason, date_from::text, date_to::text,
                    object_name, notes
             FROM dump_trucks.repairs
             WHERE date_from BETWEEN $1 AND $2
             ORDER BY date_from DESC
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
  {
    key: 'pipeline_runs',
    label: 'Pipeline Runs',
    pool: 'main',
    sql: (from, to, limit) => ({
      text: `SELECT run_id, pipeline_name, trigger_type, target_date::text, shift_type,
                    status, started_at::text, completed_at::text, duration_ms,
                    total_vehicles, success_count, error_count
             FROM public.pipeline_runs
             WHERE started_at BETWEEN $1::date AND ($2::date + interval '1 day')
             ORDER BY started_at DESC
             LIMIT $3`,
      values: [from, to, limit],
    }),
  },
];

app.get('/api/admin/db-tables', (_req, res) => {
  res.json(DB_PRESETS.map(p => ({ key: p.key, label: p.label, pool: p.pool })));
});

app.get('/api/admin/db-query', async (req, res) => {
  const table = req.query.table as string;
  const dateFrom = req.query.dateFrom as string;
  const dateTo = req.query.dateTo as string;
  const limit = Math.min(Number(req.query.limit || 200), 500);

  if (!table || !dateFrom || !dateTo) {
    res.status(400).json({ error: 'table, dateFrom, dateTo обязательны' });
    return;
  }

  const preset = DB_PRESETS.find(p => p.key === table);
  if (!preset) {
    res.status(400).json({ error: `Неизвестная таблица: ${table}` });
    return;
  }

  const pool = preset.pool === 'kip' ? kipPool : mainPool;
  const query = preset.sql(dateFrom, dateTo, limit);

  try {
    const result = await pool.query(query.text, query.values);
    const columns = result.fields.map(f => f.name);
    res.json({ columns, rows: result.rows, total: result.rowCount ?? 0 });
  } catch (e) {
    res.status(500).json({ error: String(e), columns: [], rows: [], total: 0 });
  }
});

// ─── Coverage Dashboard ───────────────────────────────────────────────────────

app.get('/api/admin/coverage-dashboard', async (req, res) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    res.status(400).json({ error: '"from" и "to" обязательны (YYYY-MM-DD)' });
    return;
  }

  try {
    // ── Baseline: max vehicles/day over last 7 days ──
    const [kipBaselineRes, dtBaselineRes] = await Promise.all([
      kipPool.query(`
        SELECT COALESCE(MAX(day_count), 0)::int AS kip_expected FROM (
          SELECT report_date, COUNT(DISTINCT vehicle_id) AS day_count
          FROM vehicle_records
          WHERE report_date >= CURRENT_DATE - 7 AND COALESCE(is_gap_filled, false) = false
          GROUP BY report_date
        ) sub
      `),
      mainPool.query(`
        SELECT COALESCE(MAX(day_count), 0)::int AS dt_expected FROM (
          SELECT report_date, COUNT(DISTINCT vehicle_id) AS day_count
          FROM dump_trucks.shift_records
          WHERE report_date >= CURRENT_DATE - 7
          GROUP BY report_date
        ) sub
      `),
    ]);

    const baseline = {
      kipExpected: kipBaselineRes.rows[0]?.kip_expected ?? 0,
      dtExpected: dtBaselineRes.rows[0]?.dt_expected ?? 0,
    };

    // ── Per-day KIP data ──
    const kipDaysRes = await kipPool.query(
      `SELECT
         vr.report_date::text AS date,
         COUNT(DISTINCT vr.vehicle_id) FILTER (WHERE NOT COALESCE(vr.is_gap_filled, false))::int AS vehicle_count,
         COUNT(DISTINCT mr.vehicle_id)::int AS raw_count,
         EXISTS(SELECT 1 FROM kip_shift_segments kss WHERE kss.report_date = vr.report_date LIMIT 1) AS has_segments
       FROM vehicle_records vr
       LEFT JOIN monitoring_raw mr ON mr.report_date = vr.report_date AND mr.vehicle_id = vr.vehicle_id
       WHERE vr.report_date BETWEEN $1 AND $2
       GROUP BY vr.report_date
       ORDER BY vr.report_date`,
      [from, to],
    );

    const kipMap = new Map<string, { vehicleCount: number; rawCount: number; rawPct: number; hasSegments: boolean }>();
    for (const row of kipDaysRes.rows) {
      const vc = row.vehicle_count;
      const rc = row.raw_count;
      kipMap.set(row.date, {
        vehicleCount: vc,
        rawCount: rc,
        rawPct: vc > 0 ? Math.round(rc / vc * 100) : 0,
        hasSegments: row.has_segments,
      });
    }

    // ── Per-day DT data ──
    const dtDaysRes = await mainPool.query(
      `SELECT
         sr.report_date::text AS date,
         COUNT(DISTINCT sr.vehicle_id)::int AS vehicle_count,
         COALESCE(SUM(sr.trips_count), 0)::int AS trip_count,
         COUNT(DISTINCT sr.shift_type)::int AS shift_count,
         EXISTS(SELECT 1 FROM dump_trucks.shift_segments ss
           JOIN dump_trucks.shift_records sr2 ON sr2.id = ss.shift_record_id
           WHERE sr2.report_date = sr.report_date LIMIT 1) AS has_segments
       FROM dump_trucks.shift_records sr
       WHERE sr.report_date BETWEEN $1 AND $2
       GROUP BY sr.report_date
       ORDER BY sr.report_date`,
      [from, to],
    );

    const dtMap = new Map<string, { vehicleCount: number; tripCount: number; shiftCount: number; hasSegments: boolean }>();
    for (const row of dtDaysRes.rows) {
      dtMap.set(row.date, {
        vehicleCount: row.vehicle_count,
        tripCount: row.trip_count,
        shiftCount: row.shift_count,
        hasSegments: row.has_segments,
      });
    }

    // ── Pipeline runs per date ──
    const runsRes = await mainPool.query(
      `SELECT DISTINCT ON (target_date)
         target_date::text AS date, status, completed_at::text AS completed_at
       FROM pipeline_runs
       WHERE target_date BETWEEN $1 AND $2
       ORDER BY target_date, started_at DESC`,
      [from, to],
    );
    const runMap = new Map<string, { status: string; completedAt: string | null }>();
    for (const row of runsRes.rows) {
      runMap.set(row.date, { status: row.status, completedAt: row.completed_at });
    }

    // ── Build day cards ──
    const days: unknown[] = [];
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const kip = kipMap.get(dateStr) ?? { vehicleCount: 0, rawCount: 0, rawPct: 0, hasSegments: false };
      const dt = dtMap.get(dateStr) ?? { vehicleCount: 0, tripCount: 0, shiftCount: 0, hasSegments: false };
      const run = runMap.get(dateStr);

      // Health color logic
      let health: 'green' | 'yellow' | 'red' | 'grey' = 'grey';
      if (kip.vehicleCount === 0 && dt.vehicleCount === 0) {
        health = 'grey';
      } else if (run?.status === 'failed') {
        health = 'red';
      } else {
        const kipPct = baseline.kipExpected > 0 ? kip.vehicleCount / baseline.kipExpected : 1;
        const dtPct = baseline.dtExpected > 0 ? dt.vehicleCount / baseline.dtExpected : 1;
        const minPct = Math.min(kipPct, dtPct);
        if (minPct >= 0.85) health = 'green';
        else if (minPct >= 0.50) health = 'yellow';
        else health = 'red';
      }

      days.push({
        date: dateStr,
        kip,
        dt,
        health,
        lastRunStatus: run?.status ?? null,
        lastRunAt: run?.completedAt ?? null,
      });
      cur.setDate(cur.getDate() + 1);
    }

    // ── Summary (7-day averages, ghost count, pipeline stats) ──
    const kipAvgRes = await kipPool.query(`
      SELECT COALESCE(AVG(day_count), 0)::int AS avg_count FROM (
        SELECT report_date, COUNT(DISTINCT vehicle_id) AS day_count
        FROM vehicle_records
        WHERE report_date >= CURRENT_DATE - 7 AND COALESCE(is_gap_filled, false) = false
        GROUP BY report_date
      ) sub
    `);
    const dtAvgRes = await mainPool.query(`
      SELECT COALESCE(AVG(day_count), 0)::int AS avg_count FROM (
        SELECT report_date, COUNT(DISTINCT vehicle_id) AS day_count
        FROM dump_trucks.shift_records
        WHERE report_date >= CURRENT_DATE - 7
        GROUP BY report_date
      ) sub
    `);

    // Ghost count: vehicles seen in last 30 days but not in last 4 days
    const ghostRes = await kipPool.query(`
      SELECT COUNT(DISTINCT vehicle_id)::int AS ghost_count
      FROM vehicle_records
      WHERE report_date >= CURRENT_DATE - 30
        AND COALESCE(is_gap_filled, false) = false
        AND vehicle_id NOT IN (
          SELECT DISTINCT vehicle_id FROM vehicle_records
          WHERE report_date >= CURRENT_DATE - 4 AND COALESCE(is_gap_filled, false) = false
        )
    `);

    // Pipeline stats (last 7 days)
    const pipelineStatsRes = await mainPool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS ok,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS fail
      FROM pipeline_runs
      WHERE started_at >= now() - interval '7 days'
    `);

    const summary = {
      kipAvg7d: kipAvgRes.rows[0]?.avg_count ?? 0,
      dtAvg7d: dtAvgRes.rows[0]?.avg_count ?? 0,
      ghostCount: ghostRes.rows[0]?.ghost_count ?? 0,
      pipelineOk: pipelineStatsRes.rows[0]?.ok ?? 0,
      pipelineFail: pipelineStatsRes.rows[0]?.fail ?? 0,
    };

    res.json({ baseline, days, summary });
  } catch (err) {
    console.error('[coverage-dashboard] Error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[admin] Сервер запущен на 0.0.0.0:${PORT}`);

  // Run migrations
  await runMigration();

  // Start pg-boss
  try {
    await boss.start();
    await registerWorkers();
    console.log('[admin] pg-boss started successfully');
  } catch (err) {
    console.error('[admin] pg-boss failed to start (non-fatal):', err);
  }

  console.log(`[admin] Авто-запуск всех сервисов...`);
  SERVICES.forEach(cfg => startService(cfg));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[admin] Завершение работы...');
  SERVICES.forEach(({ id }) => stopService(id));
  try { await boss.stop({ graceful: true, timeout: 5000 }); } catch {}
  setTimeout(() => process.exit(0), 2000);
});
