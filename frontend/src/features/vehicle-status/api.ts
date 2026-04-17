import type { VehicleRecord, SyncStatus, FilterOptions } from './types';

const BASE = '/api/vs';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export async function fetchVehicles(): Promise<VehicleRecord[]> {
  const d = await get<{ data: VehicleRecord[] }>(`${BASE}/vehicles`);
  return d.data;
}

export async function triggerSync(): Promise<void> {
  const r = await fetch(`${BASE}/vehicles/sync`, { method: 'POST' });
  if (!r.ok) throw new Error(`Sync failed: ${r.status}`);
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  return get<SyncStatus>(`${BASE}/vehicles/sync-status`);
}

export async function fetchFilterOptions(): Promise<FilterOptions> {
  return get<FilterOptions>(`${BASE}/vehicles/filters`);
}

export async function fetchSnapshotDates(): Promise<string[]> {
  const d = await get<{ dates: string[] }>(`${BASE}/snapshots/dates`);
  return d.dates;
}

export async function fetchSnapshots(date: string): Promise<VehicleRecord[]> {
  const d = await get<{ data: VehicleRecord[] }>(`${BASE}/snapshots?date=${date}`);
  return d.data;
}
