import React from 'react';
import { createPortal } from 'react-dom';
import { Wrench } from 'lucide-react';
import type { RepairPeriod } from './repairPeriods';
import { fmtDateShort } from './repairPeriods';

interface Props {
  period: RepairPeriod;
  size?: number;
}

export function RepairBadge({ period, size = 11 }: Props) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const ref = React.useRef<HTMLSpanElement>(null);
  const tipRef = React.useRef<HTMLSpanElement>(null);
  const color = period.status === 'true' ? '#EF4444' : '#F59E0B';
  const label = period.techStatus || (period.status === 'true' ? 'неисправен' : 'требует ремонта');

  const place = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top, left: r.left + r.width / 2 });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    const close = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (tipRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return (
    <span ref={ref} style={{ display: 'inline-flex', flexShrink: 0 }}>
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
      {open && pos && createPortal(
        <span
          ref={tipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            marginTop: -6,
            zIndex: 9999,
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
            pointerEvents: 'none',
          }}
        >
          <span style={{ color, marginRight: 4 }}>■</span>
          {'в статусе '}
          <b>«{label}»</b>
          {` с ${fmtDateShort(period.from)} по ${fmtDateShort(period.to)}`}
        </span>,
        document.body,
      )}
    </span>
  );
}
