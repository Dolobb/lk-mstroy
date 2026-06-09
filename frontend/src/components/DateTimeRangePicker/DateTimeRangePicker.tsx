import React, { useState, useCallback, useMemo } from 'react';
import { type DateRange } from 'react-day-picker';
import {
  startOfWeek, endOfWeek,
  subDays, format, parseISO,
} from 'date-fns';
import { DatePickerCore, fmtTrigger, matchPreset, type DatePreset } from '../DateRangePicker';

export interface DateTimeRangePickerProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
  tz?: string;
}

const SHIFT1_START = { hours: 7, minutes: 30 };
const SHIFT1_END = { hours: 19, minutes: 30 };
const SHIFT2_START = { hours: 19, minutes: 30 };
const SHIFT2_END = { hours: 7, minutes: 30 };

const WK = { weekStartsOn: 1 as const };

function clampToDate(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  return out;
}

function shiftDay(ts: number, plusDays: number): Date {
  const d = new Date(ts);
  d.setDate(d.getDate() + plusDays);
  return d;
}

function setTime(d: Date, h: number, m: number): Date {
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

function mkDate(ts: number, h: number, m: number): Date {
  const d = new Date(ts);
  d.setHours(h, m, 0, 0);
  return d;
}

function shiftEndDate(ts: number, plusDays: number, h: number, m: number): Date {
  const d = shiftDay(ts, plusDays);
  d.setHours(h, m, 0, 0);
  return d;
}

function getCurrentShift(now: Date): { from: Date; to: Date } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minutes = now.getHours() * 60 + now.getMinutes();
  const shift1StartMin = SHIFT1_START.hours * 60 + SHIFT1_START.minutes;
  const shift2StartMin = SHIFT2_START.hours * 60 + SHIFT2_START.minutes;

  if (minutes >= shift1StartMin && minutes < shift2StartMin) {
    return {
      from: setTime(midnight, SHIFT1_START.hours, SHIFT1_START.minutes),
      to: setTime(midnight, SHIFT1_END.hours, SHIFT1_END.minutes),
    };
  }
  const yesterdayMidnight = shiftDay(midnight.getTime(), -1);
  return {
    from: setTime(yesterdayMidnight, SHIFT2_START.hours, SHIFT2_START.minutes),
    to: setTime(midnight, SHIFT2_END.hours, SHIFT2_END.minutes),
  };
}

function buildPresets(now: Date): DatePreset[] {
  const ts = now.getTime();
  const currentShift = getCurrentShift(now);

  return [
    { label: 'Текущая смена', from: currentShift.from, to: currentShift.to },
    {
      label: 'Утренняя смена',
      from: mkDate(ts, SHIFT1_START.hours, SHIFT1_START.minutes),
      to: mkDate(ts, SHIFT1_END.hours, SHIFT1_END.minutes),
    },
    {
      label: 'Вечерняя смена (вчера)',
      from: shiftEndDate(ts, -1, SHIFT2_START.hours, SHIFT2_START.minutes),
      to: shiftEndDate(ts, 0, SHIFT2_END.hours, SHIFT2_END.minutes),
    },
    {
      label: 'Сегодня',
      from: mkDate(ts, 0, 0),
      to: mkDate(ts, 23, 45),
    },
    {
      label: 'Вчера',
      from: setTime(shiftDay(ts, -1), 0, 0),
      to: setTime(shiftDay(ts, -1), 23, 45),
    },
    {
      label: 'Эта неделя',
      from: setTime(startOfWeek(new Date(ts), WK), 0, 0),
      to: setTime(endOfWeek(new Date(ts), WK), 23, 45),
    },
  ];
}

function toHmLabel(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

interface TimeSelectProps {
  value: Date;
  onChange: (d: Date) => void;
  min?: Date;
  max?: Date;
}

const TIME_STEPS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

function TimeSelect({ value, onChange }: TimeSelectProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const next = new Date(value);
    next.setHours(h, m, 0, 0);
    onChange(next);
  }, [value, onChange]);

  return (
    <select
      value={toHmLabel(value)}
      onChange={handleChange}
      className="sv-dp-time-select"
      style={{
        padding: '4px 6px',
        borderRadius: '6px',
        border: '1px solid var(--dp-border, rgba(0,0,0,0.1))',
        background: 'var(--dp-bg, transparent)',
        color: 'var(--dp-text, inherit)',
        fontSize: '11px',
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {TIME_STEPS.map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}

export function DateTimeRangePicker({
  from,
  to,
  onChange,
  tz: _tz,
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false);

  const currentRange: DateRange = useMemo(() => ({
    from: clampToDate(from),
    to: clampToDate(to),
  }), [from, to]);

  const [draftRange, setDraftRange] = useState<DateRange | undefined>(currentRange);
  const [displayMonth, setDisplayMonth] = useState(() => clampToDate(from));

  const [draftFromTime, setDraftFromTime] = useState(() => new Date(from));
  const [draftToTime, setDraftToTime] = useState(() => new Date(to));

  const presets = useMemo(() => buildPresets(new Date()), [open]);

  const prevFrom = React.useRef(from.getTime());
  const prevTo = React.useRef(to.getTime());
  if (prevFrom.current !== from.getTime() || prevTo.current !== to.getTime()) {
    prevFrom.current = from.getTime();
    prevTo.current = to.getTime();
    setDraftRange({ from: clampToDate(from), to: clampToDate(to) });
    setDraftFromTime(new Date(from));
    setDraftToTime(new Date(to));
  }

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRange({ from: clampToDate(from), to: clampToDate(to) });
      setDraftFromTime(new Date(from));
      setDraftToTime(new Date(to));
      setDisplayMonth(clampToDate(from));
    }
    setOpen(nextOpen);
  }, [from, to]);

  const handlePreset = useCallback((p: DatePreset) => {
    onChange(clampToDate(p.from), clampToDate(p.to));
    setOpen(false);
  }, [onChange]);

  const handleApply = useCallback(() => {
    if (draftRange?.from && draftRange?.to) {
      const fromDate = new Date(draftRange.from);
      fromDate.setHours(draftFromTime.getHours(), draftFromTime.getMinutes(), 0, 0);
      const toDate = new Date(draftRange.to);
      toDate.setHours(draftToTime.getHours(), draftToTime.getMinutes(), 0, 0);
      onChange(fromDate, toDate);
    }
    setOpen(false);
  }, [draftRange, draftFromTime, draftToTime, onChange]);

  const handleCancel = useCallback(() => {
    setDraftRange(currentRange);
    setOpen(false);
  }, [currentRange]);

  const handleRangeChange = useCallback((range: DateRange | undefined) => {
    setDraftRange(range);
    if (range?.from) {
      setDraftFromTime(prev => {
        const next = new Date(range.from!);
        next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        return next;
      });
    }
    if (range?.to) {
      setDraftToTime(prev => {
        const next = new Date(range.to!);
        next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        return next;
      });
    }
  }, []);

  const activePresetIdx = matchPreset(draftRange, presets);

  const fromLabel = format(from, 'dd.MM.yyyy');
  const toLabel = format(to, 'dd.MM.yyyy');
  const sameYear = from.getFullYear() === to.getFullYear();
  const displayFrom = format(from, 'dd.MM' + (sameYear ? '' : '.yyyy'));
  const displayTo = format(to, 'dd.MM.yyyy');

  const triggerContent = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span>{displayFrom} {toHmLabel(from)} — {displayTo} {toHmLabel(to)}</span>
    </>
  );

  const footerContent = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <TimeSelect value={draftFromTime} onChange={setDraftFromTime} />
      <span style={{ color: 'var(--dp-muted)', fontSize: 12 }}>—</span>
      <TimeSelect value={draftToTime} onChange={setDraftToTime} />
    </div>
  );

  return (
    <DatePickerCore
      open={open}
      onOpenChange={handleOpenChange}
      selectedRange={draftRange}
      onRangeChange={handleRangeChange}
      displayMonth={displayMonth}
      onDisplayMonthChange={setDisplayMonth}
      presets={presets}
      activePresetIdx={activePresetIdx}
      onPreset={handlePreset}
      onApply={handleApply}
      onCancel={handleCancel}
      triggerContent={triggerContent}
      footerContent={footerContent}
    />
  );
}
