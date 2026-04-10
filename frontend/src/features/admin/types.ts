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
