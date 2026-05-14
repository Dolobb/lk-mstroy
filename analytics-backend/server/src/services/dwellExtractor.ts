import { SimplifiedPoint } from './trackSimplifier';
import { haversineMeters } from '../utils/geo';

export interface TrackPoint {
  lat: number;
  lng: number;
  ts: number;
  speed: number | null;
  heading: number | null;
  engineOn: boolean;
  motionStatus: 'moving' | 'idle' | 'dwell';
  dwellSec: number | null;
}

const DWELL_RADIUS_M = 50;
const DWELL_MIN_DURATION_S = 300;
const DWELL_MAX_GAP_S = 7200;

function toTrackPoint(p: SimplifiedPoint, motionStatus: 'moving' | 'idle' | 'dwell', dwellSec: number | null = null): TrackPoint {
  return {
    lat: p.lat,
    lng: p.lng,
    ts: p.ts,
    speed: p.speed ?? null,
    heading: p.heading ?? null,
    engineOn: p.engineOn,
    motionStatus,
    dwellSec,
  };
}

export function extractDwells(points: SimplifiedPoint[]): TrackPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [toTrackPoint(points[0], points[0].motionStatus)];
  }

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
      if (i - clusterStart >= 2) {
        clusters.push({ start: clusterStart, end: i - 1 });
      }
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
      for (let j = c.start; j <= c.end; j++) {
        dwellIndices.add(j);
      }
    }
  }

  const result: TrackPoint[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (dwellIndices.has(i)) {
      let j = i;
      while (j < sorted.length && dwellIndices.has(j)) j++;
      const durationS = sorted[j - 1].ts - sorted[i].ts;

      const clusterLat = avg(sorted.slice(i, j).map(p => p.lat));
      const clusterLng = avg(sorted.slice(i, j).map(p => p.lng));

      result.push(toTrackPoint(
        { ...sorted[i], lat: clusterLat, lng: clusterLng, speed: sorted[i].speed },
        'dwell',
        Math.round(durationS),
      ));
      i = j;
    } else {
      result.push(toTrackPoint(sorted[i], sorted[i].motionStatus));
      i++;
    }
  }

  return result;
}

function avg(nums: number[]): number {
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}
