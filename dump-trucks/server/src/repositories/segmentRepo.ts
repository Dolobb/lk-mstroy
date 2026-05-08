import { Pool, PoolClient } from 'pg';
import type { ShiftSegment } from '../types/domain';

/**
 * Атомарная замена сегментов для смены:
 * 1. DELETE все сегменты для shift_record_id
 * 2. INSERT новые (24 строки)
 * Должно выполняться в транзакции.
 */
export async function replaceSegments(
  client: PoolClient,
  shiftRecordId: number,
  segments: ShiftSegment[],
): Promise<void> {
  await client.query(
    'DELETE FROM dump_trucks.shift_segments WHERE shift_record_id = $1',
    [shiftRecordId],
  );

  if (segments.length === 0) return;

  for (const seg of segments) {
    await client.query(`
      INSERT INTO dump_trucks.shift_segments (
        shift_record_id, segment_index,
        segment_start, segment_end,
        engine_time_sec, moving_time_sec,
        in_boundary, distance_km, track_points_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      shiftRecordId,
      seg.segmentIndex,
      seg.segmentStart,
      seg.segmentEnd,
      seg.engineTimeSec,
      seg.movingTimeSec,
      seg.inBoundary,
      seg.distanceKm,
      seg.trackPointsCount,
    ]);
  }
}

/**
 * Чтение сегментов для shift_record.
 */
export async function querySegments(
  pool: Pool,
  shiftRecordId: number,
): Promise<ShiftSegment[]> {
  const result = await pool.query<{
    segment_index: number;
    segment_start: Date;
    segment_end: Date;
    engine_time_sec: number;
    moving_time_sec: number;
    in_boundary: boolean;
    distance_km: string;
    track_points_count: number;
  }>(`
    SELECT ss.segment_index, ss.segment_start, ss.segment_end,
           ss.engine_time_sec, ss.moving_time_sec,
           ss.in_boundary, ss.distance_km, ss.track_points_count
    FROM dump_trucks.shift_segments ss
    WHERE ss.shift_record_id = $1
      AND EXISTS (
        SELECT 1 FROM dump_trucks.shift_records_active sra
        WHERE sra.id = ss.shift_record_id
      )
    ORDER BY ss.segment_index
  `, [shiftRecordId]);

  return result.rows.map(r => ({
    segmentIndex:    r.segment_index,
    segmentStart:    r.segment_start,
    segmentEnd:      r.segment_end,
    engineTimeSec:   r.engine_time_sec,
    movingTimeSec:   r.moving_time_sec,
    inBoundary:      r.in_boundary,
    distanceKm:      Number(r.distance_km),
    trackPointsCount: r.track_points_count,
  }));
}

/**
 * Возвращает Set ID записей, у которых уже есть сегменты.
 */
export async function getRecordIdsWithSegments(
  pool: Pool,
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();

  const result = await pool.query<{ shift_record_id: number }>(`
    SELECT DISTINCT shift_record_id
    FROM dump_trucks.shift_segments
    WHERE shift_record_id = ANY($1)
  `, [ids]);

  return new Set(result.rows.map(r => r.shift_record_id));
}
