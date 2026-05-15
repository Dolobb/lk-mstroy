import React, { useState, useCallback, useMemo } from 'react';
import { type DateRange } from 'react-day-picker';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subDays, subWeeks, subMonths, format, parse, isValid,
} from 'date-fns';
import {
  DatePickerCore,
  matchPreset,
  fmtTrigger,
  type DatePreset,
} from './DatePickerCore';
import './DateRangePicker.css';

export interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onRangeChange: (from: string, to: string) => void;
  shift?: 'all' | 'shift1' | 'shift2';
  onShiftChange?: (s: 'all' | 'shift1' | 'shift2') => void;
}

const toYmd = (d: Date) => format(d, 'yyyy-MM-dd');
const toDate = (s: string) => parse(s, 'yyyy-MM-dd', new Date());

const WK = { weekStartsOn: 1 as const };

function buildPresets(): DatePreset[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    { label: 'Сегодня',         from: today, to: today },
    { label: 'Вчера',           from: subDays(today, 1), to: subDays(today, 1) },
    { label: 'Текущая неделя',  from: startOfWeek(today, WK), to: endOfWeek(today, WK) },
    { label: 'Прошлая неделя',  from: startOfWeek(subWeeks(today, 1), WK), to: endOfWeek(subWeeks(today, 1), WK) },
    { label: 'Этот месяц',      from: startOfMonth(today), to: endOfMonth(today) },
    { label: 'Прошлый месяц',   from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) },
  ];
}

export function DateRangePicker({ dateFrom, dateTo, onRangeChange, shift, onShiftChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const currentRange: DateRange = useMemo(() => ({
    from: toDate(dateFrom),
    to: toDate(dateTo),
  }), [dateFrom, dateTo]);

  const [draftRange, setDraftRange] = useState<DateRange | undefined>(currentRange);
  const [displayMonth, setDisplayMonth] = useState(() => toDate(dateFrom));

  const presets = useMemo(() => buildPresets(), []);

  const prevFrom = React.useRef(dateFrom);
  const prevTo = React.useRef(dateTo);
  if (prevFrom.current !== dateFrom || prevTo.current !== dateTo) {
    prevFrom.current = dateFrom;
    prevTo.current = dateTo;
    setDraftRange({ from: toDate(dateFrom), to: toDate(dateTo) });
  }

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRange({ from: toDate(dateFrom), to: toDate(dateTo) });
      setDisplayMonth(toDate(dateFrom));
    }
    setOpen(nextOpen);
  }, [dateFrom, dateTo]);

  const handlePreset = useCallback((p: DatePreset) => {
    onRangeChange(toYmd(p.from), toYmd(p.to));
    setOpen(false);
  }, [onRangeChange]);

  const handleApply = useCallback(() => {
    if (draftRange?.from && draftRange?.to) {
      onRangeChange(toYmd(draftRange.from), toYmd(draftRange.to));
    } else if (draftRange?.from) {
      onRangeChange(toYmd(draftRange.from), toYmd(draftRange.from));
    }
    setOpen(false);
  }, [draftRange, onRangeChange]);

  const handleCancel = useCallback(() => {
    setDraftRange(currentRange);
    setOpen(false);
  }, [currentRange]);

  const handleShift = useCallback((s: 'all' | 'shift1' | 'shift2') => {
    onShiftChange?.(s);
  }, [onShiftChange]);

  const activePresetIdx = matchPreset(draftRange, presets);

  const triggerContent = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span>{fmtTrigger(dateFrom, dateTo)}</span>
      {shift && (
        <span className="sv-dp-shift-badge">
          {shift === 'all' ? 'Обе' : shift === 'shift1' ? '1 см.' : '2 см.'}
        </span>
      )}
    </>
  );

  const sidebarContent = onShiftChange ? (
    <div className="sv-dp-shifts">
      <button
        type="button"
        className={`sv-dp-shift-btn${shift === 'all' ? ' active' : ''}`}
        onClick={() => handleShift('all')}
      >
        Обе смены
      </button>
      <div className="sv-dp-shift-row">
        <button
          type="button"
          className={`sv-dp-shift-btn${shift === 'shift1' ? ' active' : ''}`}
          onClick={() => handleShift('shift1')}
        >
          1-я смена
        </button>
        <button
          type="button"
          className={`sv-dp-shift-btn${shift === 'shift2' ? ' active' : ''}`}
          onClick={() => handleShift('shift2')}
        >
          2-я смена
        </button>
      </div>
    </div>
  ) : undefined;

  return (
    <DatePickerCore
      open={open}
      onOpenChange={handleOpenChange}
      selectedRange={draftRange}
      onRangeChange={setDraftRange}
      displayMonth={displayMonth}
      onDisplayMonthChange={setDisplayMonth}
      presets={presets}
      activePresetIdx={activePresetIdx}
      onPreset={handlePreset}
      onApply={handleApply}
      onCancel={handleCancel}
      triggerContent={triggerContent}
      sidebarContent={sidebarContent}
    />
  );
}
