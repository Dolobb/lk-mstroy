import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

type ShiftType = 'shift1' | 'shift2';

const ROOT = path.resolve(__dirname, '../..');
const KIP_BASE = process.env.KIP_BASE ?? 'http://localhost:3001';
const DT_BASE = process.env.DT_BASE ?? 'http://localhost:3002';
const DATE = process.env.SEGMENT_TEST_DATE ?? '2026-06-03';
const DT_SHIFT = (process.env.DT_SHIFT ?? 'shift1') as ShiftType;
const KIP_SHIFT = process.env.KIP_SHIFT ?? (DT_SHIFT === 'shift1' ? 'morning' : 'evening');
const KIP_LIMIT = Number(process.env.KIP_LIMIT ?? 120);
const DT_LIMIT = Number(process.env.DT_LIMIT ?? 30);
const POLL_MS = Number(process.env.POLL_MS ?? 2000);
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 20 * 60_000);

interface TisStats {
  requests: number;
  retry429: number;
  retryTimeout: number;
  http404: number;
  otherErrors: number;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^#=\s]+)=(.*)$/);
    if (m) out[m[1]!.trim()] = m[2]!.trim();
  }
  return out;
}

function makePool(env: Record<string, string>, fallbackDb: string, fallbackUser: string): Pool {
  return new Pool({
    host: env['DB_HOST'] ?? 'localhost',
    port: Number(env['DB_PORT'] ?? 5432),
    database: env['DB_NAME'] ?? fallbackDb,
    user: env['DB_USER'] ?? fallbackUser,
    password: env['DB_PASSWORD'] ?? '',
    max: 5,
  });
}

function countTokens(env: Record<string, string>): number {
  return (env['TIS_API_TOKENS'] ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean).length;
}

async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function diffStats(before: TisStats | null, after: TisStats | null): TisStats {
  return {
    requests: (after?.requests ?? 0) - (before?.requests ?? 0),
    retry429: (after?.retry429 ?? 0) - (before?.retry429 ?? 0),
    retryTimeout: (after?.retryTimeout ?? 0) - (before?.retryTimeout ?? 0),
    http404: (after?.http404 ?? 0) - (before?.http404 ?? 0),
    otherErrors: (after?.otherErrors ?? 0) - (before?.otherErrors ?? 0),
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getKipStats(): Promise<{ stats: TisStats | null; tokenCount?: number }> {
  return httpJson(`${KIP_BASE}/api/admin/tis-stats`);
}

async function getDtStats(): Promise<{ stats: TisStats | null; tokenCount?: number }> {
  return httpJson(`${DT_BASE}/api/dt/admin/tis-stats`);
}

async function selectKipVehicles(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ vehicle_id: string }>(`
    SELECT vehicle_id
    FROM vehicle_records
    WHERE report_date = $1
      AND shift_type = $2
      AND engine_on_time > 0
    GROUP BY vehicle_id
    ORDER BY vehicle_id
    LIMIT $3
  `, [DATE, KIP_SHIFT, KIP_LIMIT]);
  return result.rows.map(r => r.vehicle_id);
}

async function selectDtRecordIds(pool: Pool): Promise<number[]> {
  const result = await pool.query<{ id: string }>(`
    SELECT id
    FROM dump_trucks.shift_records
    WHERE report_date = $1
      AND shift_type = $2
      AND work_type = 'onsite'
    ORDER BY id
    LIMIT $3
  `, [DATE, DT_SHIFT, DT_LIMIT]);
  return result.rows.map(r => Number(r.id));
}

async function triggerKipVehicles(vehicleIds: string[]): Promise<void> {
  await Promise.all(vehicleIds.map(vehicleId => httpJson(`${KIP_BASE}/api/segments/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, date: DATE, shiftType: KIP_SHIFT }),
  })));
}

async function triggerDtShift(): Promise<void> {
  await httpJson(`${DT_BASE}/api/dt/admin/fetch-segments?date=${DATE}&shift=${DT_SHIFT}&force=true`, {
    method: 'POST',
  });
}

async function countFreshKip(pool: Pool, vehicleIds: string[], startedAt: Date): Promise<number> {
  const result = await pool.query<{ cnt: string }>(`
    WITH selected(vehicle_id) AS (SELECT UNNEST($1::text[]))
    SELECT COUNT(*)::text AS cnt
    FROM selected s
    WHERE EXISTS (
      SELECT 1
      FROM kip_shift_segments kss
      WHERE kss.vehicle_id = s.vehicle_id
        AND kss.report_date = $2
        AND kss.shift_type = $3
      GROUP BY kss.vehicle_id
      HAVING COUNT(*) = 24
         AND MIN(kss.created_at) >= $4
    )
  `, [vehicleIds, DATE, KIP_SHIFT, startedAt]);
  return Number(result.rows[0]?.cnt ?? 0);
}

async function countFreshDt(pool: Pool, recordIds: number[], startedAt: Date): Promise<number> {
  const result = await pool.query<{ cnt: string }>(`
    WITH selected(id) AS (SELECT UNNEST($1::int[]))
    SELECT COUNT(*)::text AS cnt
    FROM selected s
    WHERE EXISTS (
      SELECT 1
      FROM dump_trucks.shift_segments ss
      WHERE ss.shift_record_id = s.id
      GROUP BY ss.shift_record_id
      HAVING COUNT(*) = 24
         AND MIN(ss.created_at) >= $2
    )
  `, [recordIds, startedAt]);
  return Number(result.rows[0]?.cnt ?? 0);
}

async function waitFor(label: string, expected: number, fn: () => Promise<number>): Promise<number> {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < MAX_WAIT_MS) {
    const current = await fn();
    if (current !== last) {
      process.stdout.write(`\n${label}: ${current}/${expected}`);
      last = current;
    } else {
      process.stdout.write('.');
    }
    if (current >= expected) return Math.round((Date.now() - started) / 1000);
    await sleep(POLL_MS);
  }
  throw new Error(`${label} timed out at ${last}/${expected}`);
}

async function main(): Promise<void> {
  const kipEnv = parseEnvFile(path.join(ROOT, 'kip/.env'));
  const dtEnv = parseEnvFile(path.join(ROOT, 'dump-trucks/server/.env'));
  const kipEnvTokenCount = countTokens(kipEnv);
  const dtEnvTokenCount = countTokens(dtEnv);
  const kipPool = makePool(kipEnv, 'kip_vehicles', 'postgres');
  const dtPool = makePool(dtEnv, 'mstroy', 'max');

  try {
    const [kipVehicles, dtRecordIds, kipStatsBefore, dtStatsBefore] = await Promise.all([
      selectKipVehicles(kipPool),
      selectDtRecordIds(dtPool),
      getKipStats(),
      getDtStats(),
    ]);

    console.log(JSON.stringify({
      date: DATE,
      kipShift: KIP_SHIFT,
      dtShift: DT_SHIFT,
      kipSelected: kipVehicles.length,
      dtSelected: dtRecordIds.length,
      kipEnvTokenCount,
      dtEnvTokenCount,
      kipApiTokenCount: kipStatsBefore.tokenCount,
      dtTokenCount: dtStatsBefore.tokenCount,
      expectedSegmentRequests: (kipVehicles.length + dtRecordIds.length) * 24,
    }, null, 2));

    if (kipVehicles.length === 0 && dtRecordIds.length === 0) {
      throw new Error('No KIP or DT records selected for test');
    }

    const startedAt = new Date();
    await Promise.all([
      kipVehicles.length ? triggerKipVehicles(kipVehicles) : Promise.resolve(),
      dtRecordIds.length ? triggerDtShift() : Promise.resolve(),
    ]);

    const [kipDuration, dtDuration] = await Promise.all([
      kipVehicles.length
        ? waitFor('KIP fresh segments', kipVehicles.length, () => countFreshKip(kipPool, kipVehicles, startedAt))
        : Promise.resolve(0),
      dtRecordIds.length
        ? waitFor('DT fresh segments', dtRecordIds.length, () => countFreshDt(dtPool, dtRecordIds, startedAt))
        : Promise.resolve(0),
    ]);

    const [kipStatsAfter, dtStatsAfter] = await Promise.all([getKipStats(), getDtStats()]);
    console.log('\n\nResult');
    console.log(JSON.stringify({
      kip: {
        vehicles: kipVehicles.length,
        durationSec: kipDuration,
        expectedSegmentRequests: kipVehicles.length * 24,
        observedEndpointStats: diffStats(kipStatsBefore.stats, kipStatsAfter.stats),
      },
      dt: {
        vehicles: dtRecordIds.length,
        durationSec: dtDuration,
        expectedSegmentRequests: dtRecordIds.length * 24,
        observedEndpointStats: diffStats(dtStatsBefore.stats, dtStatsAfter.stats),
      },
    }, null, 2));
  } finally {
    await Promise.allSettled([kipPool.end(), dtPool.end()]);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
