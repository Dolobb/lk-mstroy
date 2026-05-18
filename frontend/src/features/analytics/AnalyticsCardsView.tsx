import React from 'react';
import type { UnifiedVehicleRow, UnifiedRecord } from './types';
import { VehicleCard } from './VehicleCard';

interface AnalyticsGroup {
  groupName: string;
  groupUid?: string;
  vehicles: UnifiedVehicleRow[];
}

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

interface AnalyticsCardsViewProps {
  filteredGroups: AnalyticsGroup[];
  dstRecords: Map<string, UnifiedRecord[]>;
  selectedChip: string | null;
  onChipClick: (key: string) => void;
  onSelectVehicle?: (regNumber: string) => void;
  renderChipDetail?: (chipKey: string) => React.ReactNode;
}

export function AnalyticsCardsView({
  filteredGroups,
  dstRecords,
  selectedChip,
  onChipClick,
  onSelectVehicle,
  renderChipDetail,
}: AnalyticsCardsViewProps) {
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
          <div style={{ columns: 2, columnGap: 8 }}>
            {g.vehicles.map(v => {
              const records = v.source === 'dump_truck' ? v.records : (dstRecords.get(v.regNumber) ?? []);
              return (
                <div key={v.regNumber} style={{ breakInside: 'avoid', marginBottom: 8 }}>
                  <VehicleCard
                    row={v}
                    records={records}
                    selectedChip={selectedChip}
                    onChipClick={onChipClick}
                    onSelectVehicle={onSelectVehicle ? () => onSelectVehicle(v.regNumber) : undefined}
                    renderChipDetail={renderChipDetail}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {filteredGroups.length === 0 && (
        <div className="sv-empty">
          <span className="sv-empty-text">Нет данных</span>
        </div>
      )}
    </div>
  );
}
