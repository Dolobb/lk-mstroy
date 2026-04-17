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

export interface FilterOptions {
  categories: string[];
  branches: string[];
  vehicleTypes: string[];
  brands: string[];
  constructionObjects: string[];
  techStatuses: string[];
  workTypes: string[];
}
