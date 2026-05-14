import { parseDdMmYyyyHhmm } from './dateFormat';
import type { TisTrackPoint } from '../types/tis-api';

export interface ParsedTrackPoint {
  lat: number;
  lng: number;
  ts: number;
  speed: number | undefined;
  heading: number | undefined;
}

export function parseTrackPoints(raw: TisTrackPoint[]): ParsedTrackPoint[] {
  const result: ParsedTrackPoint[] = [];

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
