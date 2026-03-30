import React, { useState, useEffect, useCallback } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { ReportConfig } from './ReportConfig';
import { ColumnConfigurator } from './ColumnConfigurator';
import { fetchReportMeta, generateReport, downloadBlob } from './api';
import type { ReportType, ReportMeta, ReportFilters } from './types';
import { format, startOfWeek, endOfWeek } from 'date-fns';

const toYmd = (d: Date) => format(d, 'yyyy-MM-dd');
const now = new Date();
const defaultFrom = toYmd(startOfWeek(now, { weekStartsOn: 1 }));
const defaultTo = toYmd(endOfWeek(now, { weekStartsOn: 1 }));

export const ReportsPage: React.FC = () => {
  const [reportType, setReportType] = useState<ReportType>('kip');
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [included, setIncluded] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load meta on type/date change
  const loadMeta = useCallback(async () => {
    try {
      const m = await fetchReportMeta(reportType, dateFrom, dateTo);
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

  const handleDateChange = (from: string, to: string) => {
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
      const blob = await generateReport({
        reportType,
        dateFrom,
        dateTo,
        columns: included,
        filters,
      });
      downloadBlob(blob, `report_${reportType}_${dateFrom}_${dateTo}.xlsx`);
    } catch (err: any) {
      setError(err.message || 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      {/* Block 1: Parameters */}
      <div className="glass-card rounded-[18px] p-4 shrink-0">
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
        <div className="text-xs text-muted-foreground">
          {included.length} столбцов выбрано
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
