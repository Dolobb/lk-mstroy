import React, { useState, useCallback } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/src/style.css';
import { ru } from 'react-day-picker/locale';
import { format, parse, isValid } from 'date-fns';
import './DateRangePicker.css';

export interface DatePreset {
  label: string;
  from: Date;
  to: Date;
  /** Показать тонкий разделитель после этого пресета (между сменными и календарными). */
  dividerAfter?: boolean;
}

export interface DatePickerCoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRange: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  displayMonth: Date;
  onDisplayMonthChange: (month: Date) => void;
  presets: DatePreset[];
  activePresetIdx: number;
  onPreset: (preset: DatePreset) => void;
  onApply: () => void;
  onCancel: () => void;
  triggerContent: React.ReactNode;
  footerContent?: React.ReactNode;
  sidebarContent?: React.ReactNode;
}

const toYmd = (d: Date) => format(d, 'yyyy-MM-dd');
const toDate = (s: string) => parse(s, 'yyyy-MM-dd', new Date());

export function fmtTrigger(from: string, to: string): string {
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

export function matchPreset(range: DateRange | undefined, presets: DatePreset[]): number {
  if (!range?.from || !range?.to) return -1;
  const f = toYmd(range.from), t = toYmd(range.to);
  return presets.findIndex(p => toYmd(p.from) === f && toYmd(p.to) === t);
}

export function DatePickerCore({
  open,
  onOpenChange,
  selectedRange,
  onRangeChange,
  displayMonth,
  onDisplayMonthChange,
  presets,
  activePresetIdx,
  onPreset,
  onApply,
  onCancel,
  triggerContent,
  footerContent,
  sidebarContent,
}: DatePickerCoreProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button className="sv-dp-trigger" type="button">
          {triggerContent}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={6} className="sv-dp-popover">
          <div className="sv-dp-panel">
            {/* Sidebar */}
            <div className="sv-dp-sidebar">
              {presets.map((p, i) => (
                <React.Fragment key={p.label}>
                  <button
                    type="button"
                    className={`sv-dp-preset${activePresetIdx === i ? ' active' : ''}`}
                    onClick={() => onPreset(p)}
                  >
                    {p.label}
                  </button>
                  {p.dividerAfter && <div className="sv-dp-preset-divider" />}
                </React.Fragment>
              ))}
              {sidebarContent}
            </div>

            {/* Calendars */}
            <div className="sv-dp-calendars">
              <DayPicker
                mode="range"
                locale={ru}
                numberOfMonths={2}
                weekStartsOn={1}
                showOutsideDays
                selected={selectedRange}
                onSelect={onRangeChange}
                month={displayMonth}
                onMonthChange={onDisplayMonthChange}
              />
              {/* Footer */}
              <div className="sv-dp-footer">
                <div className="sv-dp-range-display">
                  <span className="sv-dp-range-input">{fmtDisplay(selectedRange?.from)}</span>
                  <span>—</span>
                  <span className="sv-dp-range-input">{fmtDisplay(selectedRange?.to)}</span>
                </div>
                {footerContent}
                <div className="sv-dp-actions">
                  <button type="button" className="sv-dp-cancel" onClick={onCancel}>Отмена</button>
                  <button type="button" className="sv-dp-apply" onClick={onApply} disabled={!selectedRange?.from}>Применить</button>
                </div>
              </div>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
