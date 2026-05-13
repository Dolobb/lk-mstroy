export interface VehicleRecord {
  id: number;
  plateNumber: string;
  branch: string | null;
  vehicleType: string | null;
  brand: string | null;
  constructionObject: string | null;
  techStatus: string | null;
  workType: string | null;
  category: string;
  isBroken: boolean;
  lastCheckDate: string | null;
  updatedAt: string;
}

export interface SyncStatus {
  lastSync: string | null;
  lastResult: { processed: number; errors: string[] } | null;
  inProgress: boolean;
}

export interface SyncLogEntry {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  processed: number;
  errors: string[];
  errorMessage: string | null;
  downloadMs: number | null;
  parseMs: number | null;
  writeMs: number | null;
  snapshotDate: string | null;
}
  export interface FilterOptions {
  categories: string[];
  branches: string[];
  vehicleTypes: string[];
  brands: string[];
  constructionObjects: string[];
  techStatuses: string[];
  workTypes: string[];
}
