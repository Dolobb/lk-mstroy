import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MiniBar } from '@/components/MiniBar';
import { fetchGeoObjects, fetchZonesByObject } from './api';
import type { GeoObject, ZoneFeature, UnifiedVehicleRow } from './types';

// ─── Types ───────────────────────────────────────────────

interface AnalyticsGroup {
  groupName: string;
  groupUid?: string;
  vehicles: UnifiedVehicleRow[];
}

interface BoundaryData {
  objectUid: string;
  objectName: string;
  boundary: ZoneFeature;
  vehicles: UnifiedVehicleRow[];
}

// ─── Helpers ─────────────────────────────────────────────

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

function avgKip(vehicles: UnifiedVehicleRow[]): number {
  const vals = vehicles.filter(v => v.avgKipPct > 0).map(v => v.avgKipPct);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// GeoJSON [lng, lat] → Leaflet [lat, lng]
function geoJsonRingToLeaflet(ring: number[][]): LatLngTuple[] {
  return ring.map(([lng, lat]) => [lat!, lng!] as LatLngTuple);
}

function computeBounds(positions: LatLngTuple[]): LatLngBoundsLiteral | null {
  if (!positions.length) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of positions) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [[minLat, minLng], [maxLat, maxLng]];
}

// ─── FitBounds helper ────────────────────────────────────

function FitBounds({ bounds }: { bounds: LatLngBoundsLiteral | null }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (bounds && !fittedRef.current) {
      map.fitBounds(bounds, { padding: [40, 40] });
      fittedRef.current = true;
    }
  }, [map, bounds]);
  return null;
}

// ─── Inspector panel ─────────────────────────────────────

function Inspector({ data, onClose }: { data: BoundaryData; onClose: () => void }) {
  const kip = avgKip(data.vehicles);

  const byType = React.useMemo(() => {
    const m = new Map<string, UnifiedVehicleRow[]>();
    for (const v of data.vehicles) {
      if (!m.has(v.vehicleType)) m.set(v.vehicleType, []);
      m.get(v.vehicleType)!.push(v);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.vehicles]);

  return (
    <div style={{
      width: 300, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--sv-card, #1e1e2e)',
      borderLeft: '1px solid var(--sv-card-border, rgba(255,255,255,0.08))',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--sv-card-border, rgba(255,255,255,0.08))',
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--sv-text-1)', marginBottom: 2, wordBreak: 'break-word' }}>
            {data.objectName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--sv-text-2)' }}>
            {data.vehicles.length} ТС
            {kip > 0 && (
              <span style={{ marginLeft: 8, color: kipColor(kip), fontWeight: 600 }}>
                КИП {Math.round(kip)}%
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--sv-text-3)', fontSize: 16, lineHeight: 1, padding: '0 2px',
          }}
        >×</button>
      </div>

      {/* Vehicle list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {byType.map(([type, vehicles]) => (
          <div key={type}>
            <div style={{
              padding: '4px 12px', fontSize: 10, fontWeight: 600,
              color: 'var(--sv-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {type} ({vehicles.length})
            </div>
            {vehicles.map(v => {
              const kip = Math.round(v.avgKipPct);
              const sec = Math.round(v.avgSecondaryPct);
              return (
                <div key={v.regNumber} style={{
                  padding: '5px 12px',
                  borderBottom: '1px solid var(--sv-card-border, rgba(255,255,255,0.05))',
                  display: 'flex', flexDirection: 'column', gap: 3,
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-1)' }}>
                      {v.regNumber}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--sv-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.nameMO}
                    </span>
                  </div>
                  {(kip > 0 || sec > 0) && (
                    <MiniBar
                      primary={{ value: kip, label: 'КИП' }}
                      secondary={{ value: sec, label: v.secondaryLabel }}
                      width={220}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────

interface AnalyticsMapViewProps {
  groups: AnalyticsGroup[];
}

export function AnalyticsMapView({ groups }: AnalyticsMapViewProps) {
  const [geoObjects, setGeoObjects] = useState<GeoObject[]>([]);
  const [boundaries, setBoundaries] = useState<Map<string, ZoneFeature>>(new Map());
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  // Load geo objects once
  useEffect(() => {
    fetchGeoObjects()
      .then(setGeoObjects)
      .catch(err => setGeoError(String(err)));
  }, []);

  // Build set of group uids that have a matching geo object
  const groupUids = React.useMemo(
    () => new Set(groups.map(g => g.groupUid).filter(Boolean) as string[]),
    [groups],
  );

  // Load dt_boundary zones for each matching object (parallel)
  useEffect(() => {
    if (!geoObjects.length) return;

    const uids = geoObjects
      .filter(o => groupUids.has(o.uid))
      .map(o => o.uid);

    if (!uids.length) return;

    Promise.allSettled(
      uids.map(uid =>
        fetchZonesByObject(uid, 'dt_boundary').then(zones => ({ uid, zones }))
      )
    ).then(results => {
      const next = new Map<string, ZoneFeature>();
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.zones.length) {
          next.set(r.value.uid, r.value.zones[0]!);
        }
      }
      setBoundaries(next);
    });
  }, [geoObjects, groupUids]);

  // Build BoundaryData list for rendering
  const boundaryList: BoundaryData[] = React.useMemo(() => {
    return groups
      .filter(g => g.groupUid && boundaries.has(g.groupUid))
      .map(g => ({
        objectUid: g.groupUid!,
        objectName: g.groupName,
        boundary: boundaries.get(g.groupUid!)!,
        vehicles: g.vehicles,
      }));
  }, [groups, boundaries]);

  // Compute fit bounds from all polygon vertices
  const fitBounds: LatLngBoundsLiteral | null = React.useMemo(() => {
    const allPositions: LatLngTuple[] = [];
    for (const bd of boundaryList) {
      const ring = bd.boundary.geometry.coordinates[0];
      if (ring) allPositions.push(...geoJsonRingToLeaflet(ring));
    }
    return computeBounds(allPositions);
  }, [boundaryList]);

  const selectedData = selectedUid
    ? boundaryList.find(bd => bd.objectUid === selectedUid) ?? null
    : null;

  if (geoError) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: '#EF4444' }}>Геоданные недоступны: {geoError}</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Map */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <MapContainer
          center={[62, 80]}
          zoom={4}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {fitBounds && <FitBounds bounds={fitBounds} />}
          {boundaryList.map(bd => {
            const ring = bd.boundary.geometry.coordinates[0];
            if (!ring) return null;
            const positions = geoJsonRingToLeaflet(ring);
            const kip = avgKip(bd.vehicles);
            const color = kip > 0 ? kipColor(kip) : '#60A5FA';
            const isActive = selectedUid === bd.objectUid;

            return (
              <Polygon
                key={bd.objectUid}
                positions={positions}
                pathOptions={{
                  color,
                  weight: isActive ? 2.5 : 1.5,
                  fillColor: color,
                  fillOpacity: isActive ? 0.32 : 0.12,
                  opacity: isActive ? 1 : 0.7,
                }}
                eventHandlers={{
                  click: () => setSelectedUid(prev => prev === bd.objectUid ? null : bd.objectUid),
                }}
              >
                <Tooltip sticky={false} permanent={false} direction="center">
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{bd.objectName}</div>
                  <div style={{ fontSize: 11 }}>
                    {bd.vehicles.length} ТС
                    {kip > 0 && <span style={{ marginLeft: 6, color: kipColor(kip) }}>{Math.round(kip)}%</span>}
                  </div>
                </Tooltip>
              </Polygon>
            );
          })}
        </MapContainer>

        {/* No boundaries hint */}
        {!boundaryList.length && geoObjects.length > 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            padding: '8px 16px', borderRadius: 8, fontSize: 12,
            pointerEvents: 'none', zIndex: 1000,
          }}>
            Нет объектов с границами за выбранный период
          </div>
        )}
      </div>

      {/* Inspector */}
      {selectedData && (
        <Inspector
          data={selectedData}
          onClose={() => setSelectedUid(null)}
        />
      )}
    </div>
  );
}
