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
}
