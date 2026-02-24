// Типы данных для блока Самосвалы

export interface DtObject {
  uid: string;
  name: string;
  smu: string | null;
}

export interface OrderSummary {
  number: number;
  status: string;
  rawJson: {
    orders?: Array<{
      nameCargo?: string;
      weightCargo?: number;
      volumeCargo?: number;
      cntTrip?: number;
      route?: {
        distance?: number;
        time?: number;
        points?: Array<{ address?: string; date?: string; time?: string }>;
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
}

// Структуры, вычисляемые из OrderSummary
export interface OrderCard {
  number: number;
  status: string;
  cargo: string;
  weightPerTrip: number;
  volumePerTrip: number;
  planTrips: number;
  routeFrom: string;
  routeTo: string;
  routeDistance: number;
  routeTimeMins: number;
  objectExpend: string;
  dateFrom: string;
  dateTo: string;
  actualTrips: number;
  pct: number;
  vehicles: string[];
  vehicleNames: string[];
  objectNames: string[];
  plCount: number;
  city: string;
  isDone: boolean;
}

export interface GanttRecord {
  id: string;
  reg_number: string;
  name_mo: string;
  report_date: string;
  shift_type: 'shift1' | 'shift2';
  trips_count: string;
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
