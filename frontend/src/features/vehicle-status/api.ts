import type { StatusRecord, SyncStatus } from './types';

const BASE = '/api/vs';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export async function fetchVehicleStatus(filters?: {
  isRepairing?: boolean;
  category?: string;
}): Promise<StatusRecord[]> {
  const q = new URLSearchParams();
  if (filters?.isRepairing !== undefined) q.set('isRepairing', String(filters.isRepairing));
  if (filters?.category)                  q.set('category', filters.category);
  const qs = q.toString() ? `?${q}` : '';
  const d = await get<{ data: StatusRecord[] }>(`${BASE}/vehicle-status${qs}`);
  return d.data;
}

export async function triggerSync(): Promise<void> {
  const r = await fetch(`${BASE}/vehicle-status/sync`, { method: 'POST' });
  if (!r.ok) throw new Error(`Sync failed: ${r.status}`);
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  return get<SyncStatus>(`${BASE}/vehicle-status/sync-status`);
}
