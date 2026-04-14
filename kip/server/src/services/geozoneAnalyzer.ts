import { readFileSync } from 'fs';
import { resolve } from 'path';
import { point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import type { Feature, Polygon, FeatureCollection } from 'geojson';
import type { GeozoneResult } from '../types/domain';
import { logger } from '../utils/logger';
import { parseDdMmYyyyHhmm, dayjs } from '../utils/dateFormat';

const GPS_GAP_FILL_RADIUS_M = 500;
const SYNTHETIC_POINT_INTERVAL_MS = 20 * 60 * 1000;

interface GeozoneProperties {
  zoneName: string;
  uid: string;
  zoneGroup: string;
  controlType: number;
}

interface ParsedZone {
  id: string;
  name: string;
  departmentUnit: string;
  feature: Feature<Polygon>;
}

let cachedZones: ParsedZone[] | null = null;

/**
 * Extract department unit from zone name.
 * Returns the full zone name as-is.
 */
function extractDepartmentUnit(zoneName: string): string {
  return zoneName;
}

function loadGeozones(): ParsedZone[] {
  if (cachedZones !== null) return cachedZones;

  const filePath = resolve(__dirname, '../../../config/geozones.geojson');

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn(`Geozones file not found at ${filePath}, geozone analysis disabled`);
    cachedZones = [];
    return cachedZones;
  }

  const collection: FeatureCollection<Polygon, GeozoneProperties> = JSON.parse(raw);

  if (!collection.features || !Array.isArray(collection.features)) {
    logger.warn('Geozones file has no features array');
    cachedZones = [];
    return cachedZones;
  }

  // Only use work-site zones: controlType 1 + zoneName starts with "СМУ"
  cachedZones = collection.features
    .filter(f =>
      f.properties?.controlType === 1 &&
      f.geometry?.type === 'Polygon' &&
      f.properties?.zoneName?.startsWith('СМУ'),
    )
    .map(f => ({
      id: f.properties!.uid,
      name: f.properties!.zoneName,
      departmentUnit: extractDepartmentUnit(f.properties!.zoneName),
      feature: f as Feature<Polygon>,
    }));

  logger.info(`Loaded ${cachedZones.length} geozones (filtered from ${collection.features.length} total features)`);
  return cachedZones;
}

/**
 * Find which zone a point belongs to (or null if outside all zones).
 * Coordinates: lat/lon from TIS track.
 */
function findZone(lat: number, lon: number, zones: ParsedZone[]): ParsedZone | null {
  const pt = point([lon, lat]); // GeoJSON: [longitude, latitude]
  for (const zone of zones) {
    if (booleanPointInPolygon(pt, zone.feature)) {
      return zone;
    }
  }
  return null;
}

/**
 * Return filtered geozones as a GeoJSON FeatureCollection for the client map.
 */
export function getFilteredGeozonesGeoJson(): FeatureCollection<Polygon, GeozoneProperties> {
  const zones = loadGeozones();
  return {
    type: 'FeatureCollection',
    features: zones.map(z => z.feature as Feature<Polygon, GeozoneProperties>),
  };
}

type TrackPoint = { lat: number; lon: number; timestamp: string };

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return distance(point([lon1, lat1]), point([lon2, lat2]), { units: 'meters' });
}

/**
 * Fill gaps in the track with synthetic points when the vehicle stayed in place.
 * For each gap between track[i] and track[i+1]:
 *   - If GPS distance < 500m → vehicle stood still, fill with synthetic points at last known position
 *   - If GPS distance >= 500m → vehicle moved, leave gap as-is
 * No time limit on gap length — only GPS check.
 */
function fillTrackGaps(track: TrackPoint[]): TrackPoint[] {
  if (track.length < 2) return track;

  const result: TrackPoint[] = [track[0]];

  for (let i = 1; i < track.length; i++) {
    const prev = result[result.length - 1];
    const curr = track[i];
    const distM = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);

    if (distM < GPS_GAP_FILL_RADIUS_M) {
      const prevDate = parseDdMmYyyyHhmm(prev.timestamp);
      const currDate = parseDdMmYyyyHhmm(curr.timestamp);
      if (prevDate && currDate) {
        let tMs = prevDate.getTime() + SYNTHETIC_POINT_INTERVAL_MS;
        const endMs = currDate.getTime();
        while (tMs < endMs) {
          result.push({
            lat: prev.lat,
            lon: prev.lon,
            timestamp: dayjs(new Date(tMs)).format('DD.MM.YYYY HH:mm:ss'),
          });
          tMs += SYNTHETIC_POINT_INTERVAL_MS;
        }
      }
    }

    result.push(curr);
  }

  return result;
}

export function analyzeTrackGeozones(
  track: TrackPoint[],
): GeozoneResult {
  const zones = loadGeozones();

  const emptyResult: GeozoneResult = {
    totalStayTime: 0,
    departmentUnit: '',
    outsideZoneTime: 0,
    zoneBreakdown: [],
    zoneExits: [],
    firstZoneId: null,
    lastZoneId: null,
  };

  if (track.length < 2) {
    return emptyResult;
  }

  if (zones.length === 0) {
    return emptyResult;
  }

  const filledTrack = fillTrackGaps(track);

  const zoneTimeMs = new Map<string, number>();
  const zoneExits: GeozoneResult['zoneExits'] = [];

  const pointZones: Array<ParsedZone | null> = filledTrack.map(p => findZone(p.lat, p.lon, zones));

  const firstZoneId: string | null = pointZones[0]?.id ?? null;
  const lastZoneId: string | null = pointZones[pointZones.length - 1]?.id ?? null;

  let outsideMs = 0;

  for (let i = 0; i < filledTrack.length - 1; i++) {
    const d0 = parseDdMmYyyyHhmm(filledTrack[i].timestamp);
    const d1 = parseDdMmYyyyHhmm(filledTrack[i + 1].timestamp);
    if (!d0 || !d1) continue;
    const t0 = d0.getTime();
    const t1 = d1.getTime();
    const intervalMs = t1 - t0;

    if (intervalMs <= 0) continue;

    const z0 = pointZones[i];
    const z1 = pointZones[i + 1];

    if (z0 && z1 && z0.id === z1.id) {
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + intervalMs);
    } else if (z0 && z1 && z0.id !== z1.id) {
      const half = intervalMs / 2;
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + half);
      zoneTimeMs.set(z1.id, (zoneTimeMs.get(z1.id) ?? 0) + half);
      zoneExits.push({ timestamp: filledTrack[i + 1].timestamp, fromZone: z0.name });
    } else if (z0 && !z1) {
      const half = intervalMs / 2;
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + half);
      outsideMs += half;
      zoneExits.push({ timestamp: filledTrack[i + 1].timestamp, fromZone: z0.name });
    } else if (!z0 && z1) {
      const half = intervalMs / 2;
      zoneTimeMs.set(z1.id, (zoneTimeMs.get(z1.id) ?? 0) + half);
      outsideMs += half;
    } else {
      outsideMs += intervalMs;
    }
  }

  const zoneBreakdown: GeozoneResult['zoneBreakdown'] = [];
  for (const zone of zones) {
    const ms = zoneTimeMs.get(zone.id);
    if (ms && ms > 0) {
      zoneBreakdown.push({
        zoneId: zone.id,
        zoneName: zone.name,
        departmentUnit: zone.departmentUnit,
        timeHours: ms / 3_600_000,
      });
    }
  }
  zoneBreakdown.sort((a, b) => b.timeHours - a.timeHours);

  const totalStayTime = zoneBreakdown.reduce((sum, z) => sum + z.timeHours, 0);
  const departmentUnit = zoneBreakdown.length > 0 ? zoneBreakdown[0].departmentUnit : '';

  return {
    totalStayTime,
    departmentUnit,
    outsideZoneTime: outsideMs / 3_600_000,
    zoneBreakdown,
    zoneExits,
    firstZoneId,
    lastZoneId,
  };
}
