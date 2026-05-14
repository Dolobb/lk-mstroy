import { getPool } from '../db';
import { getDstVehicles, clearDstCache } from '../services/dstRegistry';
import { getTisClient } from '../services/tisClientFactory';
import { simplifyTrack } from '../services/trackSimplifier';
import { extractDwells } from '../services/dwellExtractor';
import { parseTrackPoints } from '../utils/trackParser';
import { logger } from '../utils/logger';
import type { TrackPoint } from '../services/dwellExtractor';
import { Pool } from 'pg';

const DEFAULT_SHIFT = 'full';
const DEFAULT_CONCURRENCY = 18;

interface AnalyticsFetchResult {
  date: string;
  vehicles: number;
  sessions: number;
  points: number;
  errors: string[];
}

export async function runAnalyticsFetch(
  dateStr: string,
  force: boolean = false,
): Promise<AnalyticsFetchResult> {
  const pool = getPool();
  clearDstCache();
  const vehicles = await getDstVehicles();
  const tisClient = getTisClient();
  const concurrency = Number(process.env.TIS_CONCURRENCY || DEFAULT_CONCURRENCY);

  const result: AnalyticsFetchResult = {
    date: dateStr,
    vehicles: 0,
    sessions: 0,
    points: 0,
    errors: [],
  };

  const fromDate = new Date(`${dateStr}T00:00:00+05:00`);
  const toDate = new Date(`${dateStr}T23:59:59+05:00`);

  const results = await mapConcurrent(vehicles, concurrency, async (vehicle) => {
    const vResult = { vehicle_id: vehicle.vehicle_id, sessionId: null as string | null, points: 0, error: null as string | null };
    try {
      const existing = await getExistingSession(pool, vehicle.vehicle_id, dateStr);
      if (existing && !force) return vResult;

      if (existing && force) {
        await pool.query('DELETE FROM analytics.track_sessions WHERE id = $1', [existing]);
      }

      const stats = await tisClient.getMonitoringStats(vehicle.idMO, fromDate, toDate);
      if (!stats || !stats.track || stats.track.length < 2) return vResult;

      const rawPoints = parseTrackPoints(stats.track);
      if (rawPoints.length < 2) return vResult;

      const simplified = simplifyTrack(rawPoints, stats.ignitionWork);
      const withDwells = extractDwells(simplified);

      const sessionId = await createSession(pool, vehicle.vehicle_id, dateStr);
      const inserted = await insertTrackPoints(pool, sessionId, withDwells);

      vResult.sessionId = sessionId;
      vResult.points = inserted;
      return vResult;
    } catch (err) {
      vResult.error = err instanceof Error ? err.message : String(err);
      return vResult;
    }
  });

  for (const r of results) {
    if (r.sessionId) {
      result.sessions++;
      result.vehicles++;
      result.points += r.points;
    }
    if (r.error) {
      result.errors.push(`${r.vehicle_id}: ${r.error}`);
      logger.error(`Analytics fetch error for ${r.vehicle_id}: ${r.error}`);
    }
  }

  logger.info(`Analytics fetch complete: ${result.vehicles} vehicles, ${result.sessions} sessions, ${result.points} points, ${result.errors.length} errors`);
  return result;
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function getExistingSession(
  pool: Pool,
  vehicleId: string,
  date: string,
): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM analytics.track_sessions
     WHERE vehicle_id = $1 AND date = $2 AND shift = $3 AND source = 'pipeline'
     LIMIT 1`,
    [vehicleId, date, DEFAULT_SHIFT],
  );
  return res.rows[0]?.id ?? null;
}

async function createSession(
  pool: Pool,
  vehicleId: string,
  date: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO analytics.track_sessions (vehicle_id, date, shift, source)
     VALUES ($1, $2, $3, 'pipeline')
     ON CONFLICT (vehicle_id, date, shift, source) DO UPDATE
       SET fetched_at = now()
     RETURNING id`,
    [vehicleId, date, DEFAULT_SHIFT],
  );
  return res.rows[0].id;
}

async function insertTrackPoints(
  pool: Pool,
  sessionId: string,
  points: TrackPoint[],
): Promise<number> {
  if (points.length === 0) return 0;

  await pool.query('DELETE FROM analytics.track_points WHERE session_id = $1', [sessionId]);

  const values: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const p of points) {
    values.push(
      `($1, $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`,
    );
    params.push(
      new Date(p.ts * 1000).toISOString(),
      p.lat,
      p.lng,
      p.speed ?? null,
      p.heading ?? null,
      p.engineOn,
      p.motionStatus,
      p.dwellSec ?? null,
    );
    paramIdx += 8;
  }

  const query = `
    INSERT INTO analytics.track_points
      (session_id, ts, lat, lng, speed, heading, engine_on, motion_status, dwell_sec)
    VALUES ${values.join(', ')}
    ON CONFLICT (session_id, ts) DO NOTHING
  `;

  const res = await pool.query(query, [sessionId, ...params]);
  return res.rowCount ?? 0;
}
