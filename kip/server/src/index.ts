import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { startScheduler } from './jobs/scheduler';
import { runDailyFetch } from './jobs/dailyFetchJob';
import { logger } from './utils/logger';
import { getFilteredGeozonesGeoJson } from './services/geozoneAnalyzer';
import { getVehicleInfo } from './services/vehicleRegistry';

dotenv.config();

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve React build as static files
const clientBuildPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientBuildPath));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Legacy endpoint (kept for backward compat) ---
app.get('/api/vehicles', async (req, res) => {
  const date = req.query.date as string | undefined;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Query parameter "date" required in YYYY-MM-DD format' });
    return;
  }
  const shift = req.query.shift as string | undefined;

  try {
    const { getVehicleRecords, getRequestNumbersForDate } = await import('./repositories/vehicleRecordRepo');
    const [records, reqMap] = await Promise.all([
      getVehicleRecords(date, shift),
      getRequestNumbersForDate(date, shift),
    ]);
    const enriched = records.map(r => ({
      ...r,
      request_numbers: reqMap.get(r.vehicle_id) ?? [],
    }));
    res.json(enriched);
  } catch (err) {
    logger.error('Failed to fetch vehicle records', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- NEW: Weekly aggregated vehicles for map ---
app.get('/api/vehicles/weekly', async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: '"from" and "to" required in YYYY-MM-DD format' });
    return;
  }

  try {
    const { getWeeklyAggregated, getRequestNumbersForDateRange } = await import('./repositories/vehicleRecordRepo');

    // Helper to parse query param as string array
    const toArray = (val: unknown): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val as string[];
      return [val as string];
    };

    const [rows, reqMap] = await Promise.all([
      getWeeklyAggregated({
        from,
        to,
        shift: req.query.shift as string | undefined,
        branches: toArray(req.query.branch),
        types: toArray(req.query.type),
        departments: toArray(req.query.department),
        kpiRanges: toArray(req.query.kpiRange),
      }),
      getRequestNumbersForDateRange(from, to),
    ]);

    // Enrich with type/branch from registry + request numbers
    const enriched = rows.map(r => {
      const info = getVehicleInfo(r.vehicle_id);
      return {
        ...r,
        vehicle_type: info?.type ?? '',
        branch: info?.branch ?? '',
        request_numbers: reqMap.get(r.vehicle_id) ?? [],
      };
    });

    res.json(enriched);
  } catch (err) {
    logger.error('Failed to fetch weekly vehicles', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- NEW: Vehicle details by day/shift ---
app.get('/api/vehicles/:id/details', async (req, res) => {
  const vehicleId = req.params.id;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!from || !to) {
    res.status(400).json({ error: '"from" and "to" required' });
    return;
  }

  try {
    const { getVehicleDetails } = await import('./repositories/vehicleRecordRepo');
    const rows = await getVehicleDetails(vehicleId, from, to);
    res.json(rows);
  } catch (err) {
    logger.error(`Failed to fetch details for ${vehicleId}`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- NEW: Requests for a specific vehicle ---
app.get('/api/vehicles/:id/requests', async (req, res) => {
  const vehicleId = req.params.id;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!from || !to) {
    res.status(400).json({ error: '"from" and "to" required' });
    return;
  }

  try {
    const { getRequestsForVehicle } = await import('./repositories/requestRepo');
    const rows = await getRequestsForVehicle(vehicleId, from, to);
    res.json(rows);
  } catch (err) {
    logger.error(`Failed to fetch requests for ${vehicleId}`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- NEW: Cascading filter options ---
app.get('/api/filters', async (req, res) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  if (!from || !to) {
    res.status(400).json({ error: '"from" and "to" required' });
    return;
  }

  try {
    const { getFilterOptions } = await import('./repositories/filterRepo');

    const toArr = (val: unknown): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val as string[];
      return [val as string];
    };

    const options = await getFilterOptions(
      from,
      to,
      toArr(req.query.branch),
      toArr(req.query.type),
    );
    res.json(options);
  } catch (err) {
    logger.error('Failed to fetch filter options', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET geozones GeoJSON for the map
app.get('/api/geozones', (_req, res) => {
  try {
    res.json(getFilteredGeozonesGeoJson());
  } catch (err) {
    logger.error('Failed to load geozones', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin endpoint: manually trigger daily fetch for a specific date
app.post('/api/admin/fetch', async (req, res) => {
  const date = req.query.date as string | undefined;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Query parameter "date" required in YYYY-MM-DD format' });
    return;
  }

  logger.info(`Manual fetch triggered for date: ${date}`);
  // Run async — respond immediately
  runDailyFetch(date).catch(err => {
    logger.error(`Manual fetch failed for ${date}`, err);
  });

  res.json({ status: 'started', date });
});

// SPA fallback: any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  startScheduler();
});
