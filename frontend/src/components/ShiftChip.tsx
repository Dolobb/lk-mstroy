import React from 'react';

export interface ShiftChipProps {
  date: string;        // "01.04"
  shift: 1 | 2 | 0;   // 0 = aggregated day (both shifts)
  trips: number;
  kip: number;
  movement: number;
  workType: string;    // 'delivery' | 'onsite'
  engineHours?: number; // hours for onsite display
  isSelected: boolean;
  onClick: () => void;
}

function barColor(v: number): string {
  return v >= 75 ? '#22c55e' : v >= 50 ? '#60A5FA' : '#EF4444';
}

export function ShiftChip({ date, shift, trips, kip, movement, workType, engineHours, isSelected, onClick }: ShiftChipProps) {
  const isOnsite = workType === 'onsite';
  const shiftLabel = shift === 0 ? `${trips > 1 ? '2' : '1'}см` : `C${shift}`;
  const workLabel = isOnsite
    ? `${engineHours != null ? engineHours : 0}ч`
    : `${trips}р`;

  const titleLines = [
    `${date} Смена ${shift === 0 ? '1+2' : shift}`,
    `КИП: ${Math.round(kip)}%`,
    `Движение: ${Math.round(movement)}%`,
    isOnsite ? `Двигатель: ${engineHours ?? 0}ч` : `Рейсов: ${trips}`,
  ];

  const color = barColor(kip);
  const pct = Math.max(0, Math.min(100, kip));

  return (
    <button
      type="button"
      className={`sv-chip${isSelected ? ' selected' : ''}${isOnsite ? ' onsite' : ''}`}
      title={titleLines.join('\n')}
      onClick={onClick}
    >
      <span>{date}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{shiftLabel}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{workLabel}</span>
      <div className="sv-chip-bar">
        <div className="sv-chip-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </button>
  );
}
