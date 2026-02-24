/**
 * Vehicle Detector
 * Определяет, на каком объекте работает ТС.
 *
 * Логика:
 * 1. Грузим все объекты с dt_* зонами из БД (geo.objects + geo.zones)
 * 2. Для каждого объекта проверяем, есть ли трек-точки в dt_boundary
 * 3. Возвращаем объект, в зоне которого максимальное количество точек
 *
 * В тест-режиме: просто возвращаем первый объект с dt_boundary
 * (пока нет реальных треков для матчинга)
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { TisTrackPoint } from '../types/tis-api';
import type { GeoZone } from '../types/domain';

export interface ObjectCandidate {
  objectUid: string;
  objectName: string;
  boundaryZone: GeoZone;
  pointsInside: number;
}

/**
 * Определяет объект по максимальному количеству трек-точек в dt_boundary.
 * Возвращает null если ни одной точки не попало ни в одну зону.
 */
export function detectObject(
  track: TisTrackPoint[],
  zones: GeoZone[],
): ObjectCandidate | null {
  const boundaryZones = zones.filter(z => z.tag === 'dt_boundary');

  if (boundaryZones.length === 0 || track.length === 0) return null;

  let best: ObjectCandidate | null = null;

  for (const zone of boundaryZones) {
    let count = 0;
    for (const pt of track) {
      const turfPoint = point([pt.lon, pt.lat]);
      if (booleanPointInPolygon(turfPoint, zone.geojson)) {
        count++;
      }
    }

    if (count > 0 && (best === null || count > best.pointsInside)) {
      best = {
        objectUid:    zone.objectUid,
        objectName:   zone.name,
        boundaryZone: zone,
        pointsInside: count,
      };
    }
  }

  return best;
}
