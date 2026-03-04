import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { Pool } from 'pg';

dotenv.config();

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

  const child = spawn(cfg.cmd, cfg.args, {
    cwd: cfg.cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: process.platform === 'win32',
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
  if (!child) return;
  appendLog(id, '[admin] Остановка...');

  if (process.platform === 'win32' && child.pid) {
    // На Windows SIGTERM не убивает дерево дочерних процессов (tsx, npm остаются зомби)
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: false });
  } else {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (processes[id] === child) {
        try { child.kill('SIGKILL'); } catch {}
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
         COUNT(DISTINCT vr.vehicle_id || '|' || vr.shift_type)  AS vr_count,
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

  // Вычислить недостающие даты
  const allDates = allDatesInRange(from, to).reverse(); // от последней к ранней
  let missing: string[];

  if (force && service === 'kip') {
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

  // Запускаем в фоне
  if (service === 'kip') {
    runKipQueue(missing, force).catch(console.error);
  } else {
    runDTQueue(missing).catch(console.error);
  }
});

// POST cancel fetch
app.post('/api/admin/fetch/cancel', (_req, res) => {
  if (!fetchProgress.active) {
    res.json({ ok: true, message: 'Нет активной загрузки' });
    return;
  }
  fetchProgress.cancelRequested = true;
  res.json({ ok: true, message: 'Отмена запрошена' });
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

  if (service === 'kip') {
    runKipRecalc(dates).catch(console.error);
  } else {
    runDTRecalc(dates).catch(console.error);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[admin] Сервер запущен на :${PORT}`);
  console.log(`[admin] Авто-запуск всех сервисов...`);
  SERVICES.forEach(cfg => startService(cfg));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[admin] Завершение работы...');
  SERVICES.forEach(({ id }) => stopService(id));
  setTimeout(() => process.exit(0), 2000);
});
