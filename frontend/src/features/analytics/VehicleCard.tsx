import React from 'react';
import type { UnifiedVehicleRow, UnifiedRecord } from './types';
import { VehicleIcon } from '@/components/VehicleIcon';
import { ShiftChip } from '@/components/ShiftChip';
import { abbreviateOrg } from '@/features/samosvaly/orgAbbrev';
import { vehicleCategory } from './categories';

function fmDateShort(isoDate: string): string {
  const dateOnly = isoDate.split('T')[0] ?? isoDate;
  const p = dateOnly.split('-');
  return `${p[2]}.${p[1]}`;
}
function toDateStr(isoDate: string): string {
  return (isoDate.split('T')[0] ?? isoDate).substring(0, 10);
}

function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function kipClass(v: number): string {
  return v >= 75 ? 'sv-v-g' : v >= 50 ? 'sv-v-b' : 'sv-v-r';
}

const CAT_COLORS: Record<string, string> = {
  samosvaly: '#F97316',
  ekskav: '#A78BFA',
  kip: '#60A5FA',
  krany: '#22C55E',
};

interface VehicleCardProps {
  row: UnifiedVehicleRow;
  records?: UnifiedRecord[];
  selectedChip?: string | null;
  onChipClick?: (key: string) => void;
}

export function VehicleCard({ row, records, selectedChip, onChipClick }: VehicleCardProps) {
  const cat = vehicleCategory(row);
  const catColor = CAT_COLORS[cat] || '#60A5FA';
  const kip = Math.round(row.avgKipPct);
  const sec = Math.round(row.avgSecondaryPct);

  const chips = React.useMemo(() => {
    if (!records || !records.length) return [];
    const sorted = [...records].sort((a, b) =>
      toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType)
    );
    return sorted.slice(-10).map(r => ({
      key: `${row.regNumber}_${toDateStr(r.reportDate)}_${r.shiftType}`,
      date: fmDateShort(toDateStr(r.reportDate)),
      shift: (r.shiftType === 'shift1' ? 1 : 2) as 1 | 2,
      trips: r.tripsCount ?? 0,
      kip: r.kipPct,
      movement: r.secondaryPct,
      workType: r.workType ?? 'delivery',
      engineHours: Math.round(r.engineTimeSec / 3600),
    }));
  }, [records, row.regNumber]);

  const tripOrFuel = row.source === 'dump_truck'
    ? `${row.totalTrips || 0} р`
    : row.totalFuelL > 0 ? `${Math.round(row.totalFuelL)} л` : '0 л';

  const gap = row.gapFilledCount ?? 0;

  return (
    <div className="sv-veh-card">
      <div className="sv-veh-head">
        <VehicleIcon kind={cat} color={catColor} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sv-veh-plate">{row.regNumber}</div>
          <div className="sv-veh-model">{row.nameMO}</div>
        </div>
        {row.organization && (
          <span className="sv-veh-org" title={row.organization}>
            {abbreviateOrg(row.organization)}
          </span>
        )}
      </div>

      <div className="sv-veh-meta">
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">КИП</span>
          <span className={`sv-veh-meta-val ${kipClass(kip)}`}>{kip}%</span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">{row.secondaryLabel}</span>
          <span className="sv-veh-meta-val">{sec}%</span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">Смены</span>
          <span className="sv-veh-meta-val">
            {row.shiftsCount}
            {gap > 0 && <span style={{ marginLeft: 2, fontSize: 9, color: '#9ca3af' }}>⚑{gap}</span>}
          </span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">{row.source === 'dump_truck' ? 'Рейсы' : 'Расход'}</span>
          <span className="sv-veh-meta-val">{tripOrFuel}</span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">Двиг.</span>
          <span className="sv-veh-meta-val">{fmtHours(row.engineTotalSec)}</span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="sv-veh-chips">
          {chips.map(c => {
            const { key: _k, ...chip } = c;
            return (
              <ShiftChip
                key={c.key}
                {...chip}
                isSelected={selectedChip === c.key}
                onClick={() => onChipClick?.(c.key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
