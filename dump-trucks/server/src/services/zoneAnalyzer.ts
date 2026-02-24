/**
 * Zone Analyzer
 * Анализирует GPS-трек (TisTrackPoint[]) против геозон (GeoZone[]).
 * Возвращает события входа/выхода из каждой зоны.
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { TisTrackPoint } from '../types/tis-api';
import type { GeoZone, ZoneEvent } from '../types/domain';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

export function analyzeZones(
  track: TisTrackPoint[],
  zones: GeoZone[],
): ZoneEvent[] {
  if (track.length === 0 || zones.length === 0) return [];

  const events: ZoneEvent[] = [];

  for (const zone of zones) {
    let insideFrom: Date | null = null;

    for (const pt of track) {
      const timestamp = parseDdMmYyyyHhmm(pt.time);
      if (!timestamp) continue;

      const turfPoint = point([pt.lon, pt.lat]);
      const inside = booleanPointInPolygon(turfPoint, zone.geojson);

      if (inside && insideFrom === null) {
        // Вошли в зону
        insideFrom = timestamp;
      } else if (!inside && insideFrom !== null) {
        // Вышли из зоны
        const durationSec = Math.round((timestamp.getTime() - insideFrom.getTime()) / 1000);
        events.push({
          zoneUid:     zone.uid,
          zoneName:    zone.name,
          zoneTag:     zone.tag,
          objectUid:   zone.objectUid,
          enteredAt:   insideFrom,
          exitedAt:    timestamp,
          durationSec,
        });
        insideFrom = null;
      }
    }

    // Если трек закончился внутри зоны
    if (insideFrom !== null && track.length > 0) {
      const lastPt = track[track.length - 1];
      const lastTime = parseDdMmYyyyHhmm(lastPt.time);
      const durationSec = lastTime
        ? Math.round((lastTime.getTime() - insideFrom.getTime()) / 1000)
        : null;
      events.push({
        zoneUid:     zone.uid,
        zoneName:    zone.name,
        zoneTag:     zone.tag,
        objectUid:   zone.objectUid,
        enteredAt:   insideFrom,
        exitedAt:    lastTime,
        durationSec,
      });
    }
  }

  // Сортируем по времени входа
  events.sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

  return events;
}

/**
 * Суммарное время в зоне boundary (onsite) в секундах
 */
export function calcOnsiteSec(events: ZoneEvent[], objectUid: string): number {
  return events
    .filter(e => e.zoneTag === 'dt_boundary' && e.objectUid === objectUid)
    .reduce((acc, e) => acc + (e.durationSec ?? 0), 0);
}
