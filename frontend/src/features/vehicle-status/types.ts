export interface StatusRecord {
  id: number;
  plateNumber: string;
  statusText: string | null;
  isRepairing: boolean;
  dateStart: string;
  dateEnd: string | null;
  daysInRepair: number;
  category: string | null;
  lastCheckDate: string | null;
}

export interface SyncStatus {
  lastSync: string | null;
  lastResult: { processed: number; errors: string[] } | null;
  inProgress: boolean;
}
