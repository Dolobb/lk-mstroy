/**
 * Segment Fetch Job — загрузка 30-мин сегментов для onsite-машин.
 *
 * Для каждого onsite shift_record:
 * 1. 24 вызова getMonitoringStats (по 30-мин окнам)
 * 2. Для каждого окна: analyzeZones → in_boundary
 * 3. Сохранение в dump_trucks.shift_segments
 */

import { getPool } from '../config/database';
import { getEnvConfig } from '../config/env';
import { TisClient } from '../services/tisClient';
import { TokenPool } from '../services/tokenPool';
import { PerVehicleRateLimiter } from '../services/rateLimiter';
import { analyzeZones } from '../services/zoneAnalyzer';
import { getAllDtZones } from '../repositories/filterRepo';
import { replaceSegments, getRecordIdsWithSegments } from '../repositories/segmentRepo';
import { logger } from '../utils/logger';
import { getJobController, isCancelledError, CancelledError } from '../services/jobController';
import type { ShiftSegment, GeoZone, ShiftType } from '../types/domain';

const SEGMENT_COUNT = 24;
const SEGMENT_DURATION_MIN = 30;

export interface SegmentFetchResult {
  recordsProcessed: number;
  recordsSkipped: number;
  errors: string[];
}

interface ShiftRecordRow {
  id: number;
  vehicle_id: number;
  reg_number: string | null;
  shift_start: Date;
  shift_end: Date;
  object_uid: string;
}

export async function runSegmentFetch(options: {
  shiftRecordIds?: number[];
  dateStr?: string;
  shiftType?: ShiftType;
  force?: boolean;
}): Promise<SegmentFetchResult> {
  const pool = getPool();
  const config = getEnvConfig();
  const jobController = getJobController('segments');
  if (jobController.isCancelled()) jobController.reset();
  const signal = jobController.signal;
  const result: SegmentFetchResult = {
    recordsProcessed: 0,
    recordsSkipped: 0,
    errors: [],
  };

  logger.info('[SegmentFetch] Start', options);

  // 1. Find onsite shift_records
  let records: ShiftRecordRow[];
  if (options.shiftRecordIds && options.shiftRecordIds.length > 0) {
    const res = await pool.query<ShiftRecordRow>(`
      SELECT id, vehicle_id, reg_number, shift_start, shift_end, object_uid
      FROM dump_trucks.shift_records
      WHERE id = ANY($1) AND work_type = 'onsite'
    `, [options.shiftRecordIds]);
    records = res.rows;
  } else if (options.dateStr && options.shiftType) {
    const res = await pool.query<ShiftRecordRow>(`
      SELECT id, vehicle_id, reg_number, shift_start, shift_end, object_uid
      FROM dump_trucks.shift_records
      WHERE report_date = $1 AND shift_type = $2 AND work_type = 'onsite'
    `, [options.dateStr, options.shiftType]);
    records = res.rows;
  } else {
    logger.warn('[SegmentFetch] No shiftRecordIds or dateStr+shiftType provided');
    return result;
  }

  logger.info(`[SegmentFetch] Found ${records.length} onsite records`);

  if (records.length === 0) return result;

  // 2. Skip records that already have segments (unless force)
  if (!options.force) {
    const existingIds = await getRecordIdsWithSegments(pool, records.map(r => r.id));
    const before = records.length;
    records = records.filter(r => !existingIds.has(r.id));
    result.recordsSkipped = before - records.length;
    if (result.recordsSkipped > 0) {
      logger.info(`[SegmentFetch] Skipped ${result.recordsSkipped} records (already have segments)`);
    }
  }

  if (records.length === 0) {
    logger.info('[SegmentFetch] Nothing to process');
    return result;
  }

  // 3. Load dt_boundary zones
  let allZones: GeoZone[];
  try {
    allZones = await getAllDtZones(pool);
  } catch (err) {
    const msg = `Failed to load zones: ${String(err)}`;
    logger.error(`[SegmentFetch] ${msg}`);
    result.errors.push(msg);
    return result;
  }
  const boundaryZones = allZones.filter(z => z.tag === 'dt_boundary');

  // 4. Create TIS client with own rate limiter
  if (config.tisApiTokens.length === 0) {
    result.errors.push('TIS_API_TOKENS not configured');
    return result;
  }
  const tisClient = new TisClient({
    baseUrl:     config.tisApiUrl,
    tokenPool:   new TokenPool(config.tisApiTokens),
    rateLimiter: new PerVehicleRateLimiter(30_000),
  });

  // 5. Process vehicles with concurrency
  const maxConcurrency = Math.min(config.tisApiTokens.length, records.length);

  await runWithConcurrency(records, async (record) => {
    if (jobController.isCancelled()) return;
    try {
      const segments = await fetchSegmentsForRecord(tisClient, record, boundaryZones, signal);

      // Save in transaction
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        await replaceSegments(dbClient, record.id, segments);
        await dbClient.query('COMMIT');
        result.recordsProcessed++;
        logger.info(`[SegmentFetch] Record ${record.id} (idMO=${record.vehicle_id}): saved ${segments.length} segments`);
      } catch (dbErr) {
        await dbClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        dbClient.release();
      }
    } catch (err) {
      if (isCancelledError(err)) {
        logger.info(`[SegmentFetch] Cancelled (caught) record=${record.id}`);
        return;
      }
      const msg = `Record ${record.id} (idMO=${record.vehicle_id}): ${String(err)}`;
      logger.error(`[SegmentFetch] ${msg}`);
      result.errors.push(msg);
    }
  }, maxConcurrency);

  if (jobController.isCancelled()) {
    logger.info(`[SegmentFetch] Cancelled. processed=${result.recordsProcessed} skipped=${result.recordsSkipped}`);
    result.errors.push('cancelled');
  }
  logger.info(`[SegmentFetch] Done: processed=${result.recordsProcessed} skipped=${result.recordsSkipped} errors=${result.errors.length}`);
  return result;
}

/**
 * Fetch 24 segments for one shift record.
 */
async function fetchSegmentsForRecord(
  tisClient: TisClient,
  record: ShiftRecordRow,
  boundaryZones: GeoZone[],
  signal?: AbortSignal,
): Promise<ShiftSegment[]> {
  const segments: ShiftSegment[] = [];
  const shiftStartMs = record.shift_start.getTime();

  // Filter boundary zones for this record's object
  const objectBoundaryZones = boundaryZones.filter(z => z.objectUid === record.object_uid);

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    if (signal?.aborted) throw new CancelledError();
    const segStart = new Date(shiftStartMs + i * SEGMENT_DURATION_MIN * 60 * 1000);
    const segEnd = new Date(shiftStartMs + (i + 1) * SEGMENT_DURATION_MIN * 60 * 1000);

    let engineTimeSec = 0;
    let movingTimeSec = 0;
    let distanceKm = 0;
    let trackPointsCount = 0;
    let inBoundary = false;

    try {
      const monitoring = await tisClient.getMonitoringStats(record.vehicle_id, segStart, segEnd, signal);

      if (monitoring) {
        engineTimeSec = monitoring.engineTime ?? 0;
        movingTimeSec = monitoring.movingTime ?? 0;
        distanceKm = Number(monitoring.distance ?? 0);
        const track = monitoring.track || [];
        trackPointsCount = track.length;

        // Check if any track points are in object boundary
        if (track.length > 0 && objectBoundaryZones.length > 0) {
          const zoneEvents = analyzeZones(track, objectBoundaryZones);
          inBoundary = zoneEvents.length > 0;
        }
      }
    } catch (err) {
      logger.warn(`[SegmentFetch] idMO=${record.vehicle_id} seg=${i}: TIS error: ${String(err)}`);
      // Save segment with zeros
    }

    segments.push({
      segmentIndex: i,
      segmentStart: segStart,
      segmentEnd: segEnd,
      engineTimeSec,
      movingTimeSec,
      inBoundary,
      distanceKm,
      trackPointsCount,
    });
  }

  return segments;
}

/**
 * Simple concurrency pool using Promise.race.
 */
async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  maxConcurrency: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = fn(item).then(() => { executing.delete(p); });
    executing.add(p);

    if (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}
