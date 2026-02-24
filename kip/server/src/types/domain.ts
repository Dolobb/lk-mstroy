/** Internal domain types */

export interface ShiftWindow {
  shiftType: 'morning' | 'evening';
  date: string;             // YYYY-MM-DD (report date)
  from: Date;
  to: Date;
}

export interface VehicleTask {
  idMO: number;
  regNumber: string;
  nameMO: string;
  category: string;
  garageNumber: string;
  plId: number;
  companyName: string;
  shift: ShiftWindow;
  requestNumbers: number[];
}

export interface ParsedMonitoringRecord {
  engineOnTime: number;       // hours
  fuelConsumedTotal: number;  // liters
  lastLat: number | null;
  lastLon: number | null;
  trackSimplified: Array<{ lat: number; lon: number; timestamp: string }>;
  fullTrack: Array<{ lat: number; lon: number; timestamp: string }>;
}

export interface ParsedRequest {
  requestId: number;
  number: number;
  status: string;
  dateCreate: Date | null;
  dateProcessed: Date | null;
  contactPerson: string;
  rawJson: object;
}

// Config types

export interface ShiftConfig {
  morning: { start: string; end: string };
  evening: { start: string; end: string };
}

export interface VehicleTypeConfig {
  id: string;
  label: string;
  keywords: string[];
}

export interface FuelNormEntry {
  vehicle_model: string;
  fuel_rate_norm: number;
}

export interface EnvConfig {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  tisApiUrl: string;
  tisApiTokens: string[];
  serverPort: number;
  nodeEnv: string;
  rateLimitPerVehicleMs: number;
}

// Weekly / detail API types

export interface WeeklyVehicleRow {
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
  track_simplified: object | null;
}

export interface VehicleRequestRow {
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

export interface FilterOptions {
  branches: string[];
  types: string[];
  departments: string[];
}

// Geozone types

export interface GeozoneResult {
  totalStayTime: number;        // hours inside all zones combined
  departmentUnit: string;       // department of the zone with max time (or "")
  outsideZoneTime: number;      // hours outside all zones
  zoneBreakdown: Array<{
    zoneId: string;
    zoneName: string;
    departmentUnit: string;
    timeHours: number;
  }>;
  zoneExits: Array<{
    timestamp: string;
    fromZone: string;
  }>;
}
