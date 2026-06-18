import React from 'react';
import { Wrench } from 'lucide-react';
import type { RepairPeriod } from './repairPeriods';
import { fmtDateShort } from './repairPeriods';

interface Props {
  period: RepairPeriod;
  size?: number;
}

export function RepairBadge({ period, size = 11 }: Props) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  const color = period.status === 'true' ? '#EF4444' : '#F59E0B';
  const label = period.techStatus || (period.status === 'true' ? 'неисправен' : 'требует ремонта');

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <span
        role="button"
        tabIndex={0}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setOpen(o => !o); } }}
        style={{ display: 'inline-flex', cursor: 'pointer' }}
        aria-label={`в ремонте: ${label}`}
      >
        <Wrench size={size} strokeWidth={2} style={{ color }} />
      </span>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: 6,
            zIndex: 100,
            background: 'var(--popover, #1e1e2e)',
            color: 'var(--popover-foreground, #e2e8f0)',
            border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,.4)',
            lineHeight: 1.4,
          }}
        >
          <span style={{ color, marginRight: 4 }}>■</span>
          {'в статусе '}
          <b>«{label}»</b>
          {` с ${fmtDateShort(period.from)} по ${fmtDateShort(period.to)}`}
        </span>
      )}
    </span>
  );
}
