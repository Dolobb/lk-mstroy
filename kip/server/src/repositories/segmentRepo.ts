import { Pool, PoolClient } from 'pg';
import type { KipShiftSegment } from '../types/domain';

/**
 * Atomic replacement of segments for a shift:
 * 1. DELETE all segments for vehicle/date/shift
 * 2. INSERT new (24 rows)
 * Must run inside a transaction.
 */
export async function replaceSegments(
  client: PoolClient,
  vehicleId: string,
  reportDate: string,
  shiftType: string,
  segments: KipShiftSegment[],
): Promise<void> {
  await client.query(
    'DELETE FROM kip_shift_segments WHERE vehicle_id = $1 AND report_date = $2 AND shift_type = $3',
    [vehicleId, reportDate, shiftType],
  );

  if (segments.length === 0) return;

  for (const seg of segments) {
    await client.query(`
      INSERT INTO kip_shift_segments (
        vehicle_id, report_date, shift_type, segment_index,
        segment_start, segment_end,
        engine_time_sec, moving_time_sec,
        distance_km, track_points_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      vehicleId,
      reportDate,
      shiftType,
      seg.segmentIndex,
      seg.segmentStart,
      seg.segmentEnd,
      seg.engineTimeSec,
      seg.movingTimeSec,
      seg.distanceKm,
      seg.trackPointsCount,
    ]);
  }
}

/**
 * Read segments for a vehicle/date/shift.
 */
export async function querySegments(
  pool: Pool,
  vehicleId: string,
  reportDate: string,
  shiftType: string,
): Promise<KipShiftSegment[]> {
  const result = await pool.query<{
    segment_index: number;
    segment_start: Date;
    segment_end: Date;
    engine_time_sec: number;
    moving_time_sec: number;
    distance_km: string;
    track_points_count: number;
  }>(`
    SELECT segment_index, segment_start, segment_end,
           engine_time_sec, moving_time_sec,
           distance_km, track_points_count
    FROM kip_shift_segments
    WHERE vehicle_id = $1 AND report_date = $2 AND shift_type = $3
    ORDER BY segment_index
  `, [vehicleId, reportDate, shiftType]);

  return result.rows.map(r => ({
    segmentIndex:    r.segment_index,
    segmentStart:    r.segment_start,
    segmentEnd:      r.segment_end,
    engineTimeSec:   r.engine_time_sec,
    movingTimeSec:   r.moving_time_sec,
    distanceKm:      Number(r.distance_km),
    trackPointsCount: r.track_points_count,
  }));
}

/**
 * Check if segments exist for a vehicle/date/shift.
 */
export async function hasSegments(
  pool: Pool,
  vehicleId: string,
  reportDate: string,
  shiftType: string,
): Promise<boolean> {
  const result = await pool.query<{ cnt: string }>(
    'SELECT COUNT(*)::text AS cnt FROM kip_shift_segments WHERE vehicle_id = $1 AND report_date = $2 AND shift_type = $3',
    [vehicleId, reportDate, shiftType],
  );
  return Number(result.rows[0]?.cnt ?? 0) > 0;
}
