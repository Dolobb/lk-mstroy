import React, { useCallback, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { WeeklyVehicle, VehicleDetailRow } from '../types/vehicle';
import { getKpiColor, KPI_COLORS, capDisplay } from '../utils/kpi';
import GeozoneLayer from './GeozoneLayer';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface Props {
  vehicles: WeeklyVehicle[];
  selectedVehicleId: string | null;
  selectedDetails: VehicleDetailRow[];
  onSelectVehicle: (id: string | null) => void;
}

// Center showing European + Asian Russia, Moscow visible on left
const RUSSIA_CENTER: [number, number] = [58, 70];
const DEFAULT_ZOOM = 5;

function createPillIcon(regNumber: string, color: string, isSelected: boolean): L.DivIcon {
  const border = isSelected ? '2px solid #1976d2' : '1px solid rgba(0,0,0,0.3)';
  const shadow = isSelected ? '0 0 6px rgba(25,118,210,0.6)' : '0 1px 3px rgba(0,0,0,0.3)';
  return L.divIcon({
    className: '',
    html: `<div style="
      display:inline-flex;align-items:center;gap:3px;
      padding:2px 6px;border-radius:10px;
      background:#fff;border:${border};
      box-shadow:${shadow};
      font-size:11px;font-weight:600;white-space:nowrap;
      color:#333;
    "><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>${regNumber}</div>`,
    iconSize: [0, 0],
    iconAnchor: [40, 10],
    popupAnchor: [0, -12],
  });
}

function DeselectOnMapClick({ onDeselect }: { onDeselect: () => void }) {
  useMapEvents({ click: () => onDeselect() });
  return null;
}

function ResetView({ vehicles }: { vehicles: WeeklyVehicle[] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(RUSSIA_CENTER, DEFAULT_ZOOM);
  }, [vehicles, map]);
  return null;
}

function FlyToVehicle({ vehicles, selectedVehicleId }: { vehicles: WeeklyVehicle[]; selectedVehicleId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedVehicleId) return;
    const v = vehicles.find(v => v.vehicle_id === selectedVehicleId);
    if (v?.latitude != null && v?.longitude != null) {
      map.flyTo([v.latitude, v.longitude], 13, { duration: 1.2 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId]);
  return null;
}

const VehicleMap: React.FC<Props> = ({ vehicles, selectedVehicleId, selectedDetails, onSelectVehicle }) => {
  const withCoords = useMemo(
    () => vehicles.filter(v => v.latitude != null && v.longitude != null),
    [vehicles],
  );

  // Track from latest detail that has one
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
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <DeselectOnMapClick onDeselect={handleDeselect} />
      <ResetView vehicles={vehicles} />
      <FlyToVehicle vehicles={withCoords} selectedVehicleId={selectedVehicleId} />
      <GeozoneLayer />

      <MarkerClusterGroup chunkedLoading>
        {withCoords.map(v => {
          const color = KPI_COLORS[getKpiColor(v.avg_utilization_ratio)];
          const isSelected = v.vehicle_id === selectedVehicleId;
          return (
            <Marker
              key={v.vehicle_id}
              position={[v.latitude!, v.longitude!]}
              icon={createPillIcon(v.vehicle_id, color, isSelected)}
              eventHandlers={{
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
      </MarkerClusterGroup>

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
