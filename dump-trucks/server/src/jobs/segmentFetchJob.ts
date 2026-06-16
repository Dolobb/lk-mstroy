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
import { getJobController, isCancelledError, CancelledError, abortableSleep } from '../services/jobController';
import { ensureTask, markRunning, markDone, markFailed } from '../services/ledgerClient';
import type { ShiftSegment, GeoZone, ShiftType } from '../types/domain';

const SEGMENT_COUNT = 24;
const SEGMENT_DURATION_MIN = 30;
const DEFAULT_RECORD_CONCURRENCY = 5;
const DIRECT_FETCH_COOLDOWN_MS = 32_000;

const lastDirectFetchByIdMO = new Map<number, number>();
const directFetchLocks = new Map<number, Promise<void>>();

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
  report_date: string;   // YYYY-MM-DD (для ledger unit_key)
  shift_type: string;    // shift1 | shift2
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
      SELECT id, vehicle_id, reg_number, shift_start, shift_end, object_uid,
             to_char(report_date, 'YYYY-MM-DD') AS report_date, shift_type
      FROM dump_trucks.shift_records
      WHERE id = ANY($1) AND work_type = 'onsite'
    `, [options.shiftRecordIds]);
    records = res.rows;
  } else if (options.dateStr && options.shiftType) {
    const res = await pool.query<ShiftRecordRow>(`
      SELECT id, vehicle_id, reg_number, shift_start, shift_end, object_uid,
             to_char(report_date, 'YYYY-MM-DD') AS report_date, shift_type
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
    const skippedExisting = before - records.length;
    result.recordsSkipped += skippedExisting;
    if (skippedExisting > 0) {
      logger.info(`[SegmentFetch] Skipped ${skippedExisting} records (already have segments)`);
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
  const segmentTokens = tisClient.tokens.getAll();
  if (segmentTokens.length < SEGMENT_COUNT) {
    logger.warn(`[SegmentFetch] Only ${segmentTokens.length} tokens configured for ${SEGMENT_COUNT} segments; records will need multiple 30s waves`);
  }

  // 5. Process vehicles with concurrency
  const maxConcurrency = Math.min(config.fetchConcurrency ?? DEFAULT_RECORD_CONCURRENCY, records.length);
  logger.info(`[SegmentFetch] Worker pool: concurrency=${maxConcurrency} (tokens=${segmentTokens.length}, records=${records.length})`);

  await runWithConcurrencyByKey(records, record => record.vehicle_id, async (record) => {
    if (jobController.isCancelled()) return;

    // Ledger write-through (dt-segments): делает выгрузку сегментов видимой.
    // Best-effort. Контракт — INGEST_LEDGER_SPEC.md.
    const ledgerTaskId = await ensureTask({
      pipeline: 'dt-segments',
      unitKey: `${record.vehicle_id}|${record.report_date}|${record.shift_type}`,
      targetDate: record.report_date,
      shiftType: record.shift_type,
      vehicleRef: String(record.vehicle_id),
      vehicleLabel: record.reg_number ?? undefined,
    });
    if (ledgerTaskId != null) await markRunning(ledgerTaskId);

    try {
      const fetchStartedAt = Date.now();
      const segments = await withVehicleDirectFetchSlot(record.vehicle_id, signal, () =>
        fetchSegmentsForRecord(tisClient, record, boundaryZones, segmentTokens, signal)
      );
      const fetchElapsedSec = ((Date.now() - fetchStartedAt) / 1000).toFixed(1);

      // Save in transaction
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');
        await replaceSegments(dbClient, record.id, segments);
        await dbClient.query('COMMIT');
        result.recordsProcessed++;
        logger.info(`[SegmentFetch] Record ${record.id} (idMO=${record.vehicle_id}): saved ${segments.length} segments in ${fetchElapsedSec}s`);
      } catch (dbErr) {
        await dbClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        dbClient.release();
      }

      if (ledgerTaskId != null) {
        const withData = segments.filter(s => s.trackPointsCount > 0 || s.engineTimeSec > 0).length;
        const inBoundary = segments.filter(s => s.inBoundary).length;
        await markDone(ledgerTaskId, { segments: segments.length, withData, inBoundary });
      }
    } catch (err) {
      if (isCancelledError(err)) {
        logger.info(`[SegmentFetch] Cancelled (caught) record=${record.id}`);
        if (ledgerTaskId != null) await markFailed(ledgerTaskId, 'cancelled', 'job cancelled');
        return;
      }
      const msg = `Record ${record.id} (idMO=${record.vehicle_id}): ${String(err)}`;
      logger.error(`[SegmentFetch] ${msg}`);
      result.errors.push(msg);
      if (ledgerTaskId != null) await markFailed(ledgerTaskId, 'internal_error', err instanceof Error ? err.message : String(err));
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
  tokens: string[],
  signal?: AbortSignal,
): Promise<ShiftSegment[]> {
  const segments: ShiftSegment[] = [];
  const shiftStartMs = record.shift_start.getTime();

  // Filter boundary zones for this record's object
  const objectBoundaryZones = boundaryZones.filter(z => z.objectUid === record.object_uid);

  const windows = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
    index: i,
    start: new Date(shiftStartMs + i * SEGMENT_DURATION_MIN * 60 * 1000),
    end: new Date(shiftStartMs + (i + 1) * SEGMENT_DURATION_MIN * 60 * 1000),
  }));

  const chunkSize = Math.max(1, tokens.length);
  for (let offset = 0; offset < windows.length; offset += chunkSize) {
    if (signal?.aborted) throw new CancelledError();
    const chunk = windows.slice(offset, offset + chunkSize);
    const chunkSegments = await Promise.all(chunk.map(async (win, idx) => {
      let engineTimeSec = 0;
      let movingTimeSec = 0;
      let distanceKm = 0;
      let trackPointsCount = 0;
      let inBoundary = false;

      try {
        const token = tokens[idx]!;
        const monitoring = await tisClient.getMonitoringStatsDirect(
          token,
          record.vehicle_id,
          win.start,
          win.end,
          signal,
        );

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
        logger.warn(`[SegmentFetch] idMO=${record.vehicle_id} seg=${win.index}: TIS error: ${String(err)}`);
        // Save segment with zeros
      }

      return {
        segmentIndex: win.index,
        segmentStart: win.start,
        segmentEnd: win.end,
        engineTimeSec,
        movingTimeSec,
        inBoundary,
        distanceKm,
        trackPointsCount,
      };
    }));

    segments.push(...chunkSegments);

    if (offset + chunkSize < windows.length) {
      await abortableSleep(32_000, signal);
    }
  }

  return segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
}

async function withVehicleDirectFetchSlot<T>(
  idMO: number,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = directFetchLocks.get(idMO) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  directFetchLocks.set(idMO, tail);

  await previous.catch(() => undefined);

  try {
    const lastFetch = lastDirectFetchByIdMO.get(idMO) ?? 0;
    const remaining = DIRECT_FETCH_COOLDOWN_MS - (Date.now() - lastFetch);
    if (remaining > 0) {
      await abortableSleep(remaining, signal);
    }

    const result = await fn();
    lastDirectFetchByIdMO.set(idMO, Date.now());
    return result;
  } finally {
    release();
    if (directFetchLocks.get(idMO) === tail) {
      directFetchLocks.delete(idMO);
    }
  }
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

async function runWithConcurrencyByKey<T, K>(
  items: T[],
  keyFn: (item: T) => K,
  fn: (item: T) => Promise<void>,
  maxConcurrency: number,
): Promise<void> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  await runWithConcurrency(Array.from(groups.values()), async (group) => {
    for (const item of group) {
      await fn(item);
    }
  }, maxConcurrency);
}
