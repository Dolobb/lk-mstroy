import React from 'react';

export interface MicroBar {
  kip: number;
  mov: number;
}

export interface ShiftChipProps {
  date: string;        // "01.04"
  shift: 1 | 2 | 0;   // 0 = aggregated day (both shifts)
  trips: number;
  kip: number;
  movement: number;
  workType: string;    // 'delivery' | 'onsite'
  engineHours?: number;
  isSelected: boolean;
  onClick: () => void;
  microBars?: MicroBar[];
}

function barColor(v: number): string {
  return v >= 75 ? '#22c55e' : v >= 50 ? '#60A5FA' : '#EF4444';
}

function kipColorClass(v: number): string {
  return v >= 75 ? 'kg' : v >= 50 ? 'kb' : 'kr';
}

export function ShiftChip({ date, shift, trips, kip, movement, workType, engineHours, isSelected, onClick, microBars }: ShiftChipProps) {
  const isOnsite = workType === 'onsite';
  const hasMicro = isOnsite && microBars != null && microBars.length > 0;
  const isZero = isOnsite ? (!engineHours || engineHours === 0) : trips === 0;
  const shiftLabel = shift === 0 ? '2см' : `C${shift}`;

  const kipPct = Math.max(0, Math.min(100, kip));
  const movPct = Math.max(0, Math.min(100, movement));
  // For onsite: show proportion of 12h shift with engine on
  const onsitePct = isOnsite && engineHours != null ? Math.min(100, (engineHours / 12) * 100) : 0;

  const titleLines = [
    `${date} Смена ${shift === 0 ? '1+2' : shift}`,
    `КИП: ${Math.round(kip)}%`,
    isOnsite
      ? `Двигатель: ${engineHours ?? 0}ч`
      : `Движение: ${Math.round(movement)}% · Рейсов: ${trips}`,
  ];

  return (
    <button
      type="button"
      className={`sv-chip${isSelected ? ' selected' : ''}${isOnsite ? ' onsite' : ''}${isZero ? ' zero' : ''}`}
      title={titleLines.join('\n')}
      onClick={onClick}
    >
      {/* Left: date + shift */}
      <span className="sv-chip-date">
        {date}
        <small>{shiftLabel}</small>
      </span>

      {/* Center: vis tracks / micro-bar chart */}
      <span className={`sv-chip-vis${hasMicro ? ' sv-chip-micro' : ''}`}>
        {hasMicro ? (
          (microBars as MicroBar[]).map((bar, i) => {
            const h = Math.max(0, Math.min(100, bar.kip));
            const isEmpty = h < 5;
            const isMov = !isEmpty && bar.mov > h * 0.55;
            return (
              <i
                key={i}
                className={`sv-chip-microbar${isEmpty ? ' empty' : isMov ? ' mov' : ''}`}
                style={{ height: `${h}%` }}
              />
            );
          })
        ) : (
          <>
            <span className="sv-chip-vis-lbl">
              <span>КИП</span>
              {kip > 0
                ? <span className={kipColorClass(Math.round(kip))}>{Math.round(kip)}</span>
                : <span>—</span>
              }
            </span>
            <span className="sv-chip-track">
              <i style={{ width: `${kipPct}%`, background: barColor(kip) }} />
            </span>
            <span className="sv-chip-track">
              <i style={{
                width: `${isOnsite ? onsitePct : movPct}%`,
                background: isOnsite ? '#A78BFA' : '#60A5FA',
                opacity: 0.7,
              }} />
            </span>
          </>
        )}
      </span>

      {/* Right: count + unit */}
      <span className="sv-chip-num">
        {isZero ? 'Op' : isOnsite ? `${engineHours ?? 0}ч` : String(trips)}
        <small>{isZero ? 'нет ПЛ' : isOnsite ? 'двиг.' : 'рейсов'}</small>
      </span>
    </button>
  );
}
