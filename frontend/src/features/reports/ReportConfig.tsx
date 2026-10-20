import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateTimeRangePicker } from '@/components/DateTimeRangePicker';
import type { ReportType, ReportMeta, ReportFilters } from './types';

export type ReportShift = 'all' | 'shift1' | 'shift2';

interface MultiSelectProps {
  allLabel: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

const MultiSelect: React.FC<MultiSelectProps> = ({ allLabel, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find(o => o.id === selected[0])?.label || `${selected.length} выбрано`
      : `${selected.length} выбрано`;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="bg-card-inner/50 border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer flex items-center gap-2 w-full min-w-0 justify-between"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground border-b border-border/40"
              >
                Снять все
              </button>
            )}
            {options.map(o => (
              <label
                key={o.id}
                onClick={() => toggle(o.id)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-card-inner/50 cursor-pointer"
              >
                <div
                  className={cn(
                    'size-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                    selected.includes(o.id) ? 'bg-primary border-primary' : 'border-muted-foreground',
                  )}
                >
                  {selected.includes(o.id) && (
                    <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-[11px] text-foreground break-words min-w-0">{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface Props {
  reportType: ReportType;
  onTypeChange: (t: ReportType) => void;
  dateFrom: Date;
  dateTo: Date;
  onDateChange: (from: Date, to: Date) => void;
  shiftType: ReportShift;
  onShiftChange: (s: ReportShift) => void;
  meta: ReportMeta | null;
  filters: ReportFilters;
  onFiltersChange: (f: ReportFilters) => void;
}

const selectClass =
  'w-full min-w-0 max-w-[320px] bg-popover border border-border/50 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer';

export const ReportConfig: React.FC<Props> = ({
  reportType,
  onTypeChange,
  dateFrom,
  dateTo,
  onDateChange,
  shiftType,
  onShiftChange,
  meta,
  filters,
  onFiltersChange,
}) => {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3">
      {/* Report type */}
      <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Тип отчёта</label>
        <select
          value={reportType}
          onChange={e => onTypeChange(e.target.value as ReportType)}
          className={selectClass} aria-label="Тип отчёта"
        >
          {(meta?.reportTypes || []).map(rt => (
            <option key={rt.id} value={rt.id}>{rt.label}</option>
          ))}
          {!meta && (
            <>
              <option value="kip">Отчёт КИП</option>
              <option value="dump-truck-trips">Отчёт по рейсам самосвалов</option>
              <option value="dump-truck-onsite">Самосвалы — по месту</option>
            </>
          )}
        </select>
      </div>

      {/* Date range — границы операционных суток 07:30→07:30 (как в аналитике) */}
      <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Период</label>
        <DateTimeRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={onDateChange}
        />
      </div>

      {/* Shift filter — дефолт «Обе смены» */}
      <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Смена</label>
        <select
          value={shiftType}
          onChange={e => onShiftChange(e.target.value as ReportShift)}
          className={selectClass}
        >
          <option value="all">Обе смены</option>
          <option value="shift1">1 смена</option>
          <option value="shift2">2 смена</option>
        </select>
      </div>

      {/* Object filter — dump trucks (trips + onsite) */}
      {(reportType === 'dump-truck-trips' || reportType === 'dump-truck-onsite') && meta?.filters?.objects && (
        <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Объект</label>
          <MultiSelect
            allLabel="Все объекты"
            options={meta.filters.objects.map(o => ({ id: o.uid, label: o.name }))}
            selected={filters.objectUids || []}
            onChange={ids => onFiltersChange({
              ...filters,
              objectUids: ids.length > 0 ? ids : undefined,
            })}
          />
        </div>
      )}

      {/* Department filter — KIP only */}
      {reportType === 'kip' && meta?.filters?.departments && (
        <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">СМУ</label>
          <select
            aria-label="СМУ" title={filters.departments?.[0] || 'Все СМУ'}
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
        <div className="flex flex-col gap-1 min-w-0 max-w-[320px]">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">ТС</label>
          <MultiSelect
            allLabel="Все ТС"
            options={meta.filters.vehicles}
            selected={filters.vehicles || []}
            onChange={ids => onFiltersChange({
              ...filters,
              vehicles: ids.length > 0 ? ids : undefined,
            })}
          />
        </div>
      )}
    </div>
  );
};
