import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, CircleMarker, Tooltip as LeafletTooltip, useMap, useMapEvents, ZoomControl, AttributionControl } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ArrowRight, MoveHorizontal, Pause, Play, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useTheme } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { MiniBar } from '@/components/MiniBar';
import { fetchGeoObjects, fetchZonesByObject } from './api';
import type { GeoObject, ZoneFeature, UnifiedVehicleRow, PositionPoint, TrackPoint, TrackResponse } from './types';
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

function computeCentroid(positions: LatLngTuple[]): LatLngTuple {
  const n = positions.length;
  const lat = positions.reduce((s, p) => s + p[0], 0) / n;
  const lng = positions.reduce((s, p) => s + p[1], 0) / n;
  return [lat, lng];
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

function computeBoundsTopLeft(positions: LatLngTuple[]): LatLngTuple {
  let maxLat = -Infinity;
  let minLng = Infinity;
  for (const [lat, lng] of positions) {
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
  }
  return [maxLat, minLng];
}

function isPointInRing(point: LatLngTuple, ring: LatLngTuple[]): boolean {
  const [lat, lng] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i]!;
    const [latJ, lngJ] = ring[j]!;
    const intersects = (latI > lat) !== (latJ > lat)
      && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersects) inside = !inside;
  }

  return inside;
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

function FitBounds({
  bounds,
  maxZoom,
  onlyIfZoomingIn,
}: {
  bounds: LatLngBoundsLiteral | null;
  maxZoom?: number;
  onlyIfZoomingIn?: boolean;
}) {
  const map = useMap();
  const lastKeyRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!bounds) return;
    const key = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`;
    if (lastKeyRef.current === key) return;

    if (onlyIfZoomingIn) {
      const latLngBounds = L.latLngBounds(bounds);
      const targetZoom = Math.min(
        map.getBoundsZoom(latLngBounds, false, L.point(40, 40)),
        maxZoom ?? Infinity,
      );
      if (map.getZoom() >= targetZoom) {
        lastKeyRef.current = key;
        map.panTo(latLngBounds.getCenter());
        return;
      }
    }

    lastKeyRef.current = key;
    map.fitBounds(bounds, { padding: [40, 40], ...(maxZoom != null ? { maxZoom } : {}) });
  }, [map, bounds, maxZoom, onlyIfZoomingIn]);
  return null;
}

function InitialFitBounds({ bounds }: { bounds: LatLngBoundsLiteral | null }) {
  const map = useMap();
  const didFitRef = React.useRef(false);

  useEffect(() => {
    if (!bounds || didFitRef.current) return;
    didFitRef.current = true;
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, bounds]);

  return null;
}

function ZoneMapClickHandler({
  selectedData,
  onOutsideSelected,
}: {
  selectedData: BoundaryData | null;
  onOutsideSelected: () => void;
}) {
  useMapEvents({
    click: (e) => {
      if (!selectedData) return;
      const ring = selectedData.boundary.geometry.coordinates[0];
      if (!ring) return;
      const selectedRing = geoJsonRingToLeaflet(ring);
      const clickedPoint: LatLngTuple = [e.latlng.lat, e.latlng.lng];
      if (!isPointInRing(clickedPoint, selectedRing)) {
        onOutsideSelected();
      }
    },
  });

  return null;
}

// ─── Inspector panel ─────────────────────────────────────

type TrackTimelineDatum = {
  ts: number;               // мс эпохи — X-координата (ось ВРЕМЕНИ, пропорциональная)
  pointIdx: number | null;  // индекс в points[]; null — маркер разрыва данных
  speed: number | null;
};

type TrackTimelineTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: TrackTimelineDatum }>;
};

type ChartPointerState = {
  activeTooltipIndex?: number | string | null;
  activeLabel?: number | string | null;
  activePayload?: Array<{ payload?: TrackTimelineDatum }>;
};

const PLAYBACK_INTERVAL_MS = 250;
const PLAYBACK_SPEEDS = [10, 60, 180, 600, 1800] as const;
type PlaybackSpeed = typeof PLAYBACK_SPEEDS[number];

// Зум/панорама оси времени графика скорости.
const MIN_VIEW_SPAN_MS = 60_000;   // нельзя приблизить мельче 1 минуты
const ZOOM_STEP = 1.6;             // во сколько раз меняем окно за клик
const PAN_STEP_FRAC = 0.3;         // на какую долю окна сдвигаем при панораме
const AXIS_TICK_TARGET = 12;       // ориентир по числу подписей снизу
const AXIS_TICK_STEPS_MS = [
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  60 * 60_000, 2 * 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000,
  12 * 60 * 60_000, 24 * 60 * 60_000,
];

function formatTrackTime(ts: string | number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return typeof ts === 'string' ? (ts.slice(11, 16) || ts) : String(ts);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatTrackSpeed(speed: number | null): string {
  return `${Math.round(speed ?? 0)} км/ч`;
}

// Подпись тика оси времени: каждая в формате DD.MM HH:MM.
function formatAxisTick(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mo} ${hh}:${mm}`;
}

// Ось числовая по времени: activeLabel = ts (мс) под курсором.
function getChartTs(state: unknown): number | null {
  const s = state as ChartPointerState | null;
  const rawLabel = s?.activeLabel;
  if (rawLabel != null && Number.isFinite(Number(rawLabel))) return Number(rawLabel);
  const fromPayload = s?.activePayload?.find(p => p.payload?.ts != null)?.payload?.ts;
  if (fromPayload != null && Number.isFinite(Number(fromPayload))) return Number(fromPayload);
  return null;
}

function stopOverlayEvent(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function TrackTimelineTooltip({ active, payload }: TrackTimelineTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum || datum.pointIdx == null || datum.speed == null) return null;
  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: 8,
      background: 'rgba(15,23,42,0.96)',
      border: '1px solid rgba(255,255,255,0.14)',
      color: '#fff',
      boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
      fontSize: 11,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{formatTrackTime(datum.ts)}</div>
      <div style={{ color: '#fecaca', fontWeight: 700 }}>{Math.round(datum.speed)} км/ч</div>
    </div>
  );
}

function TrackPlaybackMarker({ point }: { point: TrackPoint }) {
  const map = useMap();
  const lastPanAtRef = React.useRef(0);
  const timeoutRef = React.useRef<number | null>(null);

  useEffect(() => {
    const pan = () => {
      lastPanAtRef.current = Date.now();
      map.panTo([point.lat, point.lng], { animate: true, duration: 0.25 });
    };

    const elapsed = Date.now() - lastPanAtRef.current;
    if (elapsed >= 140) {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      pan();
      return;
    }

    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      pan();
    }, 140 - elapsed);

    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [map, point]);

  return (
    <CircleMarker
      center={[point.lat, point.lng] as LatLngTuple}
      radius={7}
      pathOptions={{
        color: '#fff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1,
        opacity: 1,
        className: 'track-playback-marker',
      }}
    >
      <LeafletTooltip direction="top" offset={[0, -8]}>
        <div style={{ fontSize: 11, fontWeight: 700 }}>{formatTrackTime(point.ts)}</div>
        <div style={{ fontSize: 10 }}>{formatTrackSpeed(point.speed)}</div>
      </LeafletTooltip>
    </CircleMarker>
  );
}

function TrackTimelinePanel({
  track,
  activeIndex,
  onActiveIndexChange,
}: {
  track: TrackResponse;
  activeIndex: number | null;
  onActiveIndexChange: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(10);
  const points = track.points;

  // Палитра окна таймлайна под тёмную/светлую тему (SVG-цвета Recharts нужны
  // конкретными строками — var(--sv-*) в атрибутах SVG не резолвится).
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const ui = isDark
    ? {
        panelBg: 'rgba(15,23,42,0.90)', panelBorder: 'rgba(255,255,255,0.12)',
        groupBg: 'rgba(255,255,255,0.04)', groupBorder: 'rgba(255,255,255,0.08)',
        btnBg: 'rgba(255,255,255,0.06)', btnBorder: 'rgba(255,255,255,0.12)',
        divider: 'rgba(255,255,255,0.12)',
        speedBg: 'rgba(255,255,255,0.05)', speedBorder: 'rgba(255,255,255,0.10)',
        text1: '#F1F5F9', text2: '#94A3B8',
        grid: 'rgba(255,255,255,0.08)', axisLine: 'rgba(255,255,255,0.16)',
        tickX: 'rgba(255,255,255,0.52)', tickY: 'rgba(255,255,255,0.46)',
      }
    : {
        panelBg: 'rgba(255,255,255,0.94)', panelBorder: 'rgba(0,0,0,0.10)',
        groupBg: 'rgba(0,0,0,0.03)', groupBorder: 'rgba(0,0,0,0.08)',
        btnBg: 'rgba(0,0,0,0.04)', btnBorder: 'rgba(0,0,0,0.12)',
        divider: 'rgba(0,0,0,0.10)',
        speedBg: 'rgba(0,0,0,0.04)', speedBorder: 'rgba(0,0,0,0.10)',
        text1: '#0F172A', text2: '#475569',
        grid: 'rgba(0,0,0,0.08)', axisLine: 'rgba(0,0,0,0.18)',
        tickX: 'rgba(0,0,0,0.55)', tickY: 'rgba(0,0,0,0.50)',
      };

  const pointTimes = useMemo(
    () => points.map(p => new Date(p.ts).getTime()),
    [points],
  );

  // Полный временной диапазон трека.
  const fullStart = pointTimes[0] ?? 0;
  const fullEndRaw = pointTimes[pointTimes.length - 1] ?? fullStart;
  const fullEnd = fullEndRaw > fullStart ? fullEndRaw : fullStart + MIN_VIEW_SPAN_MS;
  const fullSpan = fullEnd - fullStart;

  // Видимое окно оси X (зум/панорама). null → весь диапазон.
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => { setView(null); }, [points]);  // сброс при смене ТС/периода

  const viewStart = view ? view.start : fullStart;
  const viewEnd = view ? view.end : fullEnd;

  const clampView = useCallback((s: number, e: number): { start: number; end: number } | null => {
    let w = e - s;
    if (w >= fullSpan) return null;             // окно ≥ полного → снять зум
    if (w < MIN_VIEW_SPAN_MS) w = MIN_VIEW_SPAN_MS;
    let ns = s;
    let ne = s + w;
    if (ns < fullStart) { ns = fullStart; ne = ns + w; }
    if (ne > fullEnd) { ne = fullEnd; ns = ne - w; }
    if (ns < fullStart) ns = fullStart;
    return { start: ns, end: ne };
  }, [fullStart, fullEnd, fullSpan]);

  const zoomBy = useCallback((factor: number) => {
    setView(v => {
      const s = v ? v.start : fullStart;
      const e = v ? v.end : fullEnd;
      const c = (s + e) / 2;
      const w = (e - s) * factor;
      return clampView(c - w / 2, c + w / 2);
    });
  }, [clampView, fullStart, fullEnd]);

  const panBy = useCallback((dir: number) => {
    setView(v => {
      const s = v ? v.start : fullStart;
      const e = v ? v.end : fullEnd;
      const w = e - s;
      const shift = w * PAN_STEP_FRAC * dir;
      return clampView(s + shift, e + shift);
    });
  }, [clampView, fullStart, fullEnd]);

  // «Масштаб по данным» — обрезать простой по краям, показать движение (speed > 1).
  const fitToData = useCallback(() => {
    let lo = -1, hi = -1;
    for (let i = 0; i < points.length; i++) {
      if ((points[i]!.speed ?? 0) > 1) { if (lo < 0) lo = i; hi = i; }
    }
    if (lo < 0 || hi <= lo) { setView(null); return; }
    const pad = Math.max((pointTimes[hi]! - pointTimes[lo]!) * 0.02, 30_000);
    setView(clampView(pointTimes[lo]! - pad, pointTimes[hi]! + pad));
  }, [points, pointTimes, clampView]);

  const resetView = useCallback(() => setView(null), []);

  // График по РЕАЛЬНОМУ времени, БЕЗ разрывов: линия непрерывна и идёт по нулю там,
  // где скорость 0 (простой = плоская линия у нуля пропорциональной ширины). Скачки
  // 0→значение не прерывают линию.
  const chartData = useMemo<TrackTimelineDatum[]>(
    () => points.map((p, idx) => ({ ts: pointTimes[idx]!, pointIdx: idx, speed: p.speed ?? 0 })),
    [points, pointTimes],
  );

  const maxSpeed = useMemo(() => {
    const max = Math.max(10, ...chartData.map(d => d.speed ?? 0));
    return Math.ceil(max / 10) * 10;
  }, [chartData]);

  // Подписи времени снизу: «красивый» шаг под ширину окна, выровненный по локальным
  // границам времени (МСК = UTC+3, getTimezoneOffset в минутах).
  const axisTicks = useMemo(() => {
    const span = viewEnd - viewStart;
    if (span <= 0) return [];
    let step = AXIS_TICK_STEPS_MS[AXIS_TICK_STEPS_MS.length - 1]!;
    for (const s of AXIS_TICK_STEPS_MS) {
      if (span / s <= AXIS_TICK_TARGET) { step = s; break; }
    }
    const off = new Date().getTimezoneOffset() * 60_000;  // local = utc - off
    const firstLocal = Math.ceil((viewStart - off) / step) * step;
    const out: number[] = [];
    for (let t = firstLocal + off; t <= viewEnd; t += step) out.push(t);
    return out;
  }, [viewStart, viewEnd]);

  const activePoint = activeIndex == null ? null : points[activeIndex] ?? null;
  const activeTs = activeIndex == null ? null : pointTimes[activeIndex] ?? null;

  const findPointAtOrAfter = useCallback((targetMs: number): number => {
    let lo = 0;
    let hi = pointTimes.length - 1;
    let answer = pointTimes.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (pointTimes[mid]! >= targetMs) {
        answer = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return answer;
  }, [pointTimes]);

  const findNearestIdx = useCallback((targetMs: number): number => {
    const after = findPointAtOrAfter(targetMs);
    if (after <= 0) return 0;
    const before = after - 1;
    const da = Math.abs(pointTimes[after]! - targetMs);
    const db = Math.abs(pointTimes[before]! - targetMs);
    return db <= da ? before : after;
  }, [findPointAtOrAfter, pointTimes]);

  const selectFromChart = useCallback((state: unknown) => {
    const ts = getChartTs(state);
    if (ts == null) return;
    onActiveIndexChange(findNearestIdx(ts));
  }, [findNearestIdx, onActiveIndexChange]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      onActiveIndexChange(prev => {
        const current = prev == null ? 0 : prev;
        const currentMs = pointTimes[current] ?? pointTimes[0];
        if (currentMs == null) return prev;
        const nextMs = currentMs + playbackSpeed * PLAYBACK_INTERVAL_MS;
        return findPointAtOrAfter(nextMs);
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [findPointAtOrAfter, isPlaying, onActiveIndexChange, playbackSpeed, pointTimes]);

  useEffect(() => {
    if (isPlaying && activeIndex != null && activeIndex >= points.length - 1) {
      setIsPlaying(false);
    }
  }, [activeIndex, isPlaying, points.length]);

  useEffect(() => {
    if (!points.length) setIsPlaying(false);
  }, [points.length]);

  const controlButtonStyle: React.CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${ui.btnBorder}`,
    background: ui.btnBg,
    color: ui.text1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };

  const speedButtonStyle = (speed: PlaybackSpeed): React.CSSProperties => ({
    height: 26,
    minWidth: 34,
    borderRadius: 7,
    border: playbackSpeed === speed ? '1px solid rgba(239,68,68,0.7)' : `1px solid ${ui.speedBorder}`,
    background: playbackSpeed === speed ? 'rgba(239,68,68,0.16)' : ui.speedBg,
    color: playbackSpeed === speed ? '#e11d48' : ui.text2,
    fontSize: 11,
    fontWeight: 800,
    cursor: 'pointer',
  });

  const groupStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 6px',
    borderRadius: 10,
    background: ui.groupBg,
    border: `1px solid ${ui.groupBorder}`,
  };

  return (
    <div
      onPointerDown={stopOverlayEvent}
      onPointerMove={stopOverlayEvent}
      onPointerUp={stopOverlayEvent}
      onMouseDown={stopOverlayEvent}
      onClick={stopOverlayEvent}
      onDoubleClick={stopOverlayEvent}
      onWheel={stopOverlayEvent}
      style={{
        position: 'absolute',
        left: 18,
        right: 62,
        bottom: 14,
        zIndex: 1000,
        height: 218,
        minWidth: 320,
        padding: '12px 14px 10px',
        borderRadius: 12,
        background: ui.panelBg,
        border: `1px solid ${ui.panelBorder}`,
        backdropFilter: 'blur(18px)',
        boxShadow: isDark ? '0 18px 42px rgba(0,0,0,0.34)' : '0 18px 42px rgba(15,23,42,0.16)',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        {/* Блок 1 — проигрывание трека */}
        <div style={groupStyle}>
          <button
            type="button"
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
            onClick={() => {
              if (isPlaying) {
                setIsPlaying(false);
                return;
              }
              if (activeIndex == null || activeIndex >= points.length - 1) onActiveIndexChange(0);
              setIsPlaying(true);
            }}
            style={{ ...controlButtonStyle, background: 'rgba(239,68,68,0.18)', borderColor: 'rgba(239,68,68,0.45)', color: '#fecaca' }}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <div style={{ width: 1, height: 20, background: ui.divider }} />
          {PLAYBACK_SPEEDS.map(speed => (
            <button
              key={speed}
              type="button"
              title={`Скорость ${speed}x`}
              onClick={() => setPlaybackSpeed(speed)}
              style={speedButtonStyle(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 8 }} />

        <div style={{
          minWidth: 140,
          textAlign: 'right',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--sv-text-2)',
          fontVariantNumeric: 'tabular-nums',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {activePoint ? `${formatTrackTime(activePoint.ts)} · ${formatTrackSpeed(activePoint.speed)}` : `${points.length} точек`}
        </div>

        {/* Блок 2 — масштаб/панорама графика */}
        <div style={groupStyle}>
          <button type="button" title="Сдвинуть влево" onClick={() => panBy(-1)} style={controlButtonStyle}>
            <ArrowLeft size={14} />
          </button>
          <button type="button" title="Сдвинуть вправо" onClick={() => panBy(1)} style={controlButtonStyle}>
            <ArrowRight size={14} />
          </button>
          <div style={{ width: 1, height: 20, background: ui.divider }} />
          <button type="button" title="Отдалить" onClick={() => zoomBy(ZOOM_STEP)} style={controlButtonStyle}>
            <ZoomOut size={14} />
          </button>
          <button type="button" title="Приблизить" onClick={() => zoomBy(1 / ZOOM_STEP)} style={controlButtonStyle}>
            <ZoomIn size={14} />
          </button>
          <div style={{ width: 1, height: 20, background: ui.divider }} />
          <button type="button" title="Масштаб по данным" onClick={fitToData} style={controlButtonStyle}>
            <MoveHorizontal size={14} />
          </button>
          <button type="button" title="Сбросить масштаб" onClick={resetView} style={controlButtonStyle}>
            <RotateCcw size={14} />
          </button>
        </div>

        <button type="button" title="Скрыть точку" onClick={() => { setIsPlaying(false); onActiveIndexChange(null); }} style={controlButtonStyle}>
          <X size={15} />
        </button>
      </div>

      <div style={{ minHeight: 0, cursor: isDragging ? 'grabbing' : 'crosshair', userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 10, bottom: 18, left: 6 }}
            onClick={selectFromChart}
            onMouseDown={(state: unknown) => {
              setIsDragging(true);
              setIsPlaying(false);
              selectFromChart(state);
            }}
            onMouseMove={(state: unknown) => {
              if (isDragging) selectFromChart(state);
            }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            <defs>
              <linearGradient id="track-speed-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.38} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={ui.grid} vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={[viewStart, viewEnd]}
              ticks={axisTicks}
              allowDataOverflow
              tick={{ fill: ui.tickX, fontSize: 10 }}
              axisLine={{ stroke: ui.axisLine }}
              tickLine={{ stroke: ui.axisLine }}
              minTickGap={64}
              tickFormatter={(v) => formatAxisTick(Number(v))}
            />
            <YAxis
              domain={[0, maxSpeed]}
              tick={{ fill: ui.tickY, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={38}
              tickFormatter={(v) => `${Math.round(Number(v))}`}
            />
            <ChartTooltip
              cursor={{ stroke: 'rgba(248,113,113,0.65)', strokeWidth: 1 }}
              content={(props: unknown) => <TrackTimelineTooltip {...(props as TrackTimelineTooltipProps)} />}
            />
            {activeTs != null && (
              <ReferenceLine x={activeTs} stroke="#ef4444" strokeWidth={2} ifOverflow="hidden" />
            )}
            <Area
              type="monotone"
              dataKey="speed"
              stroke="#f87171"
              strokeWidth={2}
              fill="url(#track-speed-fill)"
              dot={false}
              connectNulls={false}
              activeDot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

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
  focusedObjectUid?: string | null;
  onFocusObject?: (uid: string | null) => void;
  showOutsideOnMap?: boolean;
}

export function AnalyticsMapView({ groups, dateFrom, dateTo, overlayTopLeft, positions, selectedVehicleId, track, onSelectVehicle, focusedObjectUid, onFocusObject, showOutsideOnMap }: AnalyticsMapViewProps) {
  const [geoObjects, setGeoObjects] = useState<GeoObject[]>([]);
  const [objectZones, setObjectZones] = useState<Map<string, ZoneFeature[]>>(new Map());
  const [geoError, setGeoError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeTrackPointIdx, setActiveTrackPointIdx] = useState<number | null>(null);

  const selectedTrack = useMemo(() => {
    if (!selectedVehicleId || !track) return null;
    return track.vehicleId.toUpperCase() === selectedVehicleId.toUpperCase() ? track : null;
  }, [selectedVehicleId, track]);

  useEffect(() => {
    setActiveTrackPointIdx(null);
  }, [selectedVehicleId, track]);

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

  const selectedData = focusedObjectUid
    ? boundaryList.find(bd => bd.objectUid === focusedObjectUid) ?? null
    : null;

  // Bounds of the selected vehicle's track. When a vehicle is selected
  // (from the map, the table or the cards view) this is the single zoom
  // authority — see activeBounds below.
  const trackBounds: LatLngBoundsLiteral | null = useMemo(() => {
    if (!selectedTrack || !selectedTrack.points.length) return null;
    return computeBounds(selectedTrack.points.map(p => [p.lat, p.lng] as LatLngTuple));
  }, [selectedTrack]);

  // Single fitBounds authority for active drill-downs. The all-objects fit is
  // intentionally one-shot on map load, so clearing a zone does not zoom out.
  const activeBounds = useMemo(() => {
    if (trackBounds) return trackBounds;
    if (!selectedData) return null;
    const ring = selectedData.boundary.geometry.coordinates[0];
    if (!ring) return null;
    return computeBounds(geoJsonRingToLeaflet(ring));
  }, [trackBounds, selectedData]);

  // ── All vehicle pins (positions + fallback) ──
  const vehicleRowMap = useMemo(() => {
    const rowMap = new Map<string, UnifiedVehicleRow>();
    for (const g of groups) {
      for (const v of g.vehicles) {
        if (!rowMap.has(v.regNumber)) rowMap.set(v.regNumber, v);
      }
    }
    return rowMap;
  }, [groups]);

  const allPositionPins = useMemo(() => {
    const pins: Array<{ row: UnifiedVehicleRow; lat: number; lng: number }> = [];
    const seen = new Set<string>();

    // 1. Positions (track data) — highest priority
    if (positions) {
      for (const p of positions) {
        const row = vehicleRowMap.get(p.regNumber);
        if (!row) {
          // Unknown vehicle — synthetic degraded row
          pins.push({
            row: {
              regNumber: p.regNumber,
              ledgerVehicleRef: p.regNumber,
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
    for (const [reg, row] of vehicleRowMap) {
      if (seen.has(reg)) continue;
      if (row.latitude != null && row.longitude != null) {
        pins.push({ row, lat: row.latitude, lng: row.longitude });
        seen.add(reg);
      }
    }

    return pins;
  }, [positions, vehicleRowMap]);

  const selectedTrackPin = useMemo(() => {
    if (!selectedVehicleId || !selectedTrack || !selectedTrack.points.length) return null;
    const lastPoint = selectedTrack.points[selectedTrack.points.length - 1]!;
    const row = vehicleRowMap.get(selectedVehicleId)
      ?? allPositionPins.find(p => p.row.regNumber === selectedVehicleId)?.row;
    if (!row) return null;
    return { row, lat: lastPoint.lat, lng: lastPoint.lng };
  }, [selectedVehicleId, selectedTrack, vehicleRowMap, allPositionPins]);

  // ── Reg numbers for all vehicles that belong to at least one named object ──
  const allInObjectRegs = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      if (g.groupUid) {
        for (const v of g.vehicles) s.add(v.regNumber);
      }
    }
    return s;
  }, [groups]);

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
    if (selectedTrackPin) seen.add(selectedTrackPin.row.regNumber);
    const missing = selectedData.vehicles.filter(v => !seen.has(v.regNumber));

    return missing.map((v, i) => {
      const angle = (i / Math.max(missing.length, 1)) * Math.PI * 2;
      const r = 0.0005 + (i % 3) * 0.0003;
      return { row: v, lat: cLat + Math.cos(angle) * r, lng: cLng + Math.sin(angle) * r };
    });
  }, [selectedData, allPositionPins, selectedTrackPin]);

  // ── Which pins to actually render ──
  // Object selected → only that object's vehicles.
  // Outside eye on, no object selected → vehicles not inside any named object.
  // Otherwise → nothing (clean map with just zone outlines + badges).
  const displayedPositionPins = useMemo(() => {
    const withSelectedTrackPin = (pins: Array<{ row: UnifiedVehicleRow; lat: number; lng: number }>) => {
      if (!selectedTrackPin) return pins;
      const idx = pins.findIndex(p => p.row.regNumber === selectedTrackPin.row.regNumber);
      if (idx === -1) return [...pins, selectedTrackPin];
      const next = pins.slice();
      next[idx] = selectedTrackPin;
      return next;
    };

    if (focusedObjectUid) {
      const bd = boundaryList.find(b => b.objectUid === focusedObjectUid);
      if (!bd) return withSelectedTrackPin([]);
      const inObject = new Set(bd.vehicles.map(v => v.regNumber));
      return withSelectedTrackPin(allPositionPins.filter(p => inObject.has(p.row.regNumber)));
    }
    if (showOutsideOnMap) {
      return withSelectedTrackPin(allPositionPins.filter(p => !allInObjectRegs.has(p.row.regNumber)));
    }
    return withSelectedTrackPin([]);
  }, [focusedObjectUid, boundaryList, showOutsideOnMap, allInObjectRegs, allPositionPins, selectedTrackPin]);

  const hasTrackTimeline = Boolean(selectedTrack && selectedTrack.points.length > 1);
  const activeTrackPoint = hasTrackTimeline && activeTrackPointIdx != null
    ? selectedTrack!.points[activeTrackPointIdx] ?? null
    : null;

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
      onClose={() => onFocusObject?.(null)}
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
          zoomControl={false}
          attributionControl={false}
          scrollWheelZoom={true}
        >
          <ZoomControl position="bottomright" />
          <AttributionControl position="bottomleft" prefix={false} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <InitialFitBounds bounds={selectedVehicleId || focusedObjectUid ? null : allBounds} />
          <ZoneMapClickHandler
            selectedData={selectedData}
            onOutsideSelected={() => onFocusObject?.(null)}
          />
          {activeBounds && (
            <FitBounds
              bounds={activeBounds}
              maxZoom={trackBounds ? 16 : undefined}
              onlyIfZoomingIn={!trackBounds}
            />
          )}
          {boundaryList.map(bd => {
            const ring = bd.boundary.geometry.coordinates[0];
            if (!ring) return null;
            const positions = geoJsonRingToLeaflet(ring);
            const kip = avgKip(bd.vehicles);
            const color = kip > 0 ? kipColor(kip) : '#60A5FA';
            const isActive = focusedObjectUid === bd.objectUid;
            const labelPosition = isActive ? computeBoundsTopLeft(positions) : computeCentroid(positions);

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
                          fillOpacity: isActive ? 0 : 0.05,
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
                    fill: !isActive,
                    fillColor: color,
                    fillOpacity: isActive ? 0 : 0.04,
                    opacity: isActive ? 1 : 0.75,
                    interactive: true,
                  }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      if (!isActive) onFocusObject?.(bd.objectUid);
                    },
                  }}
                />
                <Marker
                  key={`label-${bd.objectUid}`}
                  position={labelPosition}
                  icon={L.divIcon({
                    className: '',
                    html: `<div class="sv-map-obj-badge${isActive ? ' active' : ''}" style="--kip-color:${color}"><div class="sv-map-obj-badge-name">${bd.objectName}</div><div class="sv-map-obj-badge-sub"><span class="sv-map-obj-badge-vehicles">${bd.vehicles.length} ТС</span>${kip > 0 ? `<span class="sv-map-obj-badge-kip">${Math.round(kip)}%</span>` : ''}</div></div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  })}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      if (!isActive) onFocusObject?.(bd.objectUid);
                    },
                  }}
                />
              </React.Fragment>
            );
          })}

          <MarkerClusterGroup chunkedLoading spiderfyDistanceMultiplier={2} showCoverageOnHover={false}>
            {displayedPositionPins.map(p => {
              const isSel = p.row.regNumber === selectedVehicleId;
              return (
                <Marker
                  key={p.row.regNumber}
                  position={[p.lat, p.lng] as LatLngTuple}
                  icon={createAnalyticsPin(p.row, isSel)}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      onSelectVehicle?.(isSel ? null : p.row.regNumber);
                    },
                  }}
                />
              );
            })}
            {focusedObjectUid && zoneSyntheticPins.map(p => {
              const isSel = p.row.regNumber === selectedVehicleId;
              return (
                <Marker
                  key={`synth-${p.row.regNumber}`}
                  position={[p.lat, p.lng] as LatLngTuple}
                  icon={createAnalyticsPin(p.row, isSel)}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      onSelectVehicle?.(isSel ? null : p.row.regNumber);
                    },
                  }}
                />
              );
            })}
          </MarkerClusterGroup>

          {selectedTrack && (
            <TrackLayer track={selectedTrack} onDeselect={() => onSelectVehicle?.(null)} />
          )}
          {activeTrackPoint && (
            <TrackPlaybackMarker point={activeTrackPoint} />
          )}
        </MapContainer>

        {hasTrackTimeline && selectedTrack && (
          <TrackTimelinePanel
            track={selectedTrack}
            activeIndex={activeTrackPointIdx}
            onActiveIndexChange={setActiveTrackPointIdx}
          />
        )}

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
          position: 'absolute', bottom: hasTrackTimeline ? 244 : 24, left: 12, zIndex: 1000,
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
