import { fetchShiftRecords } from '@/features/samosvaly/api';
import type { ShiftRecord } from '@/features/samosvaly/types';
import type {
  KipWeeklyVehicle,
  KipVehicleDetail,
  KipSegment,
  KipSegmentProgress,
  UnifiedRecord,
  UnifiedVehicleRow,
  DstZoneFeature,
  GeoObject,
  ZoneFeature,
  PositionsResponse,
  GroupsResponse,
  BigObjectsResponse,
  TrackResponse,
} from './types';

// ─── Geo-admin API ──────────────────────────────────────

/** Загружает все зоны с тегом dst_zone из geo-admin (статические данные, не зависят от периода) */
export async function fetchDstZones(): Promise<DstZoneFeature[]> {
  const r = await fetch('/api/geo/zones/by-tag/dst_zone');
  if (!r.ok) throw new Error(`geo-admin unavailable: ${r.status}`);
  const fc = await r.json() as { type: string; features: DstZoneFeature[] };
  return fc.features ?? [];
}

export async function fetchGeoObjects(): Promise<GeoObject[]> {
  const r = await fetch('/api/geo/objects');
  if (!r.ok) throw new Error(`geo-admin unavailable: ${r.status}`);
  return r.json() as Promise<GeoObject[]>;
}

export async function fetchZonesByObject(objectUid: string, tag?: string): Promise<ZoneFeature[]> {
  const url = tag
    ? `/api/geo/zones/by-object/${encodeURIComponent(objectUid)}?tags=${encodeURIComponent(tag)}`
    : `/api/geo/zones/by-object/${encodeURIComponent(objectUid)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`geo-admin unavailable: ${r.status}`);
  const fc = await r.json() as { type: string; features: ZoneFeature[] };
  return fc.features ?? [];
}

// ─── KIP API ────────────────────────────────────────────

const KIP_BASE = '/api/kip';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export async function fetchKipWeekly(
  from: string,
  to: string,
  types?: string[],
  excludeGapFilled?: boolean,
): Promise<KipWeeklyVehicle[]> {
  const q = new URLSearchParams({ from, to });
  if (types?.length) types.forEach(t => q.append('type', t));
  if (excludeGapFilled) q.append('excludeGapFilled', 'true');
  return get<KipWeeklyVehicle[]>(`${KIP_BASE}/vehicles/weekly?${q}`);
}

export async function fetchKipVehicleDetails(
  vehicleId: string,
  from: string,
  to: string,
): Promise<KipVehicleDetail[]> {
  const q = new URLSearchParams({ from, to });
  return get<KipVehicleDetail[]>(`${KIP_BASE}/vehicles/${encodeURIComponent(vehicleId)}/details?${q}`);
}

// ─── KIP Segments API ───────────────────────────────────

export async function triggerKipSegmentFetch(
  vehicleId: string,
  date: string,
  shiftType: string,
): Promise<{ status: string }> {
  const r = await fetch(`${KIP_BASE}/segments/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, date, shiftType }),
  });
  if (!r.ok) throw new Error(`Segment fetch error: ${r.status}`);
  return r.json();
}

export async function fetchKipSegments(
  vehicleId: string,
  date: string,
  shift: string,
): Promise<KipSegment[]> {
  const q = new URLSearchParams({ vehicleId, date, shift });
  return get<KipSegment[]>(`${KIP_BASE}/segments?${q}`);
}

export async function fetchKipSegmentProgress(): Promise<KipSegmentProgress> {
  return get<KipSegmentProgress>(`${KIP_BASE}/segments/progress`);
}

export async function triggerDtShiftSegmentFetch(
  date: string,
  shiftType: string,
): Promise<{ status: string }> {
  const q = new URLSearchParams({ date, shift: shiftType, force: 'true' });
  const r = await fetch(`/api/dt/admin/fetch-segments?${q}`, { method: 'POST' });
  if (!r.ok) throw new Error(`DT segment fetch error: ${r.status}`);
  return r.json();
}

// ─── Positions API (Session 7) ─────────────────────────

export async function fetchPositions(from: Date, at: Date): Promise<PositionsResponse> {
  const q = new URLSearchParams({ from: from.toISOString(), at: at.toISOString() });
  const r = await fetch(`/api/analytics/positions?${q}`);
  if (!r.ok) throw new Error(`Positions API error: ${r.status}`);
  return r.json() as Promise<PositionsResponse>;
}

// ─── Groups API (Session 8) ──────────────────────────────

export async function fetchGroups(from: string, to: string): Promise<GroupsResponse> {
  const q = new URLSearchParams({ from, to });
  const r = await fetch(`/api/analytics/groups?${q}`);
  if (!r.ok) throw new Error(`Groups API error: ${r.status}`);
  return r.json() as Promise<GroupsResponse>;
}

export async function fetchBigObjects(): Promise<BigObjectsResponse> {
  const r = await fetch('/api/analytics/objects');
  if (!r.ok) throw new Error(`Objects API error: ${r.status}`);
  return r.json() as Promise<BigObjectsResponse>;
}

// ─── Converters ─────────────────────────────────────────

function normalizeKipShift(shift: string): 'shift1' | 'shift2' {
  if (shift === 'morning' || shift === 'shift1') return 'shift1';
  return 'shift2';
}

/** Убирает слово "Самосвал" из названия ТС */
function stripSamosvaly(name: string | null | undefined): string {
  if (!name) return '—';
  return name.replace(/^самосвал\s*/i, '').trim();
}

export function dtRecordToUnified(sr: ShiftRecord): UnifiedRecord {
  return {
    source: 'dump_truck',
    regNumber: sr.regNumber,
    nameMO: stripSamosvaly(sr.nameMO),
    organization: sr.organization,
    vehicleType: 'Самосвал',
    reportDate: sr.reportDate.split('T')[0] ?? sr.reportDate,
    shiftType: sr.shiftType,
    engineTimeSec: sr.engineTimeSec,
    kipPct: sr.kipPct,
    secondaryPct: sr.movementPct,
    secondaryLabel: 'Движение',
    // DT-specific
    id: sr.id,
    objectUid: sr.objectUid,
    objectName: sr.objectName,
    movingTimeSec: sr.movingTimeSec,
    distanceKm: sr.distanceKm,
    onsiteMin: sr.onsiteMin,
    tripsCount: sr.tripsCount,
    workType: sr.workType,
    requestNumbers: sr.requestNumbers,
    shiftStart: sr.shiftStart ?? undefined,
    shiftEnd: sr.shiftEnd ?? undefined,
    objectTimezone: sr.objectTimezone,
  };
}

export function kipDetailToUnified(
  row: KipVehicleDetail,
  vehicleModel: string,
  vehicleType: string,
  companyName: string,
  departmentUnit: string,
  regNumber: string,
): UnifiedRecord {
  return {
    source: 'dst',
    regNumber,
    nameMO: vehicleModel,
    organization: companyName || null,
    vehicleType,
    reportDate: row.report_date,
    shiftType: normalizeKipShift(row.shift_type),
    engineTimeSec: row.engine_on_time * 3600,
    kipPct: row.utilization_ratio,
    secondaryPct: row.load_efficiency_pct,
    secondaryLabel: 'Нагрузка',
    fuelConsumedL: row.fuel_consumed_total,
    totalStayTimeH: row.total_stay_time,
    idleTimeH: row.idle_time,
    departmentUnit: departmentUnit,
    isGapFilled: row.is_gap_filled,
  };
}

function dtRecordsToVehicleRow(regNumber: string, recs: ShiftRecord[]): UnifiedVehicleRow {
  const first = recs[0]!;
  const unified = recs.map(dtRecordToUnified);
  const kipVals = recs.filter(r => r.kipPct > 0).map(r => r.kipPct);
  const movVals = recs.filter(r => r.movementPct > 0).map(r => r.movementPct);

  return {
    regNumber,
    nameMO: stripSamosvaly(first.nameMO),
    organization: first.organization,
    vehicleType: 'Самосвал',
    source: 'dump_truck',
    records: unified,
    shiftsCount: recs.length,
    avgKipPct: kipVals.length ? kipVals.reduce((a, b) => a + b, 0) / kipVals.length : 0,
    avgSecondaryPct: movVals.length ? movVals.reduce((a, b) => a + b, 0) / movVals.length : 0,
    secondaryLabel: 'Движение',
    totalTrips: recs.reduce((s, r) => s + r.tripsCount, 0),
    totalFuelL: 0,
    engineTotalSec: recs.reduce((s, r) => s + r.engineTimeSec, 0),
  };
}

export function kipWeeklyToVehicleRow(kv: KipWeeklyVehicle): UnifiedVehicleRow {
  return {
    regNumber: kv.vehicle_id,
    nameMO: kv.vehicle_model,
    organization: kv.company_name || null,
    vehicleType: kv.vehicle_type,
    source: 'dst',
    records: [],  // lazy-loaded via fetchKipVehicleDetails
    shiftsCount: kv.record_count,
    avgKipPct: kv.avg_utilization_ratio,
    avgSecondaryPct: kv.avg_load_efficiency_pct,
    secondaryLabel: 'Нагрузка',
    totalTrips: 0,
    totalFuelL: kv.avg_fuel * kv.record_count,
    engineTotalSec: kv.avg_engine_on_time * 3600 * kv.record_count,
    kipVehicleId: kv.vehicle_id,
    departmentUnit: kv.department_unit,
    requestNumbers: kv.request_numbers ?? [],
    gapFilledCount: kv.gap_filled_count ?? 0,
    latitude: kv.latitude,
    longitude: kv.longitude,
  };
}

// ─── Main fetch ─────────────────────────────────────────

export async function fetchUnifiedData(
  from: string,
  to: string,
): Promise<{ dtRows: UnifiedVehicleRow[]; dstRows: UnifiedVehicleRow[] }> {
  // Parallel fetch both APIs
  const [dtRecords, kipVehicles] = await Promise.all([
    fetchShiftRecords({ dateFrom: from, dateTo: to }),
    fetchKipWeekly(from, to),
  ]);

  // Group DT records by vehicle
  const dtMap = new Map<string, ShiftRecord[]>();
  dtRecords.forEach(r => {
    if (!dtMap.has(r.regNumber)) dtMap.set(r.regNumber, []);
    dtMap.get(r.regNumber)!.push(r);
  });

  const dtRows = [...dtMap.entries()].map(([reg, recs]) => dtRecordsToVehicleRow(reg, recs));

  // Convert KIP weekly to rows (excluding ghost vehicles)
  const dstRows = kipVehicles.map(kipWeeklyToVehicleRow);

  return { dtRows, dstRows };
}

// ─── Track API (Session 9) ─────────────────────────────

export async function fetchTrack(vehicleId: string, from: Date, to: Date): Promise<TrackResponse> {
  const q = new URLSearchParams({
    vehicle: vehicleId,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const r = await fetch(`/api/analytics/tracks?${q}`);
  if (!r.ok) throw new Error(`Track API error: ${r.status}`);
  return r.json() as Promise<TrackResponse>;
}
