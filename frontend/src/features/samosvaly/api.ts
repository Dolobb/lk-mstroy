import type {
  DtObject, OrderSummary, GanttRecord, GanttResponse,
  ShiftRecord, TripRecord, ZoneEvent, Repair,
} from './types';

const BASE = '/api/dt';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export async function fetchObjects(): Promise<DtObject[]> {
  const d = await get<{ data: DtObject[] }>(`${BASE}/objects`);
  return d.data;
}

export async function fetchOrders(dateFrom: string, dateTo: string): Promise<OrderSummary[]> {
  const d = await get<{ data: OrderSummary[] }>(`${BASE}/orders?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  return d.data;
}

export async function fetchOrderGantt(number: number): Promise<GanttResponse> {
  return get<GanttResponse>(`${BASE}/orders/${number}/gantt`);
}

export async function fetchShiftRecords(params: {
  dateFrom?: string;
  dateTo?: string;
  objectUid?: string;
  shiftType?: string;
}): Promise<ShiftRecord[]> {
  const q = new URLSearchParams();
  if (params.dateFrom)  q.set('dateFrom',  params.dateFrom);
  if (params.dateTo)    q.set('dateTo',    params.dateTo);
  if (params.objectUid) q.set('objectUid', params.objectUid);
  if (params.shiftType) q.set('shiftType', params.shiftType);
  const d = await get<{ data: ShiftRecord[] }>(`${BASE}/shift-records?${q}`);
  return d.data;
}

export async function fetchShiftDetail(shiftRecordId: number): Promise<{
  trips: TripRecord[];
  zoneEvents: ZoneEvent[];
  objectTimezone?: string;
}> {
  return get(`${BASE}/shift-detail?shiftRecordId=${shiftRecordId}`);
}

export async function fetchRepairs(objectName?: string): Promise<Repair[]> {
  const q = objectName ? `?objectName=${encodeURIComponent(objectName)}` : '';
  const d = await get<{ data: Repair[] }>(`${BASE}/repairs${q}`);
  return d.data;
}

export async function fetchOrderNorms(): Promise<{ request_number: number; trips_per_shift: number }[]> {
  const d = await get<{ data: { request_number: number; trips_per_shift: number }[] }>(`${BASE}/order-norms`);
  return d.data;
}

export async function saveOrderNorms(norms: { number: number; tripsPerShift: number }[]): Promise<void> {
  const r = await fetch(`${BASE}/order-norms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ norms }),
  });
  if (!r.ok) throw new Error(`API error: ${r.status}`);
}
