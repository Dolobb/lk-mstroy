import React from 'react';
import type { UnifiedVehicleRow, UnifiedRecord } from './types';
import type { MicroBar } from '@/components/ShiftChip';
import { VehicleCard } from './VehicleCard';

export interface AnalyticsGroup {
  groupName: string;
  groupUid?: string;
  vehicles: UnifiedVehicleRow[];
}

export const EMPTY_RECORDS: UnifiedRecord[] = [];

export function limitGroupsForCards(groups: AnalyticsGroup[], limit: number): AnalyticsGroup[] {
  let remaining = Math.max(0, limit);
  const visible: AnalyticsGroup[] = [];

  for (const group of groups) {
    if (remaining <= 0) break;
    const vehicles = group.vehicles.slice(0, remaining);
    if (vehicles.length > 0) {
      visible.push({ ...group, vehicles });
      remaining -= vehicles.length;
    }
  }

  return visible;
}

export function countGroupVehicles(groups: AnalyticsGroup[]): number {
  return groups.reduce((sum, group) => sum + group.vehicles.length, 0);
}

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

interface AnalyticsCardsViewProps {
  filteredGroups: AnalyticsGroup[];
  dstRecords: Map<string, UnifiedRecord[]>;
  // Общий источник onsite micro-bars из AnalyticsPage (дедупликация запросов).
  chipSegments: Map<number, MicroBar[]>;
  selectedChip: string | null;
  onChipClick: (key: string) => void;
  onCloseDetail: () => void;
  onSelectVehicle?: (regNumber: string) => void;
  renderChipDetail?: (chipKey: string) => React.ReactNode;
  visibleVehicleCount: number;
  totalVehicleCount: number;
  onShowMore: () => void;
}

export function AnalyticsCardsView({
  filteredGroups,
  dstRecords,
  chipSegments,
  selectedChip,
  onChipClick,
  onCloseDetail,
  onSelectVehicle,
  renderChipDetail,
  visibleVehicleCount,
  totalVehicleCount,
  onShowMore,
}: AnalyticsCardsViewProps) {
  const hasMore = visibleVehicleCount < totalVehicleCount;

  return (
    <div className="sv-cards-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 0', minHeight: 0 }}>
      {filteredGroups.map(g => (
        <div key={g.groupUid ?? g.groupName} style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            padding: '0 4px', fontSize: 12, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: 'var(--sv-text-2)',
          }}>
            {g.groupUid && (() => {
              const kips = g.vehicles.filter(v => v.avgKipPct > 0).map(v => v.avgKipPct);
              const gKip = kips.length ? kips.reduce((a, b) => a + b, 0) / kips.length : 0;
              return (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: gKip > 0 ? kipColor(gKip) : 'var(--sv-text-4)',
                  flexShrink: 0,
                }} />
              );
            })()}
            <span>{g.groupName}</span>
            <span style={{
              fontSize: 9, padding: '2px 6px', borderRadius: 6,
              background: 'rgba(96,165,250,0.1)', color: '#60A5FA',
              fontWeight: 600,
            }}>{g.vehicles.length} ТС</span>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--sv-divider)', margin: '0 0 8px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, alignItems: 'start' }}>
            {g.vehicles.map(v => {
              const records = v.source === 'dump_truck' ? v.records : (dstRecords.get(v.regNumber) ?? EMPTY_RECORDS);
              const activeChipKey = selectedChip?.startsWith(v.regNumber + '_') ? selectedChip : null;
              return (
                <div key={v.regNumber} style={{ minWidth: 0 }}>
                  <VehicleCard
                    row={v}
                    records={records}
                    chipSegments={chipSegments}
                    activeChipKey={activeChipKey}
                    onChipClick={onChipClick}
                    onSelectVehicle={onSelectVehicle}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 16px' }}>
          <button
            type="button"
            className="sv-btn"
            onClick={onShowMore}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            Показать ещё 60
          </button>
        </div>
      )}
      {selectedChip && renderChipDetail && (
        <div
          className="sv-cards-detail-panel"
          style={{
            margin: '4px 0 16px',
            padding: 12,
            border: '1px solid var(--sv-card-border)',
            borderRadius: 8,
            background: 'var(--sv-card)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              onClick={onCloseDetail}
              title="Закрыть"
              style={{
                width: 24,
                height: 24,
                border: '1px solid var(--sv-card-border)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--sv-text-2)',
                cursor: 'pointer',
              }}
            >
              x
            </button>
          </div>
          {renderChipDetail(selectedChip)}
        </div>
      )}
      {filteredGroups.length === 0 && (
        <div className="sv-empty">
          <span className="sv-empty-text">Нет данных</span>
        </div>
      )}
    </div>
  );
}
