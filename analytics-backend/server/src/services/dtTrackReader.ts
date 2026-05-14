import { getPool } from '../db';
import { logger } from '../utils/logger';
import type { TrackPoint } from '../services/dwellExtractor';

export interface DtTrackRow {
  track_simplified: Array<{
    ts: number;
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    engineOn: boolean;
    motionStatus: 'moving' | 'idle' | 'dwell';
    dwellSec: number | null;
  }>;
}

export async function getDumpTruckTracks(
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<TrackPoint[]> {
  const pool = getPool();
  try {
    const res = await pool.query<DtTrackRow>(
      `SELECT dt.track_simplified
       FROM dump_trucks.dt_tracks dt
       WHERE UPPER(dt.vehicle_id) = UPPER($1)
         AND dt.date >= $2::date
         AND dt.date <= $3::date`,
      [vehicleId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
    );

    const allPoints: TrackPoint[] = [];
    for (const row of res.rows) {
      const track = row.track_simplified;
      if (!Array.isArray(track)) continue;
      for (const p of track) {
        if (typeof p.ts !== 'number') continue;
        const pointTime = new Date(p.ts * 1000);
        if (pointTime < from || pointTime > to) continue;
        allPoints.push({
          lat: p.lat,
          lng: p.lng,
          ts: p.ts,
          speed: p.speed ?? null,
          heading: p.heading ?? null,
          engineOn: p.engineOn,
          motionStatus: p.motionStatus as TrackPoint['motionStatus'],
          dwellSec: p.dwellSec ?? null,
        });
      }
    }

    return allPoints;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      logger.info(`[DtTrackReader] dt_tracks table not yet migrated — skipping dump truck tracks`);
    } else {
      logger.warn(`[DtTrackReader] Failed to read dt_tracks for ${vehicleId}: ${msg}`);
    }
    return [];
  }
}
