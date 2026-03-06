import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { WeeklyVehicle, VehicleDetailRow } from '../types/vehicle';
import { getKpiColor, capDisplay } from '../utils/kpi';
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

// Ширина контейнера Leaflet для маркера (pill центрируется внутри через align-items: center)
// Высота = pill ~33px + stem 17px + dot 8px ≈ 58px, +2px запас = 60px
const ICON_W = 140;
const ICON_H = 60;

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

function createVehicleIcon(
  regNumber: string,
  kip: number | null,
  vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const kipClass = getKipClass(getKpiColor(kip != null ? kip : 0));
  const kipStr = kip != null ? `${capDisplay(kip).toFixed(0)}%` : 'Н/Д';
  const iconUrl = getVehicleIconUrl(vehicleType);
  const iconHtml = iconUrl ? `<img src="${iconUrl}" class="marker-icon-img" alt="" />` : '';
  const selectedClass = isSelected ? ' selected' : '';

  const html = `
    <div class="marker ${kipClass}${selectedClass}">
      <div class="marker-compact">
        <div class="marker-icon">${iconHtml}</div>
        <div class="marker-plate">${regNumber}</div>
        <div class="marker-expand"><div class="marker-expand-sep"></div><span class="marker-kip${kip == null ? ' no-data' : ''}">${kipStr}</span></div>
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

function createGhostVehicleIcon(
  regNumber: string,
  _vehicleType: string | undefined,
  isSelected: boolean,
): L.DivIcon {
  const selectedClass = isSelected ? ' selected' : '';
  const html = `
    <div class="marker ghost${selectedClass}" style="opacity:.75;">
      <div class="marker-compact">
        <div class="marker-icon"></div>
        <div class="marker-plate">${regNumber}</div>
        <div class="marker-expand"><div class="marker-expand-sep"></div><span class="marker-kip no-data">Н/Д</span></div>
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
    };
    const onUnspiderfied = () => {
      if (suppressRef.current && lastCluster) {
        const c = lastCluster;
        requestAnimationFrame(() => { c.spiderfy(); });
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

  // Флаг подавления unspiderfy на 500мс после клика по маркеру внутри паука
  const clusterSuppress = useRef(false);

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
        {/* Обычные ТС */}
        {withCoords.map(v => {
          const isSelected = v.vehicle_id === selectedVehicleId;
          return (
            <Marker
              key={v.vehicle_id}
              position={[v.latitude!, v.longitude!]}
              icon={createVehicleIcon(v.vehicle_id, v.avg_utilization_ratio, v.vehicle_type, isSelected)}
              eventHandlers={{
                mousedown: () => {
                  clusterSuppress.current = true;
                  setTimeout(() => { clusterSuppress.current = false; }, 500);
                },
                click: (e) => {
                  L.DomEvent.stopPropagation(e.originalEvent);
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
        {/* Условие 5: призрачные ТС в том же кластере */}
        {ghostVehicles.map(v => {
          const isSelected = v.vehicle_id === selectedVehicleId;
          return (
            <Marker
              key={`ghost-${v.vehicle_id}`}
              position={[v.latitude!, v.longitude!]}
              icon={createGhostVehicleIcon(v.vehicle_id, v.vehicle_type, isSelected)}
              eventHandlers={{
                mousedown: () => {
                  clusterSuppress.current = true;
                  setTimeout(() => { clusterSuppress.current = false; }, 500);
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
      <ClusterSpiderfyController groupRef={clusterRef} suppressRef={clusterSuppress} />

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
