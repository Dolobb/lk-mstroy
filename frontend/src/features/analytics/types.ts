export type VehicleSource = 'dump_truck' | 'dst';

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
  // Pre-loaded request numbers (KIP weekly provides them without expand)
  requestNumbers?: number[];
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
