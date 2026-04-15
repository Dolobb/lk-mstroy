export interface DtShiftCoverage {
  report_date: string;
  shift_type: string;
  vehicle_count: number;
  delivery_count: number;
  onsite_count: number;
  total_trips: number;
  avg_kip: number | null;
  objects: string[];
}

export interface DayDetailedCoverage {
  date: string;
  kip: {
    vehicle_count: number;
    raw_count: number;
    raw_pct: number;
    has_segments: boolean;
  } | null;
  dt: {
    shifts: DtShiftCoverage[];
    has_segments: boolean;
  } | null;
  last_run_status: string | null;
}

export interface PipelineHealthCard {
  pipeline_name: string;
  last_run: string | null;
  last_success: string | null;
  runs_7d: number;
  failures_7d: number;
  status: 'green' | 'yellow' | 'red';
  hours_since_success: number | null;
}
