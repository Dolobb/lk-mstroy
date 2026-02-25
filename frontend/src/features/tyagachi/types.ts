// ===================== Dashboard types =====================

export interface TyagachiVehicle {
  id: number;
  ts_id_mo: number;
  ts_reg_number: string | null;
  ts_name_mo: string | null;
  first_seen_at: string;
  last_seen_at: string;
  requests_total: number;
  requests_stable: number;
  requests_in_progress: number;
}

export interface PLRecordBrief {
  pl_id: string;
  pl_status: string | null;
  pl_date_out: string | null;
  pl_date_out_plan: string | null;   // "DD.MM.YYYY HH:MM" — начало ПЛ (плановое)
  pl_date_in_plan: string | null;    // "DD.MM.YYYY HH:MM" — конец ПЛ (плановое)
}

export interface TyagachiRequest {
  id: number;
  request_number: number;
  request_status: string | null;
  stability_status: 'stable' | 'in_progress';
  route_start_address: string | null;
  route_end_address: string | null;
  route_start_date: string | null;    // "DD.MM.YYYY HH:MM"
  route_end_date: string | null;
  route_distance: string | null;      // строка в БД
  object_expend_code: string | null;
  object_expend_name: string | null;
  order_name_cargo: string | null;
  first_synced_at: string;
  last_synced_at: string;
  pl_records?: PLRecordBrief[];
}

export interface DashboardSummary {
  vehicles_count: number;
  requests_total: number;
  requests_stable: number;
  requests_in_progress: number;
  last_sync: {
    synced_at: string;
    period_from_pl: string;
    period_to_pl: string;
    period_from_req: string;
    period_to_req: string;
    vehicles_count: number;
    requests_total: number;
    requests_stable: number;
    requests_in_progress: number;
    status: 'success' | 'error';
  } | null;
}

export interface SyncStats {
  vehicles_count: number;
  requests_total: number;
  requests_stable: number;
  requests_in_progress: number;
  requests_added: number;
  requests_updated: number;
}

export interface SyncStatus {
  running: boolean;
  progress: string;
  error: string | null;
  completed_at: string | null;
  stats: SyncStats | null;
  mon_current: number;
  mon_total: number;
}

export interface LegacyReport {
  id: number;
  title: string | null;
  from_requests: string | null;
  to_requests: string | null;
  from_pl: string | null;
  to_pl: string | null;
  created_at: string;
  html_filename: string | null;
  requests_count: number | null;
  matched_count: number | null;
}

// ===================== Report viewer types =====================

export interface TrackPoint {
  lat: number | null;
  lon: number | null;
  time: string | null;   // "DD.MM.YYYY HH:MM:SS"
  speed: number | null;
}

export interface Parking {
  begin: string | null;        // "DD.MM.YYYY HH:MM:SS"
  end: string | null;
  address: string | null;
  duration_min: number | null;
  lat: number | null;
  lon: number | null;
}

export interface FuelRecord {
  name: string | null;
  charges: number | null;
  discharges: number | null;
  rate: number | null;
  value_begin: number | null;
  value_end: number | null;
}

export interface VehicleMonitoring {
  ts_id_mo: string | null;
  ts_reg_number: string | null;
  ts_name_mo: string | null;
  mon_distance: number | null;
  mon_moving_time_hours: number | null;
  mon_engine_time_hours: number | null;
  mon_idling_time_hours: number | null;
  mon_fuels: FuelRecord[] | null;
  mon_parkings: Parking[] | null;
  mon_track: TrackPoint[] | null;
  mon_parkings_count: number | null;
  mon_parkings_total_hours: number | null;
}

export interface PLEntry {
  pl_id: string;
  pl_ts_number: string | null;
  pl_date_out: string | null;
  pl_status: string | null;
  vehicles: VehicleMonitoring[];
}

export interface RequestHierarchy {
  request_number: number;
  request_status: string | null;
  route_start_address: string | null;
  route_end_address: string | null;
  route_start_date: string | null;
  route_end_date: string | null;
  route_distance: number | null;
  object_expend_name: string | null;
  order_name_cargo: string | null;
  pl_list: PLEntry[];
}

export interface RequestDataResponse {
  request_number: number;
  request_info: TyagachiRequest;
  hierarchy: Record<string, RequestHierarchy>;
}
