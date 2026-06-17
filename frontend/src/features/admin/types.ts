export interface ServiceStatus {
  id: string;
  name: string;
  port: number;
  pid: number | null;
  running: boolean;
  portOpen: boolean;
}

export interface DataCoverage {
  kip: string[];          // YYYY-MM-DD dates with data
  dumpTrucks: string[];   // YYYY-MM-DD dates with full dump-truck coverage
  dtPartial?: string[];   // dump-truck dates with partial coverage
  analytics?: string[];   // analytics track_sessions dates
  analyticsPartial?: string[];  // analytics dates with partial coverage
  rawDates: string[];     // dates with >=90% coverage in monitoring_raw
  rawPartial?: string[];  // dates with >0 but <90% coverage
  errors?: { kip: string | null; dumpTrucks: string | null; analytics?: string | null };
  config?: { kip: string; main: string };
}

export interface FetchStatus {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  current: string | null;
  startedAt: number | null;
  processedVehicles?: number;
  totalVehicles?: number;
  queue: string[];
  done: string[];
  errors: string[];
}

export interface RecalcStatus {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  current: string | null;
  queue: string[];
  done: string[];
  errors: string[];
}

export interface SegmentDateResult {
  date: string;
  totalVehicles: number;
  vehiclesWithSegments: number;
  totalSegments: number;
  vehicles: Array<{
    regNumber: string;
    shiftType: string;
    segmentCount: number;
  }>;
}

export interface SegmentFetchStatus {
  active: boolean;
  current: string | null;
  startedAt: number | null;
  queue: string[];
  done: string[];
  errors: string[];
  results?: SegmentDateResult[];
}

export interface KipSegmentJob {
  vehicleId: string;
  date: string;
  shift: string;
  status: 'queued' | 'running' | 'done' | 'error';
  segmentsDone: number;
  startedAt?: number;
  error?: string;
}

export interface KipSegmentProgress {
  queue: KipSegmentJob[];
  active: KipSegmentJob[];
  completed: KipSegmentJob[];
  maxConcurrent: number;
}

export interface DbTablePreset {
  key: string;
  label: string;
  pool: 'kip' | 'main';
}

export interface DbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  error?: string;
}

// Pipeline Health

export interface PipelineHealthCard {
  pipeline_name: string;
  last_run: string | null;
  last_success: string | null;
  runs_7d: number;
  failures_7d: number;
  status: 'green' | 'yellow' | 'red';
  hours_since_success: number | null;
}

export interface PipelineRun {
  run_id: string;
  pipeline_name: string;
  trigger_type: 'cron' | 'manual' | 'cascade';
  target_date: string;
  shift_type: string | null;
  status: 'running' | 'completed' | 'failed' | 'partial';
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_vehicles: number;
  success_count: number;
  error_count: number;
  errors: unknown[];
}

// Coverage Dashboard

export interface CoverageDashboardResponse {
  baseline: { kipExpected: number; dtExpected: number };
  days: DayCard[];
  summary: {
    kipAvg7d: number;
    dtAvg7d: number;
    ghostCount: number;
    pipelineOk: number;
    pipelineFail: number;
  };
}

export interface DayCard {
  date: string;
  kip: { vehicleCount: number; rawCount: number; rawPct: number; hasSegments: boolean };
  dt: { vehicleCount: number; tripCount: number; shiftCount: number; hasSegments: boolean };
  health: 'green' | 'yellow' | 'red' | 'grey';
  lastRunStatus: string | null;
  lastRunAt: string | null;
}

// Detailed Coverage

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
