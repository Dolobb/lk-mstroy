import React from 'react';
import { DateRangePicker } from '../../components/DateRangePicker/DateRangePicker';
import type { ReportType, ReportMeta, ReportFilters } from './types';

interface Props {
  reportType: ReportType;
  onTypeChange: (t: ReportType) => void;
  dateFrom: string;
  dateTo: string;
  onDateChange: (from: string, to: string) => void;
  meta: ReportMeta | null;
  filters: ReportFilters;
  onFiltersChange: (f: ReportFilters) => void;
}

const selectClass =
  'bg-card-inner/50 border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer';

export const ReportConfig: React.FC<Props> = ({
  reportType,
  onTypeChange,
  dateFrom,
  dateTo,
  onDateChange,
  meta,
  filters,
  onFiltersChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Report type */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Тип отчёта</label>
        <select
          value={reportType}
          onChange={e => onTypeChange(e.target.value as ReportType)}
          className={selectClass}
        >
          {(meta?.reportTypes || []).map(rt => (
            <option key={rt.id} value={rt.id}>{rt.label}</option>
          ))}
          {!meta && (
            <>
              <option value="kip">Отчёт КИП</option>
              <option value="dump-truck-trips">Отчёт по рейсам самосвалов</option>
            </>
          )}
        </select>
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Период</label>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRangeChange={onDateChange}
        />
      </div>

      {/* Object filter — dump trucks only */}
      {reportType === 'dump-truck-trips' && meta?.filters?.objects && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Объект</label>
          <select
            value={filters.objectUid || ''}
            onChange={e => onFiltersChange({ ...filters, objectUid: e.target.value || undefined })}
            className={selectClass}
          >
            <option value="">Все объекты</option>
            {meta.filters.objects.map(o => (
              <option key={o.uid} value={o.uid}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Department filter — KIP only */}
      {reportType === 'kip' && meta?.filters?.departments && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">СМУ</label>
          <select
            value={filters.departments?.[0] || ''}
            onChange={e => onFiltersChange({
              ...filters,
              departments: e.target.value ? [e.target.value] : undefined,
            })}
            className={selectClass}
          >
            <option value="">Все СМУ</option>
            {meta.filters.departments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Vehicle filter */}
      {meta?.filters?.vehicles && meta.filters.vehicles.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">ТС</label>
          <select
            value={filters.vehicles?.[0] || ''}
            onChange={e => onFiltersChange({
              ...filters,
              vehicles: e.target.value ? [e.target.value] : undefined,
            })}
            className={selectClass}
          >
            <option value="">Все ТС</option>
            {meta.filters.vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
