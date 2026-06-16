export type VehicleSource = 'dump_truck' | 'dst';

// ─── Ingest Ledger types ─────────────────────────────────

export type LedgerStatus = 'pending' | 'running' | 'done' | 'empty' | 'failed';

export interface DataStatusUnit {
  pipeline: string;
  vehicleRef: string;
  vehicleLabel: string | null;
  date: string;         // YYYY-MM-DD
  shift: string;        // morning|evening|shift1|shift2|full
  status: LedgerStatus;
  reasonCode: string | null;
  reasonLabel: string | null;
  attempt: number;
  lastError: string | null;
  finishedAt: string | null;
}

export interface DataStatusResponse {
  units: DataStatusUnit[];
}

// ─── Geo-admin types ─────────────────────────────────────

export interface GeoObject {
  id: number;
  uid: string;
  name: string;
  timezone: string;
}

export interface ZoneFeatureProperties {
  id: number;
  uid: string;
  object_id: number;
  object_uid: string;
  name: string;
  tags: string[];
  min_duration_sec: number;
}

export interface ZoneFeature {
  type: 'Feature';
  properties: ZoneFeatureProperties;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface DstZoneProperties {
  uid: string;
  name: string;
  object_uid: string;
  object_name: string;
  tags: string[];
  min_duration_sec: number;
}

/** Одна зона с тегом dst_zone из geo-admin (GeoJSON Feature) */
export interface DstZoneFeature {
  type: 'Feature';
  properties: DstZoneProperties;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface UnifiedRecord {
  // Идентификация
  source: VehicleSource;
  regNumber: string;
  nameMO: string;
  organization: string | null;
  vehicleType: string;            // "Самосвал" | "Бульдозер" | "Кран авт. 80т" | ...

  // Период
  reportDate: string;             // YYYY-MM-DD
  shiftType: 'shift1' | 'shift2';

  // Общие метрики
  engineTimeSec: number;
  kipPct: number;
  secondaryPct: number;           // movementPct (самосвалы) | loadEfficiencyPct (ДСТ)
  secondaryLabel: string;         // "Движение" | "Нагрузка"

  // Самосвалы-only
  id?: number;
  objectUid?: string;
  objectName?: string;
  movingTimeSec?: number;
  distanceKm?: number;
  onsiteMin?: number;
  tripsCount?: number;
  workType?: string;
  requestNumbers?: number[];
  shiftStart?: string;
  shiftEnd?: string;
  objectTimezone?: string;

  // ДСТ-only
  fuelConsumedL?: number;
  totalStayTimeH?: number;
  idleTimeH?: number;
  departmentUnit?: string;
  isGapFilled?: boolean;
}

export interface UnifiedVehicleRow {
  regNumber: string;
  nameMO: string;
  organization: string | null;
  vehicleType: string;
  source: VehicleSource;
  records: UnifiedRecord[];
  // Агрегаты
  shiftsCount: number;
  avgKipPct: number;
  avgSecondaryPct: number;
  secondaryLabel: string;
  totalTrips: number;             // самосвалы: сумма рейсов
  totalFuelL: number;             // ДСТ: сумма топлива
  engineTotalSec: number;
  // Для lazy-loading ДСТ деталей
  kipVehicleId?: string;
  departmentUnit?: string;
  // Координаты последней фиксации (из KIP weekly) — для geo-матчинга
  latitude?: number | null;
  longitude?: number | null;
  // Pre-loaded request numbers (KIP weekly provides them without expand)
  requestNumbers?: number[];
  // Число смен без данных (KIP gap-fill). Показывается бейджиком «⚑N» рядом с counter смен.
  gapFilledCount?: number;
}

// KIP Segment types (for Gantt diagrams)

export interface KipSegment {
  segmentIndex: number;
  segmentStart: string;
  segmentEnd: string;
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  trackPointsCount: number;
}

export interface KipSegmentJob {
  vehicleId: string;
  date: string;
  shift: string;
  status: 'queued' | 'running' | 'done' | 'error';
  segmentsDone: number;
  error?: string;
}

export interface KipSegmentProgress {
  queue: KipSegmentJob[];
  active: KipSegmentJob[];
  completed: KipSegmentJob[];
  maxConcurrent: number;
}

// KIP API response types
export interface KipWeeklyVehicle {
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  vehicle_type: string;
  branch: string;
  department_unit: string;
  avg_total_stay_time: number;
  avg_engine_on_time: number;
  avg_idle_time: number;
  avg_fuel: number;
  avg_load_efficiency_pct: number;
  avg_utilization_ratio: number;
  latitude: number | null;
  longitude: number | null;
  record_count: number;
  gap_filled_count: number;
  request_numbers: number[];
  is_ghost: boolean;
  last_seen_date?: string;
}

export interface KipVehicleDetail {
  report_date: string;
  shift_type: string;
  department_unit: string;
  total_stay_time: number;
  engine_on_time: number;
  idle_time: number;
  fuel_consumed_total: number;
  fuel_rate_fact: number;
  fuel_rate_norm: number;
  load_efficiency_pct: number;
  utilization_ratio: number;
  track_simplified: unknown;
  is_gap_filled: boolean;
}

// ─── Positions (Session 7) ───────────────────────────────

export interface PositionPoint {
  regNumber: string;
  lat: number;
  lng: number;
  ts: string; // ISO
  motionStatus: string;
  speed: number | null;
  heading: number | null;
  engineOn: boolean | null;
  source: 'track_points' | 'dt_tracks' | 'kip_records';
}

export interface PositionsResponse {
  from?: string;
  at: string;
  positions: PositionPoint[];
}

// ─── Groups (Session 8) ─────────────────────────────────

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
}

export interface BigObjectsResponse {
  objects: BigObject[];
}

// ─── Sidebar summary ───────────────────────────────────

export type SidebarGroupKey = 'samosvaly' | 'ekskav' | 'krany' | 'kip';

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

export interface SidebarSummaryResponse {
  from: string;
  to: string;
  generatedAt: string;
  objects: SidebarObjectCard[];
}

// ─── Track (Session 9) ──────────────────────────────────

export interface TrackPoint {
  ts: string; // ISO
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  engineOn: boolean;
  motionStatus: string;
  dwellSec: number | null;
}

export interface TrackResponse {
  vehicleId: string;
  points: TrackPoint[];
}
