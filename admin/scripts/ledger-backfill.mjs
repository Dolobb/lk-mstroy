// Ledger backfill — одноразовый сид ingest.tasks из уже существующих данных.
// Контракт: INGEST_LEDGER_SPEC.md → «Backfill (история за 14 дней)».
//
// Идемпотентен: ON CONFLICT (pipeline, unit_key) DO NOTHING — безопасно перезапускать.
// Источники: kip_vehicles.vehicle_records, mstroy.dump_trucks.shift_records,
//            mstroy.analytics.track_sessions(+track_points). Цель — mstroy.ingest.tasks.
//
// Запуск (одноразово, dev-сид; рутинное управление — через Admin UI):
//   node admin/scripts/ledger-backfill.mjs [FROM YYYY-MM-DD] [TO YYYY-MM-DD]
// По умолчанию — последние 14 дней.

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

const argFrom = process.argv[2];
const argTo = process.argv[3];
const today = new Date();
const from = argFrom || ymd(new Date(today.getTime() - 14 * 86400_000));
const to = argTo || ymd(today);

const kipPool = new Pool({
  host: process.env.KIP_DB_HOST || 'localhost',
  port: Number(process.env.KIP_DB_PORT || 5432),
  database: process.env.KIP_DB_NAME || 'kip_vehicles',
  user: process.env.KIP_DB_USER || 'max',
  password: process.env.KIP_DB_PASSWORD,
});

const mainPool = new Pool({
  host: process.env.MAIN_DB_HOST || 'localhost',
  port: Number(process.env.MAIN_DB_PORT || 5432),
  database: process.env.MAIN_DB_NAME || 'mstroy',
  user: process.env.MAIN_DB_USER || 'max',
  password: process.env.MAIN_DB_PASSWORD,
});

/**
 * Вставка пачки задач в ingest.tasks. row = {pipeline, unitKey, targetDate,
 * shiftType, vehicleRef, vehicleLabel, status, reasonCode, result}.
 * finished_at = now() для терминальных статусов. ON CONFLICT DO NOTHING.
 * Возвращает количество РЕАЛЬНО вставленных строк (без учёта конфликтов).
 */
async function insertTasks(rows) {
  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, idx) => {
      const b = idx * 9;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::jsonb, now())`);
      params.push(
        r.pipeline, r.unitKey, r.targetDate, r.shiftType ?? null,
        r.vehicleRef, r.vehicleLabel ?? null, r.status, r.reasonCode ?? null,
        r.result != null ? JSON.stringify(r.result) : null,
      );
    });
    const sql = `
      INSERT INTO ingest.tasks
        (pipeline, unit_key, target_date, shift_type, vehicle_ref, vehicle_label, status, reason_code, result, finished_at)
      VALUES ${values.join(', ')}
      ON CONFLICT (pipeline, unit_key) DO NOTHING`;
    const res = await mainPool.query(sql, params);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

async function backfillKip() {
  const res = await kipPool.query(
    `SELECT to_char(report_date,'YYYY-MM-DD') AS date, shift_type, vehicle_id,
            vehicle_model, is_gap_filled, engine_on_time, utilization_ratio
       FROM vehicle_records
      WHERE report_date >= $1 AND report_date <= $2`,
    [from, to],
  );
  const rows = res.rows.map(r => {
    const ref = String(r.vehicle_id).toUpperCase();
    return {
      pipeline: 'kip-shift',
      unitKey: `${ref}|${r.date}|${r.shift_type}`,
      targetDate: r.date,
      shiftType: r.shift_type,
      vehicleRef: ref,
      vehicleLabel: r.vehicle_model,
      status: 'done',
      reasonCode: r.is_gap_filled ? 'gap_filled_onsite' : null,
      result: {
        fromBackfill: true,
        gapFilled: !!r.is_gap_filled,
        engineSec: Math.round(Number(r.engine_on_time || 0) * 3600),
        kip: Number(r.utilization_ratio || 0),
      },
    };
  });
  const inserted = await insertTasks(rows);
  return { source: rows.length, inserted };
}

async function backfillDt() {
  // В dump_trucks.shift_records idMO хранится в колонке vehicle_id (см. segmentFetchJob).
  const res = await mainPool.query(
    `SELECT to_char(report_date,'YYYY-MM-DD') AS date, shift_type, vehicle_id,
            max(reg_number) AS reg_number
       FROM dump_trucks.shift_records
      WHERE report_date >= $1 AND report_date <= $2
      GROUP BY report_date, shift_type, vehicle_id`,
    [from, to],
  );
  const rows = res.rows.map(r => ({
    pipeline: 'dt-shift',
    unitKey: `${r.vehicle_id}|${r.date}|${r.shift_type}`,
    targetDate: r.date,
    shiftType: r.shift_type,
    vehicleRef: String(r.vehicle_id),
    vehicleLabel: r.reg_number,
    status: 'done',
    reasonCode: null,
    result: { fromBackfill: true },
  }));
  const inserted = await insertTasks(rows);
  return { source: rows.length, inserted };
}

async function backfillAnalytics() {
  const res = await mainPool.query(
    `SELECT to_char(ts.date,'YYYY-MM-DD') AS date, ts.vehicle_id, ts.shift,
            count(tp.ts)::int AS points
       FROM analytics.track_sessions ts
       LEFT JOIN analytics.track_points tp ON tp.session_id = ts.id
      WHERE ts.date >= $1 AND ts.date <= $2 AND ts.source = 'pipeline'
      GROUP BY ts.id, ts.date, ts.vehicle_id, ts.shift`,
    [from, to],
  );
  const rows = res.rows.map(r => {
    const ref = String(r.vehicle_id).toUpperCase();
    const hasPoints = Number(r.points) > 0;
    return {
      pipeline: 'analytics-track',
      unitKey: `${ref}|${r.date}|${r.shift}`,
      targetDate: r.date,
      shiftType: r.shift,
      vehicleRef: ref,
      vehicleLabel: null,
      status: hasPoints ? 'done' : 'failed',
      reasonCode: hasPoints ? null : 'internal_error',
      result: { fromBackfill: true, points: Number(r.points) },
    };
  });
  const inserted = await insertTasks(rows);
  const failed = rows.filter(r => r.status === 'failed').length;
  return { source: rows.length, inserted, failed };
}

async function main() {
  console.log(`[ledger-backfill] Диапазон: ${from} … ${to}`);
  const out = {};
  try {
    out.kip = await backfillKip();
    console.log(`[ledger-backfill] kip-shift:       source=${out.kip.source} inserted=${out.kip.inserted}`);
  } catch (err) {
    console.error('[ledger-backfill] kip-shift FAILED:', err.message);
  }
  try {
    out.dt = await backfillDt();
    console.log(`[ledger-backfill] dt-shift:        source=${out.dt.source} inserted=${out.dt.inserted}`);
  } catch (err) {
    console.error('[ledger-backfill] dt-shift FAILED:', err.message);
  }
  try {
    out.analytics = await backfillAnalytics();
    console.log(`[ledger-backfill] analytics-track: source=${out.analytics.source} inserted=${out.analytics.inserted} failed=${out.analytics.failed}`);
  } catch (err) {
    console.error('[ledger-backfill] analytics-track FAILED:', err.message);
  }
  await kipPool.end();
  await mainPool.end();
  console.log('[ledger-backfill] Готово.');
}

main().catch(err => {
  console.error('[ledger-backfill] Fatal:', err);
  process.exit(1);
});
