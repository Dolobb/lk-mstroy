import type { TisMonitoringStats, TisTrackPoint } from '../types/tis-api';
import type { ParsedMonitoringRecord } from '../types/domain';
import { secondsToHours } from '../utils/dateFormat';

const TRACK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Simplify track by keeping points at >=20 min intervals.
 * Always includes first and last points.
 */
function parseTrackTime(timeStr: string): number {
  // "DD.MM.YYYY HH:mm:ss" → ms since epoch
  const [datePart, timePart] = timeStr.split(' ');
  const [d, m, y] = datePart.split('.');
  return new Date(`${y}-${m}-${d}T${timePart}`).getTime();
}

function simplifyTrack(
  track: TisTrackPoint[],
): Array<{ lat: number; lon: number; timestamp: string }> {
  if (track.length === 0) return [];

  const result: Array<{ lat: number; lon: number; timestamp: string }> = [];
  result.push({ lat: track[0].lat, lon: track[0].lon, timestamp: track[0].time });

  let lastTimestamp = parseTrackTime(track[0].time);

  for (let i = 1; i < track.length; i++) {
    const pointTime = parseTrackTime(track[i].time);
    if (pointTime - lastTimestamp >= TRACK_INTERVAL_MS) {
      result.push({
        lat: track[i].lat,
        lon: track[i].lon,
        timestamp: track[i].time,
      });
      lastTimestamp = pointTime;
    }
  }

  // Always include the last point
  const lastTrack = track[track.length - 1];
  const lastInResult = result[result.length - 1];
  if (lastInResult.timestamp !== lastTrack.time) {
    result.push({
      lat: lastTrack.lat,
      lon: lastTrack.lon,
      timestamp: lastTrack.time,
    });
  }

  return result;
}

export function parseMonitoringStats(
  stats: TisMonitoringStats,
): ParsedMonitoringRecord {
  const engineOnTime = secondsToHours(stats.engineTime);

  // Sum fuel consumption across all tanks
  const fuelConsumedTotal = stats.fuels.reduce(
    (sum, fuel) => sum + fuel.rate,
    0,
  );

  // Last GPS point for map marker
  const lastPoint = stats.track.length > 0
    ? stats.track[stats.track.length - 1]
    : null;

  const trackSimplified = simplifyTrack(stats.track);

  const fullTrack = stats.track.map(p => ({
    lat: p.lat,
    lon: p.lon,
    timestamp: p.time,
  }));

  return {
    engineOnTime,
    fuelConsumedTotal,
    lastLat: lastPoint?.lat ?? null,
    lastLon: lastPoint?.lon ?? null,
    trackSimplified,
    fullTrack,
  };
}
