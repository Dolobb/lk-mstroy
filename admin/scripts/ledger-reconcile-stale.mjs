// Reconciler-lite: лечит «застрявшие» задачи ingest.tasks в статусе running,
// которые остались висеть после прерванного прогона пайплайна (процесс убит до
// записи терминального статуса). Контракт — INGEST_LEDGER_SPEC.md (Layer «Reconciler»).
//
// Правило: running старше POROG минут →
//   - есть данные в таблице-источнике для (vehicle, date, shift) → done {reconciled:true}
//   - данных нет → failed('cancelled', 'stale running reconciled')
//
// Идемпотентен и безопасен: трогает только status='running'. Источники:
//   kip-shift → kip_vehicles.vehicle_records; dt-shift → mstroy.dump_trucks.shift_records;
//   analytics-track → mstroy.analytics.track_sessions(+points).
//
//   node admin/scripts/ledger-reconcile-stale.mjs [STALE_MINUTES=20]

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const STALE_MIN = Number(process.argv[2] || 20);

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

// Множество unit-ключей (vehicle|date|shift), для которых ЕСТЬ данные.
async function dataKeys(pipeline) {
  const set = new Set();
  if (pipeline === 'kip-shift') {
    const r = await kipPool.query(
      `SELECT DISTINCT upper(vehicle_id) AS v, to_char(report_date,'YYYY-MM-DD') AS d, shift_type AS s FROM vehicle_records`);
    for (const x of r.rows) set.add(`${x.v}|${x.d}|${x.s}`);
  } else if (pipeline === 'dt-shift') {
    const r = await mainPool.query(
      `SELECT DISTINCT vehicle_id AS v, to_char(report_date,'YYYY-MM-DD') AS d, shift_type AS s FROM dump_trucks.shift_records`);
    for (const x of r.rows) set.add(`${x.v}|${x.d}|${x.s}`);
  } else if (pipeline === 'analytics-track') {
    const r = await mainPool.query(
      `SELECT upper(ts.vehicle_id) AS v, to_char(ts.date,'YYYY-MM-DD') AS d, ts.shift AS s
         FROM analytics.track_sessions ts JOIN analytics.track_points tp ON tp.session_id = ts.id
        GROUP BY ts.vehicle_id, ts.date, ts.shift`);
    for (const x of r.rows) set.add(`${x.v}|${x.d}|${x.s}`);
  }
  return set;
}

async function reconcile(pipeline) {
  const stale = await mainPool.query(
    `SELECT id, unit_key FROM ingest.tasks
      WHERE pipeline = $1 AND status = 'running'
        AND started_at < now() - ($2 || ' minutes')::interval`,
    [pipeline, String(STALE_MIN)],
  );
  if (stale.rows.length === 0) return { pipeline, stale: 0, healedDone: 0, healedFailed: 0 };

  const keys = await dataKeys(pipeline);
  let healedDone = 0, healedFailed = 0;
  for (const row of stale.rows) {
    const hasData = keys.has(row.unit_key.toUpperCase()) || keys.has(row.unit_key);
    if (hasData) {
      await mainPool.query(
        `UPDATE ingest.tasks SET status='done', result = jsonb_build_object('reconciled', true), finished_at = now() WHERE id = $1`,
        [row.id]);
      await mainPool.query(
        `INSERT INTO ingest.task_events (task_id, status, meta) VALUES ($1,'done', jsonb_build_object('reconciled', true))`,
        [row.id]);
      healedDone++;
    } else {
      await mainPool.query(
        `UPDATE ingest.tasks SET status='failed', reason_code='cancelled', last_error='stale running reconciled', attempt = attempt + 1, finished_at = now() WHERE id = $1`,
        [row.id]);
      await mainPool.query(
        `INSERT INTO ingest.task_events (task_id, status, reason_code, error) VALUES ($1,'failed','cancelled','stale running reconciled')`,
        [row.id]);
      healedFailed++;
    }
  }
  return { pipeline, stale: stale.rows.length, healedDone, healedFailed };
}

async function main() {
  console.log(`[reconcile] Лечу running старше ${STALE_MIN} мин…`);
  for (const p of ['kip-shift', 'dt-shift', 'analytics-track', 'kip-segments', 'dt-segments']) {
    try {
      const r = await reconcile(p);
      if (r.stale > 0) console.log(`[reconcile] ${p}: stale=${r.stale} → done=${r.healedDone}, failed(cancelled)=${r.healedFailed}`);
    } catch (err) {
      console.error(`[reconcile] ${p} FAILED:`, err.message);
    }
  }
  await kipPool.end();
  await mainPool.end();
  console.log('[reconcile] Готово.');
}

main().catch(err => { console.error('[reconcile] Fatal:', err); process.exit(1); });
