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
  dumpTrucks: string[];   // YYYY-MM-DD dates with data
  rawDates: string[];     // даты с ≥90% покрытием в monitoring_raw
  rawPartial?: string[];  // даты с >0% но <90% покрытием
  errors?: { kip: string | null; dumpTrucks: string | null };
  config?: { kip: string; main: string };
}

export interface FetchStatus {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  current: string | null;     // дата в процессе загрузки
  startedAt: number | null;   // unix ms когда текущая дата начала загружаться
  queue: string[];            // даты в очереди
  done: string[];             // успешно загруженные за текущую сессию
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

// ─── Pipeline Health ──────────────────────────────────────────────────────────

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

// ─── Detailed Coverage ────────────────────────────────────────────────────────

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
