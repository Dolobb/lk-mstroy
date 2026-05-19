import React, { useState, useMemo, useCallback } from 'react';
import { Polyline, Marker, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { TrackPoint, TrackResponse } from '../types';

interface TrackLayerProps {
  track: TrackResponse;
  onDeselect?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────

function interpolateColor(speed: number | null): string {
  const s = speed ?? 0;
  if (s <= 0) return '#3b82f6';
  if (s >= 60) return '#ef4444';

  const stops = [
    { speed: 0,  r: 59,  g: 130, b: 246 },
    { speed: 30, r: 34,  g: 197, b: 94  },
    { speed: 60, r: 239, g: 68,  b: 68  },
  ];

  let lower = stops[0], upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (s >= stops[i].speed && s <= stops[i + 1].speed) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  const ratio = (s - lower.speed) / (upper.speed - lower.speed);
  const r = Math.round(lower.r + (upper.r - lower.r) * ratio);
  const g = Math.round(lower.g + (upper.g - lower.g) * ratio);
  const b = Math.round(lower.b + (upper.b - lower.b) * ratio);
  return `rgb(${r},${g},${b})`;
}

function toRad(deg: number): number { return deg * Math.PI / 180; }

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}ч ${m}мин`;
  return `${m}мин`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function createArrowIcon(heading: number): L.DivIcon {
  // Open chevron (no fill) — direction is readable, colored track stays
  // visible through it. Dark halo under a white stroke keeps it legible on
  // both the light basemap and the coloured track.
  return L.divIcon({
    className: '',
    html: `<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${heading}deg);overflow:visible;">
      <path d="M3 10 L7 4 L11 10" fill="none" stroke="#1f2937" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
      <path d="M3 10 L7 4 L11 10" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createDwellIcon(dwellSec: number, idx: number): L.DivIcon {
  const color = dwellSec <= 1800 ? '#9ca3af' : dwellSec <= 7200 ? '#f59e0b' : '#ef4444';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:26px;height:26px;border-radius:50%;background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;font-weight:700;
      font-size:12px;font-family:system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,0.3);
      animation:dwellFadeIn 250ms ease-out ${idx * 50}ms backwards;
    ">P</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// ─── Map click handler (deselect on empty space) ────────

function MapClickHandler({ onEmptyClick }: { onEmptyClick: () => void }) {
  useMapEvents({
    click: (e) => {
      const target = (e.originalEvent?.target as HTMLElement);
      // Ignore clicks on markers, paths, or polylines
      if (target?.closest('.leaflet-marker-icon, .leaflet-overlay-pane path, .leaflet-overlay-pane polyline')) {
        return;
      }
      onEmptyClick();
    },
  });
  return null;
}

// ─── Component ──────────────────────────────────────────

export function TrackLayer({ track, onDeselect }: TrackLayerProps) {
  const [pinnedDwellIdx, setPinnedDwellIdx] = useState<number | null>(null);
  const points = track.points;

  // NOTE: zoom-to-track lives in AnalyticsMapView's single FitBounds
  // authority (activeBounds → trackBounds). Doing fitBounds here too raced
  // that one on a fresh map mount (table/cards → map) and lost the zoom.

  // 1. Gradient segments
  const segments = useMemo(() => {
    const result: Array<{ positions: [number, number][]; color: string; key: string; avgSpeed: number; ts: string }> = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const avgSpeed = ((prev.speed ?? 0) + (curr.speed ?? 0)) / 2;
      result.push({
        positions: [[prev.lat, prev.lng], [curr.lat, curr.lng]],
        color: interpolateColor(avgSpeed),
        key: `seg-${i}`,
        avgSpeed,
        ts: curr.ts,
      });
    }
    return result;
  }, [points]);

  // 2. Direction arrows — adaptive spacing.
  // Aim for a roughly constant number of arrows across the whole route so a
  // long track is not buried under hundreds of overlapping markers, but never
  // place them closer than MIN_STEP_M so short tracks stay readable too.
  const arrows = useMemo(() => {
    const result: Array<{ lat: number; lng: number; heading: number; key: string }> = [];

    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }

    const TARGET_ARROWS = 22;
    const MIN_STEP_M = 350;
    const step = Math.max(MIN_STEP_M, total / TARGET_ARROWS);

    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      dist += haversine(prev.lat, prev.lng, curr.lat, curr.lng);
      if (dist >= step && curr.heading != null && curr.motionStatus !== 'dwell') {
        result.push({ lat: curr.lat, lng: curr.lng, heading: curr.heading, key: `arrow-${i}` });
        dist = 0;
      }
    }
    return result;
  }, [points]);

  // 3. Dwell markers
  const dwells = useMemo(() => {
    return points
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.motionStatus === 'dwell' && p.dwellSec != null && p.dwellSec > 0);
  }, [points]);

  const handleDwellClick = useCallback((idx: number) => {
    setPinnedDwellIdx(prev => prev === idx ? null : idx);
  }, []);

  const handleMapEmptyClick = useCallback(() => {
    setPinnedDwellIdx(null);
    onDeselect?.();
  }, [onDeselect]);

  return (
    <>
      {/* Click on empty map → unfreeze + deselect */}
      <MapClickHandler onEmptyClick={handleMapEmptyClick} />

      {/* Gradient track segments */}
      {segments.map(seg => (
        <Polyline
          key={seg.key}
          positions={seg.positions}
          pathOptions={{
            color: seg.color,
            weight: 5,
            opacity: 1,
            lineCap: 'round',
            lineJoin: 'round',
            className: 'track-segment',
          }}
        >
          <Tooltip sticky direction="top" offset={[0, -4]}>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{Math.round(seg.avgSpeed)} км/ч</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>{formatTime(seg.ts)}</div>
          </Tooltip>
        </Polyline>
      ))}

      {/* Direction arrows */}
      {arrows.map(a => (
        <Marker
          key={a.key}
          position={[a.lat, a.lng]}
          icon={createArrowIcon(a.heading)}
          interactive={false}
        />
      ))}

      {/* Dwell markers */}
      {dwells.map(({ p, idx }) => (
        <Marker
          key={`dwell-${idx}`}
          position={[p.lat, p.lng]}
          icon={createDwellIcon(p.dwellSec!, idx)}
          eventHandlers={{ click: () => handleDwellClick(idx) }}
        >
          <Tooltip
            direction="top"
            offset={[0, -20]}
            permanent={pinnedDwellIdx === idx}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>Стоянка</div>
            <div style={{ fontSize: 11 }}>
              {formatDuration(p.dwellSec!)} &bull; {formatTime(p.ts)}
            </div>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
