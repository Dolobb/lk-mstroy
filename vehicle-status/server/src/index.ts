import express from 'express';
import cors from 'cors';
import { getEnvConfig } from './config/env';
import { getPool, closePool } from './config/database';
import { queryAllVehicles, getFilterOptions, querySnapshotsByDate, querySnapshotDates } from './repositories/vehicleStatusRepo';
import { runSync, runDiagnostic, type SyncResult, debugRawRows } from './services/sheetsSyncService';

const app = express();
app.use(cors());
app.use(express.json());

let lastSync: string | null = null;
let lastResult: SyncResult | null = null;
let syncInProgress = false;

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

app.post('/api/vs/vehicles/sync', (req, res) => {
  res.json({ status: 'started' });

  if (syncInProgress) return;
  syncInProgress = true;

  runSync()
    .then(result => {
      lastResult = result;
      lastSync = new Date().toISOString();
      console.log(`[Sync] Done: processed=${result.processed} errors=${result.errors.length}`);
    })
    .catch(err => {
      lastResult = { processed: 0, errors: [String(err)] };
      lastSync = new Date().toISOString();
      console.error('[Sync] Failed', err);
    })
    .finally(() => {
      syncInProgress = false;
    });
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
