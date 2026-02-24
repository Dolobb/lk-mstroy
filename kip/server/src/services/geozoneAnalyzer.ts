import { readFileSync } from 'fs';
import { resolve } from 'path';
import { point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, Polygon, FeatureCollection } from 'geojson';
import type { GeozoneResult } from '../types/domain';
import { logger } from '../utils/logger';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

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
 * Analyze a vehicle track against geozones.
 * Returns time spent in each zone, dominant department, and zone exits.
 */
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

export function analyzeTrackGeozones(
  track: Array<{ lat: number; lon: number; timestamp: string }>,
): GeozoneResult {
  const zones = loadGeozones();

  const emptyResult: GeozoneResult = {
    totalStayTime: 0,
    departmentUnit: '',
    outsideZoneTime: 0,
    zoneBreakdown: [],
    zoneExits: [],
  };

  if (zones.length === 0 || track.length < 2) {
    return emptyResult;
  }

  // Accumulate time per zone
  const zoneTimeMs = new Map<string, number>();
  const zoneExits: GeozoneResult['zoneExits'] = [];

  // Classify each point
  const pointZones: Array<ParsedZone | null> = track.map(p => findZone(p.lat, p.lon, zones));

  let outsideMs = 0;

  for (let i = 0; i < track.length - 1; i++) {
    const d0 = parseDdMmYyyyHhmm(track[i].timestamp);
    const d1 = parseDdMmYyyyHhmm(track[i + 1].timestamp);
    if (!d0 || !d1) continue;
    const t0 = d0.getTime();
    const t1 = d1.getTime();
    const intervalMs = t1 - t0;

    if (intervalMs <= 0) continue;

    const z0 = pointZones[i];
    const z1 = pointZones[i + 1];

    if (z0 && z1 && z0.id === z1.id) {
      // Both points in the same zone — full interval to that zone
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + intervalMs);
    } else if (z0 && z1 && z0.id !== z1.id) {
      // Transition between two different zones — half to each
      const half = intervalMs / 2;
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + half);
      zoneTimeMs.set(z1.id, (zoneTimeMs.get(z1.id) ?? 0) + half);
      // Exited z0
      zoneExits.push({ timestamp: track[i + 1].timestamp, fromZone: z0.name });
    } else if (z0 && !z1) {
      // Left a zone — half interval to zone, half outside
      const half = intervalMs / 2;
      zoneTimeMs.set(z0.id, (zoneTimeMs.get(z0.id) ?? 0) + half);
      outsideMs += half;
      zoneExits.push({ timestamp: track[i + 1].timestamp, fromZone: z0.name });
    } else if (!z0 && z1) {
      // Entered a zone — half interval to zone, half outside
      const half = intervalMs / 2;
      zoneTimeMs.set(z1.id, (zoneTimeMs.get(z1.id) ?? 0) + half);
      outsideMs += half;
    } else {
      // Both outside — full interval outside
      outsideMs += intervalMs;
    }
  }

  // Build breakdown
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
  };
}
