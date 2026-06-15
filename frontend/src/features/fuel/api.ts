import type {
  AtzStatus, Driver, ShiftDetail, ShiftFilters, ShiftSummary,
} from './types';

const BASE = '/api/fuel';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export async function fetchAtz(): Promise<AtzStatus[]> {
  return get<AtzStatus[]>(`${BASE}/atz`);
}

export async function fetchDrivers(): Promise<Driver[]> {
  return get<Driver[]>(`${BASE}/drivers`);
}

export async function fetchShifts(filters?: ShiftFilters): Promise<ShiftSummary[]> {
  const q = new URLSearchParams();
  if (filters?.status) q.set('status', filters.status);
  if (filters?.from)   q.set('from',   filters.from);
  if (filters?.to)     q.set('to',     filters.to);
  if (filters?.limit !== undefined) q.set('limit', String(filters.limit));

  const qs = q.toString();
  return get<ShiftSummary[]>(`${BASE}/shifts${qs ? `?${qs}` : ''}`);
}

export async function fetchShiftDetail(id: string): Promise<ShiftDetail> {
  return get<ShiftDetail>(`${BASE}/shifts/${id}`);
}

export function ttnPhotoUrl(receiptId: string): string {
  return `${BASE}/receipts/${receiptId}/photo`;
}
