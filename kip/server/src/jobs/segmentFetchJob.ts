/**
 * KIP Segment Fetch Job — parallel 30-min segment loading.
 *
 * Strategy: 24 tokens × 24 segments fired simultaneously via Promise.all.
 * ~5 seconds per vehicle instead of ~12 minutes sequential.
 *
 * Cooldown: 32s per idMO (TIS rate limit = 30s per token+idMO pair,
 * but different tokens for same idMO are fine — cooldown only matters
 * when the SAME idMO is fetched again in a subsequent job).
 */

import { getPool } from '../config/database';
import { getEnvConfig } from '../config/env';
import { TisClient } from '../services/tisClient';
import { TokenPool } from '../services/tokenPool';
import { PerVehicleRateLimiter } from '../services/rateLimiter';
import { replaceSegments } from '../repositories/segmentRepo';
import { logger } from '../utils/logger';
import type { KipShiftSegment } from '../types/domain';
import {
  markRunning,
  updateProgress,
  markDone,
  markError,
  hasSlot,
  nextQueued,
  setMaxConcurrent,
  setProcessQueueFn,
  setCooldownChecker,
  setNextCooldownFn,
} from './segmentProgress';
import { getJobController, isCancelledError, abortableSleep } from '../services/jobController';

const SEGMENT_COUNT = 24;
const SEGMENT_DURATION_MIN = 30;
const COOLDOWN_MS = 32_000; // 30s rate limit + 2s safety

// Shift windows (Yekaterinburg local, but stored as UTC)
const SHIFT_HOURS: Record<string, { startH: number; startM: number }> = {
  morning: { startH: 7, startM: 30 },
  evening: { startH: 19, startM: 30 },
};

/* ─── Cooldown tracker ─── */

const lastFetchByIdMO = new Map<number, number>();

function canFetchNow(idMO: number): boolean {
  const last = lastFetchByIdMO.get(idMO) ?? 0;
  return Date.now() - last >= COOLDOWN_MS;
}

async function waitCooldown(idMO: number, signal?: AbortSignal): Promise<void> {
  const last = lastFetchByIdMO.get(idMO) ?? 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    logger.info(`[KipSegmentFetch] Waiting ${Math.ceil(remaining / 1000)}s cooldown for idMO=${idMO}`);
    await abortableSleep(remaining, signal);
  }
}

function markCooldown(idMO: number): void {
  lastFetchByIdMO.set(idMO, Date.now());
}

/** Returns ms until the nearest cooldown expires, or null. */
function nextCooldownExpiry(): number | null {
  let shortest: number | null = null;
  const now = Date.now();
  for (const [, ts] of lastFetchByIdMO) {
    const remaining = COOLDOWN_MS - (now - ts);
    if (remaining > 0 && (shortest === null || remaining < shortest)) {
      shortest = remaining;
    }
  }
  return shortest;
}


/* ─── TIS Client singleton ─── */

let tisClient: TisClient | null = null;

function getTisClient(): TisClient {
  if (!tisClient) {
    const config = getEnvConfig();
    tisClient = new TisClient({
      baseUrl: config.tisApiUrl,
      tokenPool: new TokenPool(config.tisApiTokens),
      rateLimiter: new PerVehicleRateLimiter(config.rateLimitPerVehicleMs),
    });

    // Segment jobs use all tokens per vehicle. Keep legacy one-at-a-time default,
    // but allow controlled stress tests via FETCH_CONCURRENCY.
    setMaxConcurrent(config.fetchConcurrency ?? 1);

    // Register cooldown checker for smart queue
    setCooldownChecker(canFetchNow);
    setNextCooldownFn(nextCooldownExpiry);
  }
  return tisClient;
}

/* ─── Helpers ─── */

async function findIdMO(regNumber: string): Promise<number | null> {
  const pool = getPool();
  const result = await pool.query<{ id_mo: number }>(
    `SELECT DISTINCT v.id_mo FROM vehicles v
     JOIN route_lists rl ON v.route_list_id = rl.id
     WHERE v.reg_number = $1 AND v.id_mo IS NOT NULL
     LIMIT 1`,
    [regNumber],
  );
  return result.rows[0]?.id_mo ?? null;
}

function buildShiftStart(reportDate: string, shiftType: string): Date {
  const hours = SHIFT_HOURS[shiftType] ?? SHIFT_HOURS.morning!;
  const [y, m, d] = reportDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, hours.startH - 5, hours.startM));
  return dt;
}

/* ─── Main fetch function ─── */

/**
 * Fetch 24 segments for one vehicle/date/shift — all in parallel.
 */
export async function fetchKipSegments(
  vehicleId: string,
  date: string,
  shiftType: string,
): Promise<void> {
  const client = getTisClient();
  const pool = getPool();
  const jobController = getJobController('segments');
  if (jobController.isCancelled()) jobController.reset();
  const signal = jobController.signal;

  markRunning(vehicleId, date, shiftType);

  try {
    if (jobController.isCancelled()) {
      markError(vehicleId, date, shiftType, 'cancelled');
      return;
    }

    // 1. Find idMO
    const idMO = await findIdMO(vehicleId);
    if (!idMO) {
      throw new Error(`No id_mo found for vehicle ${vehicleId}`);
    }

    // 2. Wait cooldown for this idMO
    await waitCooldown(idMO, signal);

    // 3. Get all tokens
    const allTokens = client.tokens.getAll();
    const tokenCount = allTokens.length;

    // 4. Build 24 segment windows
    const shiftStart = buildShiftStart(date, shiftType);
    const windows = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
      index: i,
      start: new Date(shiftStart.getTime() + i * SEGMENT_DURATION_MIN * 60_000),
      end: new Date(shiftStart.getTime() + (i + 1) * SEGMENT_DURATION_MIN * 60_000),
    }));

    // 5. Fire all 24 requests in parallel, each with its own token
    let done = 0;
    const fetchStart = Date.now();

    const results = await Promise.all(
      windows.map(async (win) => {
        const token = allTokens[win.index % tokenCount]!;

        let engineTimeSec = 0;
        let movingTimeSec = 0;
        let distanceKm = 0;
        let trackPointsCount = 0;

        try {
          const monitoring = await client.getMonitoringStatsDirect(
            token, idMO, win.start, win.end, signal,
          );

          if (monitoring) {
            engineTimeSec = monitoring.engineTime ?? 0;
            movingTimeSec = monitoring.movingTime ?? 0;
            distanceKm = Number(monitoring.distance ?? 0);
            trackPointsCount = (monitoring.track || []).length;
          }
        } catch (err) {
          logger.warn(`[KipSegmentFetch] vehicle=${vehicleId} seg=${win.index}: TIS error: ${String(err)}`);
        }

        done++;
        updateProgress(vehicleId, date, shiftType, done);

        return {
          segmentIndex: win.index,
          segmentStart: win.start,
          segmentEnd: win.end,
          engineTimeSec,
          movingTimeSec,
          distanceKm,
          trackPointsCount,
        } satisfies KipShiftSegment;
      }),
    );

    // 6. Mark cooldown AFTER all requests complete
    markCooldown(idMO);

    const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
    logger.info(`[KipSegmentFetch] Fetched ${results.length} segments for ${vehicleId} ${date} ${shiftType} in ${elapsed}s (${tokenCount} tokens)`);

    // 7. Save in transaction
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');
      await replaceSegments(dbClient, vehicleId, date, shiftType, results);
      await dbClient.query('COMMIT');
    } catch (dbErr) {
      await dbClient.query('ROLLBACK');
      throw dbErr;
    } finally {
      dbClient.release();
    }

    markDone(vehicleId, date, shiftType);
  } catch (err) {
    if (isCancelledError(err)) {
      markError(vehicleId, date, shiftType, 'cancelled');
      logger.info(`[KipSegmentFetch] Cancelled for ${vehicleId} ${date} ${shiftType}`);
      return;
    }
    markError(vehicleId, date, shiftType, String(err));
    logger.error(`[KipSegmentFetch] Failed for ${vehicleId} ${date} ${shiftType}: ${String(err)}`);
  }

  // Process next in queue (unless cancellation was requested)
  if (!getJobController('segments').isCancelled()) {
    processQueue();
  }
}

/* ─── Queue processor ─── */

function processQueue(): void {
  while (hasSlot()) {
    const next = nextQueued();
    if (!next) break;
    // Fire async — don't await
    fetchKipSegments(next.vehicleId, next.date, next.shift);
  }
}

// Register the queue processor
setProcessQueueFn(processQueue);
