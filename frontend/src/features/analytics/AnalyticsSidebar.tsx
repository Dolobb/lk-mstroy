import type { SidebarObjectCard, SidebarTrendPoint } from './types';

export type ObjectTier = 'key' | 'secondary';

interface AnalyticsSidebarProps {
  objects: SidebarObjectCard[];
  secondaryObjects: SidebarObjectCard[];
  activeTier: ObjectTier;
  onTierChange: (tier: ObjectTier) => void;
  focusedObjectUid: string | null;
  onFocusObject: (uid: string | null) => void;
  from: string;
  to: string;
  loading?: boolean;
  error?: unknown;
}

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

function fmtDateRangeShort(from: string, to: string): string {
  const fm = (s: string) => { const p = s.slice(0, 10).split('-'); return `${p[2]}.${p[1]}`; };
  const fromY = from.slice(0, 4);
  const toY = to.slice(0, 4);
  if (fromY !== toY) return `${fm(from)}.${fromY} - ${fm(to)}.${toY}`;
  return `${fm(from)} - ${fm(to)}.${toY}`;
}

function pctText(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)}%`;
}

function SidebarKipSparkline({ trend, color }: { trend: SidebarTrendPoint[]; color: string }) {
  const width = 308;
  const height = 66;
  const chartTop = 6;
  const chartHeight = 36;
  const step = width / Math.max(1, trend.length - 1);

  const points = trend
    .map((p, i) => {
      if (p.kipPct == null) return null;
      const x = i * step;
      const y = chartTop + chartHeight - (Math.max(0, Math.min(100, p.kipPct)) / 100) * chartHeight;
      return { x, y };
    })
    .filter((p): p is { x: number; y: number } => p !== null);

  return (
    <div style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true" focusable="false">
        {[0, 1, 2].map(i => (
          <line
            key={i}
            x1={0}
            x2={width}
            y1={chartTop + i * (chartHeight / 2)}
            y2={chartTop + i * (chartHeight / 2)}
            stroke="var(--sv-divider)"
            strokeWidth="1"
          />
        ))}
        {points.length > 1 && (
          <polyline
            points={points.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {trend.map((p, i) => {
          const x = i * step;
          const value = p.kipPct ?? 0;
          const y = chartTop + chartHeight - (Math.max(0, Math.min(100, value)) / 100) * chartHeight;
          const hasData = p.kipPct != null;
          return (
            <g key={p.date}>
              <circle
                cx={x}
                cy={hasData ? y : chartTop + chartHeight}
                r={3.2}
                fill={hasData ? color : 'var(--sv-text-4)'}
                opacity={hasData ? 1 : 0.45}
              />
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="var(--sv-text-3)"
              >
                {p.weekday}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ObjectCard({
  object,
  focusedObjectUid,
  onFocusObject,
}: {
  object: SidebarObjectCard;
  focusedObjectUid: string | null;
  onFocusObject: (uid: string | null) => void;
}) {
  const selected = focusedObjectUid === object.uid;
  const dimmed = focusedObjectUid !== null && !selected;
  const hasData = object.vehicleCount > 0;
  const color = hasData ? kipColor(object.kipPct) : 'var(--sv-text-4)';

  return (
    <button
      type="button"
      onClick={() => onFocusObject(selected ? null : object.uid)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 0.15s, transform 0.15s',
      }}
    >
      <div style={{
        padding: 16,
        borderRadius: 8,
        background: selected ? 'rgba(96,165,250,0.10)' : 'var(--sv-card-inner)',
        border: '1px solid',
        borderColor: selected ? 'rgba(96,165,250,0.55)' : 'var(--sv-card-inner-border)',
        boxShadow: selected ? '0 0 0 1px rgba(96,165,250,0.18)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            color: 'var(--sv-text-1)',
            fontSize: 16,
            fontWeight: 800,
            lineHeight: 1.15,
            overflowWrap: 'anywhere',
          }}>
            {object.name}
          </div>
          <div style={{
            flexShrink: 0,
            borderRadius: 999,
            padding: '4px 8px',
            fontSize: 10,
            fontWeight: 800,
            color: 'var(--sv-text-2)',
            background: 'rgba(148,163,184,0.12)',
            border: '1px solid var(--sv-divider)',
          }}>
            {object.timezoneLabel}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-3)', textTransform: 'uppercase' }}>
              КИП 7 дней
            </div>
            <div style={{ marginTop: 4, fontSize: 36, lineHeight: 1, fontWeight: 900, color }}>
              {hasData ? `${Math.round(object.kipPct)}%` : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, lineHeight: 1, fontWeight: 900, color: 'var(--sv-text-1)' }}>
              {object.vehicleCount}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: 'var(--sv-text-3)' }}>
              ТС за период
            </div>
          </div>
        </div>

        <SidebarKipSparkline trend={object.trend} color={hasData ? kipColor(object.kipPct) : '#94A3B8'} />

        <div style={{ marginTop: 14 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 42px',
            alignItems: 'end',
            gap: 8,
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--sv-text-3)', textTransform: 'uppercase' }}>
              Группы техники
            </div>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--sv-text-3)', textAlign: 'right', textTransform: 'uppercase' }}>
              КИП
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {object.groups.map(group => {
            const barPct = group.kipPct ?? 0;
            return (
              <div key={group.key} style={{ display: 'grid', gridTemplateColumns: '146px 1fr 42px', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: group.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {group.label}
                  </span>
                  <span style={{
                    marginLeft: 'auto',
                    flexShrink: 0,
                    minWidth: 26,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'rgba(148,163,184,0.13)',
                    color: 'var(--sv-text-2)',
                    border: '1px solid var(--sv-divider)',
                    fontSize: 10,
                    fontWeight: 850,
                    textAlign: 'center',
                  }}>
                    {group.vehicleCount} ТС
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.14)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(0, Math.min(100, barPct))}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: group.kipPct == null ? 'transparent' : group.color,
                  }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: group.kipPct == null ? 'var(--sv-text-4)' : group.color, textAlign: 'right' }}>
                  {pctText(group.kipPct)}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </button>
  );
}

function TierTab({
  title,
  count,
  active,
  onClick,
}: {
  title: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        padding: '8px 10px',
        borderRadius: 8,
        background: active ? 'rgba(96,165,250,0.12)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'rgba(96,165,250,0.55)' : 'transparent',
        cursor: 'pointer',
        color: 'inherit',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{
        fontSize: 12,
        fontWeight: 850,
        color: active ? 'var(--sv-text-1)' : 'var(--sv-text-3)',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}>
        {title}
      </span>
      <span style={{
        minWidth: 18,
        padding: '1px 6px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 850,
        textAlign: 'center',
        color: active ? 'var(--sv-text-2)' : 'var(--sv-text-3)',
        background: 'rgba(148,163,184,0.14)',
        border: '1px solid var(--sv-divider)',
      }}>
        {count}
      </span>
    </button>
  );
}

export function AnalyticsSidebar({
  objects,
  secondaryObjects,
  activeTier,
  onTierChange,
  focusedObjectUid,
  onFocusObject,
  from,
  to,
  loading,
  error,
}: AnalyticsSidebarProps) {
  const activeObjects = activeTier === 'key' ? objects : secondaryObjects;
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
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--sv-divider)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 850, color: 'var(--sv-text-1)' }}>
            Объекты
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sv-text-3)', whiteSpace: 'nowrap' }}>
            {fmtDateRangeShort(from, to)}
          </div>
        </div>
        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--sv-text-3)' }}>
          последние 7 закрытых дней
        </div>

        <div style={{
          display: 'flex',
          gap: 6,
          marginTop: 12,
          padding: 4,
          borderRadius: 10,
          background: 'var(--sv-card-inner)',
          border: '1px solid var(--sv-card-inner-border)',
        }}>
          <TierTab
            title="Ключевые"
            count={objects.length}
            active={activeTier === 'key'}
            onClick={() => onTierChange('key')}
          />
          <TierTab
            title="Второстепенные"
            count={secondaryObjects.length}
            active={activeTier === 'secondary'}
            onClick={() => onTierChange('secondary')}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loading && objects.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--sv-text-3)' }}>
            Загрузка объектов...
          </div>
        ) : error ? (
          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.10)', color: '#EF4444', fontSize: 12 }}>
            Не удалось загрузить сайдбар
          </div>
        ) : activeObjects.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--sv-text-3)' }}>
            {activeTier === 'key' ? 'Нет объектов' : 'Нет второстепенных зон за период'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeObjects.map(object => (
              <ObjectCard
                key={object.uid}
                object={object}
                focusedObjectUid={focusedObjectUid}
                onFocusObject={onFocusObject}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
