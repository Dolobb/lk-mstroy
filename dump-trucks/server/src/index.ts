import express from 'express';
import cors from 'cors';
import { getEnvConfig } from './config/env';
import { getPool, closePool } from './config/database';
import { startScheduler } from './jobs/scheduler';
import { runShiftFetch, getTisClient } from './jobs/shiftFetchJob';
import { runSegmentFetch } from './jobs/segmentFetchJob';
import { recalculateShift } from './jobs/recalculateJob';
import { queryShiftRecords } from './repositories/shiftRecordRepo';
import { getDtObjects } from './repositories/filterRepo';
import { querySegments, querySegmentsBatch } from './repositories/segmentRepo';
import { logger } from './utils/logger';
import type { ShiftType } from './types/domain';
import { stringify } from './utils/csv';
import { getJobController } from './services/jobController';
import { tryAcquire as tryAcquireFetchLock, release as releaseFetchLock, getActiveFetch } from './services/fetchLock';

const app = express();
app.use(cors());
app.use(express.json());

// ========================
// Health
// ========================
app.get('/api/dt/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dump-trucks', time: new Date().toISOString() });
});

// ========================
// Записи смен (основной endpoint)
// ========================
// GET /api/dt/shift-records?dateFrom=2026-02-10&dateTo=2026-02-19&objectUid=...&shiftType=shift1
app.get('/api/dt/shift-records', async (req, res) => {
  try {
    const pool = getPool();
    const records = await queryShiftRecords(pool, {
      dateFrom:  req.query['dateFrom'] as string | undefined,
      dateTo:    req.query['dateTo']   as string | undefined,
      objectUid: req.query['objectUid'] as string | undefined,
      shiftType: req.query['shiftType'] as string | undefined,
    });
    res.json({ data: records, total: records.length });
  } catch (err) {
    logger.error('GET /api/dt/shift-records error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Объекты с dt_* зонами (для фильтров)
// ========================
// GET /api/dt/objects
app.get('/api/dt/objects', async (_req, res) => {
  try {
    const pool = getPool();
    const objects = await getDtObjects(pool);
    res.json({ data: objects });
  } catch (err) {
    logger.error('GET /api/dt/objects error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Ручной запуск пайплайна
// ========================
// POST /api/dt/admin/fetch?date=2026-02-18&shift=shift1
type FetchJobState = 'running' | 'done' | 'error';
interface FetchJobStatus {
  state: FetchJobState;
  date: string;
  shift: ShiftType;
  startedAt: number;
  finishedAt: number | null;
  vehiclesProcessed: number;
  vehiclesSkipped: number;
  errors: string[];
}
const fetchJobs = new Map<string, FetchJobStatus>();
const fetchKey = (d: string, s: ShiftType) => `${d}|${s}`;

// TIS client stats — для мониторинга нагрузки и тестов на 429
app.get('/api/dt/admin/tis-stats', (_req, res) => {
  try {
    const client = getTisClient();
    const tokenCount = getEnvConfig().tisApiTokens.length;
    res.json({ stats: client.stats, tokenCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/dt/admin/tis-stats/reset', (_req, res) => {
  try {
    getTisClient().resetStats();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Cancel endpoints — must be registered BEFORE /fetch route to avoid prefix mistakes
app.post('/api/dt/admin/fetch/cancel', (_req, res) => {
  getJobController('fetch').cancel();
  logger.info('[Admin] DT shift fetch cancellation requested');
  res.json({ ok: true, message: 'Cancellation signalled' });
});

app.post('/api/dt/admin/recalculate/cancel', (_req, res) => {
  getJobController('recalculate').cancel();
  logger.info('[Admin] DT recalculate cancellation requested');
  res.json({ ok: true, message: 'Cancellation signalled' });
});

app.post('/api/dt/admin/fetch-segments/cancel', (_req, res) => {
  getJobController('segments').cancel();
  logger.info('[Admin] DT segment fetch cancellation requested');
  res.json({ ok: true, message: 'Cancellation signalled' });
});

app.post('/api/dt/admin/fetch', (req, res) => {
  const dateStr   = req.query['date'] as string;
  const shiftStr  = req.query['shift'] as string;

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
    return;
  }
  if (!shiftStr || !['shift1', 'shift2'].includes(shiftStr)) {
    res.status(400).json({ error: 'shift param required (shift1 | shift2)' });
    return;
  }

  const shiftType = shiftStr as ShiftType;
  const key = fetchKey(dateStr, shiftType);

  const existing = fetchJobs.get(key);
  if (existing && existing.state === 'running') {
    res.json({ status: 'already_running', date: dateStr, shift: shiftType, startedAt: existing.startedAt });
    return;
  }

  if (!tryAcquireFetchLock(dateStr, shiftType)) {
    const a = getActiveFetch();
    res.status(409).json({
      status: 'busy',
      activeDate: a?.date,
      activeShift: a?.shift,
      startedAt: a?.startedAt,
    });
    return;
  }

  const job: FetchJobStatus = {
    state: 'running',
    date: dateStr,
    shift: shiftType,
    startedAt: Date.now(),
    finishedAt: null,
    vehiclesProcessed: 0,
    vehiclesSkipped: 0,
    errors: [],
  };
  fetchJobs.set(key, job);

  // Запускаем асинхронно
  res.json({ status: 'started', date: dateStr, shift: shiftType });

  runShiftFetch(dateStr, shiftType)
    .then(result => {
      job.state = 'done';
      job.finishedAt = Date.now();
      job.vehiclesProcessed = result.vehiclesProcessed;
      job.vehiclesSkipped = result.vehiclesSkipped;
      job.errors = result.errors;
      logger.info('[Admin] Fetch complete', result);
    })
    .catch(err => {
      job.state = 'error';
      job.finishedAt = Date.now();
      job.errors.push(String(err));
      logger.error('[Admin] Fetch error', err);
    })
    .finally(() => {
      releaseFetchLock(dateStr, shiftType);
    });
});

// GET /api/dt/admin/fetch/status?date=YYYY-MM-DD&shift=shift1
app.get('/api/dt/admin/fetch/status', (req, res) => {
  const dateStr  = req.query['date']  as string;
  const shiftStr = req.query['shift'] as string;
  if (!dateStr || !shiftStr || !['shift1', 'shift2'].includes(shiftStr)) {
    res.status(400).json({ error: 'date and shift required' });
    return;
  }
  const job = fetchJobs.get(fetchKey(dateStr, shiftStr as ShiftType));
  if (!job) {
    res.json({ state: 'not_found', date: dateStr, shift: shiftStr });
    return;
  }
  res.json(job);
});

// ========================
// Рейсы по смене
// ========================
// GET /api/dt/trips?shiftRecordId=123
app.get('/api/dt/trips', async (req, res) => {
  try {
    const pool = getPool();
    const id = req.query['shiftRecordId'];
    if (!id) { res.status(400).json({ error: 'shiftRecordId required' }); return; }
    const result = await pool.query(`
      SELECT t.*, sr.reg_number, sr.name_mo, sr.object_name, sr.report_date, sr.shift_type
      FROM dump_trucks.trips t
      JOIN dump_trucks.shift_records_active sr ON sr.id = t.shift_record_id
      WHERE t.shift_record_id = $1
      ORDER BY t.trip_number
    `, [id]);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Zone events по смене
// ========================
// GET /api/dt/zone-events?vehicleId=15&date=2026-02-16&shiftType=shift1
app.get('/api/dt/zone-events', async (req, res) => {
  try {
    const pool = getPool();
    const { vehicleId, date, shiftType } = req.query;
    const result = await pool.query(`
      SELECT ze.* FROM dump_trucks.zone_events ze
      WHERE ($1::int IS NULL OR ze.vehicle_id = $1)
        AND ($2::date IS NULL OR ze.report_date = $2)
        AND ($3::text IS NULL OR ze.shift_type = $3)
        AND EXISTS (
          SELECT 1 FROM dump_trucks.shift_records_active sra
          WHERE sra.vehicle_id  = ze.vehicle_id
            AND sra.report_date = ze.report_date
            AND sra.shift_type  = ze.shift_type
            AND sra.object_uid  = ze.object_uid
        )
      ORDER BY ze.entered_at
    `, [vehicleId || null, date || null, shiftType || null]);
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Заявки (orders) — только те, по которым были самосвалы в указанный период
// ========================
// GET /api/dt/orders?dateFrom=2026-02-17&dateTo=2026-02-19
app.get('/api/dt/orders', async (req, res) => {
  try {
    const pool = getPool();
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const result = await pool.query(`
      SELECT
        r.number,
        r.status,
        r.raw_json,
        MIN(sr.report_date)                                                         AS first_date,
        MAX(sr.report_date)                                                         AS last_date,
        COALESCE(SUM(sr.trips_count), 0)                                            AS actual_trips,
        COUNT(DISTINCT sr.vehicle_id)                                               AS vehicle_count,
        ARRAY_AGG(DISTINCT sr.reg_number) FILTER (WHERE sr.reg_number IS NOT NULL)  AS vehicles,
        ARRAY_AGG(DISTINCT sr.name_mo)    FILTER (WHERE sr.name_mo    IS NOT NULL)  AS vehicle_names,
        ARRAY_AGG(DISTINCT sr.object_name)FILTER (WHERE sr.object_name IS NOT NULL) AS object_names,
        COUNT(DISTINCT sr.pl_id)          FILTER (WHERE sr.pl_id IS NOT NULL)       AS pl_count,
        (SELECT ROUND(AVG(shift_rate)::numeric, 1)
         FROM (
           SELECT SUM(sr2.trips_count)::float / NULLIF(COUNT(DISTINCT sr2.vehicle_id), 0) AS shift_rate
           FROM dump_trucks.shift_records_active sr2
           WHERE sr2.request_numbers @> ARRAY[r.number]
             AND sr2.trips_count > 0
             AND ($1::date IS NULL OR sr2.report_date >= $1)
             AND ($2::date IS NULL OR sr2.report_date <= $2)
           GROUP BY sr2.report_date, sr2.shift_type
         ) sub
        ) AS trips_per_veh_day
      FROM dump_trucks.requests r
      -- INNER JOIN: берём только заявки с реальной активностью ТС в указанный период
      INNER JOIN dump_trucks.shift_records_active sr
        ON sr.request_numbers @> ARRAY[r.number]
        AND ($1::date IS NULL OR sr.report_date >= $1)
        AND ($2::date IS NULL OR sr.report_date <= $2)
      GROUP BY r.request_id, r.number, r.status, r.raw_json
      HAVING SUM(sr.trips_count) > 0
      ORDER BY r.number DESC
    `, [dateFrom || null, dateTo || null]);

    // Check route points against dt_boundary for each order
    const rows = result.rows;
    const objectUids = new Set<string>();
    for (const row of rows) {
      for (const objName of (row.object_names ?? [])) {
        objectUids.add(objName);
      }
    }

    // Get boundary unions per object for containment checks
    // We need object_uid from shift_records, so grab them
    const objUidMap = new Map<string, string>(); // object_name → object_uid
    if (rows.length > 0) {
      const objUidResult = await pool.query(`
        SELECT DISTINCT object_name, object_uid
        FROM dump_trucks.shift_records
        WHERE object_name IS NOT NULL AND object_uid IS NOT NULL
      `);
      for (const r of objUidResult.rows) {
        objUidMap.set(r.object_name, r.object_uid);
      }
    }

    // For each order, extract latLon from route points and check against boundaries
    for (const row of rows) {
      const pts = row.raw_json?.orders?.[0]?.route?.points ?? [];
      const latLons = pts.map((p: { latLon?: { lat: number; lng: number } }) => p.latLon ?? null);

      // Find the object_uid for this order (from first object_name)
      const objName = (row.object_names ?? [])[0];
      const objUid = objName ? objUidMap.get(objName) : null;

      if (objUid && latLons.some((ll: { lat: number; lng: number } | null) => ll !== null)) {
        try {
          const checks = await Promise.all(
            latLons.map(async (ll: { lat: number; lng: number } | null) => {
              if (!ll) return null;
              const check = await pool.query(`
                SELECT ST_Contains(
                  (SELECT ST_Union(z.geom) FROM geo.zones z
                   JOIN geo.zone_tags zt ON zt.zone_uid = z.uid
                   WHERE zt.tag = 'dt_boundary'
                     AND z.object_uid = $1),
                  ST_SetSRID(ST_MakePoint($2, $3), 4326)
                ) AS inside
              `, [objUid, ll.lng, ll.lat]);
              return check.rows[0]?.inside ?? null;
            })
          );
          row.points_in_boundary = checks;
        } catch {
          row.points_in_boundary = null;
        }
      } else {
        row.points_in_boundary = null;
      }
    }

    res.json({ data: rows });
  } catch (err) {
    logger.error('GET /api/dt/orders error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Расчётные рейсы (нормы заявок)
// ========================
// GET /api/dt/order-norms
app.get('/api/dt/order-norms', async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`SELECT request_number, trips_per_shift FROM dump_trucks.order_norms`);
    res.json({ data: result.rows });
  } catch (err) {
    logger.error('GET /api/dt/order-norms error', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/dt/order-norms
app.post('/api/dt/order-norms', async (req, res) => {
  try {
    const pool = getPool();
    const { norms } = req.body as { norms: { number: number; tripsPerShift: number }[] };
    if (!Array.isArray(norms) || norms.length === 0) {
      res.status(400).json({ error: 'norms array required' }); return;
    }
    for (const n of norms) {
      await pool.query(`
        INSERT INTO dump_trucks.order_norms (request_number, trips_per_shift)
        VALUES ($1, $2)
        ON CONFLICT (request_number) DO UPDATE SET trips_per_shift = $2, updated_at = NOW()
      `, [n.number, n.tripsPerShift]);
    }
    res.json({ status: 'ok', count: norms.length });
  } catch (err) {
    logger.error('POST /api/dt/order-norms error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Гантт для конкретной заявки
// ========================
// GET /api/dt/orders/:number/gantt
app.get('/api/dt/orders/:number/gantt', async (req, res) => {
  try {
    const pool = getPool();
    const num = parseInt(req.params['number'] ?? '0', 10);
    if (!num) { res.status(400).json({ error: 'invalid order number' }); return; }
    const result = await pool.query(`
      SELECT
        id,
        reg_number,
        name_mo,
        TO_CHAR(report_date, 'YYYY-MM-DD') AS report_date,
        shift_type,
        trips_count,
        work_type,
        movement_pct,
        object_uid,
        request_numbers
      FROM dump_trucks.shift_records_active
      WHERE request_numbers @> ARRAY[$1::int]
      ORDER BY report_date, reg_number, shift_type, trips_count DESC, id
    `, [num]);
    const rangeResult = await pool.query(`
      SELECT
        TO_CHAR(MIN(report_date), 'YYYY-MM-DD') AS date_from,
        TO_CHAR(MAX(report_date), 'YYYY-MM-DD') AS date_to
      FROM dump_trucks.shift_records_active
      WHERE request_numbers @> ARRAY[$1::int]
    `, [num]);
    const { date_from, date_to } = rangeResult.rows[0] ?? {};

    // Presence map: same vehicles × date range, regardless of request_numbers
    // Returns ALL shifts for order vehicles (not just on the same object) — filtering done on frontend
    let presence: { reg_number: string; report_date: string; shift_type: string; request_numbers: number[] | null; object_uid: string }[] = [];
    if (result.rows.length > 0 && date_from && date_to) {
      const presenceResult = await pool.query(`
        WITH order_vehicles AS (
          SELECT DISTINCT vehicle_id
          FROM dump_trucks.shift_records_active
          WHERE request_numbers @> ARRAY[$1::int]
        )
        SELECT sr.reg_number,
               TO_CHAR(sr.report_date, 'YYYY-MM-DD') AS report_date,
               sr.shift_type,
               sr.request_numbers,
               sr.object_uid
        FROM dump_trucks.shift_records_active sr
        JOIN order_vehicles ov ON sr.vehicle_id = ov.vehicle_id
        WHERE sr.report_date BETWEEN $2::date AND $3::date
          AND NOT (sr.request_numbers @> ARRAY[$1::int])
        ORDER BY sr.reg_number, report_date, sr.shift_type
      `, [num, date_from, date_to]);
      presence = presenceResult.rows;
    }

    res.json({ data: result.rows, dateFrom: date_from, dateTo: date_to, presence });
  } catch (err) {
    logger.error('GET /api/dt/orders/:number/gantt error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Ремонты ТС
// ========================
// GET /api/dt/repairs?objectName=...&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
app.get('/api/dt/repairs', async (req, res) => {
  try {
    const pool = getPool();
    const { objectName, dateFrom, dateTo } = req.query as Record<string, string>;
    const result = await pool.query(`
      SELECT *
      FROM dump_trucks.repairs
      WHERE ($1::text IS NULL OR object_name = $1)
        AND ($2::date IS NULL OR date_from  <= $2::date)
        AND ($3::date IS NULL OR (date_to IS NULL OR date_to >= $3::date))
      ORDER BY date_from DESC
    `, [objectName || null, dateTo || null, dateFrom || null]);
    res.json({ data: result.rows });
  } catch (err) {
    logger.error('GET /api/dt/repairs error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Детализация смены: рейсы + события зон
// ========================
// GET /api/dt/shift-detail?shiftRecordId=N
app.get('/api/dt/shift-detail', async (req, res) => {
  try {
    const pool = getPool();
    const id = req.query['shiftRecordId'];
    if (!id) { res.status(400).json({ error: 'shiftRecordId required' }); return; }

    const [tripsResult, srResult] = await Promise.all([
      pool.query(`
        SELECT t.* FROM dump_trucks.trips t
        WHERE t.shift_record_id = $1
          AND EXISTS (SELECT 1 FROM dump_trucks.shift_records_active sra WHERE sra.id = t.shift_record_id)
        ORDER BY t.trip_number
      `, [id]),
      pool.query(`
        SELECT vehicle_id, report_date, shift_type, object_timezone, object_uid
        FROM dump_trucks.shift_records_active
        WHERE id = $1
      `, [id]),
    ]);

    if (srResult.rows.length === 0) {
      res.status(404).json({ error: 'shift record not found' }); return;
    }

    const sr = srResult.rows[0];
    const zeResult = await pool.query(`
      SELECT * FROM dump_trucks.zone_events
      WHERE vehicle_id = $1 AND report_date = $2 AND shift_type = $3
        AND object_uid = $4
      ORDER BY entered_at
    `, [sr.vehicle_id, sr.report_date, sr.shift_type, sr.object_uid]);

    res.json({ trips: tripsResult.rows, zoneEvents: zeResult.rows, objectTimezone: sr.object_timezone || 'Asia/Yekaterinburg' });
  } catch (err) {
    logger.error('GET /api/dt/shift-detail error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// CSV экспорт — сводная таблица
// ========================
// GET /api/dt/export/summary.csv?dateFrom=2026-02-16&dateTo=2026-02-17&objectUid=tobolsk-osnova
app.get('/api/dt/export/summary.csv', async (req, res) => {
  try {
    const pool = getPool();
    const { dateFrom, dateTo, objectUid } = req.query as Record<string, string>;

    const result = await pool.query(`
      SELECT
        TO_CHAR(sr.report_date, 'YYYY-MM-DD') AS report_date,
        sr.shift_type,
        sr.vehicle_id   AS id_mo,
        sr.reg_number,
        sr.name_mo,
        sr.organization,
        sr.object_name,
        sr.work_type,
        sr.engine_time_sec,
        ROUND(sr.engine_time_sec::numeric / 3600, 2) AS engine_time_h,
        ROUND(sr.moving_time_sec::numeric / 3600, 2) AS moving_time_h,
        sr.distance_km,
        sr.onsite_min,
        sr.trips_count,
        sr.fact_volume_m3,
        sr.kip_pct,
        sr.movement_pct,
        sr.request_numbers
      FROM dump_trucks.shift_records_active sr
      WHERE ($1::date IS NULL OR sr.report_date >= $1)
        AND ($2::date IS NULL OR sr.report_date <= $2)
        AND ($3::text IS NULL OR sr.object_uid = $3)
      ORDER BY sr.report_date, sr.shift_type, sr.reg_number
    `, [dateFrom || null, dateTo || null, objectUid || null]);

    const rows = result.rows.map(r => ({
      'Дата':          r.report_date,
      'Смена':         r.shift_type === 'shift1' ? '1 смена' : '2 смена',
      'idMO':          r.id_mo,
      'Гос. номер':    r.reg_number,
      'Наименование':  r.name_mo,
      'Организация':   r.organization || '',
      'Объект':        r.object_name,
      'Вид работ':     r.work_type,
      'Моточасы':      Number(r.engine_time_h),
      'Движение, ч':   Number(r.moving_time_h),
      'Пробег, км':    Number(r.distance_km),
      'На объекте, мин': r.onsite_min,
      'Рейсов':        r.trips_count,
      'Объём факт, м3': Number(r.fact_volume_m3),
      'КИП, %':        Number(r.kip_pct),
      'Движение, %':   Number(r.movement_pct),
      'Заявки':        (r.request_numbers || []).join('; '),
    }));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="summary.csv"');
    res.send(stringify(rows));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// CSV экспорт — детализация рейсов
// ========================
// GET /api/dt/export/trips.csv?dateFrom=2026-02-16&dateTo=2026-02-17&objectUid=tobolsk-osnova
app.get('/api/dt/export/trips.csv', async (req, res) => {
  try {
    const pool = getPool();
    const { dateFrom, dateTo, objectUid } = req.query as Record<string, string>;

    const result = await pool.query(`
      SELECT
        TO_CHAR(sr.report_date, 'YYYY-MM-DD') AS report_date,
        sr.shift_type,
        sr.vehicle_id   AS id_mo,
        sr.reg_number,
        sr.object_name,
        t.trip_number,
        t.loading_zone,
        t.unloading_zone,
        TO_CHAR(t.loaded_at   AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS loaded_at,
        TO_CHAR(t.unloaded_at AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS unloaded_at,
        t.duration_min,
        t.distance_km,
        t.volume_m3
      FROM dump_trucks.trips t
      JOIN dump_trucks.shift_records_active sr ON sr.id = t.shift_record_id
      WHERE ($1::date IS NULL OR sr.report_date >= $1)
        AND ($2::date IS NULL OR sr.report_date <= $2)
        AND ($3::text IS NULL OR sr.object_uid = $3)
      ORDER BY sr.report_date, sr.shift_type, sr.reg_number, t.trip_number
    `, [dateFrom || null, dateTo || null, objectUid || null]);

    const rows = result.rows.map(r => ({
      'Дата':          r.report_date,
      'Смена':         r.shift_type === 'shift1' ? '1 смена' : '2 смена',
      'idMO':          r.id_mo,
      'Гос. номер':    r.reg_number,
      'Объект':        r.object_name,
      'Рейс №':        r.trip_number,
      'Зона погрузки': r.loading_zone,
      'Зона выгрузки': r.unloading_zone,
      'Погружен в':    r.loaded_at   || '',
      'Выгружен в':    r.unloaded_at || '',
      'Длительность, мин': r.duration_min,
      'Пробег, км':    r.distance_km,
      'Объём, м3':     r.volume_m3,
    }));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="trips.csv"');
    res.send(stringify(rows));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// CSV экспорт — zone events
// ========================
// GET /api/dt/export/zone-events.csv?dateFrom=...&dateTo=...&objectUid=...
app.get('/api/dt/export/zone-events.csv', async (req, res) => {
  try {
    const pool = getPool();
    const { dateFrom, dateTo, objectUid } = req.query as Record<string, string>;

    const result = await pool.query(`
      SELECT
        TO_CHAR(ze.report_date, 'YYYY-MM-DD') AS report_date,
        ze.shift_type,
        ze.vehicle_id   AS id_mo,
        sr.reg_number,
        sr.object_name,
        ze.zone_name,
        ze.zone_tag,
        TO_CHAR(ze.entered_at AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS entered_at,
        TO_CHAR(ze.exited_at  AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS exited_at,
        ROUND(ze.duration_sec::numeric / 60, 1) AS duration_min
      FROM dump_trucks.zone_events ze
      JOIN dump_trucks.shift_records_active sr
        ON sr.vehicle_id  = ze.vehicle_id
        AND sr.report_date = ze.report_date
        AND sr.shift_type  = ze.shift_type
        AND sr.object_uid  = ze.object_uid
      WHERE ($1::date IS NULL OR ze.report_date >= $1)
        AND ($2::date IS NULL OR ze.report_date <= $2)
        AND ($3::text IS NULL OR sr.object_uid = $3)
      ORDER BY ze.report_date, ze.shift_type, ze.vehicle_id, ze.entered_at
    `, [dateFrom || null, dateTo || null, objectUid || null]);

    const rows = result.rows.map(r => ({
      'Дата':          r.report_date,
      'Смена':         r.shift_type === 'shift1' ? '1 смена' : '2 смена',
      'idMO':          r.id_mo,
      'Гос. номер':    r.reg_number || '',
      'Объект':        r.object_name || '',
      'Зона':          r.zone_name,
      'Тег':           r.zone_tag,
      'Вход':          r.entered_at || '',
      'Выход':         r.exited_at  || '',
      'Время в зоне, мин': Number(r.duration_min) || '',
    }));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zone-events.csv"');
    res.send(stringify(rows));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Сегменты смены (30-мин Gantt slices)
// ========================
// GET /api/dt/shift-segments?shiftRecordId=123
app.get('/api/dt/shift-segments', async (req, res) => {
  try {
    const pool = getPool();
    const id = req.query['shiftRecordId'];
    if (!id) { res.status(400).json({ error: 'shiftRecordId required' }); return; }
    const segments = await querySegments(pool, Number(id));
    res.json({ data: segments, total: segments.length });
  } catch (err) {
    logger.error('GET /api/dt/shift-segments error', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/dt/shift-segments/batch?ids=123,456
app.get('/api/dt/shift-segments/batch', async (req, res) => {
  try {
    const rawIds = req.query['ids'];
    const idsParam = Array.isArray(rawIds) ? rawIds.join(',') : rawIds;
    if (typeof idsParam !== 'string' || idsParam.trim() === '') {
      res.status(400).json({ error: 'ids param required' });
      return;
    }

    const parts = idsParam.split(',').map(s => s.trim()).filter(Boolean);
    const invalid = parts.some(s => !/^\d+$/.test(s) || Number(s) <= 0 || !Number.isSafeInteger(Number(s)));
    if (parts.length === 0 || invalid) {
      res.status(400).json({ error: 'ids must be positive integers separated by comma' });
      return;
    }

    const ids = [...new Set(parts.map(Number))];
    if (ids.length > 500) {
      res.status(400).json({ error: 'max 500 ids per request' });
      return;
    }

    const pool = getPool();
    const segmentsById = await querySegmentsBatch(pool, ids);
    const data: Record<string, unknown> = {};
    segmentsById.forEach((segments, id) => {
      data[String(id)] = segments;
    });
    res.json({ data, total: ids.length });
  } catch (err) {
    logger.error('GET /api/dt/shift-segments/batch error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Результаты загруженных сегментов за дату
// ========================
// GET /api/dt/admin/segment-results?date=YYYY-MM-DD
app.get('/api/dt/admin/segment-results', async (req, res) => {
  const dateStr = req.query['date'] as string;
  if (!dateStr) { res.status(400).json({ error: 'date required' }); return; }

  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT sr.id, sr.reg_number, sr.shift_type, sr.work_type,
             COUNT(ss.id)::int AS segment_count,
             COALESCE(SUM(ss.engine_time_sec), 0)::int AS total_engine_sec,
             COALESCE(SUM(ss.moving_time_sec), 0)::int AS total_moving_sec,
             COUNT(CASE WHEN ss.in_boundary THEN 1 END)::int AS boundary_segments
      FROM dump_trucks.shift_records sr
      LEFT JOIN dump_trucks.shift_segments ss ON ss.shift_record_id = sr.id
      WHERE sr.report_date = $1 AND sr.work_type = 'onsite'
      GROUP BY sr.id, sr.reg_number, sr.shift_type, sr.work_type
      ORDER BY sr.shift_type, sr.reg_number
    `, [dateStr]);

    res.json({
      date: dateStr,
      vehicles: result.rows.map(r => ({
        shiftRecordId: r.id,
        regNumber: r.reg_number || '—',
        shiftType: r.shift_type,
        segmentCount: r.segment_count,
        totalEngineSec: r.total_engine_sec,
        totalMovingSec: r.total_moving_sec,
        boundarySegments: r.boundary_segments,
      })),
      totalVehicles: result.rows.length,
      totalSegments: result.rows.reduce((s: number, r: { segment_count: number }) => s + r.segment_count, 0),
      vehiclesWithSegments: result.rows.filter((r: { segment_count: number }) => r.segment_count > 0).length,
    });
  } catch (err) {
    logger.error('GET /api/dt/admin/segment-results error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ========================
// Ручной запуск загрузки сегментов
// ========================
// POST /api/dt/admin/fetch-segments?date=2026-04-05&shift=shift1&force=true
app.post('/api/dt/admin/fetch-segments', (req, res) => {
  const dateStr  = req.query['date'] as string;
  const shiftStr = req.query['shift'] as string;
  const force    = req.query['force'] === 'true';

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
    return;
  }
  if (!shiftStr || !['shift1', 'shift2'].includes(shiftStr)) {
    res.status(400).json({ error: 'shift param required (shift1 | shift2)' });
    return;
  }

  const shiftType = shiftStr as ShiftType;

  res.json({ status: 'started', date: dateStr, shift: shiftType, force });

  runSegmentFetch({ dateStr, shiftType, force })
    .then(result => logger.info('[Admin] Segment fetch complete', result))
    .catch(err   => logger.error('[Admin] Segment fetch error', err));
});

// ========================
// Пересчёт из raw_monitoring (без TIS API)
// ========================
// POST /api/dt/admin/recalculate?date=2026-02-18&shift=shift1
app.post('/api/dt/admin/recalculate', async (req, res) => {
  const dateStr  = req.query['date']  as string;
  const shiftStr = req.query['shift'] as string;

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
    return;
  }
  if (!shiftStr || !['shift1', 'shift2'].includes(shiftStr)) {
    res.status(400).json({ error: 'shift param required (shift1 | shift2)' });
    return;
  }

  const shiftType = shiftStr as ShiftType;

  // Синхронный — ждёт завершения пересчёта
  const pool = getPool();
  try {
    const result = await recalculateShift(pool, dateStr, shiftType);
    logger.info('[Admin] Recalculate complete', result);
    res.json({ ...result, status: 'done', date: dateStr, shift: shiftType });
  } catch (err) {
    logger.error('[Admin] Recalculate error', err);
    res.status(500).json({ status: 'error', date: dateStr, shift: shiftType, error: String(err) });
}
});

// ========================
// Статистика конфигурации (для отладки)
// ========================
// GET /api/dt/admin/config
app.get('/api/dt/admin/config', (_req, res) => {
  const config = getEnvConfig();
  res.json({
    dbPort:       config.dbPort,
    dbName:       config.dbName,
    serverPort:   config.serverPort,
    testMode:     config.testIdMos !== null,
    testIdMos:    config.testIdMos,
    tokensCount:  config.tisApiTokens.length,
    tisApiUrl:    config.tisApiUrl ? '***configured***' : '(not set)',
  });
});

// ========================
// Startup
// ========================
const config = getEnvConfig();

// Проверяем подключение к БД при старте
getPool().query('SELECT 1').then(() => {
  logger.info(`[DB] Connected to ${config.dbName} at :${config.dbPort}`);
}).catch(err => {
  logger.error('[DB] Connection failed', err);
});

startScheduler();

app.listen(config.serverPort, () => {
  logger.info(`[Server] dump-trucks running on :${config.serverPort}`);
  if (config.testIdMos) {
    logger.info(`[Server] TEST MODE: idMOs = ${config.testIdMos.join(', ')}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('[Server] SIGTERM received, shutting down...');
  await closePool();
  process.exit(0);
});
