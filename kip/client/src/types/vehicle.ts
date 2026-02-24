export interface TrackPoint {
  lat: number;
  lon: number;
  timestamp: string;
}

// Legacy single-day record (still used by detail endpoint)
export interface VehicleRecord {
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  department_unit: string;
  total_stay_time: number;
  engine_on_time: number;
  idle_time: number;
  fuel_consumed_total: number;
  fuel_rate_fact: number;
  max_work_allowed: number;
  fuel_rate_norm: number;
  fuel_max_calc: number;
  fuel_variance: number;
  load_efficiency_pct: number;
  utilization_ratio: number;
  latitude?: number;
  longitude?: number;
  track_simplified?: TrackPoint[] | null;
  request_numbers?: number[];
}

// Weekly aggregated vehicle for map markers
export interface WeeklyVehicle {
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
  request_numbers: number[];
}

// Detail row: one day/shift for a specific vehicle
export interface VehicleDetailRow {
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
  track_simplified?: TrackPoint[] | null;
}

// Request linked to a vehicle
export interface VehicleRequest {
  request_id: number;
  number: number;
  status: string;
  date_create: string | null;
  contact_person: string;
  object_name: string;
  id_own_customer: number | null;
  customer_name: string;
  type_of_work: string;
  object_expend_name: string;
}

// Cascading filter options from server
export interface FilterOptions {
  branches: string[];
  types: string[];
  departments: string[];
}

// Current filter state
export interface FilterState {
  from: string;
  to: string;
  shift: string | null;
  branches: string[];
  types: string[];
  departments: string[];
  kpiRanges: string[];
}

export type KpiColor = 'RED' | 'BLUE' | 'GREEN';
