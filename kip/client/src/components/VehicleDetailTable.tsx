import React, { useMemo, useState } from 'react';
import type { VehicleDetailRow } from '../types/vehicle';
import { capDisplay } from '../utils/kpi';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';

interface Props {
  details: VehicleDetailRow[];
}

interface PivotRow {
  date: string;
  morningKip: number | null;
  morningLoad: number | null;
  eveningKip: number | null;
  eveningLoad: number | null;
}

function getKipColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  const v = capDisplay(value);
  if (v < 25) return '#ef4444';
  if (v < 50) return '#eab308';
  if (v < 75) return '#3b82f6';
  return '#22c55e';
}

function getLoadColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  const v = capDisplay(value);
  if (v < 50) return '#ef4444';
  return '#22c55e';
}

function formatDate(d: string): string {
  const clean = d.split('T')[0];
  const parts = clean.split('-');
  return `${parts[2]}.${parts[1]}`;
}

function pct(v: number | null): string {
  if (v == null) return '';
  return Math.round(capDisplay(v)).toString();
}

const MIN_ROWS = 7;

const VehicleDetailTable: React.FC<Props> = ({ details }) => {
  const { pivotRows, totals } = useMemo(() => {
    const byDate = new Map<string, { morning?: VehicleDetailRow; evening?: VehicleDetailRow }>();

    for (const d of details) {
      const dateKey = d.report_date.split('T')[0];
      if (!byDate.has(dateKey)) byDate.set(dateKey, {});
      const entry = byDate.get(dateKey)!;
      if (d.shift_type === 'morning') entry.morning = d;
      else entry.evening = d;
    }

    const dates = Array.from(byDate.keys()).sort();

    const rows: PivotRow[] = dates.map(date => {
      const entry = byDate.get(date)!;
      return {
        date,
        morningKip: entry.morning?.utilization_ratio ?? null,
        morningLoad: entry.morning?.load_efficiency_pct ?? null,
        eveningKip: entry.evening?.utilization_ratio ?? null,
        eveningLoad: entry.evening?.load_efficiency_pct ?? null,
      };
    });

    let mKipSum = 0, mKipCount = 0;
    let mLoadSum = 0, mLoadCount = 0;
    let eKipSum = 0, eKipCount = 0;
    let eLoadSum = 0, eLoadCount = 0;

    for (const d of details) {
      if (d.shift_type === 'morning') {
        mKipSum += d.utilization_ratio; mKipCount++;
        mLoadSum += d.load_efficiency_pct; mLoadCount++;
      } else {
        eKipSum += d.utilization_ratio; eKipCount++;
        eLoadSum += d.load_efficiency_pct; eLoadCount++;
      }
    }

    return {
      pivotRows: rows,
      totals: {
        morningKip: mKipCount > 0 ? mKipSum / mKipCount : null,
        morningLoad: mLoadCount > 0 ? mLoadSum / mLoadCount : null,
        eveningKip: eKipCount > 0 ? eKipSum / eKipCount : null,
        eveningLoad: eLoadCount > 0 ? eLoadSum / eLoadCount : null,
      },
    };
  }, [details]);

  const displayRows = [...pivotRows];
  while (displayRows.length < MIN_ROWS) {
    displayRows.push({ date: '', morningKip: null, morningLoad: null, eveningKip: null, eveningLoad: null });
  }

  return (
    <div className="glass-card flex flex-col overflow-hidden h-full min-h-0">
      <div className="px-3 pt-2 pb-1 shrink-0 flex items-center justify-between">
        <h3 className="font-bold text-foreground" style={{ fontSize: '12px' }}>
          Выработка МиМ по дням
        </h3>
        <Dialog>
          <DialogTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none"
              style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}
            >
              Все параметры
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-5xl glass-card border-border" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <DialogHeader>
              <DialogTitle style={{ fontSize: '13px' }}>Параметры расчёта по дням / сменам</DialogTitle>
            </DialogHeader>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    {['Дата', 'Смена', 'Вр.зоны ч', 'Двиг. ч', 'Простой ч', 'Расход л', 'Норма л/ч', 'Факт л/ч', 'КИП %', 'Нагр. %'].map(h => (
                      <TableHead key={h} className="text-muted-foreground font-semibold uppercase whitespace-nowrap" style={{ fontSize: '8px', padding: '4px 8px' }}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...details].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.shift_type.localeCompare(b.shift_type)).map((row, i) => (
                    <TableRow key={i} className="border-border hover:bg-muted/30">
                      <TableCell className="font-medium text-foreground whitespace-nowrap" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {formatDate(row.report_date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.shift_type === 'morning' ? '1' : '2'}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.total_stay_time.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.engine_on_time.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.idle_time.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.fuel_consumed_total.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.fuel_rate_norm.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-foreground" style={{ fontSize: '11px', padding: '5px 8px' }}>
                        {row.fuel_rate_fact.toFixed(1)}
                      </TableCell>
                      <TableCell className="font-semibold" style={{ fontSize: '11px', padding: '5px 8px', color: getKipColor(row.utilization_ratio) }}>
                        {pct(row.utilization_ratio)}
                      </TableCell>
                      <TableCell className="font-semibold" style={{ fontSize: '11px', padding: '5px 8px', color: getLoadColor(row.load_efficiency_pct) }}>
                        {pct(row.load_efficiency_pct)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-2">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead
                rowSpan={2}
                className="text-muted-foreground font-semibold uppercase align-bottom"
                style={{ fontSize: '8px', padding: '3px 6px' }}
              >
                Дата
              </TableHead>
              <TableHead
                colSpan={2}
                className="text-center text-muted-foreground font-semibold uppercase border-b-0"
                style={{ fontSize: '8px', padding: '3px 6px' }}
              >
                1 Смена, %
              </TableHead>
              <TableHead
                colSpan={2}
                className="text-center text-muted-foreground font-semibold uppercase border-b-0"
                style={{ fontSize: '8px', padding: '3px 6px' }}
              >
                2 Смена, %
              </TableHead>
            </TableRow>
            <TableRow className="border-border hover:bg-transparent">
              {['КИП', 'Под нагр.', 'КИП', 'Под нагр.'].map((h, i) => (
                <TableHead
                  key={i}
                  className="text-center text-muted-foreground font-semibold uppercase"
                  style={{ fontSize: '8px', padding: '2px 6px' }}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {displayRows.map((row, i) => (
              <TableRow key={i} className="border-border hover:bg-muted/30">
                <TableCell className="font-medium text-foreground whitespace-nowrap" style={{ fontSize: '11px', padding: '4px 6px' }}>
                  {row.date ? formatDate(row.date) : ''}
                </TableCell>
                <TableCell className="text-center font-semibold" style={{ fontSize: '11px', padding: '4px 6px', color: getKipColor(row.morningKip) }}>
                  {pct(row.morningKip)}
                </TableCell>
                <TableCell className="text-center font-semibold" style={{ fontSize: '11px', padding: '4px 6px', color: getLoadColor(row.morningLoad) }}>
                  {pct(row.morningLoad)}
                </TableCell>
                <TableCell className="text-center font-semibold" style={{ fontSize: '11px', padding: '4px 6px', color: getKipColor(row.eveningKip) }}>
                  {pct(row.eveningKip)}
                </TableCell>
                <TableCell className="text-center font-semibold" style={{ fontSize: '11px', padding: '4px 6px', color: getLoadColor(row.eveningLoad) }}>
                  {pct(row.eveningLoad)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          <TableFooter className="bg-transparent border-t-2 border-border">
            <TableRow className="hover:bg-muted/30 border-0">
              <TableCell className="font-bold text-foreground" style={{ fontSize: '11px', padding: '4px 6px' }}>
                Итого
              </TableCell>
              <TableCell className="text-center font-bold" style={{ fontSize: '11px', padding: '4px 6px', color: getKipColor(totals.morningKip) }}>
                {pct(totals.morningKip)}
              </TableCell>
              <TableCell className="text-center font-bold" style={{ fontSize: '11px', padding: '4px 6px', color: getLoadColor(totals.morningLoad) }}>
                {pct(totals.morningLoad)}
              </TableCell>
              <TableCell className="text-center font-bold" style={{ fontSize: '11px', padding: '4px 6px', color: getKipColor(totals.eveningKip) }}>
                {pct(totals.eveningKip)}
              </TableCell>
              <TableCell className="text-center font-bold" style={{ fontSize: '11px', padding: '4px 6px', color: getLoadColor(totals.eveningLoad) }}>
                {pct(totals.eveningLoad)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
};

export default VehicleDetailTable;
