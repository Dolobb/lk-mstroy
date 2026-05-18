import React from 'react';
import { useTheme } from 'next-themes';

interface BarData {
  value: number;
  label: string;
}

interface MiniBarProps {
  primary: BarData;
  secondary: BarData;
  width?: number;
}

function barColor(v: number): string {
  return v >= 75 ? '#22c55e' : v >= 50 ? '#60A5FA' : '#EF4444';
}

export function MiniBar({ primary, secondary, width = 80 }: MiniBarProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const p = Math.max(0, Math.min(100, primary.value));
  const s = Math.max(0, Math.min(100, secondary.value));

  const trackStyle = (): React.CSSProperties => ({
    flex: 1, height: 5, borderRadius: 3,
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
    overflow: 'hidden',
  });

  const fillStyle = (pct: number, color: string): React.CSSProperties => ({
    width: `${pct}%`, height: '100%',
    background: color, opacity: 0.85,
    transition: 'width .3s',
  });

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, width, padding: '3px 0', cursor: 'default' }}
      title={`${primary.label}: ${Math.round(primary.value)}%\n${secondary.label}: ${Math.round(secondary.value)}%`}
    >
      {/* Primary bar (KPI) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={trackStyle()}>
          <div style={fillStyle(p, barColor(p))} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: barColor(p), minWidth: 24, textAlign: 'right', lineHeight: 1 }}>
          {Math.round(primary.value)}%
        </span>
      </div>
      {/* Secondary bar (Movement) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={trackStyle()}>
          <div style={fillStyle(s, barColor(s))} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: barColor(s), minWidth: 24, textAlign: 'right', lineHeight: 1, opacity: 0.75 }}>
          {Math.round(secondary.value)}%
        </span>
      </div>
    </div>
  );
}
