/**
 * Filter Repo
 * Получает объекты с dt_* зонами из geo.objects + geo.zones.
 * Используется для определения объектов и загрузки геозон.
 */

import { Pool } from 'pg';
import type { GeoZone, ZoneTag } from '../types/domain';
import { Feature, Polygon, MultiPolygon } from 'geojson';

export interface GeoObject {
  uid: string;
  name: string;
  timezone: string;
  minTripsPerShift: number;
}

/**
 * Возвращает все объекты, у которых есть хотя бы одна dt_* зона.
 */
export async function getDtObjects(pool: Pool): Promise<GeoObject[]> {
  const result = await pool.query<{
    uid: string;
    name: string;
    timezone: string;
    min_trips_per_shift: number;
  }>(`
    SELECT DISTINCT o.uid, o.name, o.timezone, o.min_trips_per_shift
    FROM geo.objects o
    JOIN geo.zones z ON z.object_id = o.id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE zt.tag LIKE 'dt_%'
    ORDER BY o.name
  `);

  return result.rows.map(r => ({
    uid:              r.uid,
    name:             r.name,
    timezone:         r.timezone,
    minTripsPerShift: r.min_trips_per_shift,
  }));
}

/**
 * Загружает все dt_* зоны для заданного объекта.
 * Возвращает GeoZone[] готовых к использованию в Turf.js.
 */
export async function getDtZonesForObject(
  pool: Pool,
  objectUid: string,
): Promise<GeoZone[]> {
  const result = await pool.query<{
    uid: string;
    name: string;
    object_name: string;
    tag: string;
    geojson: string;
    min_duration_sec: number;
  }>(`
    SELECT
      z.uid,
      z.name,
      o.name AS object_name,
      zt.tag,
      ST_AsGeoJSON(z.geom)::text AS geojson,
      z.min_duration_sec
    FROM geo.zones z
    JOIN geo.objects o ON o.id = z.object_id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE o.uid = $1
      AND zt.tag LIKE 'dt_%'
    ORDER BY z.name
  `, [objectUid]);

  return result.rows.map(r => {
    const geomRaw = JSON.parse(r.geojson) as Polygon | MultiPolygon;
    const geojson: Feature<Polygon | MultiPolygon> = {
      type: 'Feature',
      properties: { uid: r.uid, name: r.name },
      geometry: geomRaw,
    };
    return {
      uid:            r.uid,
      name:           r.name,
      objectUid,
      objectName:     r.object_name,
      tag:            r.tag as ZoneTag,
      geojson,
      minDurationSec: r.min_duration_sec,
    };
  });
}

/**
 * Загружает все dt_* зоны для всех объектов сразу.
 */
export async function getAllDtZones(pool: Pool): Promise<GeoZone[]> {
  const result = await pool.query<{
    uid: string;
    name: string;
    object_uid: string;
    object_name: string;
    tag: string;
    geojson: string;
    min_duration_sec: number;
  }>(`
    SELECT
      z.uid,
      z.name,
      o.uid AS object_uid,
      o.name AS object_name,
      zt.tag,
      ST_AsGeoJSON(z.geom)::text AS geojson,
      z.min_duration_sec
    FROM geo.zones z
    JOIN geo.objects o ON o.id = z.object_id
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE zt.tag LIKE 'dt_%'
    ORDER BY o.name, z.name
  `);

  return result.rows.map(r => {
    const geomRaw = JSON.parse(r.geojson) as Polygon | MultiPolygon;
    const geojson: Feature<Polygon | MultiPolygon> = {
      type: 'Feature',
      properties: { uid: r.uid, name: r.name },
      geometry: geomRaw,
    };
    return {
      uid:            r.uid,
      name:           r.name,
      objectUid:      r.object_uid,
      objectName:     r.object_name,
      tag:            r.tag as ZoneTag,
      geojson,
      minDurationSec: r.min_duration_sec,
    };
  });
}

/**
 * Возвращает Map<objectUid, timezone> для всех объектов.
 */
export async function getObjectTimezones(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ uid: string; timezone: string }>(
    'SELECT uid, timezone FROM geo.objects',
  );
  const map = new Map<string, string>();
  for (const r of result.rows) {
    map.set(r.uid, r.timezone);
  }
  return map;
}

/**
 * Возвращает Map<vehicleId, objectUid> — последний известный объект для каждого ТС.
 */
export async function getVehicleLastObjects(pool: Pool): Promise<Map<number, string>> {
  const result = await pool.query<{ vehicle_id: number; object_uid: string }>(`
    SELECT DISTINCT ON (vehicle_id) vehicle_id, object_uid
    FROM dump_trucks.shift_records
    WHERE object_uid IS NOT NULL AND object_uid != 'unknown'
    ORDER BY vehicle_id, report_date DESC, shift_type DESC
  `);
  const map = new Map<number, string>();
  for (const r of result.rows) {
    map.set(r.vehicle_id, r.object_uid);
  }
  return map;
}
