import type {
  AtzStatus,
  CloseShiftInput,
  CreateAtzInput,
  Driver,
  EditEventResult,
  ShiftDetail,
  ShiftFilters,
  ShiftSummary,
  UpdateAtzInput,
  Vehicle,
} from './types';

const BASE = '/api/fuel';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

async function mutate<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function fetchAtz(): Promise<AtzStatus[]> {
  return get<AtzStatus[]>(`${BASE}/atz`);
}

export async function createAtz(input: CreateAtzInput): Promise<AtzStatus> {
  return mutate<AtzStatus>(`${BASE}/atz`, 'POST', input);
}

export async function updateAtz(id: string, input: UpdateAtzInput): Promise<AtzStatus> {
  return mutate<AtzStatus>(`${BASE}/atz/${id}`, 'PATCH', input);
}

export async function fetchVehicles(active: 'true' | 'all' = 'true'): Promise<Vehicle[]> {
  return get<Vehicle[]>(`${BASE}/vehicles?active=${active}`);
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

export async function closeShift(id: string, input: CloseShiftInput = {}): Promise<ShiftSummary> {
  return mutate<ShiftSummary>(`${BASE}/shifts/${id}/close`, 'POST', input);
}

export async function editEvent(
  type: 'dispense' | 'receipt',
  id: string,
  input: { liters?: number; isDeleted?: boolean },
): Promise<EditEventResult> {
  return mutate<EditEventResult>(`${BASE}/events/${type}/${id}`, 'PATCH', input);
}

export function ttnPhotoUrl(receiptId: string): string {
  return `${BASE}/receipts/${receiptId}/photo`;
}
