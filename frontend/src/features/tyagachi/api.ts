import type {
  DashboardSummary,
  TyagachiVehicle,
  TyagachiRequest,
  SyncStatus,
  RequestDataResponse,
  LegacyReport,
} from './types';

const BASE = '/api/tyagachi';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

// ===================== Dashboard =====================

export const getDashboardSummary = (): Promise<DashboardSummary> =>
  get<DashboardSummary>(`${BASE}/dashboard/summary`);

export const getVehicles = (days?: number): Promise<TyagachiVehicle[]> => {
  const q = days ? `?days=${days}` : '';
  return get<{ vehicles: TyagachiVehicle[] }>(`${BASE}/vehicles${q}`).then((d) => d.vehicles);
};

export const getVehicleRequests = (vehicleId: number, days?: number): Promise<TyagachiRequest[]> => {
  const q = days ? `?days=${days}` : '';
  return get<{ requests: TyagachiRequest[] }>(`${BASE}/vehicles/${vehicleId}/requests${q}`).then(
    (d) => d.requests
  );
};

// ===================== Sync =====================

export const startSync = (period_days: number): Promise<unknown> =>
  fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period_days }),
  }).then((r) => r.json());

export const getSyncStatus = (): Promise<SyncStatus> =>
  get<SyncStatus>(`${BASE}/sync/status`);

// ===================== Report viewer =====================

export const getRequestData = (requestNumber: number): Promise<RequestDataResponse> =>
  get<RequestDataResponse>(`${BASE}/request/${requestNumber}/data`);

// ===================== Legacy reports =====================

export const getLegacyReports = (): Promise<LegacyReport[]> =>
  get<{ reports: LegacyReport[] }>(`${BASE}/reports`).then((d) => d.reports);

export const getLegacyReportUrl = (reportId: number): string =>
  `${BASE}/reports/${reportId}/v2`;

export const createReport = (body: {
  from_pl: string;
  to_pl: string;
  from_requests: string;
  to_requests: string;
  title?: string;
}): Promise<{ report_id?: number; message?: string; error?: string }> =>
  fetch(`${BASE}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

export const getFetchStatus = (): Promise<{ running: boolean; progress: string; error: string | null }> =>
  get(`${BASE}/status`);
