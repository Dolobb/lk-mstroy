import React, { useState, useCallback, useMemo } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/src/style.css';
import { ru } from 'react-day-picker/locale';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subDays, subWeeks, subMonths, format, parse, isValid,
} from 'date-fns';
import './DateRangePicker.css';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DateRangePickerProps {
  dateFrom: string;   // YYYY-MM-DD
  dateTo: string;     // YYYY-MM-DD
  onRangeChange: (from: string, to: string) => void;
  shift?: 'all' | 'shift1' | 'shift2';
  onShiftChange?: (s: 'all' | 'shift1' | 'shift2') => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const toYmd = (d: Date) => format(d, 'yyyy-MM-dd');
const toDate = (s: string) => parse(s, 'yyyy-MM-dd', new Date());

function fmtTrigger(from: string, to: string): string {
  const a = toDate(from);
  const b = toDate(to);
  if (!isValid(a) || !isValid(b)) return '—';
  const sameYear = a.getFullYear() === b.getFullYear();
  const fmtA = format(a, 'dd.MM' + (sameYear ? '' : '.yyyy'));
  const fmtB = format(b, 'dd.MM.yyyy');
  return `${fmtA} — ${fmtB}`;
}

function fmtDisplay(d: Date | undefined): string {
  if (!d || !isValid(d)) return '__.__.____';
  return format(d, 'dd.MM.yyyy');
}

const WK = { weekStartsOn: 1 as const };

function buildPresets() {
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

function matchPreset(range: DateRange | undefined, presets: ReturnType<typeof buildPresets>): number {
  if (!range?.from || !range?.to) return -1;
  const f = toYmd(range.from), t = toYmd(range.to);
  return presets.findIndex(p => toYmd(p.from) === f && toYmd(p.to) === t);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DateRangePicker({ dateFrom, dateTo, onRangeChange, shift, onShiftChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const currentRange: DateRange = useMemo(() => ({
    from: toDate(dateFrom),
    to: toDate(dateTo),
  }), [dateFrom, dateTo]);

  const [draftRange, setDraftRange] = useState<DateRange | undefined>(currentRange);
  const [displayMonth, setDisplayMonth] = useState(() => toDate(dateFrom));

  const presets = useMemo(() => buildPresets(), []);

  // Sync draft when props change externally
  const prevFrom = React.useRef(dateFrom);
  const prevTo = React.useRef(dateTo);
  if (prevFrom.current !== dateFrom || prevTo.current !== dateTo) {
    prevFrom.current = dateFrom;
    prevTo.current = dateTo;
    setDraftRange({ from: toDate(dateFrom), to: toDate(dateTo) });
  }

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      // Opening: reset draft to current
      setDraftRange({ from: toDate(dateFrom), to: toDate(dateTo) });
      setDisplayMonth(toDate(dateFrom));
    }
    setOpen(nextOpen);
  }, [dateFrom, dateTo]);

  const handlePreset = useCallback((p: { from: Date; to: Date }) => {
    onRangeChange(toYmd(p.from), toYmd(p.to));
    setOpen(false);
  }, [onRangeChange]);

  const handleApply = useCallback(() => {
    if (draftRange?.from && draftRange?.to) {
      onRangeChange(toYmd(draftRange.from), toYmd(draftRange.to));
    } else if (draftRange?.from) {
      // Single day selected
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

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button className="sv-dp-trigger" type="button">
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
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={6} className="sv-dp-popover">
          <div className="sv-dp-panel">
            {/* Sidebar */}
            <div className="sv-dp-sidebar">
              {presets.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  className={`sv-dp-preset${activePresetIdx === i ? ' active' : ''}`}
                  onClick={() => handlePreset(p)}
                >
                  {p.label}
                </button>
              ))}
              {onShiftChange && (
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
              )}
            </div>

            {/* Calendars */}
            <div className="sv-dp-calendars">
              <DayPicker
                mode="range"
                locale={ru}
                numberOfMonths={2}
                weekStartsOn={1}
                showOutsideDays
                selected={draftRange}
                onSelect={setDraftRange}
                month={displayMonth}
                onMonthChange={setDisplayMonth}
              />
              {/* Footer */}
              <div className="sv-dp-footer">
                <div className="sv-dp-range-display">
                  <span className="sv-dp-range-input">{fmtDisplay(draftRange?.from)}</span>
                  <span>—</span>
                  <span className="sv-dp-range-input">{fmtDisplay(draftRange?.to)}</span>
                </div>
                <div className="sv-dp-actions">
                  <button type="button" className="sv-dp-cancel" onClick={handleCancel}>Отмена</button>
                  <button type="button" className="sv-dp-apply" onClick={handleApply} disabled={!draftRange?.from}>Применить</button>
                </div>
              </div>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
