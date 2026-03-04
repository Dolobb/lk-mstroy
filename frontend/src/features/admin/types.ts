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
