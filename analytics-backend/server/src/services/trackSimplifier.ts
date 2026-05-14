import { haversineMeters } from '../utils/geo';

export interface RawTrackPoint {
  lat: number;
  lng: number;
  ts: number;
  speed?: number;
  heading?: number;
}

export interface SimplifiedPoint extends RawTrackPoint {
  engineOn: boolean;
  motionStatus: 'moving' | 'idle';
}

const MIN_TIME_BETWEEN_POINTS_S = 300;
const MIN_DISTANCE_FOR_SKIP_M = 50;
const MOVING_SPEED_THRESHOLD_KMH = 2;
const ENGINE_WARMUP_WINDOW_S = 120;

export function simplifyTrack(points: RawTrackPoint[], ignitionWork?: boolean): SimplifiedPoint[] {
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

    result.push({
      ...curr,
      engineOn: engineOnHeuristic(curr, points, ignitionWork),
      motionStatus: classifyMotion(curr),
    });
  }

  const last = points[points.length - 1];
  if (result.length === 0 || result[result.length - 1].ts !== last.ts) {
    result.push({
      ...last,
      engineOn: engineOnHeuristic(last, points, ignitionWork),
      motionStatus: classifyMotion(last),
    });
  }

  return result;
}

function engineOnHeuristic(
  p: RawTrackPoint,
  allPoints: RawTrackPoint[],
  ignitionWork?: boolean,
): boolean {
  if (ignitionWork !== undefined) return ignitionWork;
  if ((p.speed ?? 0) > 0) return true;

  const hasNearbyMotion = allPoints.some(
    q => Math.abs(q.ts - p.ts) <= ENGINE_WARMUP_WINDOW_S && (q.speed ?? 0) > 0,
  );
  if (hasNearbyMotion) return true;

  return false;
}

function classifyMotion(p: RawTrackPoint): 'moving' | 'idle' {
  return (p.speed ?? 0) > MOVING_SPEED_THRESHOLD_KMH ? 'moving' : 'idle';
}
