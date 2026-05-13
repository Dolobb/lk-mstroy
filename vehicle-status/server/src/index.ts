import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { getEnvConfig } from './config/env';
import { getPool, closePool } from './config/database';
import {
  queryAllVehicles,
  getFilterOptions,
  querySnapshotsByDate,
  querySnapshotDates,
  insertSyncLog,
  updateSyncLog,
  querySyncLogs,
  queryMissingSnapshotDates,
} from './repositories/vehicleStatusRepo';
import { runSync, runSyncWithRetry, runDiagnostic, debugRawRows, type SyncResult } from './services/sheetsSyncService';

const app = express();
app.use(cors());
app.use(express.json());

let lastSync: string | null = null;
let lastResult: SyncResult | null = null;
let syncInProgress = false;
let activeSyncVersion = 0;
let activeSyncController: AbortController | null = null;

const TRIGGER_MANUAL = 'manual';
const TRIGGER_CRON = 'cron';

function abortRunningSync(): void {
  if (activeSyncController) {
    console.log('[Sync] Aborting stale sync operation');
    activeSyncController.abort();
    activeSyncController = null;
  }
}

async function executeSync(trigger: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const pool = getPool();

  const logId = await insertSyncLog(pool, trigger, today);
  console.log(`[Sync] Log entry #${logId} created (trigger=${trigger}, date=${today})`);

  activeSyncVersion = activeSyncVersion + 1;
  const myVersion = activeSyncVersion;

  abortRunningSync();
  const controller = new AbortController();
  activeSyncController = controller;

  syncInProgress = true;

  const timeout = setTimeout(() => {
    console.error(`[Sync] #${myVersion} timeout (120s), aborting`);
    controller.abort();
    if (activeSyncVersion === myVersion) {
      syncInProgress = false;
      activeSyncController = null;
      lastResult = { processed: 0, errors: ['Sync timed out after 120 seconds'] };
      lastSync = new Date().toISOString();
    }
  }, 120_000);

  try {
    const result: SyncResult = await runSyncWithRetry(2, controller.signal);

    clearTimeout(timeout);

    if (activeSyncVersion === myVersion) {
      lastResult = result;
      lastSync = new Date().toISOString();
      const hasErrors = result.errors.length > 0;
      const status = hasErrors ? (result.processed > 0 ? 'partial' : 'error') : 'success';
      await updateSyncLog(pool, logId, {
        status,
        processed: result.processed,
        errors: result.errors,
        downloadMs: result.downloadMs,
        parseMs: result.parseMs,
        writeMs: result.writeMs,
      });
      console.log(`[Sync] #${myVersion} ${status}: processed=${result.processed} errors=${result.errors.length}`);
    } else {
      console.log(`[Sync] #${myVersion} superseded, discarding result`);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (activeSyncVersion === myVersion) {
      lastResult = { processed: 0, errors: [String(err)] };
      lastSync = new Date().toISOString();
    }
    await updateSyncLog(pool, logId, {
      status: 'error',
      processed: 0,
      errors: [String(err)],
      errorMessage: String(err),
    });
    console.error(`[Sync] #${myVersion} failed:`, String(err));
  } finally {
    if (activeSyncVersion === myVersion) {
      syncInProgress = false;
      activeSyncController = null;
    }
  }
}

app.get('/api/vs/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vehicle-status', time: new Date().toISOString() });
});

app.get('/api/vs/vehicles', async (_req, res) => {
  try {
    const pool = getPool();
    const data = await queryAllVehicles(pool);
    res.json({ data });
  } catch (err) {
    console.error('GET /api/vs/vehicles error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/vs/vehicles/filters', async (_req, res) => {
  try {
    const pool = getPool();
    const data = await getFilterOptions(pool);
    res.json(data);
  } catch (err) {
    console.error('GET /api/vs/vehicles/filters error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/vs/vehicles/sync', (_req, res) => {
  res.json({ status: 'started' });
  if (syncInProgress) {
    console.log('[Sync] Manual sync requested but sync already in progress, skipping');
    return;
  }
  executeSync(TRIGGER_MANUAL).catch(err => console.error('[Sync] Manual sync wrapper failed', err));
});

app.get('/api/vs/vehicles/sync-status', (_req, res) => {
  res.json({ lastSync, lastResult, inProgress: syncInProgress });
});

app.get('/api/vs/vehicles/diagnostic', async (_req, res) => {
  try {
    const result = await runDiagnostic();
    res.json(result);
  } catch (err) {
    console.error('[Diagnostic] Failed', err);
    res.status(500).json({ error: String(err) });
  }
});

function startAutoSync() {
  if (process.env.CRON_DISABLED === 'true') {
    console.log('[Cron] Auto-sync disabled (CRON_DISABLED=true)');
    return;
  }

  const schedules = process.env.CRON_SCHEDULES
    ? process.env.CRON_SCHEDULES.split(',').map(s => s.trim())
    : ['0 8 * * *', '0 13 * * *', '0 16 * * *', '30 23 * * *'];

  for (const s of schedules) {
    cron.schedule(s, () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      console.log(`[Cron] Auto-sync triggered at ${hh}:${mm} (schedule: ${s})`);

      if (syncInProgress) {
        console.log('[Cron] Sync already in progress, skipping this scheduled run');
        return;
      }

      executeSync(TRIGGER_CRON).catch(err =>
        console.error('[Cron] Sync wrapper failed', err),
      );
    });
  }

  console.log(`[Cron] Auto-sync enabled: ${schedules.join(', ')}`);
}

startAutoSync();

async function checkMissingSnapshots(): Promise<void> {
  try {
    const pool = getPool();
    const missing = await queryMissingSnapshotDates(pool, 30);
    if (missing.length > 0) {
      console.warn(`[Startup] Missing snapshot dates (last 30 days): ${missing.join(', ')}`);
    } else {
      console.log('[Startup] All dates in last 30 days have snapshots');
    }
  } catch (err) {
    console.error('[Startup] Failed to check missing snapshots', err);
  }
}

app.get('/api/vs/sync-log', async (req, res) => {
  try {
    const pool = getPool();
    const limit = parseInt(String(req.query.limit || '50'), 10);
    const data = await querySyncLogs(pool, Math.min(limit, 200));
    res.json({ data });
  } catch (err) {
    console.error('GET /api/vs/sync-log error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/vs/snapshots/missing', async (req, res) => {
  try {
    const pool = getPool();
    const lookback = parseInt(String(req.query.days || '30'), 10);
    const dates = await queryMissingSnapshotDates(pool, Math.min(lookback, 90));
    res.json({ missing: dates });
  } catch (err) {
    console.error('GET /api/vs/snapshots/missing error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/vs/debug/raw', async (req, res) => {
  try {
    const sheetName = String(req.query.sheet || 'Сводная по МиМ');
    const plate = String(req.query.plate || '');
    const result = await debugRawRows(sheetName, plate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/vs/snapshots/dates', async (_req, res) => {
  try {
    const pool = getPool();
    const dates = await querySnapshotDates(pool);
    res.json({ dates });
  } catch (err) {
    console.error('GET /api/vs/snapshots/dates error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/vs/snapshots', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!date) {
      res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
      return;
    }
    const pool = getPool();
    const data = await querySnapshotsByDate(pool, date);
    res.json({ data });
  } catch (err) {
    console.error('GET /api/vs/snapshots error', err);
    res.status(500).json({ error: String(err) });
  }
});

const config = getEnvConfig();

getPool().query('SELECT 1').then(() => {
  console.log(`[DB] Connected to ${config.dbName} at :${config.dbPort}`);
  checkMissingSnapshots();
}).catch(err => {
  console.error('[DB] Connection failed', err);
});

app.listen(config.serverPort, () => {
  console.log(`[Server] vehicle-status running on :${config.serverPort}`);
});

process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down...');
  abortRunningSync();
  await closePool();
  process.exit(0);
});