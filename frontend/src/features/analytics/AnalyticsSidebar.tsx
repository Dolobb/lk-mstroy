import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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
  onPeriodShift: (direction: -1 | 1) => void;
  showOutsideOnMap: boolean;
  onToggleOutsideMap: () => void;
}

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

function fmtDateRangeShort(from: string, to: string): string {
  const dateOnly = (s: string) => (s.split('T')[0] ?? s).substring(0, 10);
  const fm = (s: string) => { const p = dateOnly(s).split('-'); return `${p[2]}.${p[1]}`; };
  const fromY = dateOnly(from).split('-')[0];
  const toY = dateOnly(to).split('-')[0];
  if (fromY !== toY) return `${fm(from)}.${fromY} — ${fm(to)}.${toY}`;
  return `${fm(from)} — ${fm(to)}.${toY}`;
}

export function AnalyticsSidebar({
  objectSummaries,
  focusedObjectUid,
  onFocusObject,
  dateFrom,
  dateTo,
  onPeriodShift,
  showOutsideOnMap,
  onToggleOutsideMap,
}: AnalyticsSidebarProps) {
  const [activeTab, setActiveTab] = useState<'objects' | 'outside'>('objects');

  const days = Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  const outsideObj = objectSummaries.find(o => o.uid === '__outside');
  const sideObjs = objectSummaries.filter(o => o.uid !== null && o.uid !== '__outside');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '7px 8px',
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--sv-text-1)' : 'var(--sv-text-3)',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid #60A5FA' : '2px solid transparent',
    cursor: 'pointer',
    transition: 'all .15s',
    whiteSpace: 'nowrap',
  });

  return (
    <aside style={{
      background: 'var(--sv-card)',
      border: '1px solid var(--sv-card-border)',
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Period header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px',
        borderBottom: '1px solid var(--sv-divider)',
        flexShrink: 0,
      }}>
        <button
          className="sv-view-tab"
          onClick={() => onPeriodShift(-1)}
          style={{ width: 28, height: 28, fontSize: 14, padding: 0, justifyContent: 'center' }}
        >‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-1)' }}>{fmtDateRangeShort(dateFrom, dateTo)}</div>
          <div style={{ fontSize: 9, color: 'var(--sv-text-3)', marginTop: 2 }}>{days} дн · {sideObjs.length} объект.</div>
        </div>
        <button
          className="sv-view-tab"
          onClick={() => onPeriodShift(1)}
          style={{ width: 28, height: 28, fontSize: 14, padding: 0, justifyContent: 'center' }}
        >›</button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--sv-divider)',
        flexShrink: 0,
      }}>
        <button style={tabStyle(activeTab === 'objects')} onClick={() => setActiveTab('objects')}>
          Объекты
        </button>

        {/* Outside tab: clickable label + separate eye button */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: activeTab === 'outside' ? '2px solid #60A5FA' : '2px solid transparent',
          marginBottom: '-1px',
        }}>
          <button
            onClick={() => setActiveTab('outside')}
            style={{
              flex: 1,
              padding: '7px 6px 7px 8px',
              fontSize: 11,
              fontWeight: activeTab === 'outside' ? 700 : 500,
              color: activeTab === 'outside' ? 'var(--sv-text-1)' : 'var(--sv-text-3)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'all .15s',
              textAlign: 'left',
              whiteSpace: 'nowrap',
            }}
          >
            Вне объектов
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleOutsideMap(); }}
            title={showOutsideOnMap ? 'Скрыть вне объектов с карты' : 'Показать вне объектов на карте'}
            style={{
              flexShrink: 0,
              padding: '0 8px 0 2px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: showOutsideOnMap ? '#60A5FA' : 'var(--sv-text-4)',
              display: 'flex',
              alignItems: 'center',
              transition: 'color .15s',
            }}
          >
            {showOutsideOnMap
              ? <Eye size={13} strokeWidth={2} />
              : <EyeOff size={13} strokeWidth={2} />
            }
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>

        {/* ── Objects tab ── */}
        {activeTab === 'objects' && (
          <>
            {sideObjs.map(o => (
              <div
                key={o.uid}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--sv-divider)',
                  cursor: 'pointer',
                  opacity: focusedObjectUid === o.uid ? 1 : focusedObjectUid !== null ? 0.45 : 1,
                  transition: 'opacity 0.15s',
                }}
                onClick={() => onFocusObject(focusedObjectUid === o.uid ? null : o.uid!)}
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
            {sideObjs.length === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--sv-text-3)' }}>
                Нет объектов за период
              </div>
            )}
          </>
        )}

        {/* ── Outside tab ── */}
        {activeTab === 'outside' && (
          <div style={{ paddingTop: 12 }}>
            {outsideObj ? (
              <>
                <div style={{
                  background: 'var(--sv-card-inner)', border: '1px solid var(--sv-card-inner-border)',
                  borderRadius: 10, padding: '10px 12px', marginBottom: 10,
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                  <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--sv-text-3)', letterSpacing: '0.04em' }}>ТС вне объектов</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--sv-text-1)', lineHeight: 1 }}>{outsideObj.vehicles}</div>
                </div>

                <button
                  onClick={onToggleOutsideMap}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 12px',
                    background: showOutsideOnMap ? 'rgba(96,165,250,0.10)' : 'var(--sv-card-inner)',
                    border: '1px solid',
                    borderColor: showOutsideOnMap ? 'rgba(96,165,250,0.35)' : 'var(--sv-card-inner-border)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all .15s',
                    textAlign: 'left',
                  }}
                >
                  {showOutsideOnMap
                    ? <Eye size={14} strokeWidth={2} style={{ color: '#60A5FA', flexShrink: 0 }} />
                    : <EyeOff size={14} strokeWidth={2} style={{ color: 'var(--sv-text-4)', flexShrink: 0 }} />
                  }
                  <span style={{ fontSize: 11, fontWeight: 600, color: showOutsideOnMap ? '#60A5FA' : 'var(--sv-text-3)' }}>
                    {showOutsideOnMap ? 'Отображается на карте' : 'Скрыто с карты'}
                  </span>
                </button>
              </>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--sv-text-3)' }}>
                Нет ТС вне объектов
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
