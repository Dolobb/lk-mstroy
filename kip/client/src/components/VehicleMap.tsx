import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { WeeklyVehicle, VehicleDetailRow } from '../types/vehicle';
import { getKpiColor, KPI_COLORS, capDisplay } from '../utils/kpi';
import GeozoneLayer from './GeozoneLayer';
import './VehicleMap.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface Props {
  vehicles: WeeklyVehicle[];
  selectedVehicleId: string | null;
  selectedDetails: VehicleDetailRow[];
  onSelectVehicle: (id: string | null) => void;
}

const RUSSIA_CENTER: [number, number] = [58, 70];
const DEFAULT_ZOOM = 5;

// При зуме >= порога — паучок, ниже — приближение. OSM макс = 19, порог = 19 - 4 = 15.
const SPIDERFY_ZOOM_THRESHOLD = 13;

// legacy constants used by the old icon HTML; kept as backup in case we need to
// restore the previous rectangular/stacked design (support for rollback is
// described further down).
const ICON_W = 64;
const ICON_H = 72;

// legacy helper which returned a URL to a static SVG based on vehicle type.
// we keep it around commented-out so that the old version can be restored if
// necessary; the new design embeds inline SVG icons instead.
/*
function getVehicleIconUrl(type: string | undefined): string {
  if (!type) return '';
  if (type === 'Бульдозер') return '/vehicle-icons/bulldozer.svg';
  if (type.startsWith('Каток')) return '/vehicle-icons/roller.svg';
  if (type.startsWith('Краны автомобильные')) return '/vehicle-icons/crane-truck.svg';
  if (type.startsWith('Краны гусеничные')) return '/vehicle-icons/crane-crawler.svg';
  if (type.startsWith('Краны пневмоколёсные') || type.startsWith('Краны пневмоколесные')) return '/vehicle-icons/crane-pneumo.svg';
  if (type === 'Погрузчик') return '/vehicle-icons/loader.svg';
  if (type === 'Экскаватор гусеничный') return '/vehicle-icons/excavator-crawler.svg';
  if (type === 'Экскаватор колесный') return '/vehicle-icons/excavator-wheel.svg';
  if (type === 'Экскаватор-погрузчик') return '/vehicle-icons/excavator-loader.svg';
  return '';
}
*/

// helper mapping KPI colour (returned by getKpiColor) to CSS class name used in
// the new marker design.
function getKipClass(kpiColor: ReturnType<typeof getKpiColor>): string {
  switch (kpiColor) {
    case 'RED':
      return 'kip-red';
    case 'BLUE':
      return 'kip-blue';
    case 'GREEN':
      return 'kip-green';
    default:
      return 'kip-green';
  }
}

// legacy version (kept as a comment for rollback):
/*
function createVehicleIcon(
  regNumber: string,
  color: string,
  kip: number | null,
  vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const border = isSelected ? `2px solid #1976d2` : `1px solid rgba(0,0,0,0.25)`;
  const shadow = isSelected ? '0 0 0 3px rgba(25,118,210,0.35)' : '0 2px 6px rgba(0,0,0,0.25)';
  const iconUrl = getVehicleIconUrl(vehicleType);
  const kipStr = kip != null ? `${capDisplay(kip).toFixed(0)}%` : '—';
  const iconHtml = iconUrl
    ? `<img src="${iconUrl}" style="width:28px;height:28px;display:block;margin:0 auto;" />`
    : `<div style="width:28px;height:28px;"></div>`;

  return L.divIcon({
    className: '',
    html: `<div style="
      width:${ICON_W}px;
      display:flex;flex-direction:column;align-items:center;
      background:#fff;border-radius:7px;
      border:${border};box-shadow:${shadow};
      overflow:hidden;
    ">
      <div style="width:100%;height:5px;background:${color};flex-shrink:0;"></div>
      <div style="padding:5px 4px 2px;">${iconHtml}</div>
      <div style="font-size:9.5px;font-weight:700;color:#222;padding:1px 4px;text-align:center;line-height:1.2;">${regNumber}</div>
      <div style="font-size:9px;font-weight:600;color:${color};padding:2px 4px 4px;">${kipStr}</div>
    </div>`,
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H],
    popupAnchor: [0, -ICON_H],
  });
}
*/

function createVehicleIcon(
  regNumber: string,
  color: string,
  kip: number | null,
  vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const kipClass = getKipClass(getKpiColor(kip != null ? kip : 0));
  const kipStr = kip != null ? `${capDisplay(kip).toFixed(0)}%` : '—';

  // choose an inline SVG based on type (very simplified examples)
  let vehicleSvg = '';
  if (vehicleType === 'Бульдозер') {
    vehicleSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h4l2-4h6l1 4h4"/><rect x="7" y="8" width="6" height="6" rx="1"/><path d="M13 8l4-4h2v4"/><circle cx="4" cy="20" r="2"/><circle cx="17" cy="20" r="2"/></svg>';
  } else if (vehicleType?.startsWith('Каток')) {
    vehicleSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="10" width="9" height="8" rx="1"/><polygon points="10 10 10 18 20 18 17 10"/><circle cx="5" cy="20" r="2"/><circle cx="16" cy="20" r="2"/><rect x="1" y="7" width="6" height="3" rx="1"/></svg>';
  } else {
    vehicleSvg = '<div style="width:12px;height:12px;"></div>';
  }

  const html = `
    <div class="marker ${kipClass}">
      <div class="marker-compact">
        <div class="marker-icon">${vehicleSvg}</div>
        <div class="marker-plate">${regNumber}</div>
        <div class="marker-expand"><div class="marker-expand-sep"></div><span class="marker-kip">${kipStr}</span></div>
      </div>
      <div class="marker-stem"></div><div class="marker-dot"></div>
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H],
    popupAnchor: [0, -ICON_H],
  });
}

// legacy ghost icon implementation retained for reference
/*
function createGhostVehicleIcon(
  regNumber: string,
  vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const border = isSelected ? '2px solid #1976d2' : '1px dashed #aaa';
  const iconUrl = getVehicleIconUrl(vehicleType);
  const iconHtml = iconUrl
    ? `<img src="${iconUrl}" style="width:28px;height:28px;display:block;margin:0 auto;opacity:0.4;" />`
    : `<div style="width:28px;height:28px;"></div>`;

  return L.divIcon({
    className: '',
    html: `<div style="
      width:${ICON_W}px;
      display:flex;flex-direction:column;align-items:center;
      background:rgba(255,255,255,0.7);border-radius:7px;
      border:${border};box-shadow:0 2px 6px rgba(0,0,0,0.15);
      overflow:hidden;opacity:0.7;
    ">
      <div style="width:100%;height:5px;background:#bbb;flex-shrink:0;"></div>
      <div style="padding:5px 4px 2px;">${iconHtml}</div>
      <div style="font-size:9.5px;font-weight:700;color:#888;padding:1px 4px;text-align:center;line-height:1.2;">${regNumber}</div>
      <div style="font-size:9px;color:#aaa;padding:2px 4px 4px;">нет данных</div>
    </div>`,
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H],
    popupAnchor: [0, -ICON_H],
  });
}
*/

function createGhostVehicleIcon(
  regNumber: string,
  vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const kipClass = getKipClass(getKpiColor(0));
  const html = `
    <div class="marker ${kipClass}" style="opacity:.7;">
      <div class="marker-compact">
        <div class="marker-icon" style="opacity:.4;">
          <div style="width:12px;height:12px;"></div>
        </div>
        <div class="marker-plate">${regNumber}</div>
        <div class="marker-expand"><div class="marker-expand-sep"></div><span class="marker-kip">нет данных</span></div>
      </div>
      <div class="marker-stem"></div><div class="marker-dot"></div>
    </div>
  `;
  return L.divIcon({
    className: '',
    html,
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H],
    popupAnchor: [0, -ICON_H],
  });
}

function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  // e.layer присутствует когда клик пришёл через Leaflet-propagation от маркера — не снимаем выбор
  useMapEvents({ click: (e: any) => { if (!e.layer) onDeselect(); } });
  return null;
}

function FitBoundsOnFilter({ vehicles }: { vehicles: WeeklyVehicle[] }) {
  const map = useMap();
  useEffect(() => {
    const coords = vehicles
      .filter(v => v.latitude != null && v.longitude != null)
      .map(v => [v.latitude!, v.longitude!] as [number, number]);
    if (coords.length >= 2) {
      map.fitBounds(coords, { padding: [40, 40] });
    } else if (coords.length === 1) {
      map.setView(coords[0], 12);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles]);
  return null;
}

/**
 * - зум < SPIDERFY_ZOOM_THRESHOLD → клик по кластеру = приближение
 * - зум >= SPIDERFY_ZOOM_THRESHOLD → клик по кластеру = паучок
 * - suppressRef: когда взведён (клик по маркеру в пауке) — после закрытия паука
 *   немедленно переоткрываем его, не трогая внутреннее состояние Leaflet
 */
function ClusterSpiderfyController({
  groupRef,
  suppressRef,
}: {
  groupRef: React.RefObject<any>;
  suppressRef: React.RefObject<boolean>;
}) {
  const map = useMap();

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Заменяем обработчик клика по кластеру
    group.off('clusterclick', group._zoomOrSpiderfy, group);
    const clusterClickHandler = (e: any) => {
      if (map.getZoom() >= SPIDERFY_ZOOM_THRESHOLD) {
        e.layer.spiderfy();
      } else {
        e.layer.zoomToBounds({ padding: [20, 20] });
      }
    };
    group.on('clusterclick', clusterClickHandler);

    // Храним последний раскрытый кластер
    let lastCluster: any = null;
    const onSpiderfied = (e: any) => {
      lastCluster = e.cluster;
      console.log('[spider] spiderfied, lastCluster set');
    };
    const onUnspiderfied = () => {
      console.log('[spider] unspiderfied | suppress=', suppressRef.current, '| lastCluster=', !!lastCluster);
      if (suppressRef.current && lastCluster) {
        const c = lastCluster;
        requestAnimationFrame(() => {
          console.log('[spider] rAF: calling c.spiderfy()');
          c.spiderfy();
        });
      } else {
        lastCluster = null;
      }
    };
    group.on('spiderfied', onSpiderfied);
    group.on('unspiderfied', onUnspiderfied);

    return () => {
      group.off('clusterclick', clusterClickHandler);
      group.on('clusterclick', group._zoomOrSpiderfy, group);
      group.off('spiderfied', onSpiderfied);
      group.off('unspiderfied', onUnspiderfied);
    };
  }, [map, groupRef, suppressRef]);

  return null;
}

const VehicleMap: React.FC<Props> = ({ vehicles, selectedVehicleId, selectedDetails, onSelectVehicle }) => {
  const clusterRef = useRef<any>(null);
  const ghostClusterRef = useRef<any>(null);

  // Флаги подавления unspiderfy на 200мс после клика по маркеру внутри паука
  const clusterSuppress = useRef(false);
  const ghostSuppress = useRef(false);

  const withCoords = useMemo(
    () => vehicles.filter(v => !v.is_ghost && v.latitude != null && v.longitude != null),
    [vehicles],
  );

  const ghostVehicles = useMemo(
    () => vehicles.filter(v => v.is_ghost && v.latitude != null && v.longitude != null),
    [vehicles],
  );

  const trackPositions: [number, number][] = useMemo(() => {
    if (!selectedVehicleId || !selectedDetails.length) return [];
    const withTrack = selectedDetails.find(d => d.track_simplified && d.track_simplified.length > 0);
    if (!withTrack?.track_simplified) return [];
    return withTrack.track_simplified.map(p => [p.lat, p.lon]);
  }, [selectedVehicleId, selectedDetails]);

  const handleDeselect = useCallback(() => {
    onSelectVehicle(null);
  }, [onSelectVehicle]);

  return (
    <MapContainer
      center={RUSSIA_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ height: '100%', width: '100%' }}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <DeselectOnMapClick onDeselect={handleDeselect} />
      <FitBoundsOnFilter vehicles={vehicles} />
      <GeozoneLayer />

      <MarkerClusterGroup ref={clusterRef} chunkedLoading spiderfyDistanceMultiplier={3}>
        {withCoords.map(v => {
          const color = KPI_COLORS[getKpiColor(v.avg_utilization_ratio)];
          const isSelected = v.vehicle_id === selectedVehicleId;
          return (
            <Marker
              key={v.vehicle_id}
              position={[v.latitude!, v.longitude!]}
              icon={createVehicleIcon(v.vehicle_id, color, v.avg_utilization_ratio, v.vehicle_type, isSelected)}
              eventHandlers={{
                mousedown: () => {
                  console.log('[spider] mousedown → suppress=true');
                  clusterSuppress.current = true;
                  setTimeout(() => {
                    console.log('[spider] suppress reset after 500ms');
                    clusterSuppress.current = false;
                  }, 500);
                },
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  console.log('[spider] marker click | suppress=', clusterSuppress.current);
                  onSelectVehicle(v.vehicle_id);
                },
              }}
            >
              <Popup>
                <strong>{v.vehicle_id}</strong><br />
                {v.vehicle_model}<br />
                {v.vehicle_type && <>{v.vehicle_type}<br /></>}
                Объект: {v.department_unit || '—'}<br />
                {v.request_numbers.length > 0 && <>Заявки: {v.request_numbers.join(', ')}<br /></>}
                Ср. загрузка: {capDisplay(v.avg_load_efficiency_pct ?? 0).toFixed(1)}%<br />
                Ср. использование: {capDisplay(v.avg_utilization_ratio ?? 0).toFixed(1)}%<br />
                Записей: {v.record_count}
              </Popup>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
      <ClusterSpiderfyController groupRef={clusterRef} suppressRef={clusterSuppress} />

      {/* Условие 5: призрачные ТС — последнее известное местоположение */}
      <MarkerClusterGroup ref={ghostClusterRef} chunkedLoading spiderfyDistanceMultiplier={2}>
        {ghostVehicles.map(v => {
          const isSelected = v.vehicle_id === selectedVehicleId;
          return (
            <Marker
              key={`ghost-${v.vehicle_id}`}
              position={[v.latitude!, v.longitude!]}
              icon={createGhostVehicleIcon(v.vehicle_id, v.vehicle_type, isSelected)}
              eventHandlers={{
                mousedown: () => {
                  ghostSuppress.current = true;
                  setTimeout(() => { ghostSuppress.current = false; }, 500);
                },
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
                  onSelectVehicle(v.vehicle_id);
                },
              }}
            >
              <Popup>
                <strong>{v.vehicle_id}</strong><br />
                {v.vehicle_type && <>{v.vehicle_type}<br /></>}
                <span style={{ color: '#e57373' }}>
                  Нет данных с {v.last_seen_date}<br />
                </span>
                {v.request_numbers.length > 0 && <>Заявки: {v.request_numbers.join(', ')}<br /></>}
              </Popup>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
      <ClusterSpiderfyController groupRef={ghostClusterRef} suppressRef={ghostSuppress} />

      {trackPositions.length > 1 && (
        <Polyline
          positions={trackPositions}
          pathOptions={{
            color: '#1976d2',
            weight: 3,
            opacity: 0.7,
            dashArray: '8 6',
          }}
        />
      )}
    </MapContainer>
  );
};

export default VehicleMap;
