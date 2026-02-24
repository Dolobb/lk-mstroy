import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import type { RequestDataResponse, RequestHierarchy, PLEntry, VehicleMonitoring, TrackPoint } from './types';
import { getRequestData } from './api';
import { fmtRuDT, fmtHours, fmtRequestStatus } from './utils';

// Fix leaflet marker icons in Vite build
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});

// ===================== Map fit bounds helper =====================

interface FitBoundsProps {
  points: [number, number][];
}

const FitBounds: React.FC<FitBoundsProps> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, points]);
  return null;
};

// ===================== Track display =====================

interface TrackLayerProps {
  vehicle: VehicleMonitoring;
}

const TrackLayer: React.FC<TrackLayerProps> = ({ vehicle }) => {
  const validTrack: [number, number][] = (vehicle.mon_track ?? [])
    .filter((p): p is TrackPoint & { lat: number; lon: number } => p.lat != null && p.lon != null)
    .map((p) => [p.lat, p.lon]);

  const validParkings = (vehicle.mon_parkings ?? []).filter(
    (p) => p.lat != null && p.lon != null
  );

  return (
    <>
      <FitBounds points={validTrack} />
      {validTrack.length > 1 && (
        <Polyline positions={validTrack} color="#3b82f6" weight={2} opacity={0.85} />
      )}
      {validParkings.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat!, p.lon!]}
          radius={5}
          color="#ef4444"
          fillColor="#ef4444"
          fillOpacity={0.7}
          weight={1}
        >
          <Tooltip>
            <div className="text-xs">
              <div className="font-semibold">{p.address ?? 'Стоянка'}</div>
              {p.begin && <div>Начало: {fmtRuDT(p.begin)}</div>}
              {p.end && <div>Конец: {fmtRuDT(p.end)}</div>}
              {p.duration_min != null && <div>Длит.: {p.duration_min} мин</div>}
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
};

// ===================== Fact panel =====================

interface FactPanelProps {
  vehicle: VehicleMonitoring;
  plId: string;
}

const FactPanel: React.FC<FactPanelProps> = ({ vehicle, plId }) => {
  const fuels = vehicle.mon_fuels ?? [];
  const parkings = vehicle.mon_parkings ?? [];

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <div>
        <div className="text-xs font-bold text-foreground mb-0.5">
          {vehicle.ts_reg_number ?? vehicle.ts_name_mo ?? `ТС #${vehicle.ts_id_mo}`}
        </div>
        <div className="text-[10px] text-muted-foreground">ПЛ {plId}</div>
      </div>

      {/* Основные показатели */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Пробег</div>
          <div className="text-sm font-semibold text-foreground">
            {vehicle.mon_distance != null ? `${vehicle.mon_distance} км` : '—'}
          </div>
        </div>
        <div className="glass-card px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">В движении</div>
          <div className="text-sm font-semibold text-foreground">
            {fmtHours(vehicle.mon_moving_time_hours)}
          </div>
        </div>
        <div className="glass-card px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Двигатель</div>
          <div className="text-sm font-semibold text-foreground">
            {fmtHours(vehicle.mon_engine_time_hours)}
          </div>
        </div>
        <div className="glass-card px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Холостой</div>
          <div className="text-sm font-semibold text-foreground">
            {fmtHours(vehicle.mon_idling_time_hours)}
          </div>
        </div>
      </div>

      {/* Топливо */}
      {fuels.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">
            Топливо
          </div>
          {fuels.map((f, i) => (
            <div key={i} className="text-xs flex justify-between py-0.5 border-b border-border/30 last:border-0">
              <span className="text-muted-foreground truncate">{f.name ?? 'Топливо'}</span>
              <span className="text-foreground shrink-0 ml-2">
                {f.value_begin != null && f.value_end != null
                  ? `${f.value_begin} → ${f.value_end} л`
                  : f.charges != null
                  ? `+${f.charges} л`
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Стоянки */}
      {parkings.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">
            Стоянки ({vehicle.mon_parkings_count ?? parkings.length})
          </div>
          <div className="flex flex-col gap-1">
            {parkings.slice(0, 8).map((p, i) => (
              <div key={i} className="text-[10px] py-1 border-b border-border/30 last:border-0">
                <div className="text-foreground truncate">{p.address ?? '—'}</div>
                <div className="text-muted-foreground flex gap-1.5">
                  <span>{fmtRuDT(p.begin)}</span>
                  {p.duration_min != null && <span>· {p.duration_min} мин</span>}
                </div>
              </div>
            ))}
            {parkings.length > 8 && (
              <div className="text-[10px] text-muted-foreground">...ещё {parkings.length - 8}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ===================== Left panel =====================

interface LeftPanelProps {
  hierarchy: RequestHierarchy;
  selectedKey: string | null;
  onSelectVehicle: (key: string, pl: PLEntry, vehicle: VehicleMonitoring) => void;
  defaultExpandedPLId?: string | null;
}

const LeftPanel: React.FC<LeftPanelProps> = ({ hierarchy, selectedKey, onSelectVehicle, defaultExpandedPLId }) => {
  const [expandedPLs, setExpandedPLs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (defaultExpandedPLId) {
      setExpandedPLs((prev) => {
        if (prev.has(defaultExpandedPLId)) return prev;
        return new Set([...prev, defaultExpandedPLId]);
      });
    }
  }, [defaultExpandedPLId]);

  const togglePL = (plId: string) => {
    setExpandedPLs((prev) => {
      const next = new Set(prev);
      if (next.has(plId)) next.delete(plId);
      else next.add(plId);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto h-full">
      {/* Request info */}
      <div className="glass-card px-3 py-2">
        <div className="text-xs font-bold text-primary mb-1">Заявка #{hierarchy.request_number}</div>
        {hierarchy.route_start_address && (
          <div className="text-[10px] text-muted-foreground">
            {hierarchy.route_start_address}
          </div>
        )}
        {hierarchy.route_end_address && (
          <div className="text-[10px] text-muted-foreground">
            → {hierarchy.route_end_address}
          </div>
        )}
        {hierarchy.order_name_cargo && (
          <div className="text-[10px] text-foreground mt-0.5">{hierarchy.order_name_cargo}</div>
        )}
        <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground flex-wrap">
          {hierarchy.route_start_date && <span>{fmtRuDT(hierarchy.route_start_date)}</span>}
          {hierarchy.route_distance != null && <span>{hierarchy.route_distance} км</span>}
          {hierarchy.request_status && <span>{fmtRequestStatus(hierarchy.request_status)}</span>}
        </div>
      </div>

      {/* PL list */}
      {hierarchy.pl_list.map((pl) => {
        const isExpanded = expandedPLs.has(pl.pl_id);
        return (
          <div key={pl.pl_id} className="glass-card overflow-hidden">
            <button
              onClick={() => togglePL(pl.pl_id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-muted/40 transition-colors cursor-pointer border-none bg-transparent"
            >
              <div className="flex-1 text-left min-w-0">
                <div className="text-xs font-semibold text-foreground">ПЛ {pl.pl_id}</div>
                <div className="text-[10px] text-muted-foreground flex gap-1.5">
                  {pl.pl_date_out && <span>{pl.pl_date_out}</span>}
                  {pl.pl_ts_number && <span>· {pl.pl_ts_number}</span>}
                  <span className="text-muted-foreground">· {pl.vehicles.length} ТС</span>
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
              )}
            </button>

            {isExpanded && (
              <div className="border-t border-border/40 py-1">
                {pl.vehicles.map((v, vi) => {
                  const key = `${pl.pl_id}_${v.ts_id_mo ?? vi}`;
                  const isSelected = selectedKey === key;
                  const hasTrack = (v.mon_track?.length ?? 0) > 0;
                  return (
                    <button
                      key={key}
                      onClick={() => hasTrack && onSelectVehicle(key, pl, v)}
                      disabled={!hasTrack}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-none ${
                        isSelected
                          ? 'bg-primary/20 text-primary'
                          : hasTrack
                          ? 'hover:bg-muted/40 cursor-pointer bg-transparent text-foreground'
                          : 'bg-transparent text-muted-foreground cursor-default opacity-60'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {v.ts_reg_number ?? v.ts_name_mo ?? `ТС #${v.ts_id_mo}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {hasTrack
                            ? `${(v.mon_track?.length ?? 0)} точек`
                            : 'нет трека'}
                          {v.mon_distance != null && ` · ${v.mon_distance} км`}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ===================== Main ReportView =====================

const TyagachiReportView: React.FC = () => {
  const { requestNumber } = useParams<{ requestNumber: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RequestDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleMonitoring | null>(null);
  const [selectedPL, setSelectedPL] = useState<PLEntry | null>(null);
  const [defaultExpandedPLId, setDefaultExpandedPLId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestNumber || isNaN(Number(requestNumber))) {
      setError('Некорректный номер заявки');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getRequestData(Number(requestNumber))
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [requestNumber]);

  const handleSelectVehicle = useCallback(
    (key: string, pl: PLEntry, vehicle: VehicleMonitoring) => {
      setSelectedKey(key);
      setSelectedVehicle(vehicle);
      setSelectedPL(pl);
    },
    []
  );

  // Get first hierarchy entry (usually one entry keyed by request number)
  const hierarchy = data?.hierarchy ? (Object.values(data.hierarchy)[0] ?? null) : null;

  // Auto-select first vehicle with track data
  useEffect(() => {
    if (!hierarchy || selectedKey) return;
    for (const pl of hierarchy.pl_list) {
      const v = pl.vehicles.find((v) => (v.mon_track?.length ?? 0) > 0);
      if (v) {
        const key = `${pl.pl_id}_${v.ts_id_mo ?? 0}`;
        setDefaultExpandedPLId(pl.pl_id);
        handleSelectVehicle(key, pl, v);
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Загрузка данных заявки #{requestNumber}...
      </div>
    );
  }

  if (error || !hierarchy) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-red-400 max-w-md text-center">
          {error ?? 'Данные не найдены. Убедитесь что синхронизация выполнена.'}
        </div>
        <button
          onClick={() => navigate('/tyagachi')}
          className="text-xs text-primary hover:underline cursor-pointer border-none bg-transparent"
        >
          ← Назад к тягачам
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header */}
      <div className="px-3 py-1.5 shrink-0 flex items-center gap-2 border-b border-border/40">
        <button
          onClick={() => navigate('/tyagachi')}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-none bg-transparent"
        >
          <ArrowLeft className="size-3.5" />
          Тягачи
        </button>
        <span className="text-muted-foreground text-xs">/</span>
        <span className="text-xs font-semibold text-foreground">
          Заявка #{requestNumber}
          {hierarchy.object_expend_name && (
            <span className="text-muted-foreground font-normal ml-1.5">
              {hierarchy.object_expend_name}
            </span>
          )}
        </span>
      </div>

      {/* Three-column layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: PL list */}
        <div className="w-72 shrink-0 border-r border-border/40 overflow-hidden">
          <LeftPanel
            hierarchy={hierarchy}
            selectedKey={selectedKey}
            onSelectVehicle={handleSelectVehicle}
            defaultExpandedPLId={defaultExpandedPLId}
          />
        </div>

        {/* Center: Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={[55.75, 37.6]}
            zoom={6}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {selectedVehicle && <TrackLayer vehicle={selectedVehicle} />}
          </MapContainer>

          {/* Map legend */}
          {selectedVehicle && (
            <div className="absolute bottom-4 left-4 glass-card px-2.5 py-1.5 text-[10px] flex flex-col gap-1 z-[1000]">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-0.5 bg-blue-500 rounded" />
                <span className="text-muted-foreground">Трек</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                <span className="text-muted-foreground">Стоянки</span>
              </div>
            </div>
          )}

          {!selectedVehicle && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="glass-card px-4 py-2 text-xs text-muted-foreground">
                Выберите машину из списка слева
              </div>
            </div>
          )}
        </div>

        {/* Right: Fact panel */}
        <div className="w-72 shrink-0 border-l border-border/40 overflow-hidden">
          {selectedVehicle && selectedPL ? (
            <FactPanel vehicle={selectedVehicle} plId={selectedPL.pl_id} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4 text-center">
              Выберите машину для просмотра данных
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TyagachiReportView;
