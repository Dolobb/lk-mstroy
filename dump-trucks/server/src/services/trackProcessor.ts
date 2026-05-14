/**
 * Track Processor — упрощение GPS-трека + извлечение стоянок.
 *
 * SYNC WITH analytics-backend/server/src/services/trackSimplifier.ts
 * and dwellExtractor.ts — пороги и алгоритмы должны совпадать.
 * Изменения в любом из файлов требуют синхронизации с другим.
 */
import { Pool } from 'pg';
import type { TisTrackPoint } from '../types/tis-api';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';
import { logger } from '../utils/logger';

interface RawPoint {
  lat: number;
  lng: number;
  ts: number;
  speed?: number;
  heading?: number;
}

interface SimplifiedPoint extends RawPoint {
  engineOn: boolean;
  motionStatus: 'moving' | 'idle';
}

export interface SerializedTrackPoint {
  ts: number;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  engineOn: boolean;
  motionStatus: 'moving' | 'idle' | 'dwell';
  dwellSec: number | null;
}

const MIN_TIME_BETWEEN_POINTS_S = 300;
const MIN_DISTANCE_FOR_SKIP_M = 50;
const MOVING_SPEED_THRESHOLD_KMH = 2;
const ENGINE_WARMUP_WINDOW_S = 120;
const DWELL_RADIUS_M = 50;
const DWELL_MIN_DURATION_S = 300;
const DWELL_MAX_GAP_S = 7200;

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseTrackPoints(raw: TisTrackPoint[]): RawPoint[] {
  const result: RawPoint[] = [];
  for (const p of raw) {
    const dt = parseDdMmYyyyHhmm(p.time);
    if (!dt) continue;
    result.push({
      lat: p.lat,
      lng: p.lon,
      ts: Math.floor(dt.getTime() / 1000),
      speed: p.speed,
      heading: p.direction,
    });
  }
  result.sort((a, b) => a.ts - b.ts);
  return result;
}

function engineOnHeuristic(
  p: RawPoint,
  all: RawPoint[],
  ignitionWork?: boolean,
): boolean {
  if (ignitionWork !== undefined) return ignitionWork;
  if ((p.speed ?? 0) > 0) return true;
  const hasNearbyMotion = all.some(
    q => Math.abs(q.ts - p.ts) <= ENGINE_WARMUP_WINDOW_S && (q.speed ?? 0) > 0,
  );
  return hasNearbyMotion;
}

function classifyMotion(p: RawPoint): 'moving' | 'idle' {
  return (p.speed ?? 0) > MOVING_SPEED_THRESHOLD_KMH ? 'moving' : 'idle';
}

function simplifyTrack(points: RawPoint[], ignitionWork?: boolean): SimplifiedPoint[] {
  if (points.length <= 2) {
    return points.map(p => ({
      ...p,
      engineOn: engineOnHeuristic(p, points, ignitionWork),
      motionStatus: 'idle' as const,
    }));
  }

  const result: SimplifiedPoint[] = [
    { ...points[0], engineOn: engineOnHeuristic(points[0], points, ignitionWork), motionStatus: classifyMotion(points[0]) },
  ];

  for (let i = 1; i < points.length - 1; i++) {
    const last = result[result.length - 1];
    const curr = points[i];
    const timeDelta = curr.ts - last.ts;
    const distance = haversineMeters(last.lat, last.lng, curr.lat, curr.lng);
    const speed = curr.speed ?? 0;
    const lastSpeed = last.speed ?? 0;

    if (speed > MOVING_SPEED_THRESHOLD_KMH || lastSpeed > MOVING_SPEED_THRESHOLD_KMH) {
      result.push({ ...curr, engineOn: true, motionStatus: 'moving' });
      continue;
    }

    if (timeDelta < MIN_TIME_BETWEEN_POINTS_S && distance < MIN_DISTANCE_FOR_SKIP_M) {
      continue;
    }

    result.push({ ...curr, engineOn: engineOnHeuristic(curr, points, ignitionWork), motionStatus: classifyMotion(curr) });
  }

  const last = points[points.length - 1];
  if (result.length === 0 || result[result.length - 1].ts !== last.ts) {
    result.push({ ...last, engineOn: engineOnHeuristic(last, points, ignitionWork), motionStatus: classifyMotion(last) });
  }

  return result;
}

function avg(nums: number[]): number {
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function extractDwells(points: SimplifiedPoint[]): SerializedTrackPoint[] {
  const toTP = (p: SimplifiedPoint, ms: 'moving' | 'idle' | 'dwell', ds: number | null = null): SerializedTrackPoint => ({
    lat: p.lat, lng: p.lng, ts: p.ts,
    speed: p.speed ?? null, heading: p.heading ?? null,
    engineOn: p.engineOn, motionStatus: ms, dwellSec: ds,
  });

  if (points.length === 0) return [];
  if (points.length === 1) return [toTP(points[0], points[0].motionStatus)];

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const clusters: Array<{ start: number; end: number }> = [];
  let clusterStart = 0;

  for (let i = 1; i < sorted.length; i++) {
    const dist = haversineMeters(
      sorted[i - 1].lat, sorted[i - 1].lng,
      sorted[i].lat, sorted[i].lng,
    );
    const timeGap = sorted[i].ts - sorted[i - 1].ts;
    if (dist > DWELL_RADIUS_M || timeGap > DWELL_MAX_GAP_S) {
      if (i - clusterStart >= 2) clusters.push({ start: clusterStart, end: i - 1 });
      clusterStart = i;
    }
  }
  if (sorted.length - clusterStart >= 2) {
    clusters.push({ start: clusterStart, end: sorted.length - 1 });
  }

  const dwellIndices = new Set<number>();
  for (const c of clusters) {
    const durationS = sorted[c.end].ts - sorted[c.start].ts;
    if (durationS >= DWELL_MIN_DURATION_S) {
      for (let j = c.start; j <= c.end; j++) dwellIndices.add(j);
    }
  }

  const result: SerializedTrackPoint[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (dwellIndices.has(i)) {
      let j = i;
      while (j < sorted.length && dwellIndices.has(j)) j++;
      const durationS = sorted[j - 1].ts - sorted[i].ts;
      const clusterLat = avg(sorted.slice(i, j).map(p => p.lat));
      const clusterLng = avg(sorted.slice(i, j).map(p => p.lng));
      result.push(toTP({ ...sorted[i], lat: clusterLat, lng: clusterLng, speed: sorted[i].speed }, 'dwell', Math.round(durationS)));
      i = j;
    } else {
      result.push(toTP(sorted[i], sorted[i].motionStatus));
      i++;
    }
  }

  return result;
}

export function processTrack(
  track: TisTrackPoint[],
  ignitionWork?: boolean,
): SerializedTrackPoint[] {
  if (!track || track.length < 2) return [];
  const parsed = parseTrackPoints(track);
  if (parsed.length < 2) return [];
  const simplified = simplifyTrack(parsed, ignitionWork);
  return extractDwells(simplified);
}

export async function saveTrackForShift(
  pool: Pool,
  shiftRecordId: number,
  vehicleRegNumber: string,
  date: string,
  points: SerializedTrackPoint[],
): Promise<void> {
  if (points.length === 0) return;
  try {
    await pool.query(
      `DELETE FROM dump_trucks.dt_tracks WHERE vehicle_id = $1 AND date = $2`,
      [vehicleRegNumber, date],
    );
    await pool.query(
      `INSERT INTO dump_trucks.dt_tracks (shift_record_id, vehicle_id, date, track_simplified)
       VALUES ($1, $2, $3, $4)`,
      [shiftRecordId, vehicleRegNumber, date, JSON.stringify(points)],
    );
    logger.info(`[TrackProcessor] Saved ${points.length} points for ${vehicleRegNumber} date=${date} shift_record_id=${shiftRecordId}`);
  } catch (err) {
    logger.error(`[TrackProcessor] Failed to save track for ${vehicleRegNumber}: ${String(err)}`);
  }
}
