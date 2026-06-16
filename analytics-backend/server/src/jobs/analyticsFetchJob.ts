import { getPool } from '../db';
import { getDstVehicles, clearDstCache } from '../services/dstRegistry';
import { getTisClient } from '../services/tisClientFactory';
import { simplifyTrack } from '../services/trackSimplifier';
import { extractDwells } from '../services/dwellExtractor';
import { parseTrackPoints } from '../utils/trackParser';
import { logger } from '../utils/logger';
import type { TrackPoint } from '../services/dwellExtractor';
import { computeVisitedObjectsForPoints } from '../services/visitedObjects';
import { ensureTask, markRunning, markDone, markEmpty, markFailed } from '../services/ledgerClient';
import { Pool } from 'pg';

const LEDGER_PIPELINE = 'analytics-track';

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

  // Ledger write-through (best-effort): ensureTask на каждый vehicle перед циклом.
  const taskIdByVehicle = new Map<string, number | null>();
  for (const vehicle of vehicles) {
    const taskId = await ensureTask({
      pipeline: LEDGER_PIPELINE,
      unitKey: `${vehicle.vehicle_id}|${dateStr}|${DEFAULT_SHIFT}`,
      targetDate: dateStr,
      shiftType: DEFAULT_SHIFT,
      vehicleRef: vehicle.vehicle_id,
    });
    taskIdByVehicle.set(vehicle.vehicle_id, taskId);
  }

  const results = await mapConcurrent(vehicles, concurrency, async (vehicle) => {
    const vResult = { vehicle_id: vehicle.vehicle_id, sessionId: null as string | null, points: 0, error: null as string | null };
    const taskId = taskIdByVehicle.get(vehicle.vehicle_id) ?? null;
    try {
      const existing = await getExistingSession(pool, vehicle.vehicle_id, dateStr);
      // existing && !force → НЕ трогаем ledger (статус уже корректен).
      if (existing && !force) return vResult;

      if (taskId !== null) await markRunning(taskId);

      if (existing && force) {
        await pool.query('DELETE FROM analytics.track_sessions WHERE id = $1', [existing]);
      }

      const stats = await tisClient.getMonitoringStats(vehicle.idMO, fromDate, toDate);
      if (!stats) {
        if (taskId !== null) await markEmpty(taskId, 'no_monitoring');
        return vResult;
      }
      if (!stats.track || stats.track.length < 2) {
        if (taskId !== null) await markEmpty(taskId, 'no_track');
        return vResult;
      }

      const rawPoints = parseTrackPoints(stats.track);
      if (rawPoints.length < 2) {
        if (taskId !== null) await markEmpty(taskId, 'no_track');
        return vResult;
      }

      const simplified = simplifyTrack(rawPoints, stats.ignitionWork);
      const withDwells = extractDwells(simplified);

      const sessionId = await createSession(pool, vehicle.vehicle_id, dateStr);
      const inserted = await insertTrackPoints(pool, sessionId, vehicle.vehicle_id, withDwells);

      try {
        const visited = await computeVisitedObjectsForPoints(pool, withDwells);
        if (visited.length > 0) {
          await pool.query(
            `UPDATE analytics.track_sessions SET visited_objects = $1 WHERE id = $2`,
            [visited, sessionId],
          );
        }
      } catch (err) {
        logger.warn(`visited_objects failed for ${vehicle.vehicle_id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // КРИТИЧЕСКИЙ ИНВАРИАНТ: markDone ТОЛЬКО если inserted > 0.
      // inserted === 0 при непустом входе (withDwells.length > 0) → markFailed.
      if (taskId !== null) {
        if (inserted > 0) {
          const dwells = withDwells.filter(p => p.motionStatus === 'dwell').length;
          await markDone(taskId, { points: inserted, dwells });
        } else {
          await markFailed(taskId, 'internal_error', 'insert returned 0 rows');
        }
      }

      vResult.sessionId = sessionId;
      vResult.points = inserted;
      return vResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vResult.error = message;
      if (taskId !== null) {
        const reason = isTisError(err) ? 'tis_error' : 'internal_error';
        await markFailed(taskId, reason, message);
      }
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

/**
 * Эвристика «это ошибка обращения к TIS» (а не внутренняя обработки).
 * TIS-клиент бросает Error с «Timeout after…»/«429 for all…» либо axios-ошибку.
 * Используется для выбора reason_code: tis_error vs internal_error.
 */
function isTisError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    if ((err as { isAxiosError?: boolean }).isAxiosError) return true;
    const msg = err instanceof Error
      ? err.message
      : String((err as { message?: unknown }).message ?? '');
    return /timeout|429|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(msg);
  }
  return false;
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
  vehicleId: string,
  points: TrackPoint[],
): Promise<number> {
  if (points.length === 0) return 0;

  await pool.query('DELETE FROM analytics.track_points WHERE session_id = $1', [sessionId]);

  const values: string[] = [];
  const params: unknown[] = [sessionId];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const base = i * 9 + 2;
    values.push(
      `($1::uuid, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
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
      vehicleId,
    );
  }

  const query = `
    INSERT INTO analytics.track_points
      (session_id, ts, lat, lng, speed, heading, engine_on, motion_status, dwell_sec, vehicle_id)
    VALUES ${values.join(', ')}
    ON CONFLICT (session_id, ts) DO NOTHING
  `;

  const res = await pool.query(query, params);
  return res.rowCount ?? 0;
}
