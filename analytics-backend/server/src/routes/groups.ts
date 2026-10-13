import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getKipPool, getPool } from '../db';
import { logger } from '../utils/logger';

export interface AnalyticsGroup {
  objectUid: string;
  vehicleIds: string[];
}

export interface GroupsResponse {
  from: string;
  to: string;
  objects: AnalyticsGroup[];
  outside: string[];
}

export interface BigObject {
  uid: string;
  name: string;
  timezone: string;
}

type SidebarGroupKey = 'samosvaly' | 'ekskav' | 'krany' | 'kip';

export interface SidebarTrendPoint {
  date: string;
  weekday: string;
  kipPct: number | null;
}

export interface SidebarGroupSummary {
  key: SidebarGroupKey;
  label: string;
  color: string;
  vehicleCount: number;
  kipPct: number | null;
}

export interface SidebarObjectCard {
  uid: string;
  name: string;
  timezoneLabel: string;
  vehicleCount: number;
  kipPct: number;
  trend: SidebarTrendPoint[];
  groups: SidebarGroupSummary[];
}

/** ДСТ-машина, работавшая вне всех геозон (нет объекта) за период. */
export interface NoObjectVehicle {
  vehicleId: string;
  type: string;
  engineHours: number;   // суммарно за период
  kipPct: number | null; // средний КИП по сменам с engine>0
  lat: number;
  lon: number;
  nearestObjectUid: string | null;
  nearestObjectName: string | null;
  distanceKm: number | null;
}

export interface SidebarSummaryResponse {
  from: string;
  to: string;
  generatedAt: string;
  objects: SidebarObjectCard[];
  /** Объекты с dst_zone, не входящие в ключевые, у которых есть ДСТ-активность в периоде. */
  secondaryObjects: SidebarObjectCard[];
  /** ДСТ-машины, работавшие вне всех геозон (engine>0, ни одна позиция не попала в dst_zone). */
  noObjectVehicles: NoObjectVehicle[];
}

interface VehicleRegistryEntry {
  regNumber: string;
  type: string;
}

interface MetricRecord {
  objectUid: string;
  date: string;
  groupKey: SidebarGroupKey;
  vehicleId: string;
  kipPct: number;
}

const SIDEBAR_GROUPS: Array<{ key: SidebarGroupKey; label: string; color: string }> = [
  { key: 'samosvaly', label: 'Самосвалы', color: '#F97316' },
  { key: 'ekskav', label: 'Экскаваторы', color: '#A78BFA' },
  { key: 'krany', label: 'Краны', color: '#22C55E' },
  { key: 'kip', label: 'ДСТ', color: '#60A5FA' },
];

let registryCache: Map<string, VehicleRegistryEntry> | null = null;
let registryMtimeMs = 0;
const registryPath = path.resolve(__dirname, '../../../../kip/config/vehicle-registry.json');

function loadVehicleRegistry(): Map<string, VehicleRegistryEntry> {
  // Реестр правится из админки (раздел «Техника») — перечитываем при смене mtime.
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(registryPath).mtimeMs; } catch { if (registryCache) return registryCache; }
  if (registryCache && mtimeMs === registryMtimeMs) return registryCache;
  registryMtimeMs = mtimeMs;

  const raw = fs.readFileSync(registryPath, 'utf-8');
  const parsed = JSON.parse(raw) as { vehicles?: VehicleRegistryEntry[] };
  registryCache = new Map(
    (parsed.vehicles ?? []).map(v => [v.regNumber.toUpperCase(), v]),
  );
  return registryCache;
}

function dstGroupKey(vehicleId: string, vehicleModel: string): SidebarGroupKey {
  const registry = loadVehicleRegistry();
  const vehicleType = registry.get(vehicleId.toUpperCase())?.type ?? vehicleModel;
  const t = vehicleType.toLowerCase();
  if (t.includes('экскаватор')) return 'ekskav';
  if (t.includes('кран')) return 'krany';
  return 'kip';
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysInclusive(from: string, to: string): string[] {
  const start = parseDateOnly(from)!;
  const end = parseDateOnly(to)!;
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`)).replace('.', '').toUpperCase();
}

function avgKip(values: number[]): number | null {
  const nonZero = values.filter(v => Number.isFinite(v) && v > 0);
  if (!nonZero.length) return null;
  return Math.round(nonZero.reduce((s, v) => s + v, 0) / nonZero.length);
}

function timezoneOffsetMinutes(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const hour = get('hour') === 24 ? 0 : get('hour');
  const utcLike = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((utcLike - date.getTime()) / 60_000);
}

function timezoneLabel(timezone: string): string {
  try {
    const now = new Date();
    const diffHours = (timezoneOffsetMinutes(timezone, now) - timezoneOffsetMinutes('Europe/Moscow', now)) / 60;
    if (diffHours === 0) return 'МСК';
    return `МСК${diffHours > 0 ? '+' : ''}${diffHours}`;
  } catch {
    return timezone === 'Asia/Yekaterinburg' ? 'МСК+2' : timezone;
  }
}

export async function getGroups(
  from: string,
  to: string,
): Promise<GroupsResponse> {
  const pool = getPool();

  // Object groups: vehicles that visited each object at least once
  const objectRes = await pool.query<{ vehicle_id: string; object_uid: string }>(
    `SELECT DISTINCT vehicle_id, unnest(visited_objects) AS object_uid
     FROM analytics.track_sessions
     WHERE date >= $1::date
       AND date <= $2::date
       AND cardinality(visited_objects) > 0`,
    [from, to],
  );

  const objectMap = new Map<string, Set<string>>();
  for (const r of objectRes.rows) {
    if (!objectMap.has(r.object_uid)) {
      objectMap.set(r.object_uid, new Set());
    }
    objectMap.get(r.object_uid)!.add(r.vehicle_id);
  }

  // Outside: vehicles with track data but no visited objects across the period
  const outsideRes = await pool.query<{ vehicle_id: string }>(
    `SELECT vehicle_id
     FROM analytics.track_sessions
     WHERE date >= $1::date
       AND date <= $2::date
     GROUP BY vehicle_id
     HAVING bool_and(cardinality(visited_objects) = 0)`,
    [from, to],
  );

  const objects: AnalyticsGroup[] = [];
  for (const [objectUid, vehicleSet] of objectMap) {
    objects.push({ objectUid, vehicleIds: [...vehicleSet] });
  }
  objects.sort((a, b) => a.objectUid.localeCompare(b.objectUid));

  return {
    from,
    to,
    objects,
    outside: outsideRes.rows.map(r => r.vehicle_id),
  };
}

export async function getBigObjects(): Promise<BigObject[]> {
  const pool = getPool();

  const res = await pool.query<{ uid: string; name: string; timezone: string }>(
    `SELECT o.uid, o.name, o.timezone
     FROM geo.objects o
     WHERE EXISTS (
       SELECT 1 FROM geo.zones z
       JOIN geo.zone_tags zt ON zt.zone_id = z.id
       WHERE z.object_id = o.id AND zt.tag = 'dt_boundary'
     )
     AND EXISTS (
       SELECT 1 FROM geo.zones z
       JOIN geo.zone_tags zt ON zt.zone_id = z.id
       WHERE z.object_id = o.id AND zt.tag IN ('dt_loading', 'dt_unloading', 'dt_onsite')
     )
     ORDER BY o.name`,
  );

  return res.rows;
}

/**
 * Второстепенные зоны: объекты с зоной dst_zone, НЕ являющиеся ключевыми
 * (нет связки dt_boundary + рабочая зона). Активность за период фильтруется
 * позже, в getSidebarSummary (показываем только зоны с реальными ДСТ-записями).
 */
export async function getSecondaryObjects(): Promise<BigObject[]> {
  const pool = getPool();

  const res = await pool.query<{ uid: string; name: string; timezone: string }>(
    `SELECT o.uid, o.name, o.timezone
     FROM geo.objects o
     WHERE EXISTS (
       SELECT 1 FROM geo.zones z
       JOIN geo.zone_tags zt ON zt.zone_id = z.id
       WHERE z.object_id = o.id AND zt.tag = 'dst_zone'
     )
     AND NOT (
       EXISTS (
         SELECT 1 FROM geo.zones z
         JOIN geo.zone_tags zt ON zt.zone_id = z.id
         WHERE z.object_id = o.id AND zt.tag = 'dt_boundary'
       )
       AND EXISTS (
         SELECT 1 FROM geo.zones z
         JOIN geo.zone_tags zt ON zt.zone_id = z.id
         WHERE z.object_id = o.id AND zt.tag IN ('dt_loading', 'dt_unloading', 'dt_onsite')
       )
     )
     ORDER BY o.name`,
  );

  return res.rows;
}

async function getDumpTruckSidebarRecords(from: string, to: string): Promise<MetricRecord[]> {
  const pool = getPool();
  const res = await pool.query<{
    object_uid: string;
    date: string;
    vehicle_id: string;
    kip_pct: string | number;
  }>(
    `SELECT
        sr.object_uid,
        sr.report_date::text AS date,
        COALESCE(NULLIF(sr.reg_number, ''), sr.vehicle_id::text) AS vehicle_id,
        sr.kip_pct
     FROM dump_trucks.shift_records_active sr
     WHERE sr.report_date BETWEEN $1::date AND $2::date
       AND sr.object_uid IS NOT NULL
       AND sr.object_uid != 'unknown'`,
    [from, to],
  );

  return res.rows.map(r => ({
    objectUid: r.object_uid,
    date: r.date.slice(0, 10),
    groupKey: 'samosvaly',
    vehicleId: r.vehicle_id,
    kipPct: Number(r.kip_pct),
  }));
}

async function getDstSidebarRecords(from: string, to: string): Promise<MetricRecord[]> {
  const kipPool = getKipPool();
  const kipRes = await kipPool.query<{
    idx: number;
    date: string;
    vehicle_id: string;
    vehicle_model: string;
    utilization_ratio: string | number;
    latitude: string | number | null;
    longitude: string | number | null;
  }>(
    `SELECT
        row_number() OVER ()::int AS idx,
        report_date::text AS date,
        vehicle_id,
        vehicle_model,
        utilization_ratio,
        latitude,
        longitude
     FROM vehicle_records
     WHERE report_date BETWEEN $1::date AND $2::date
       AND COALESCE(is_gap_filled, false) = false
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL`,
    [from, to],
  );

  const points = kipRes.rows
    .map(r => ({
      idx: Number(r.idx),
      lng: Number(r.longitude),
      lat: Number(r.latitude),
    }))
    .filter(p => Number.isFinite(p.lng) && Number.isFinite(p.lat));

  if (!points.length) return [];

  const pool = getPool();
  const matchRes = await pool.query<{ idx: number; object_uid: string }>(
    `WITH points AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS p(idx int, lng double precision, lat double precision)
     )
     SELECT DISTINCT ON (p.idx)
       p.idx,
       o.uid AS object_uid
     FROM points p
     JOIN geo.zones z
       ON ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
     JOIN geo.zone_tags zt
       ON zt.zone_id = z.id AND zt.tag = 'dst_zone'
     JOIN geo.objects o
       ON o.id = z.object_id
     ORDER BY p.idx, ST_Area(z.geom::geography) ASC`,
    [JSON.stringify(points)],
  );

  const objectByIdx = new Map(matchRes.rows.map(r => [Number(r.idx), r.object_uid]));

  return kipRes.rows
    .map(r => {
      const objectUid = objectByIdx.get(Number(r.idx));
      if (!objectUid) return null;
      return {
        objectUid,
        date: r.date.slice(0, 10),
        groupKey: dstGroupKey(r.vehicle_id, r.vehicle_model),
        vehicleId: r.vehicle_id,
        kipPct: Number(r.utilization_ratio),
      } satisfies MetricRecord;
    })
    .filter((r): r is MetricRecord => r !== null);
}

/**
 * ДСТ-машины, работавшие вне всех геозон за период: engine>0, и НИ ОДНА позиция
 * (последняя точка смены) не попала в dst_zone. Для каждой — ближайший объект + расстояние.
 */
export async function getNoObjectVehicles(from: string, to: string): Promise<NoObjectVehicle[]> {
  const kipPool = getKipPool();
  const kipRes = await kipPool.query<{
    idx: number; date: string; vehicle_id: string; vehicle_model: string;
    utilization_ratio: string | number; engine_on_time: string | number;
    latitude: string | number; longitude: string | number;
  }>(
    `SELECT row_number() OVER ()::int AS idx,
        report_date::text AS date, vehicle_id, vehicle_model,
        utilization_ratio, engine_on_time, latitude, longitude
     FROM vehicle_records
     WHERE report_date BETWEEN $1 AND $2
       AND COALESCE(is_gap_filled, false) = false
       AND engine_on_time > 0
       AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    [from, to],
  );
  if (!kipRes.rows.length) return [];

  const points = kipRes.rows
    .map(r => ({ idx: Number(r.idx), lng: Number(r.longitude), lat: Number(r.latitude) }))
    .filter(p => Number.isFinite(p.lng) && Number.isFinite(p.lat));

  const pool = getPool();
  // idx, попавшие хотя бы в одну dst_zone
  const matchRes = await pool.query<{ idx: number }>(
    `WITH points AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(idx int, lng double precision, lat double precision)
     )
     SELECT DISTINCT p.idx
     FROM points p
     JOIN geo.zones z ON ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
     JOIN geo.zone_tags zt ON zt.zone_id = z.id AND zt.tag = 'dst_zone'`,
    [JSON.stringify(points)],
  );
  const matchedIdx = new Set(matchRes.rows.map(r => Number(r.idx)));

  // группировка по ТС: матчился ли хоть один record
  const byVehicle = new Map<string, { rows: typeof kipRes.rows; anyMatched: boolean }>();
  for (const r of kipRes.rows) {
    const v = byVehicle.get(r.vehicle_id) ?? { rows: [], anyMatched: false };
    v.rows.push(r);
    if (matchedIdx.has(Number(r.idx))) v.anyMatched = true;
    byVehicle.set(r.vehicle_id, v);
  }

  const registry = loadVehicleRegistry();
  const noObj: Array<{ vehicleId: string; type: string; engineHours: number; kipPct: number | null; lat: number; lon: number; idx: number }> = [];
  for (const [vehicleId, info] of byVehicle) {
    if (info.anyMatched) continue; // машина была на каком-то объекте — не сюда
    const last = [...info.rows].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const engineHours = info.rows.reduce((s, r) => s + Number(r.engine_on_time), 0);
    const kipVals = info.rows.map(r => Number(r.utilization_ratio)).filter(Number.isFinite);
    const kipPct = kipVals.length ? Math.round(kipVals.reduce((s, v) => s + v, 0) / kipVals.length) : null;
    const type = registry.get(vehicleId.toUpperCase())?.type ?? last.vehicle_model;
    noObj.push({
      vehicleId, type, engineHours: Math.round(engineHours * 10) / 10, kipPct,
      lat: Number(last.latitude), lon: Number(last.longitude), idx: Number(last.idx),
    });
  }
  if (!noObj.length) return [];

  // ближайший dst_zone объект для каждой «беспризорной» точки
  const nearPoints = noObj.map(v => ({ idx: v.idx, lng: v.lon, lat: v.lat }));
  const nearRes = await pool.query<{ idx: number; uid: string; name: string; dist_m: number }>(
    `WITH points AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(idx int, lng double precision, lat double precision)
     )
     SELECT DISTINCT ON (p.idx) p.idx, o.uid, o.name,
       ST_Distance(z.geom::geography, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography) AS dist_m
     FROM points p
     CROSS JOIN geo.zones z
     JOIN geo.zone_tags zt ON zt.zone_id = z.id AND zt.tag = 'dst_zone'
     JOIN geo.objects o ON o.id = z.object_id
     ORDER BY p.idx, dist_m ASC`,
    [JSON.stringify(nearPoints)],
  );
  const nearByIdx = new Map(nearRes.rows.map(r => [Number(r.idx), r]));

  return noObj
    .map(v => {
      const near = nearByIdx.get(v.idx);
      return {
        vehicleId: v.vehicleId, type: v.type, engineHours: v.engineHours, kipPct: v.kipPct,
        lat: v.lat, lon: v.lon,
        nearestObjectUid: near?.uid ?? null,
        nearestObjectName: near?.name ?? null,
        distanceKm: near ? Math.round(Number(near.dist_m) / 100) / 10 : null,
      };
    })
    .sort((a, b) => b.engineHours - a.engineHours);
}

export async function getSidebarSummary(from: string, to: string): Promise<SidebarSummaryResponse> {
  const [keyObjects, secondaryObjectDefs, dtRecords, dstRecords, noObjectVehicles] = await Promise.all([
    getBigObjects(),
    getSecondaryObjects(),
    getDumpTruckSidebarRecords(from, to),
    getDstSidebarRecords(from, to),
    getNoObjectVehicles(from, to),
  ]);

  const relevantUids = new Set([
    ...keyObjects.map(o => o.uid),
    ...secondaryObjectDefs.map(o => o.uid),
  ]);
  const records = [...dtRecords, ...dstRecords].filter(r => relevantUids.has(r.objectUid));
  const days = daysInclusive(from, to);

  const recordsByObject = new Map<string, MetricRecord[]>();
  for (const rec of records) {
    if (!recordsByObject.has(rec.objectUid)) recordsByObject.set(rec.objectUid, []);
    recordsByObject.get(rec.objectUid)!.push(rec);
  }

  const buildCard = (obj: BigObject): SidebarObjectCard => {
    const objectRecords = recordsByObject.get(obj.uid) ?? [];
    const objectVehicleIds = new Set(objectRecords.map(r => r.vehicleId));
    const objectKip = avgKip(objectRecords.map(r => r.kipPct)) ?? 0;

    return {
      uid: obj.uid,
      name: obj.name,
      timezoneLabel: timezoneLabel(obj.timezone),
      vehicleCount: objectVehicleIds.size,
      kipPct: objectKip,
      trend: days.map(date => ({
        date,
        weekday: weekdayShort(date),
        kipPct: avgKip(objectRecords.filter(r => r.date === date).map(r => r.kipPct)),
      })),
      groups: SIDEBAR_GROUPS.map(group => {
        const groupRecords = objectRecords.filter(r => r.groupKey === group.key);
        const vehicleIds = new Set(groupRecords.map(r => r.vehicleId));
        return {
          ...group,
          vehicleCount: vehicleIds.size,
          kipPct: avgKip(groupRecords.map(r => r.kipPct)),
        };
      }),
    };
  };

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    // Ключевые показываем всегда (даже без активности — как раньше).
    objects: keyObjects.map(buildCard),
    // Второстепенные — только те, у кого реально есть ДСТ-записи в периоде.
    secondaryObjects: secondaryObjectDefs
      .filter(obj => (recordsByObject.get(obj.uid)?.length ?? 0) > 0)
      .map(buildCard),
    noObjectVehicles,
  };
}

export function groupsRouter(): Router {
  const router = Router();

  router.get('/analytics/groups', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (!from || !to) {
      res.status(400).json({ error: 'Query parameters "from" and "to" required (YYYY-MM-DD)' });
      return;
    }

    try {
      const groups = await getGroups(from, to);
      res.json(groups);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Groups endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/analytics/objects', async (_req, res) => {
    try {
      const objects = await getBigObjects();
      res.json({ objects });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Objects endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  router.get('/analytics/sidebar-summary', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const fromDate = from ? parseDateOnly(from) : null;
    const toDate = to ? parseDateOnly(to) : null;
    if (!from || !to || !fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
      res.status(400).json({ error: 'Query parameters "from" and "to" required (YYYY-MM-DD)' });
      return;
    }

    try {
      const summary = await getSidebarSummary(from, to);
      res.json(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Sidebar summary endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  // ДСТ-машины, работавшие вне всех геозон (нет объекта) за период.
  router.get('/analytics/no-object', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const fromDate = from ? parseDateOnly(from) : null;
    const toDate = to ? parseDateOnly(to) : null;
    if (!from || !to || !fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
      res.status(400).json({ error: 'Query parameters "from" and "to" required (YYYY-MM-DD)' });
      return;
    }

    try {
      const vehicles = await getNoObjectVehicles(from, to);
      res.json({ from, to, vehicles });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('No-object endpoint failed', err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
