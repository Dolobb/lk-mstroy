import express from 'express';
import cors from 'cors';
import { getEnvConfig } from './config/env';
import { getPool, closePool } from './config/database';
import { startScheduler } from './jobs/scheduler';
import { runShiftFetch } from './jobs/shiftFetchJob';
import { queryShiftRecords } from './repositories/shiftRecordRepo';
import { getDtObjects } from './repositories/filterRepo';
import { logger } from './utils/logger';
import type { ShiftType } from './types/domain';
import { stringify } from './utils/csv';

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

  // Запускаем асинхронно
  res.json({ status: 'started', date: dateStr, shift: shiftType });

  runShiftFetch(dateStr, shiftType)
    .then(result => logger.info('[Admin] Fetch complete', result))
    .catch(err   => logger.error('[Admin] Fetch error', err));
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
      JOIN dump_trucks.shift_records sr ON sr.id = t.shift_record_id
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
      SELECT * FROM dump_trucks.zone_events
      WHERE ($1::int IS NULL OR vehicle_id = $1)
        AND ($2::date IS NULL OR report_date = $2)
        AND ($3::text IS NULL OR shift_type = $3)
      ORDER BY entered_at
    `, [vehicleId || null, date || null, shiftType || null]);
    res.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
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
      FROM dump_trucks.shift_records sr
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
        TO_CHAR(t.loaded_at   AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') AS loaded_at,
        TO_CHAR(t.unloaded_at AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') AS unloaded_at,
        t.duration_min,
        t.distance_km,
        t.volume_m3
      FROM dump_trucks.trips t
      JOIN dump_trucks.shift_records sr ON sr.id = t.shift_record_id
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
        TO_CHAR(ze.entered_at AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') AS entered_at,
        TO_CHAR(ze.exited_at  AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI') AS exited_at,
        ROUND(ze.duration_sec::numeric / 60, 1) AS duration_min
      FROM dump_trucks.zone_events ze
      LEFT JOIN dump_trucks.shift_records sr
        ON sr.vehicle_id = ze.vehicle_id
        AND sr.report_date = ze.report_date
        AND sr.shift_type = ze.shift_type
        AND ($3::text IS NULL OR sr.object_uid = $3)
      WHERE ($1::date IS NULL OR ze.report_date >= $1)
        AND ($2::date IS NULL OR ze.report_date <= $2)
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
