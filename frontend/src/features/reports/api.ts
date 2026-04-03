import type { ReportType, ReportMeta, ReportFilters } from './types';

const BASE = '/api/reports';

export async function fetchReportMeta(
  type: ReportType,
  dateFrom: string,
  dateTo: string,
): Promise<ReportMeta> {
  const q = new URLSearchParams({ type, dateFrom, dateTo });
  const r = await fetch(`${BASE}/meta?${q}`);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
}

export async function generateReport(config: {
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  columns: string[];
  filters: ReportFilters;
  splitByDays?: boolean;
  splitByShifts?: boolean;
}): Promise<Blob> {
  const r = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || 'Generation failed');
  }
  return r.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
