export interface ServiceStatus {
  id: string;
  name: string;
  port: number;
  pid: number | null;
  running: boolean;
  portOpen: boolean;
}

export interface DataCoverage {
  kip: string[];        // YYYY-MM-DD dates with data
  dumpTrucks: string[]; // YYYY-MM-DD dates with data
  errors?: { kip: string | null; dumpTrucks: string | null };
  config?: { kip: string; main: string };
}

export interface FetchStatus {
  active: boolean;
  service: 'kip' | 'dump-trucks' | null;
  current: string | null;  // дата в процессе загрузки
  queue: string[];          // даты в очереди
  done: string[];           // успешно загруженные за текущую сессию
  errors: string[];
}
