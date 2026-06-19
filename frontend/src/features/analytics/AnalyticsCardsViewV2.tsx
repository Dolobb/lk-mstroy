import React from 'react';
import type { UnifiedVehicleRow, UnifiedRecord, DataStatusUnit } from './types';
import type { AnalyticsGroup } from './AnalyticsCardsView';
import { VehicleCardV2 } from './VehicleCardV2';
import { DayTimelineNav } from './DayTimelineNav';
import type { TlDay, Shift } from './DayTimelineNav';
import { useRepairPeriods } from '@/features/vehicle-status/useRepairPeriods';
import { getRepairOnDate } from '@/features/vehicle-status/repairPeriods';
import { dataStatusUnitKey } from './hooks/useDataStatus';
import './analyticsV2.css';

// ─── Карточки v2.0 («Навигация по дням») ──────────────────────────────
// Единая навигация по дням сверху (DayTimelineNav), карточки показывают
// статистику ТС за выбранную смену. Тип-фильтры/поиск/объект — снаружи
// (общий filterbar + сайдбар). План: ANALYTICS_CARDS_V2_PLAN.md

function toDateStr(isoDate: string): string {
  return (isoDate.split('T')[0] ?? isoDate).substring(0, 10);
}

/** Последние n календарных дней, заканчивающихся maxDate (по возрастанию). */
function lastNDays(maxDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(maxDate + 'T00:00:00');
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.unshift(`${y}-${m}-${day}`);
    d.setDate(d.getDate() - 1);
  }
  return out;
}

interface AnalyticsCardsViewV2Props {
  filteredGroups: AnalyticsGroup[];   // видимый срез (лимит) — для карточек
  allGroups: AnalyticsGroup[];        // полный набор — для агрегата таймлайна
  dstRecords: Map<string, UnifiedRecord[]>;
  renderWork?: (rec: UnifiedRecord) => React.ReactNode;
  onSelectVehicle?: (regNumber: string) => void;
  selected: { date: string; shift: Shift } | null;
  onSelectedChange: (selected: { date: string; shift: Shift }) => void;
  visibleVehicleCount: number;
  totalVehicleCount: number;
  onShowMore: () => void;
  /** Точный ledger-ключ pipeline|vehicleRef|date|shift. */
  dataStatusByUnit?: Map<string, DataStatusUnit>;
  dataStatusLoading?: boolean;
}

export function AnalyticsCardsViewV2({
  filteredGroups,
  allGroups,
  dstRecords,
  renderWork,
  onSelectVehicle,
  selected,
  onSelectedChange,
  visibleVehicleCount,
  totalVehicleCount,
  onShowMore,
  dataStatusByUnit,
  dataStatusLoading = false,
}: AnalyticsCardsViewV2Props) {
  const recordsFor = React.useCallback(
    (v: UnifiedVehicleRow): UnifiedRecord[] =>
      v.source === 'dump_truck' ? v.records : (dstRecords.get(v.regNumber) ?? []),
    [dstRecords]
  );

  // ─── Агрегат таймлайна (последние 14 дней × 2 смены) ──
  const timelineDays: TlDay[] = React.useMemo(() => {
    const agg = new Map<string, { sum: number; cntKip: number; count: number }>();
    let maxDate = '';
    for (const g of allGroups) {
      for (const v of g.vehicles) {
        for (const r of recordsFor(v)) {
          const date = toDateStr(r.reportDate);
          if (date > maxDate) maxDate = date;
          const key = `${date}_${r.shiftType}`;
          const a = agg.get(key) ?? { sum: 0, cntKip: 0, count: 0 };
          a.count += 1;
          if (r.kipPct > 0) { a.sum += r.kipPct; a.cntKip += 1; }
          agg.set(key, a);
        }
      }
    }
    if (!maxDate) return [];
    const shifts: Shift[] = ['shift1', 'shift2'];
    return lastNDays(maxDate, 14).map(date => ({
      date,
      cells: shifts.map(shift => {
        const a = agg.get(`${date}_${shift}`);
        return {
          shift,
          kip: a && a.cntKip ? a.sum / a.cntKip : 0,
          count: a ? a.count : 0,
          hasData: !!a && a.count > 0,
        };
      }),
    }));
  }, [allGroups, recordsFor]);

  // Окно периодов ремонта = диапазон видимого таймлайна (а не «последние 30 дней»),
  // чтобы значок-ключ корректно показывался и при просмотре старых дат.
  const repairFrom = timelineDays.length ? timelineDays[0]!.date : '';
  const repairTo = timelineDays.length ? timelineDays[timelineDays.length - 1]!.date : '';
  const repairPeriods = useRepairPeriods(repairFrom, repairTo);

  // Дефолт = последняя смена с данными (правый край таймлайна).
  const defaultSel = React.useMemo(() => {
    for (let i = timelineDays.length - 1; i >= 0; i--) {
      const day = timelineDays[i]!;
      for (let s = day.cells.length - 1; s >= 0; s--) {
        if (day.cells[s]!.hasData) return { date: day.date, shift: day.cells[s]!.shift };
      }
    }
    return null;
  }, [timelineDays]);

  const selectedExists = React.useMemo(() => {
    if (!selected) return false;
    return timelineDays.some(day =>
      day.date === selected.date && day.cells.some(cell => cell.shift === selected.shift && cell.hasData)
    );
  }, [selected, timelineDays]);

  const active = selectedExists ? selected : defaultSel;

  const statusSummary = React.useMemo(() => {
    if (!active || dataStatusLoading || !dataStatusByUnit) return null;

    const counts = {
      done: 0,
      empty: 0,
      failed: 0,
      open: 0,
      noTask: 0,
      ledgerGap: 0,
      reasons: new Map<string, number>(),
    };

    const kipShift = active.shift === 'shift1' ? 'morning' : 'evening';
    for (const unit of dataStatusByUnit.values()) {
      const isSelectedShift =
        unit.date === active.date
        && (
          (unit.pipeline === 'kip-shift' && unit.shift === kipShift)
          || (unit.pipeline === 'dt-shift' && unit.shift === active.shift)
        );
      if (!isSelectedShift) continue;

      if (unit.status === 'done') {
        counts.done += 1;
      } else if (unit.status === 'empty') {
        counts.empty += 1;
      } else if (unit.status === 'failed') {
        counts.failed += 1;
      } else {
        counts.open += 1;
      }

      if (unit.reasonCode) {
        const label = unit.reasonLabel ?? unit.reasonCode;
        counts.reasons.set(label, (counts.reasons.get(label) ?? 0) + 1);
      }
    }

    for (const group of filteredGroups) {
      for (const vehicle of group.vehicles) {
        const pipeline = vehicle.source === 'dump_truck' ? 'dt-shift' : 'kip-shift';
        const shift = vehicle.source === 'dump_truck'
          ? active.shift
          : (active.shift === 'shift1' ? 'morning' : 'evening');
        const key = dataStatusUnitKey(
          pipeline,
          vehicle.ledgerVehicleRef,
          active.date,
          shift,
        );
        const unit = dataStatusByUnit.get(key);

        if (!unit) {
          const hasResult = recordsFor(vehicle).some(record =>
            toDateStr(record.reportDate) === active.date && record.shiftType === active.shift
          );
          if (hasResult) counts.ledgerGap += 1;
          else counts.noTask += 1;
        }
      }
    }

    return counts;
  }, [active, dataStatusByUnit, dataStatusLoading, filteredGroups, recordsFor]);

  if (!active) {
    return (
      <div className="sv-empty"><span className="sv-empty-text">Нет данных</span></div>
    );
  }

  const hasMore = visibleVehicleCount < totalVehicleCount;

  return (
    <div className="sv-cards-scroll sv-v2-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
      <DayTimelineNav
        days={timelineDays}
        selectedDate={active.date}
        selectedShift={active.shift}
        onSelect={(date, shift) => onSelectedChange({ date, shift })}
      />

      {statusSummary && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            margin: '2px 0 10px',
            fontSize: 10,
            color: 'var(--sv-text-3)',
          }}
        >
          <span style={{ fontWeight: 600 }}>Ledger смены:</span>
          <span>данные {statusSummary.done}</span>
          <span>пусто по причине {statusSummary.empty}</span>
          {statusSummary.failed > 0 && <span style={{ color: '#EF4444' }}>ошибки {statusSummary.failed}</span>}
          {statusSummary.open > 0 && <span style={{ color: '#F59E0B' }}>в очереди {statusSummary.open}</span>}
          {[...statusSummary.reasons.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => <span key={label}>{label}: {count}</span>)}
          <span>нет задачи у видимых {statusSummary.noTask}</span>
          {statusSummary.ledgerGap > 0 && (
            <span style={{ color: '#F59E0B' }}>результат без ledger {statusSummary.ledgerGap}</span>
          )}
        </div>
      )}

      {filteredGroups.map(g => (
        <div key={g.groupUid ?? g.groupName} style={{ marginBottom: 16 }}>
          <div className="sv-v2-grp-head">
            <span>{g.groupName}</span>
            <span className="sv-v2-grp-cnt">{g.vehicles.length} ТС</span>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--sv-divider)', margin: '0 0 8px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, alignItems: 'start' }}>
            {g.vehicles.map(v => {
              const pipeline = v.source === 'dump_truck' ? 'dt-shift' : 'kip-shift';
              const shift = v.source === 'dump_truck'
                ? active.shift
                : (active.shift === 'shift1' ? 'morning' : 'evening');
              const dsKey = dataStatusUnitKey(
                pipeline,
                v.ledgerVehicleRef,
                active.date,
                shift,
              );
              const dsUnit = dataStatusLoading
                ? undefined
                : dataStatusByUnit
                  ? (dataStatusByUnit.get(dsKey) ?? null)
                : undefined;
              return (
                <div key={v.regNumber} style={{ minWidth: 0 }}>
                  <VehicleCardV2
                    row={v}
                    records={recordsFor(v)}
                    selectedDate={active.date}
                    selectedShift={active.shift}
                    renderWork={renderWork}
                    onSelectVehicle={onSelectVehicle}
                    dataStatusUnit={dsUnit}
                    repairPeriod={getRepairOnDate(repairPeriods.get(v.regNumber.toUpperCase()) ?? [], active.date) ?? undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 16px' }}>
          <button type="button" className="sv-btn" onClick={onShowMore} style={{ fontSize: 12, padding: '6px 12px' }}>
            Показать ещё 60
          </button>
        </div>
      )}

      {filteredGroups.length === 0 && (
        <div className="sv-empty"><span className="sv-empty-text">Нет данных</span></div>
      )}
    </div>
  );
}
