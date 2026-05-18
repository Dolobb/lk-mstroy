import React from 'react';

export interface ObjectSummary {
  uid: string | null;
  title: string;
  vehicles: number;
  work: string;
  kip: number;
}

interface AnalyticsSidebarProps {
  objectSummaries: ObjectSummary[];
  focusedObjectUid: string | null;
  onFocusObject: (uid: string | null) => void;
  dateFrom: string;
  dateTo: string;
  onPeriodShift: (days: number) => void;
}

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

function fmtDateRangeShort(from: string, to: string): string {
  const fm = (s: string) => { const p = s.split('-'); return `${p[2]}.${p[1]}`; };
  const fromParts = from.split('-');
  const toParts = to.split('-');
  if (fromParts[0] !== toParts[0]) return `${fm(from)}.${fromParts[0]} — ${fm(to)}.${toParts[0]}`;
  return `${fm(from)} — ${fm(to)}.${toParts[0]}`;
}

export function AnalyticsSidebar({
  objectSummaries,
  focusedObjectUid,
  onFocusObject,
  dateFrom,
  dateTo,
  onPeriodShift,
}: AnalyticsSidebarProps) {
  const days = Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  const objCount = objectSummaries.filter(o => o.uid !== null).length;

  const allObj = objectSummaries.find(o => o.uid === null);
  const sideObjs = objectSummaries.filter(o => o.uid !== null);

  return (
    <aside style={{
      background: 'var(--sv-card)',
      border: '1px solid var(--sv-card-border)',
      borderRadius: 14,
      overflowY: 'auto',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      {/* Period header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 10, borderBottom: '1px solid var(--sv-divider)',
        marginBottom: 10, flexShrink: 0,
      }}>
        <button
          className="sv-view-tab"
          onClick={() => onPeriodShift(-7)}
          style={{ width: 28, height: 28, fontSize: 14, padding: 0, justifyContent: 'center' }}
        >‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-1)' }}>{fmtDateRangeShort(dateFrom, dateTo)}</div>
          <div style={{ fontSize: 9, color: 'var(--sv-text-3)', marginTop: 2 }}>{days} дн · {objCount} объект.</div>
        </div>
        <button
          className="sv-view-tab"
          onClick={() => onPeriodShift(7)}
          style={{ width: 28, height: 28, fontSize: 14, padding: 0, justifyContent: 'center' }}
        >›</button>
      </div>

      {/* Object list */}
      {allObj && (
        <div
          style={{
            padding: '6px 0', borderBottom: '1px solid var(--sv-divider)',
            cursor: 'pointer',
            opacity: focusedObjectUid === null ? 1 : 0.45,
            fontStyle: 'italic',
          }}
          onClick={() => onFocusObject(null)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-1)', flex: 1 }}>
              Все ({allObj.vehicles})
            </span>
          </div>
        </div>
      )}
      {sideObjs.map(o => (
        <div
          key={o.uid}
          style={{
            padding: '8px 0', borderBottom: '1px solid var(--sv-divider)',
            cursor: 'pointer',
            opacity: focusedObjectUid === o.uid ? 1 : focusedObjectUid !== null ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
          onClick={() => onFocusObject(focusedObjectUid === o.uid ? null : o.uid)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: o.kip > 0 ? kipColor(o.kip) : 'var(--sv-text-4)',
            }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {o.title}
            </span>
            <span style={{
              fontWeight: 800, fontSize: 12,
              color: o.kip > 0 ? kipColor(o.kip) : 'var(--sv-text-3)',
            }}>
              {o.kip > 0 ? `${o.kip}%` : '—'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{
              background: 'var(--sv-card-inner)', border: '1px solid var(--sv-card-inner-border)',
              borderRadius: 8, padding: '5px 7px',
            }}>
              <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', color: 'var(--sv-text-3)', letterSpacing: '0.04em' }}>ТС</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--sv-text-1)', lineHeight: 1, marginTop: 2 }}>{o.vehicles}</div>
            </div>
            <div style={{
              background: 'var(--sv-card-inner)', border: '1px solid var(--sv-card-inner-border)',
              borderRadius: 8, padding: '5px 7px',
            }}>
              <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', color: 'var(--sv-text-3)', letterSpacing: '0.04em' }}>Работа</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--sv-text-1)', lineHeight: 1, marginTop: 2 }}>{o.work}</div>
            </div>
          </div>
        </div>
      ))}
    </aside>
  );
}
