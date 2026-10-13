import React, { useState, useEffect, useCallback } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { ReportConfig } from './ReportConfig';
import { ColumnConfigurator } from './ColumnConfigurator';
import { fetchReportMeta, generateReport, downloadBlob } from './api';
import type { ReportType, ReportMeta, ReportFilters } from './types';
import { format } from 'date-fns';

const SHIFT_START_MIN = 7 * 60 + 30; // 07:30 — граница операционных суток

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Операционные сутки (report_date) момента: до 07:30 — это предыдущий день.
function operationalDay(d: Date): string {
  const min = d.getHours() * 60 + d.getMinutes();
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (min < SHIFT_START_MIN) base.setDate(base.getDate() - 1);
  return ymd(base);
}

// Пикер отдаёт from = 07:30 «от», to = 07:30 выбранного «до» (начало его дневной смены).
// Операционные сутки идут 07:30→07:30, поэтому выбранный «до» день включается ПОЛНОСТЬЮ
// (его обе смены, ночная заканчивается в 07:30 следующего дня). Диапазон report_date:
// operationalDay(from) .. operationalDay(to) включительно.
function toReportRange(from: Date, to: Date): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: operationalDay(from),
    dateTo: operationalDay(to),
  };
}

const now = new Date();
function at730(base: Date, plusDays = 0): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + plusDays);
  d.setHours(7, 30, 0, 0);
  return d;
}
// Дефолт: последние 7 операционных суток (07:30 семь дней назад → 07:30 сегодня).
const defaultFrom = at730(now, -7);
const defaultTo = at730(now, 0);

// ─── Sticky-состояние (localStorage), как на странице «Аналитика» ──────
const LS_FROM = 'sv-reports-from';
const LS_TO = 'sv-reports-to';
const LS_SHIFT = 'sv-reports-shift';
const LS_TYPE = 'sv-reports-type';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* SSR / quota — игнор */ }
}
function initDate(key: string, fallback: Date): Date {
  const cached = lsGet(key);
  if (cached) {
    const d = new Date(cached);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}
function initShift(): 'all' | 'shift1' | 'shift2' {
  const v = lsGet(LS_SHIFT);
  return v === 'shift1' || v === 'shift2' ? v : 'all';
}
function initType(): ReportType {
  const v = lsGet(LS_TYPE);
  return v === 'dump-truck-trips' || v === 'dump-truck-onsite' ? v : 'kip';
}

export const ReportsPage: React.FC = () => {
  const [reportType, setReportType] = useState<ReportType>(initType);
  const [dateFrom, setDateFrom] = useState<Date>(() => initDate(LS_FROM, defaultFrom));
  const [dateTo, setDateTo] = useState<Date>(() => initDate(LS_TO, defaultTo));
  // Фильтр смены: 'all' (обе, дефолт) | 'shift1' | 'shift2'
  const [shiftType, setShiftType] = useState<'all' | 'shift1' | 'shift2'>(initShift);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [splitByDays, setSplitByDays] = useState(false);
  const [splitByShifts, setSplitByShifts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load meta on type/date change (мета зависит от диапазона операционных суток)
  const loadMeta = useCallback(async () => {
    try {
      const { dateFrom: df, dateTo: dt } = toReportRange(dateFrom, dateTo);
      const m = await fetchReportMeta(reportType, df, dt);
      setMeta(m);
      // Reset columns to defaults for this report type
      setIncluded(m.columns.filter(c => c.defaultIncluded).map(c => c.id));
      setFilters({});
    } catch (err) {
      console.error('Failed to load meta:', err);
    }
  }, [reportType, dateFrom, dateTo]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Sticky: сохраняем выбор в localStorage при каждом изменении.
  useEffect(() => { lsSet(LS_FROM, dateFrom.toISOString()); }, [dateFrom]);
  useEffect(() => { lsSet(LS_TO, dateTo.toISOString()); }, [dateTo]);
  useEffect(() => { lsSet(LS_SHIFT, shiftType); }, [shiftType]);
  useEffect(() => { lsSet(LS_TYPE, reportType); }, [reportType]);

  const handleDateChange = (from: Date, to: Date) => {
    setDateFrom(from);
    setDateTo(to);
  };

  const handleTypeChange = (t: ReportType) => {
    setReportType(t);
    setError(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { dateFrom: df, dateTo: dt } = toReportRange(dateFrom, dateTo);
      const blob = await generateReport({
        reportType,
        dateFrom: df,
        dateTo: dt,
        columns: included,
        filters: { ...filters, shiftType },
        splitByDays: reportType === 'kip' ? splitByDays : undefined,
        splitByShifts: reportType === 'kip' ? splitByShifts : undefined,
      });
      downloadBlob(blob, `report_${reportType}_${df}_${dt}.xlsx`);
    } catch (err: any) {
      setError(err.message || 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      {/* Block 1: Parameters */}
      <div className="glass-card rounded-[18px] p-4 shrink-0 relative z-20">
        <div className="flex items-center gap-2 mb-3">
          <FileSpreadsheet className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Конструктор отчётов</span>
        </div>
        <ReportConfig
          reportType={reportType}
          onTypeChange={handleTypeChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateChange={handleDateChange}
          shiftType={shiftType}
          onShiftChange={setShiftType}
          meta={meta}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </div>

      {/* Block 2: Column configurator */}
      <div className="flex-1 min-h-0 glass-card rounded-[18px] p-4 overflow-hidden">
        <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
          Столбцы отчёта
        </div>
        {meta ? (
          <div className="h-[calc(100%-24px)]">
            <ColumnConfigurator
              allColumns={meta.columns}
              included={included}
              onChange={setIncluded}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Загрузка...
          </div>
        )}
      </div>

      {/* Block 3: Actions */}
      <div className="glass-card rounded-[18px] px-4 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {included.length} столбцов выбрано
          </span>

          {reportType === 'kip' && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={splitByDays}
                  onChange={e => {
                    setSplitByDays(e.target.checked);
                    if (!e.target.checked) setSplitByShifts(false);
                  }}
                  className="size-3.5 accent-primary cursor-pointer"
                />
                <span className="text-xs text-foreground">По дням</span>
              </label>

              {splitByDays && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={splitByShifts}
                    onChange={e => setSplitByShifts(e.target.checked)}
                    className="size-3.5 accent-primary cursor-pointer"
                  />
                  <span className="text-xs text-foreground">По сменам</span>
                </label>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
          <button
            onClick={handleGenerate}
            disabled={loading || included.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium
              hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer border-none"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Сгенерировать
          </button>
        </div>
      </div>
    </div>
  );
};
