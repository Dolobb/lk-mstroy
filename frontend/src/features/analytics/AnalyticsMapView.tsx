import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, Tooltip, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { MiniBar } from '@/components/MiniBar';
import { fetchGeoObjects, fetchZonesByObject } from './api';
import type { GeoObject, ZoneFeature, UnifiedVehicleRow, PositionPoint, TrackResponse } from './types';
import { vehicleCategory, SUBGROUP_COLORS, SUBGROUP_LABELS, SUBGROUP_ORDER } from './categories';
import { createAnalyticsPin } from './analyticsPin';
import './analyticsPin.css';
import { TrackLayer } from './components/TrackLayer';

// ─── Types ───────────────────────────────────────────────

interface AnalyticsGroup {
  groupName: string;
  groupUid?: string;
  vehicles: UnifiedVehicleRow[];
}

interface BoundaryData {
  objectUid: string;
  objectName: string;
  boundary: ZoneFeature;       // dt_boundary — outline / centroid / select hit-area
  zones: ZoneFeature[];        // all zones of the object (incl. boundary)
  vehicles: UnifiedVehicleRow[];
}

// ─── Helpers ─────────────────────────────────────────────

function kipColor(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#60A5FA';
  return '#EF4444';
}

// ─── Zone-type palette (mirrors geo-admin/client/src/map.ts) ─────────
// Keep in sync with TAG_COLORS / TAG_PRIORITY there.
const ZONE_TAG_COLORS: Record<string, { color: string; fillOpacity: number }> = {
  dt_boundary:  { color: '#888888', fillOpacity: 0.10 },
  dt_loading:   { color: '#2e7d32', fillOpacity: 0.30 },
  dt_unloading: { color: '#e65100', fillOpacity: 0.30 },
  dt_onsite:    { color: '#1565c0', fillOpacity: 0.25 },
  dst_zone:     { color: '#6a1b9a', fillOpacity: 0.20 },
};
const ZONE_TAG_PRIORITY = ['dt_boundary', 'dt_loading', 'dt_unloading', 'dt_onsite', 'dst_zone'];
const ZONE_DEFAULT_STYLE = { color: '#555555', fillOpacity: 0.20 };

function colorByZoneTags(tags: string[]): { color: string; fillOpacity: number } {
  for (const tag of ZONE_TAG_PRIORITY) {
    if (tags.includes(tag)) return ZONE_TAG_COLORS[tag]!;
  }
  return ZONE_DEFAULT_STYLE;
}

// Inner-zone legend (the boundary itself is shown via the КИП halo above).
const ZONE_LEGEND: Array<{ tag: string; label: string }> = [
  { tag: 'dt_loading',   label: 'Погрузка' },
  { tag: 'dt_unloading', label: 'Выгрузка' },
  { tag: 'dt_onsite',    label: 'Работа по месту' },
  { tag: 'dst_zone',     label: 'Рабочая зона КИП' },
];

function avgKip(vehicles: UnifiedVehicleRow[]): number {
  const vals = vehicles.filter(v => v.avgKipPct > 0).map(v => v.avgKipPct);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

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

function fmtDateRangeShort(from: string, to: string): string {
  const fd = from.split('T')[0];
  const td = to.split('T')[0];
  const fp = fd.split('-');
  const tp = td.split('-');
  if (fp[0] !== tp[0]) return `${fp[2]}.${fp[1]}.${fp[0]} — ${tp[2]}.${tp[1]}.${tp[0]}`;
  return `${fp[2]}.${fp[1]} — ${tp[2]}.${tp[1]}.${tp[0]}`;
}

// ─── FitBounds helper ────────────────────────────────────

function FitBounds({ bounds, maxZoom }: { bounds: LatLngBoundsLiteral | null; maxZoom?: number }) {
  const map = useMap();
  const lastKeyRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!bounds) return;
    const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    map.fitBounds(bounds, { padding: [40, 40], ...(maxZoom != null ? { maxZoom } : {}) });
  }, [map, bounds, maxZoom]);
  return null;
}

// ─── Inspector panel ─────────────────────────────────────

function Inspector({ data, onClose, dateFrom, dateTo }: {
  data: BoundaryData;
  onClose: () => void;
  dateFrom?: string;
  dateTo?: string;
}) {
  const kip = avgKip(data.vehicles);

  const typeCount = useMemo(() => {
    const s = new Set<string>();
    data.vehicles.forEach(v => s.add(vehicleCategory(v)));
    return s.size;
  }, [data.vehicles]);

  const byType = useMemo(() => {
    const m = new Map<string, UnifiedVehicleRow[]>();
    for (const v of data.vehicles) {
      const cat = vehicleCategory(v);
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(v);
    }
    return SUBGROUP_ORDER
      .filter(cat => m.has(cat))
      .map(cat => [cat, m.get(cat)!] as const);
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

      {/* Aggregate stats strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
        padding: '8px 12px', borderBottom: '1px solid var(--sv-card-border, rgba(255,255,255,0.05))',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--sv-text-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            Ср. КИП
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: kip > 0 ? kipColor(kip) : 'var(--sv-text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {kip > 0 ? `${Math.round(kip)}%` : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--sv-text-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            Типов ТС
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--sv-text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {typeCount}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--sv-text-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
            Период
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--sv-text-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {dateFrom && dateTo ? fmtDateRangeShort(dateFrom, dateTo) : '—'}
          </div>
        </div>
      </div>

      {/* Vehicle list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {byType.map(([cat, vehicles]) => (
          <div key={cat}>
            <div style={{
              padding: '4px 12px', fontSize: 10, fontWeight: 600,
              color: SUBGROUP_COLORS[cat] || 'var(--sv-text-3)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SUBGROUP_COLORS[cat], flexShrink: 0 }} />
              {SUBGROUP_LABELS[cat] || cat} ({vehicles.length})
            </div>
            {vehicles.map(v => {
              const k = Math.round(v.avgKipPct);
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
                  {(k > 0 || sec > 0) && (
                    <MiniBar
                      primary={{ value: k, label: 'КИП' }}
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
  dateFrom?: string;
  dateTo?: string;
  overlayTopLeft?: React.ReactNode;
  positions?: PositionPoint[];
  selectedVehicleId?: string | null;
  track?: TrackResponse | null;
  onSelectVehicle?: (regNumber: string | null) => void;
}

export function AnalyticsMapView({ groups, dateFrom, dateTo, overlayTopLeft, positions, selectedVehicleId, track, onSelectVehicle }: AnalyticsMapViewProps) {
  const [geoObjects, setGeoObjects] = useState<GeoObject[]>([]);
  const [objectZones, setObjectZones] = useState<Map<string, ZoneFeature[]>>(new Map());
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  useEffect(() => {
    fetchGeoObjects()
      .then(setGeoObjects)
      .catch(err => setGeoError(String(err)));
  }, []);

  const groupUids = useMemo(
    () => new Set(groups.map(g => g.groupUid).filter(Boolean) as string[]),
    [groups],
  );

  useEffect(() => {
    if (!geoObjects.length) return;
    const uids = geoObjects
      .filter(o => groupUids.has(o.uid))
      .map(o => o.uid);
    if (!uids.length) return;

    Promise.allSettled(
      uids.map(uid =>
        fetchZonesByObject(uid).then(zones => ({ uid, zones }))
      )
    ).then(results => {
      const next = new Map<string, ZoneFeature[]>();
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.zones.length) {
          next.set(r.value.uid, r.value.zones);
        }
      }
      setObjectZones(next);
    });
  }, [geoObjects, groupUids]);

  const boundaryList: BoundaryData[] = useMemo(() => {
    const out: BoundaryData[] = [];
    for (const g of groups) {
      if (!g.groupUid) continue;
      const zones = objectZones.get(g.groupUid);
      if (!zones) continue;
      // Object only shown if it has a dt_boundary (same as before — the
      // boundary is the outline + selection hit-area). Inner zones layer
      // under it.
      const boundary = zones.find(z => z.properties.tags?.includes('dt_boundary'));
      if (!boundary) continue;
      out.push({
        objectUid: g.groupUid,
        objectName: g.groupName,
        boundary,
        zones,
        vehicles: g.vehicles,
      });
    }
    return out;
  }, [groups, objectZones]);

  // All-objects fitBounds
  const allBounds: LatLngBoundsLiteral | null = useMemo(() => {
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

  // Bounds of the selected vehicle's track. When a vehicle is selected
  // (from the map, the table or the cards view) this is the single zoom
  // authority — see activeBounds below.
  const trackBounds: LatLngBoundsLiteral | null = useMemo(() => {
    if (!selectedVehicleId || !track || !track.points.length) return null;
    return computeBounds(track.points.map(p => [p.lat, p.lng] as LatLngTuple));
  }, [selectedVehicleId, track]);

  // Single fitBounds authority, priority:
  //   selected vehicle's track → selected zone → all objects.
  // Track wins so that switching to the map from the table/cards zooms to
  // the vehicle deterministically (previously TrackLayer did its own
  // fitBounds, racing this one on a fresh map mount).
  const activeBounds = useMemo(() => {
    if (trackBounds) return trackBounds;
    if (!selectedData) return allBounds;
    const ring = selectedData.boundary.geometry.coordinates[0];
    if (!ring) return allBounds;
    return computeBounds(geoJsonRingToLeaflet(ring));
  }, [trackBounds, selectedData, allBounds]);

  // ── All vehicle pins (positions + fallback) ──
  const allPositionPins = useMemo(() => {
    const rowMap = new Map<string, UnifiedVehicleRow>();
    for (const g of groups) {
      for (const v of g.vehicles) {
        if (!rowMap.has(v.regNumber)) rowMap.set(v.regNumber, v);
      }
    }

    const pins: Array<{ row: UnifiedVehicleRow; lat: number; lng: number }> = [];
    const seen = new Set<string>();

    // 1. Positions (track data) — highest priority
    if (positions) {
      for (const p of positions) {
        const row = rowMap.get(p.regNumber);
        if (!row) {
          // Unknown vehicle — synthetic degraded row
          pins.push({
            row: {
              regNumber: p.regNumber,
              nameMO: p.regNumber,
              organization: null,
              vehicleType: '',
              source: p.source === 'dt_tracks' ? 'dump_truck' : 'dst',
              records: [],
              shiftsCount: 0,
              avgKipPct: 0,
              avgSecondaryPct: 0,
              secondaryLabel: 'Н/Д',
              totalTrips: 0,
              totalFuelL: 0,
              engineTotalSec: 0,
            },
            lat: p.lat,
            lng: p.lng,
          });
        } else {
          pins.push({ row, lat: p.lat, lng: p.lng });
        }
        seen.add(p.regNumber);
      }
    }

    // 2. Fallback: row.latitude/longitude for vehicles not in positions
    for (const [reg, row] of rowMap) {
      if (seen.has(reg)) continue;
      if (row.latitude != null && row.longitude != null) {
        pins.push({ row, lat: row.latitude, lng: row.longitude });
        seen.add(reg);
      }
    }

    return pins;
  }, [positions, groups]);

  // ── Synthetic pins for selected zone (vehicles without any coords) ──
  const zoneSyntheticPins = useMemo(() => {
    if (!selectedData) return [];
    const ring = selectedData.boundary.geometry.coordinates[0];
    if (!ring) return [];

    let cLat = 0, cLng = 0;
    for (const [lng, lat] of ring) { cLat += lat; cLng += lng; }
    cLat /= ring.length;
    cLng /= ring.length;

    const seen = new Set(allPositionPins.map(p => p.row.regNumber));
    const missing = selectedData.vehicles.filter(v => !seen.has(v.regNumber));

    return missing.map((v, i) => {
      const angle = (i / Math.max(missing.length, 1)) * Math.PI * 2;
      const r = 0.0005 + (i % 3) * 0.0003;
      return { row: v, lat: cLat + Math.cos(angle) * r, lng: cLng + Math.sin(angle) * r };
    });
  }, [selectedData, allPositionPins]);

  if (geoError) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: '#EF4444' }}>Геоданные недоступны: {geoError}</span>
      </div>
    );
  }

  const inspectorNode = selectedData ? (
    <Inspector
      data={selectedData}
      onClose={() => setSelectedUid(null)}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  ) : null;

  const mapContent = (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {overlayTopLeft && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 1000,
            width: 'max-content',
            pointerEvents: 'none',
            padding: '6px 10px',
            borderRadius: 10,
            background: 'var(--sv-card, rgba(15,23,42,0.75))',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--sv-card-border, rgba(255,255,255,0.08))',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            <div style={{ pointerEvents: 'auto' }}>
              {overlayTopLeft}
            </div>
          </div>
        )}
        <MapContainer
          center={[62, 80]}
          zoom={4}
          style={{ height: '100%', width: '100%' }}
          zoomControl={true}
          scrollWheelZoom={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {activeBounds && <FitBounds bounds={activeBounds} maxZoom={trackBounds ? 16 : undefined} />}
          {boundaryList.map(bd => {
            const ring = bd.boundary.geometry.coordinates[0];
            if (!ring) return null;
            const positions = geoJsonRingToLeaflet(ring);
            const kip = avgKip(bd.vehicles);
            const color = kip > 0 ? kipColor(kip) : '#60A5FA';
            const isActive = selectedUid === bd.objectUid;

            return (
              <React.Fragment key={bd.objectUid}>
                {/* Inner zones (loading / unloading / on-site / dst): same
                    border + soft-glow treatment as the boundary, tinted by
                    type (palette mirrors geo-admin). Non-interactive so the
                    object-select click still lands on the boundary below. */}
                {bd.zones.map(z => {
                  if (z.properties.tags?.includes('dt_boundary')) return null;
                  const zr = z.geometry.coordinates[0];
                  if (!zr) return null;
                  const zpos = geoJsonRingToLeaflet(zr);
                  const zc = colorByZoneTags(z.properties.tags ?? []);
                  return (
                    <React.Fragment key={`${bd.objectUid}-z-${z.properties.uid}`}>
                      {/* Blurred unfilled outline → gradient hugging the edge */}
                      <Polygon
                        positions={zpos}
                        pathOptions={{
                          color: zc.color,
                          weight: 3.5,
                          fill: false,
                          opacity: 0.32,
                          className: 'zone-glow',
                          interactive: false,
                        }}
                      />
                      {/* Crisp thin border + faint fill so the area reads */}
                      <Polygon
                        positions={zpos}
                        pathOptions={{
                          color: zc.color,
                          weight: 1.25,
                          fillColor: zc.color,
                          fillOpacity: 0.05,
                          opacity: 0.7,
                          interactive: false,
                        }}
                      />
                    </React.Fragment>
                  );
                })}
                {/* Glow layer: blurred, unfilled outline → soft gradient that
                    is strongest at the border and fades to 0 away from it.
                    pointer-events:none (CSS) so clicks pass to the border. */}
                <Polygon
                  positions={positions}
                  pathOptions={{
                    color,
                    weight: isActive ? 7 : 4,
                    fill: false,
                    opacity: isActive ? 0.6 : 0.38,
                    className: isActive ? 'zone-glow zone-glow-active' : 'zone-glow',
                    interactive: false,
                  }}
                />
                {/* Crisp border + near-invisible fill (kept only as a click
                    hit-area; without any fill the interior is not clickable). */}
                <Polygon
                  positions={positions}
                  pathOptions={{
                    color,
                    weight: isActive ? 2.5 : 1.5,
                    fillColor: color,
                    fillOpacity: isActive ? 0.08 : 0.04,
                    opacity: isActive ? 1 : 0.75,
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
              </React.Fragment>
            );
          })}

          <MarkerClusterGroup chunkedLoading spiderfyDistanceMultiplier={2} showCoverageOnHover={false}>
            {allPositionPins.map(p => {
              const isSel = p.row.regNumber === selectedVehicleId;
              return (
                <Marker
                  key={p.row.regNumber}
                  position={[p.lat, p.lng] as LatLngTuple}
                  icon={createAnalyticsPin(p.row, isSel)}
                  eventHandlers={{ click: () => onSelectVehicle?.(isSel ? null : p.row.regNumber) }}
                >
                  <Tooltip sticky={false} direction="top" offset={[0, -52]}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.row.regNumber}</div>
                    <div style={{ fontSize: 11, color: 'var(--sv-text-2)' }}>{p.row.nameMO}</div>
                    <div style={{ fontSize: 11 }}>
                      КИП {Math.round(p.row.avgKipPct)}%
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
            {selectedUid && zoneSyntheticPins.map(p => {
              const isSel = p.row.regNumber === selectedVehicleId;
              return (
                <Marker
                  key={`synth-${p.row.regNumber}`}
                  position={[p.lat, p.lng] as LatLngTuple}
                  icon={createAnalyticsPin(p.row, isSel)}
                  eventHandlers={{ click: () => onSelectVehicle?.(isSel ? null : p.row.regNumber) }}
                >
                  <Tooltip sticky={false} direction="top" offset={[0, -52]}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.row.regNumber}</div>
                    <div style={{ fontSize: 11, color: 'var(--sv-text-2)' }}>{p.row.nameMO}</div>
                    <div style={{ fontSize: 11 }}>
                      КИП {Math.round(p.row.avgKipPct)}%
                    </div>
                  </Tooltip>
                </Marker>
              );
            })}
          </MarkerClusterGroup>

          {track && (
            <TrackLayer track={track} onDeselect={() => onSelectVehicle?.(null)} />
          )}
        </MapContainer>

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

        <button
          onClick={() => setFullscreen(f => !f)}
          title={fullscreen ? 'Свернуть' : 'На весь экран'}
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 1000,
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(12px)',
            border: '1px solid var(--sv-card-border, rgba(255,255,255,0.08))',
            color: 'var(--sv-text-1)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
          }}
        >
          {fullscreen ? '⤡' : '⤢'}
        </button>

        <div style={{
          position: 'absolute', bottom: 24, left: 12, zIndex: 1000,
          padding: '6px 10px', borderRadius: 10,
          background: 'var(--sv-card, rgba(15,23,42,0.75))',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--sv-card-border, rgba(255,255,255,0.08))',
          display: 'flex', flexDirection: 'column', gap: 4,
          fontSize: 10, color: 'var(--sv-text-2)',
        }}>
          {[
            { color: '#22C55E', label: 'КИП ≥ 75%' },
            { color: '#3B82F6', label: 'КИП 50–74%' },
            { color: '#EF4444', label: 'КИП < 50%' },
            { color: '#94A3B8', label: 'Нет данных' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: item.color, flexShrink: 0,
              }} />
              <span style={{ fontWeight: 600 }}>{item.label}</span>
            </div>
          ))}
          <div style={{ height: 1, background: 'var(--sv-card-border, rgba(255,255,255,0.10))', margin: '3px 0' }} />
          {ZONE_LEGEND.map(z => (
            <div key={z.tag} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: ZONE_TAG_COLORS[z.tag]!.color, flexShrink: 0,
              }} />
              <span style={{ fontWeight: 600 }}>{z.label}</span>
            </div>
          ))}
          <div style={{ fontSize: 8, color: 'var(--sv-text-4)', marginTop: 2, textAlign: 'center' }}>
            Клик по зоне — выбор
          </div>
        </div>

        {/* Non-fullscreen inspector */}
        {!fullscreen && inspectorNode}
      </div>

      {/* Fullscreen: inspector as fixed overlay */}
      {fullscreen && inspectorNode && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9010,
          display: 'flex',
        }}>
          {inspectorNode}
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'var(--sv-bg, #040812)',
        display: 'flex', flexDirection: 'column',
      }}>
        {mapContent}
      </div>
    );
  }

  return mapContent;
}
