import React from 'react';
import {
  Map as MapIcon, MapPin, Cog, Activity, Navigation, Timer, Route, Repeat, Fuel, Pause, AlertTriangle,
} from 'lucide-react';
import { RepairBadge } from '@/features/vehicle-status/RepairBadge';
import type { RepairPeriod } from '@/features/vehicle-status/repairPeriods';
import type { UnifiedVehicleRow, UnifiedRecord, DataStatusUnit } from './types';
import { VehicleIcon } from '@/components/VehicleIcon';
import { abbreviateOrg } from '@/features/samosvaly/orgAbbrev';
import { vehicleCategory } from './categories';
import { ReasonBadge } from './components/ReasonBadge';

// ─── Карточка v2.0 («Навигация по дням») ──────────────────────────────
// Статистика ТС за ВЫБРАННУЮ смену. Гейдж КИП + health-стрипа + метрики
// (иконки) + интерактивный спарклайн + основной просмотр работы (lazy).
// План: ANALYTICS_CARDS_V2_PLAN.md

type Shift = 'shift1' | 'shift2';

function toDateStr(isoDate: string): string {
  return (isoDate.split('T')[0] ?? isoDate).substring(0, 10);
}
function fmDateShort(date: string): string {
  const p = date.split('-');
  return `${p[2]}.${p[1]}`;
}
function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function kipColorV2(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#F59E0B';
  return '#EF4444';
}

const CAT_COLORS: Record<string, string> = {
  samosvaly: '#F97316', ekskav: '#A78BFA', kip: '#60A5FA', krany: '#22C55E',
};

function Gauge({ pct, color }: { pct: number; color: string }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="sv-v2-gauge">
      <svg width={46} height={46} viewBox="0 0 46 46">
        <circle cx={23} cy={23} r={r} fill="none" stroke="var(--sv-divider)" strokeWidth={4} />
        {pct > 0 && (
          <circle
            cx={23} cy={23} r={r} fill="none" stroke={color} strokeWidth={4}
            strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
            transform="rotate(-90 23 23)"
          />
        )}
      </svg>
      <span className="sv-v2-gauge-txt" style={{ color: pct > 0 ? color : 'var(--sv-text-4)' }}>
        {pct > 0 ? pct : '—'}
      </span>
    </div>
  );
}

interface SparkPoint { v: number; sel: boolean; label: string; }

function Sparkline({ points, color }: { points: SparkPoint[]; color: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  if (points.length < 2) return <div className="sv-v2-spark-wrap" />;
  const n = points.length;
  const xPct = (i: number) => (i / (n - 1)) * 100;
  const yPct = (v: number) => 100 - Math.max(0, Math.min(100, v));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xPct(i).toFixed(2)},${yPct(p.v).toFixed(2)}`).join(' ');
  const selIdx = points.findIndex(p => p.sel);
  const act = hover ?? (selIdx >= 0 ? selIdx : null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  const popLeft = hover != null ? Math.min(90, Math.max(10, xPct(hover))) : 0;

  return (
    <div className="sv-v2-spark-wrap">
      <div className="sv-v2-spark-yaxis"><span>100</span><span>50</span><span>0</span></div>
      <div className="sv-v2-spark-chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sv-v2-spark-svg">
          {[0, 50, 100].map(g => (
            <line key={g} x1={0} x2={100} y1={100 - g} y2={100 - g} className="sv-v2-spark-grid" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={d} fill="none" stroke="var(--sv-text-3)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        </svg>
        {act != null && (
          <>
            <div className="sv-v2-spark-vline" style={{ left: `${xPct(act)}%` }} />
            <div className="sv-v2-spark-dot" style={{ left: `${xPct(act)}%`, top: `${yPct(points[act]!.v)}%`, background: color }} />
          </>
        )}
        {hover != null && (
          <div className="sv-v2-spark-pop" style={{ left: `${popLeft}%` }}>
            {points[hover]!.label} · {Math.round(points[hover]!.v)}%
          </div>
        )}
      </div>
      <div className="sv-v2-spark-xaxis">
        <span>{points[0]!.label}</span>
        <span>{points[n - 1]!.label}</span>
      </div>
    </div>
  );
}

interface Metric { icon: React.ReactNode; lbl: string; val: string; }

const ICON_PROPS = { size: 12, strokeWidth: 1.8 } as const;

interface VehicleCardV2Props {
  row: UnifiedVehicleRow;
  records: UnifiedRecord[];
  selectedDate: string;
  selectedShift: Shift;
  renderWork?: (rec: UnifiedRecord) => React.ReactNode;
  onSelectVehicle?: (regNumber: string) => void;
  /** Статус из ingest ledger для выбранной даты (может быть undefined если нет записи) */
  dataStatusUnit?: DataStatusUnit | null;
  repairPeriod?: RepairPeriod;
}

function VehicleCardV2Inner({ row, records, selectedDate, selectedShift, renderWork, onSelectVehicle, dataStatusUnit, repairPeriod }: VehicleCardV2Props) {
  const cat = vehicleCategory(row);
  const catColor = CAT_COLORS[cat] || '#60A5FA';
  const repairColor = repairPeriod?.status === 'true' ? '#EF4444' : '#F59E0B';

  const selRec = React.useMemo(
    () => records.find(r => toDateStr(r.reportDate) === selectedDate && r.shiftType === selectedShift),
    [records, selectedDate, selectedShift]
  );

  const sparkPoints: SparkPoint[] = React.useMemo(() => {
    const sorted = [...records].sort((a, b) =>
      toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType)
    );
    return sorted.map(r => ({
      v: r.kipPct,
      sel: toDateStr(r.reportDate) === selectedDate && r.shiftType === selectedShift,
      label: `${fmDateShort(toDateStr(r.reportDate))} ${r.shiftType === 'shift1' ? 'C1' : 'C2'}`,
    }));
  }, [records, selectedDate, selectedShift]);

  const mapBtn = onSelectVehicle && (
    <button
      onClick={e => { e.stopPropagation(); onSelectVehicle(row.regNumber); }}
      title="Показать трек на карте"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, padding: 0, border: 'none', borderRadius: 4,
        background: 'transparent', cursor: 'pointer', color: 'var(--sv-text-3)', flexShrink: 0,
      }}
    >
      <MapIcon size={12} strokeWidth={1.8} />
    </button>
  );

  // ─── «Не работал в эту смену» / причина из ledger ────
  if (!selRec) {
    return (
      <div className="sv-v2-card idle">
        <span className="sv-v2-stripe" style={{ background: repairPeriod ? repairColor : 'var(--sv-text-4)' }} />
        <div className="sv-v2-head">
          <Gauge pct={0} color="var(--sv-text-4)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="sv-v2-plate">{row.regNumber}</span>
              {repairPeriod && <RepairBadge period={repairPeriod} size={11} />}
              {mapBtn}
              <VehicleIcon kind={cat} color={catColor} size={16} />
            </div>
            <div className="sv-v2-model">{row.nameMO}</div>
          </div>
        </div>
        {/* Нет результата смены: показываем точную причину pipeline или отсутствие задачи. */}
        <div style={{ marginTop: 4 }}>
          <ReasonBadge unit={dataStatusUnit} />
        </div>
      </div>
    );
  }

  const kip = Math.round(selRec.kipPct);
  const color = kipColorV2(kip);

  // Подозрительный 100%: двигатель работал весь сдвиг, но нагрузка/движение = 0
  const isSuspicious100 = kip >= 95 && selRec.secondaryPct <= 5 && (selRec.movingTimeSec ?? 0) < 60;

  const metrics: Metric[] = row.source === 'dump_truck'
    ? [
        { icon: <Cog {...ICON_PROPS} />, lbl: 'Двигатель', val: fmtHours(selRec.engineTimeSec) },
        { icon: <Activity {...ICON_PROPS} />, lbl: selRec.secondaryLabel || 'Движение', val: `${Math.round(selRec.secondaryPct)}%` },
        { icon: <Navigation {...ICON_PROPS} />, lbl: 'В движении', val: fmtHours(selRec.movingTimeSec ?? 0) },
        { icon: <Timer {...ICON_PROPS} />, lbl: 'На объекте', val: selRec.onsiteMin != null ? `${Math.round(selRec.onsiteMin)}м` : '—' },
        { icon: <Route {...ICON_PROPS} />, lbl: 'Пробег', val: selRec.distanceKm != null ? `${selRec.distanceKm.toFixed(1)} км` : '—' },
        { icon: <Repeat {...ICON_PROPS} />, lbl: 'Рейсы', val: `${selRec.tripsCount ?? 0}` },
      ]
    : [
        { icon: <Cog {...ICON_PROPS} />, lbl: 'Двигатель', val: fmtHours(selRec.engineTimeSec) },
        { icon: <Activity {...ICON_PROPS} />, lbl: selRec.secondaryLabel || 'Нагрузка', val: `${Math.round(selRec.secondaryPct)}%` },
        { icon: <Fuel {...ICON_PROPS} />, lbl: 'Топливо', val: selRec.fuelConsumedL != null ? `${Math.round(selRec.fuelConsumedL)} л` : '—' },
        { icon: <Pause {...ICON_PROPS} />, lbl: 'Стоянка', val: selRec.totalStayTimeH != null ? `${selRec.totalStayTimeH.toFixed(1)} ч` : '—' },
      ];

  return (
    <div className="sv-v2-card">
      <span className="sv-v2-stripe" style={{ background: color }} />
      <div className="sv-v2-head">
        <Gauge pct={kip} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="sv-v2-plate">{row.regNumber}</span>
            {repairPeriod && <RepairBadge period={repairPeriod} size={11} />}
            {mapBtn}
            <VehicleIcon kind={cat} color={catColor} size={16} />
          </div>
          <div className="sv-v2-model">{row.nameMO}</div>
          <ReasonBadge
            unit={dataStatusUnit}
            missingReason="ledger_gap"
            className="mt-1"
          />
          {isSuspicious100 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2, padding: '1px 5px', borderRadius: 4, background: '#F59E0B22', color: '#F59E0B', fontSize: 10, fontWeight: 600 }}>
              <AlertTriangle size={9} strokeWidth={2.5} />
              требует проверки
            </div>
          )}
          {selRec.objectName && (
            <div className="sv-v2-obj"><MapPin size={9} /> {selRec.objectName}</div>
          )}
        </div>
        {row.organization && (
          <span className="sv-veh-org" title={row.organization}>{abbreviateOrg(row.organization)}</span>
        )}
      </div>

      <Sparkline points={sparkPoints} color={color} />

      <div className="sv-v2-metrics">
        {metrics.map(m => (
          <span key={m.lbl} className="sv-v2-metric" title={m.lbl}>
            {m.icon}{m.val}
          </span>
        ))}
      </div>

      {renderWork && (
        <div className="sv-v2-work">{renderWork(selRec)}</div>
      )}
    </div>
  );
}

export const VehicleCardV2 = React.memo(VehicleCardV2Inner);
