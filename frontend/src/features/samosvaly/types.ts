// Типы данных для блока Самосвалы

export interface DtObject {
  uid: string;
  name: string;
  smu: string | null;
}

export interface OrderSummary {
  number: number;
  status: string;
  raw_json: {
    orders?: Array<{
      nameCargo?: string;
      weightCargo?: number;
      volumeCargo?: number;
      cntTrip?: number;
      countTs?: number;
      notes?: string;
      comment?: string;
      route?: {
        distance?: number;
        time?: number;
        points?: Array<{ address?: string; date?: string; time?: string; latLon?: { lat: number; lng: number } }>;
      };
      objectExpend?: { code?: string; name?: string };
    }>;
  };
  first_date: string | null;
  last_date: string | null;
  actual_trips: string;
  vehicle_count: string;
  vehicles: string[] | null;
  vehicle_names: string[] | null;
  object_names: string[] | null;
  pl_count: string;
  trips_per_veh_day: string | null;
  points_in_boundary: (boolean | null)[] | null;
}

// Структуры, вычисляемые из OrderSummary
export interface OrderCard {
  number: number;
  status: string;
  cargo: string;
  weightTotal: number;
  volumeTotal: number;
  planTrips: number;
  countTs: number;
  routeFrom: string;
  routeTo: string;
  routeDistance: number;
  routeTimeMins: number;
  objectExpend: string;
  dateFrom: string;
  dateTo: string;
  dateFromIso: string;   // YYYY-MM-DD for filtering/sorting
  dateToIso: string;     // YYYY-MM-DD for filtering/sorting
  actualTrips: number;
  pct: number;
  vehicles: string[];
  vehicleNames: string[];
  objectNames: string[];
  plCount: number;
  city: string;
  isDone: boolean;
  notes: string;
  comment: string;
  tripsPerVehDay: number;
  pointsInBoundary: (boolean | null)[] | null;
}

export interface GanttRecord {
  id: string;
  reg_number: string;
  name_mo: string;
  report_date: string;
  shift_type: 'shift1' | 'shift2';
  trips_count: string;
  work_type: string;
  movement_pct: string;
  object_uid: string;
  request_numbers: number[];
}

export interface GanttPresence {
  reg_number: string;
  report_date: string;
  shift_type: 'shift1' | 'shift2';
  request_numbers: number[] | null;
  object_uid: string;
}

export interface GanttResponse {
  data: GanttRecord[];
  dateFrom: string | null;
  dateTo: string | null;
  presence?: GanttPresence[];
}

export interface ShiftRecord {
  id: number;
  reportDate: string;
  shiftType: 'shift1' | 'shift2';
  vehicleId: number;
  regNumber: string;
  nameMO: string;
  objectUid: string;
  objectName: string;
  objectTimezone: string;
  workType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  onsiteMin: number;
  tripsCount: number;
  factVolumeM3: number;
  kipPct: number;
  movementPct: number;
  plId: number | null;
  requestNumbers: number[];
  avgLoadingDwellSec: number | null;
  avgUnloadingDwellSec: number | null;
  avgTravelToUnloadMin: number | null;
  avgReturnToLoadMin: number | null;
}

export interface TripRecord {
  id: number;
  shift_record_id: number;
  trip_number: number;
  loaded_at: string | null;
  unloaded_at: string | null;
  loading_zone: string | null;
  unloading_zone: string | null;
  duration_min: number | null;
  travel_to_unload_min: number | null;
  return_to_load_min: number | null;
}

// ─── User Settings (localStorage) ───────────────────────────────────────────

export type BlockId = 'identity' | 'work' | 'kpi' | 'aggregates';

export interface UserSettings {
  blockOrder: BlockId[];
  blockVisibility: Record<BlockId, boolean>;
  columnVisibility: Record<BlockId, Record<string, boolean>>;
  columnOrder: Record<BlockId, string[]>;
  groupByRequest: boolean;   // true = группировать по заявке (уровень 1)
  groupByShift: boolean;     // true = две смены в одной строке (агрегат); false = каждая смена отдельно
}

export interface ZoneEvent {
  id: number;
  vehicle_id: number;
  report_date: string;
  shift_type: string;
  zone_uid: string;
  zone_name: string;
  zone_tag: 'dt_boundary' | 'dt_loading' | 'dt_unloading';
  object_uid: string;
  entered_at: string;
  exited_at: string | null;
  duration_sec: number | null;
}

export interface Repair {
  id: number;
  reg_number: string;
  name_mo: string | null;
  type: 'repair' | 'maintenance';
  reason: string | null;
  date_from: string;
  date_to: string | null;
  object_name: string | null;
  notes: string | null;
}

// Сводная статистика по объекту за неделю (вычисляется из shift_records)
export interface WeeklyObjectStats {
  objectName: string;
  trips: number;
  trucks: Set<string>;
  kipSum: number;
  kipCount: number;
  movSum1: number;
  movCount1: number;
  movSum2: number;
  movCount2: number;
}
