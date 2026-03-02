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
  child.kill('SIGTERM');
  setTimeout(() => {
    if (processes[id] === child) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, 3000);
}

// ─── DB connections ───────────────────────────────────────────────────────────

const kipPool = new Pool({
  host: process.env.KIP_DB_HOST || 'localhost',
  port: Number(process.env.KIP_DB_PORT || 5432),
  database: process.env.KIP_DB_NAME || 'kip_vehicles',
  user: process.env.KIP_DB_USER || 'max',
});

const mainPool = new Pool({
  host: process.env.MAIN_DB_HOST || 'localhost',
  port: Number(process.env.MAIN_DB_PORT || 5433),
  database: process.env.MAIN_DB_NAME || 'mstroy',
  user: process.env.MAIN_DB_USER || 'max',
});

async function getKipDates(from: string, to: string): Promise<string[]> {
  try {
    const res = await kipPool.query(
      `SELECT DISTINCT report_date::text FROM vehicle_records
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date`,
      [from, to]
    );
    return res.rows.map(r => r.report_date);
  } catch {
    return [];
  }
}

async function getDumpTrucksDates(from: string, to: string): Promise<string[]> {
  try {
    const res = await mainPool.query(
      `SELECT DISTINCT report_date::text FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date`,
      [from, to]
    );
    return res.rows.map(r => r.report_date);
  } catch {
    return [];
  }
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

  const [kip, dumpTrucks] = await Promise.all([
    getKipDates(from, to),
    getDumpTrucksDates(from, to),
  ]);

  res.json({ kip, dumpTrucks });
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
