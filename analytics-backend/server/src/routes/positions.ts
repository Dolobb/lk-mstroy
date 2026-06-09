import { Router } from 'express';
import { getPool, getKipPool } from '../db';
import { logger } from '../utils/logger';

export interface PositionPoint {
  regNumber: string;
  lat: number;
  lng: number;
  ts: string; // ISO
  motionStatus: string;
  speed: number | null;
  heading: number | null;
  engineOn: boolean | null;
  source: 'track_points' | 'dt_tracks' | 'kip_records';
}

interface TrackPointRow {
  vehicle_id: string;
  ts: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  engine_on: boolean | null;
  motion_status: string | null;
}

interface KipRecordRow {
  vehicle_id: string;
  latitude: string | null;
  longitude: string | null;
  report_date: string | Date;
}

interface DtLastPointRow {
  vehicle_id: string;
  ts: string | null;   // bigint as string
  lat: string | null;
  lng: string | null;
  speed: string | null;
  heading: string | null;
  engine_on: string | null;  // boolean as string
  motion_status: string | null;
}

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const YEKAT_OFFSET_MS = 5 * 60 * 60 * 1000;

function toYekatDateString(d: Date): string {
  return new Date(d.getTime() + YEKAT_OFFSET_MS).toISOString().slice(0, 10);
}

export async function getPositions(at: Date, from = new Date(at.getTime() - DEFAULT_LOOKBACK_MS)): Promise<PositionPoint[]> {
  const pool = getPool();
  const kipPool = getKipPool();
  const fromIso = from.toISOString();
  const atIso = at.toISOString();
  const fromDate = toYekatDateString(from);
  const atDate = toYekatDateString(at);
  const fromSec = Math.floor(from.getTime() / 1000);
  const atSec = Math.floor(at.getTime() / 1000);

  const result = new Map<string, PositionPoint>();

  // 1. Primary: analytics.track_points (detailed pipeline + live-cached tracks)
  try {
    const tpRes = await pool.query<TrackPointRow>(
      `SELECT DISTINCT ON (vehicle_id)
         vehicle_id, ts, lat, lng, speed, heading, engine_on, motion_status
       FROM analytics.track_points
       WHERE ts >= $1
         AND ts <= $2
       ORDER BY vehicle_id, ts DESC`,
      [fromIso, atIso],
    );
    for (const r of tpRes.rows) {
      result.set(r.vehicle_id, {
        regNumber: r.vehicle_id,
        lat: Number(r.lat),
        lng: Number(r.lng),
        ts: new Date(r.ts).toISOString(),
        motionStatus: r.motion_status || 'unknown',
        speed: r.speed !== null ? Number(r.speed) : null,
        heading: r.heading !== null ? Number(r.heading) : null,
        engineOn: r.engine_on ?? null,
        source: 'track_points',
      });
    }
  } catch (err) {
    logger.error('Failed to query track_points for positions', err);
  }

  // 2. Dump trucks: last point from dt_tracks JSONB (SQL-side, no full-array fetch)
  try {
    const dtRes = await pool.query<DtLastPointRow>(
      `WITH points AS (
         SELECT
           dt.vehicle_id,
           (p.point->>'ts')::bigint AS ts,
           p.point->>'lat' AS lat,
           p.point->>'lng' AS lng,
           p.point->>'speed' AS speed,
           p.point->>'heading' AS heading,
           p.point->>'engineOn' AS engine_on,
           p.point->>'motionStatus' AS motion_status,
           p.ord
         FROM dump_trucks.dt_tracks dt
         CROSS JOIN LATERAL jsonb_array_elements(dt.track_simplified) WITH ORDINALITY AS p(point, ord)
         WHERE dt.date >= $1::date - INTERVAL '1 day'
           AND dt.date <= $2::date + INTERVAL '1 day'
           AND jsonb_array_length(dt.track_simplified) > 0
           AND p.point->>'ts' IS NOT NULL
           AND (p.point->>'ts')::bigint >= $3::bigint
           AND (p.point->>'ts')::bigint <= $4::bigint
       )
       SELECT DISTINCT ON (vehicle_id)
         vehicle_id, ts, lat, lng, speed, heading, engine_on, motion_status
       FROM points
       ORDER BY vehicle_id, ts DESC, ord DESC`,
      [fromIso, atIso, fromSec, atSec],
    );
    for (const r of dtRes.rows) {
      if (!r.ts || !r.lat || !r.lng) continue;
      const pt = new Date(Number(r.ts) * 1000);
      if (pt < from) continue;
      if (pt > at) continue;
      if (result.has(r.vehicle_id)) continue;
      result.set(r.vehicle_id, {
        regNumber: r.vehicle_id,
        lat: Number(r.lat),
        lng: Number(r.lng),
        ts: pt.toISOString(),
        motionStatus: r.motion_status || 'unknown',
        speed: r.speed !== null ? Number(r.speed) : null,
        heading: r.heading !== null ? Number(r.heading) : null,
        engineOn: r.engine_on === 'true',
        source: 'dt_tracks',
      });
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01') {
      logger.info('[Positions] dt_tracks table not yet migrated — skipping dump truck fallback');
    } else {
      logger.warn('Failed to query dt_tracks for positions', err);
    }
  }

  // 3. KIP fallback: vehicle_records (last daily record with lat/lng)
  try {
    const kipRes = await kipPool.query<KipRecordRow>(
      `SELECT DISTINCT ON (vehicle_id)
         vehicle_id, latitude, longitude, report_date
       FROM vehicle_records
       WHERE latitude IS NOT NULL
         AND longitude IS NOT NULL
         AND report_date >= $1::date
         AND report_date <= $2::date
       ORDER BY vehicle_id, report_date DESC`,
      [fromDate, atDate],
    );
    for (const r of kipRes.rows) {
      if (result.has(r.vehicle_id)) continue;
      const reportDate = r.report_date instanceof Date
        ? toYekatDateString(r.report_date)
        : String(r.report_date).slice(0, 10);
      const reportTs = new Date(`${reportDate}T23:59:59.000+05:00`);
      const ts = reportTs.getTime() > at.getTime() ? at : reportTs;
      result.set(r.vehicle_id, {
        regNumber: r.vehicle_id,
        lat: Number(r.latitude!),
        lng: Number(r.longitude!),
        ts: ts.toISOString(),
        motionStatus: 'unknown',
        speed: null,
        heading: null,
        engineOn: null,
        source: 'kip_records',
      });
    }
  } catch (err) {
    logger.error('Failed to query KIP vehicle_records for positions', err);
  }

  return [...result.values()];
}

export function positionsRouter(): Router {
  const router = Router();

  router.get('/analytics/positions', async (req, res) => {
    const atParam = req.query.at as string | undefined;
    const fromParam = req.query.from as string | undefined;
    if (!atParam) {
      res.status(400).json({ error: 'Query parameter "at" required in ISO format' });
      return;
    }
    const at = new Date(atParam);
    if (isNaN(at.getTime())) {
      res.status(400).json({ error: 'Invalid "at" date format' });
      return;
    }
    const from = fromParam ? new Date(fromParam) : new Date(at.getTime() - DEFAULT_LOOKBACK_MS);
    if (isNaN(from.getTime())) {
      res.status(400).json({ error: 'Invalid "from" date format' });
      return;
    }
    if (from.getTime() > at.getTime()) {
      res.status(400).json({ error: 'Query parameter "from" must be earlier than or equal to "at"' });
      return;
    }

    try {
      const positions = await getPositions(at, from);
      res.json({ from: from.toISOString(), at: at.toISOString(), positions });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Positions endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
