import { Router } from 'express';
import { getPool } from '../db';
import { getTisClient } from '../services/tisClientFactory';
import { simplifyTrack } from '../services/trackSimplifier';
import { extractDwells, TrackPoint } from '../services/dwellExtractor';
import { logger } from '../utils/logger';
import { getDstVehicles } from '../services/dstRegistry';
import { parseTrackPoints } from '../utils/trackParser';
import { Pool } from 'pg';

export interface TrackResponse {
  vehicleId: string;
  points: Array<{
    ts: string;
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    engineOn: boolean;
    motionStatus: string;
    dwellSec: number | null;
  }>;
}

const LIVE_SHIFT = 'live';
const MIN_TRACK_POINTS = 2;

export async function getTracks(
  vehicleId: string,
  from: string,
  to: string,
): Promise<TrackResponse> {
  const pool = getPool();
  const fromDate = new Date(from);
  const toDate = new Date(to);

  const covered = await getCoveredDates(pool, vehicleId, fromDate, toDate);
  const fullRange = datesInRange(fromDate, toDate);

  const missing = fullRange.filter(d => !covered.has(d));

  const dbPoints = await fetchFromDb(pool, vehicleId, fromDate, toDate);
  let allPoints = dbPoints;

  for (const date of missing) {
    let dateFrom = new Date(`${date}T00:00:00Z`);
    let dateTo = new Date(`${date}T23:59:59Z`);
    if (dateFrom < fromDate) dateFrom = fromDate;
    if (dateTo > toDate) dateTo = toDate;
    const livePoints = await fetchFromTis(vehicleId, dateFrom, dateTo);
    if (livePoints.length > 0) {
      await cacheLiveTrack(pool, vehicleId, date, livePoints);
      allPoints = mergePoints(allPoints, livePoints);
    }
  }

  return formatResponse(vehicleId, allPoints);
}

async function getCoveredDates(
  pool: Pool,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  try {
    const res = await pool.query<{ date: string }>(
      `SELECT DISTINCT ts.date::text AS date
       FROM analytics.track_sessions ts
       WHERE ts.vehicle_id = $1
         AND ts.date >= $2::date
         AND ts.date <= $3::date
         AND EXISTS (
           SELECT 1 FROM analytics.track_points tp
           WHERE tp.session_id = ts.id
           LIMIT 1
         )`,
      [vehicleId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
    );
    return new Set(res.rows.map(r => r.date));
  } catch {
    return new Set();
  }
}

function datesInRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const start = new Date(from.toISOString().slice(0, 10));
  const end = new Date(to.toISOString().slice(0, 10));
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function mergePoints(db: TrackPoint[], live: TrackPoint[]): TrackPoint[] {
  const map = new Map<number, TrackPoint>();
  for (const p of db) map.set(p.ts, p);
  for (const p of live) {
    if (!map.has(p.ts)) map.set(p.ts, p);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

async function fetchFromDb(
  pool: Pool,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<TrackPoint[]> {
  try {
    const res = await pool.query<{
      ts: string; lat: number; lng: number;
      speed: number | null; heading: number | null;
      engine_on: boolean; motion_status: string; dwell_sec: number | null;
    }>(
      `SELECT tp.ts, tp.lat, tp.lng, tp.speed, tp.heading,
              tp.engine_on, tp.motion_status, tp.dwell_sec
       FROM analytics.track_points tp
       JOIN analytics.track_sessions s ON s.id = tp.session_id
       WHERE s.vehicle_id = $1
         AND s.date >= $2::date AND s.date <= $3::date
         AND tp.ts >= $2 AND tp.ts <= $3
       ORDER BY tp.ts`,
      [vehicleId, from.toISOString(), to.toISOString()],
    );

    return res.rows.map(r => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      ts: Math.floor(new Date(r.ts).getTime() / 1000),
      speed: r.speed !== null ? Number(r.speed) : null,
      heading: r.heading !== null ? Number(r.heading) : null,
      engineOn: r.engine_on,
      motionStatus: r.motion_status as TrackPoint['motionStatus'],
      dwellSec: r.dwell_sec !== null ? Number(r.dwell_sec) : null,
    }));
  } catch (err) {
    logger.error(`DB fetch failed for ${vehicleId}`, err);
    return [];
  }
}

async function fetchFromTis(
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<TrackPoint[]> {
  const dstVehicles = await getDstVehicles();
  const vehicle = dstVehicles.find(v =>
    v.vehicle_id.toUpperCase() === vehicleId.toUpperCase(),
  );

  if (!vehicle) {
    logger.warn(`Vehicle ${vehicleId} not found in DST registry`);
    return [];
  }

  const tisClient = getTisClient();
  try {
    const stats = await tisClient.getMonitoringStats(vehicle.idMO, from, to);
    if (!stats || !stats.track || stats.track.length < MIN_TRACK_POINTS) return [];

    const rawPoints = parseTrackPoints(stats.track);
    if (rawPoints.length < MIN_TRACK_POINTS) return [];

    const simplified = simplifyTrack(rawPoints, stats.ignitionWork);
    return extractDwells(simplified);
  } catch (err) {
    logger.error(`Live TIS fetch failed for ${vehicleId}`, err);
    return [];
  }
}

async function cacheLiveTrack(
  pool: Pool,
  vehicleId: string,
  date: string,
  points: TrackPoint[],
): Promise<void> {
  if (points.length === 0) return;
  try {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM analytics.track_sessions
       WHERE vehicle_id = $1 AND date = $2 AND shift = $3 AND source = 'live_tis'`,
      [vehicleId, date, LIVE_SHIFT],
    );

    let sessionId: string;

    if (existing.rows.length > 0) {
      sessionId = existing.rows[0].id;
      await pool.query('DELETE FROM analytics.track_points WHERE session_id = $1', [sessionId]);
      await pool.query(
        `UPDATE analytics.track_sessions SET fetched_at = now() WHERE id = $1`,
        [sessionId],
      );
    } else {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO analytics.track_sessions (vehicle_id, date, shift, source)
         VALUES ($1, $2, $3, 'live_tis')
         RETURNING id`,
        [vehicleId, date, LIVE_SHIFT],
      );
      sessionId = res.rows[0].id;
    }

    await insertPoints(pool, sessionId, points);
  } catch (err) {
    logger.error(`Failed to cache track for ${vehicleId}`, err);
  }
}

async function insertPoints(pool: Pool, sessionId: string, points: TrackPoint[]): Promise<void> {
  if (points.length === 0) return;

  const values: string[] = [];
  const params: unknown[] = [sessionId];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const base = i * 8 + 2;
    values.push(
      `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
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
  }

  await pool.query(
    `INSERT INTO analytics.track_points
       (session_id, ts, lat, lng, speed, heading, engine_on, motion_status, dwell_sec)
     VALUES ${values.join(', ')}
     ON CONFLICT (session_id, ts) DO NOTHING`,
    params,
  );
}

function formatResponse(vehicleId: string, points: TrackPoint[]): TrackResponse {
  return {
    vehicleId,
    points: points.map(p => ({
      ts: new Date(p.ts * 1000).toISOString(),
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      heading: p.heading,
      engineOn: p.engineOn,
      motionStatus: p.motionStatus,
      dwellSec: p.dwellSec,
    })),
  };
}

export function tracksRouter(): Router {
  const router = Router();

  router.get('/analytics/tracks', async (req, res) => {
    const vehicle = req.query.vehicle as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!vehicle) {
      res.status(400).json({ error: 'Query parameter "vehicle" required' });
      return;
    }
    if (!from || !to) {
      res.status(400).json({ error: 'Query parameters "from" and "to" required in ISO format' });
      return;
    }

    try {
      const result = await getTracks(vehicle, from, to);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
