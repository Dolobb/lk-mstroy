import React from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { UnifiedVehicleRow, UnifiedRecord } from './types';
import { VehicleIcon } from '@/components/VehicleIcon';
import { ShiftChip } from '@/components/ShiftChip';
import type { MicroBar } from '@/components/ShiftChip';
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
  // Onsite micro-bars (shiftRecordId → MicroBar[]) — общий источник из AnalyticsPage,
  // карточка их больше сама не грузит (дедупликация запросов сегментов).
  chipSegments?: Map<number, MicroBar[]>;
  activeChipKey?: string | null;
  onChipClick?: (key: string) => void;
  onSelectVehicle?: (regNumber: string) => void;
}

function VehicleCardInner({ row, records, chipSegments, activeChipKey, onChipClick, onSelectVehicle }: VehicleCardProps) {
  const cat = vehicleCategory(row);
  const catColor = CAT_COLORS[cat] || '#60A5FA';
  const kip = Math.round(row.avgKipPct);
  const sec = Math.round(row.avgSecondaryPct);

  // ─── Build chips ─────────────────────────────────────
  const chips = React.useMemo(() => {
    if (!records || !records.length) return [];
    const sorted = [...records].sort((a, b) =>
      toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType)
    );
    return sorted.map(r => ({
      key: `${row.regNumber}_${toDateStr(r.reportDate)}_${r.shiftType}`,
      date: fmDateShort(toDateStr(r.reportDate)),
      shift: (r.shiftType === 'shift1' ? 1 : 2) as 1 | 2,
      trips: r.tripsCount ?? 0,
      kip: r.kipPct,
      movement: r.secondaryPct,
      workType: r.workType ?? 'delivery',
      engineHours: Math.round(r.engineTimeSec / 3600),
      shiftRecordId: r.workType === 'onsite' && r.source === 'dump_truck' ? (r.id ?? undefined) : undefined,
    }));
  }, [records, row.regNumber]);

  const tripOrFuel = row.source === 'dump_truck'
    ? `${row.totalTrips || 0} р`
    : row.totalFuelL > 0 ? `${Math.round(row.totalFuelL)} л` : '0 л';

  const gap = row.gapFilledCount ?? 0;

  return (
    <div className="sv-veh-card">
      <div className="sv-veh-head">
        <VehicleIcon kind={cat} color={catColor} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="sv-veh-plate">{row.regNumber}</span>
            {onSelectVehicle && (
              <button
                onClick={e => { e.stopPropagation(); onSelectVehicle(row.regNumber); }}
                title="Показать трек на карте"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, padding: 0, border: 'none', borderRadius: 4,
                  background: 'transparent', cursor: 'pointer',
                  color: 'var(--sv-text-3)', flexShrink: 0,
                  transition: 'color .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#60A5FA')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--sv-text-3)')}
              >
                <MapIcon size={12} strokeWidth={1.8} />
              </button>
            )}
          </div>
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
          <span className={`sv-veh-meta-val ${kipClass(kip)}`}>{kip > 0 ? `${kip}%` : '—'}</span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">{row.secondaryLabel}</span>
          <span className="sv-veh-meta-val">{sec > 0 ? `${sec}%` : '—'}</span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">Смены</span>
          <span className="sv-veh-meta-val">
            {row.shiftsCount}
            {gap > 0 && <span style={{ marginLeft: 2, fontSize: 9, color: '#9ca3af' }}>⚑{gap}</span>}
          </span>
        </div>
        <div className="sv-veh-meta-item">
          <span className="sv-veh-meta-lbl">{row.source === 'dump_truck' ? 'Рейсы 24ч' : 'Расход'}</span>
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
            const { key: _k, shiftRecordId, ...chip } = c;
            return (
              <ShiftChip
                key={c.key}
                {...chip}
                isSelected={activeChipKey === c.key}
                onClick={() => onChipClick?.(c.key)}
                microBars={shiftRecordId != null ? chipSegments?.get(shiftRecordId) : undefined}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}

// React.memo: карточка получает только свой activeChipKey, поэтому клик по чипу
// меняет пропсы у старой/новой активной карточки, а не у всего списка.
export const VehicleCard = React.memo(VehicleCardInner);
