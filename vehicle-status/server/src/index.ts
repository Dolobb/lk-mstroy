import express from 'express';
import cors from 'cors';
import { getEnvConfig } from './config/env';
import { getPool, closePool } from './config/database';
import { queryAll } from './repositories/vehicleStatusRepo';
import { runSync, runDiagnostic, type SyncResult } from './services/sheetsSyncService';

const app = express();
app.use(cors());
app.use(express.json());

// In-memory sync state (sufficient for MVP)
let lastSync: string | null = null;
let lastResult: SyncResult | null = null;
let syncInProgress = false;

// ========================
// Health
// ========================
app.get('/api/vs/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vehicle-status', time: new Date().toISOString() });
});

// ========================
// Список записей
// ========================
// GET /api/vs/vehicle-status?isRepairing=true&category=ДСТ
app.get('/api/vs/vehicle-status', async (req, res) => {
  try {
    const pool = getPool();
    const filters: { isRepairing?: boolean; category?: string } = {};

    if (req.query['isRepairing'] !== undefined) {
      filters.isRepairing = req.query['isRepairing'] === 'true';
    }
    if (req.query['category']) {
      filters.category = req.query['category'] as string;
    }

    const records = await queryAll(pool, filters);
    res.json({ data: records, total: records.length });
  } catch (err) {
    console.error('GET /api/vs/vehicle-status error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Запуск синхронизации
// ========================
// POST /api/vs/vehicle-status/sync
app.post('/api/vs/vehicle-status/sync', (req, res) => {
  res.json({ status: 'started' });

  if (syncInProgress) return;
  syncInProgress = true;

  runSync()
    .then(result => {
      lastResult = result;
      lastSync   = new Date().toISOString();
      console.log(`[Sync] Done: processed=${result.processed} errors=${result.errors.length}`);
    })
    .catch(err => {
      lastResult = { processed: 0, errors: [String(err)] };
      lastSync   = new Date().toISOString();
      console.error('[Sync] Failed', err);
    })
    .finally(() => {
      syncInProgress = false;
    });
});

// ========================
// Статус последней синхронизации
// ========================
// GET /api/vs/vehicle-status/sync-status
app.get('/api/vs/vehicle-status/sync-status', (_req, res) => {
  res.json({ lastSync, lastResult, inProgress: syncInProgress });
});

// ========================
// Диагностика парсинга xlsx
// ========================
// GET /api/vs/vehicle-status/diagnostic
app.get('/api/vs/vehicle-status/diagnostic', async (_req, res) => {
  try {
    const result = await runDiagnostic();
    res.json(result);
  } catch (err) {
    console.error('[Diagnostic] Failed', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Startup
// ========================
const config = getEnvConfig();

getPool().query('SELECT 1').then(() => {
  console.log(`[DB] Connected to ${config.dbName} at :${config.dbPort}`);
}).catch(err => {
  console.error('[DB] Connection failed', err);
});

app.listen(config.serverPort, () => {
  console.log(`[Server] vehicle-status running on :${config.serverPort}`);
});

process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down...');
  await closePool();
  process.exit(0);
});
