import type {
  DtObject, OrderSummary, GanttRecord, GanttResponse,
  ShiftRecord, TripRecord, ZoneEvent, Repair, ShiftSegment,
} from './types';

const BASE = '/api/dt';
const SHIFT_SEGMENTS_BATCH_SIZE = 500;

const shiftSegmentsCache = new Map<number, Promise<ShiftSegment[]>>();

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

export async function fetchShiftSegments(
  shiftRecordId: number,
  options: { force?: boolean } = {},
): Promise<ShiftSegment[]> {
  if (!options.force) {
    const cached = shiftSegmentsCache.get(shiftRecordId);
    if (cached) return cached;
  }

  const promise = get<{ data: ShiftSegment[] }>(`${BASE}/shift-segments?shiftRecordId=${shiftRecordId}`)
    .then(d => d.data)
    .catch(err => {
      shiftSegmentsCache.delete(shiftRecordId);
      throw err;
    });

  shiftSegmentsCache.set(shiftRecordId, promise);
  return promise;
}

export async function fetchShiftSegmentsBatch(
  shiftRecordIds: number[],
  options: { force?: boolean } = {},
): Promise<Record<number, ShiftSegment[]>> {
  const ids = [...new Set(shiftRecordIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return {};

  const result: Record<number, ShiftSegment[]> = {};
  const cachedIds: number[] = [];
  const fetchIds: number[] = [];

  for (const id of ids) {
    const cached = shiftSegmentsCache.get(id);
    if (!options.force && cached) {
      cachedIds.push(id);
    } else {
      fetchIds.push(id);
    }
  }

  await Promise.all(cachedIds.map(async id => {
    result[id] = await shiftSegmentsCache.get(id)!;
  }));

  if (fetchIds.length > 0) {
    for (let i = 0; i < fetchIds.length; i += SHIFT_SEGMENTS_BATCH_SIZE) {
      const chunk = fetchIds.slice(i, i + SHIFT_SEGMENTS_BATCH_SIZE);
      const q = new URLSearchParams({ ids: chunk.join(',') });
      const batchPromise = get<{ data: Record<string, ShiftSegment[]>; total: number }>(`${BASE}/shift-segments/batch?${q}`);
      await Promise.all(chunk.map(async id => {
        const promise = batchPromise
          .then(batch => batch.data[String(id)] ?? [])
          .catch(err => {
            shiftSegmentsCache.delete(id);
            throw err;
          });
        shiftSegmentsCache.set(id, promise);
        result[id] = await promise;
      }));
    }
  }

  return result;
}

export async function saveOrderNorms(norms: { number: number; tripsPerShift: number }[]): Promise<void> {
  const r = await fetch(`${BASE}/order-norms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ norms }),
  });
  if (!r.ok) throw new Error(`API error: ${r.status}`);
}
