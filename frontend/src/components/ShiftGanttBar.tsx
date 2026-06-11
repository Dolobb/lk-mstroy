import React, { useState, useEffect } from 'react';
import { fetchShiftSegments, fetchShiftDetail } from '@/features/samosvaly/api';
import type { ShiftSegment, ZoneEvent } from '@/features/samosvaly/types';

/** Minimal segment shape accepted from KIP (no inBoundary) */
export interface GanttSegment {
  segmentIndex: number;
  segmentStart: string;
  segmentEnd: string;
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  trackPointsCount: number;
}

interface ShiftGanttBarProps {
  /** DT mode: fetch segments by shift_record_id */
  shiftRecordId?: number;
  timezone?: string;
  reloadKey?: number;
  onFetchMissing?: () => void | Promise<void>;
  fetchingMissing?: boolean;
  /** Direct mode: render pre-loaded segments (e.g. from KIP) */
  segments?: GanttSegment[];
}

const SEGMENT_DURATION = 1800; // 30 min in seconds
const Y_TICKS = [100, 75, 50, 25, 0];
const LABEL_INDICES = [0, 4, 8, 12, 16, 20];

function fmtTime(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return '—';
  }
}

/** Compute "outside boundary" intervals from dt_boundary zone events */
function computeOutsideIntervals(
  zoneEvents: ZoneEvent[],
  shiftStartMs: number,
  shiftEndMs: number,
): { left: number; width: number }[] {
  const shiftLen = shiftEndMs - shiftStartMs;
  if (shiftLen <= 0) return [];

  const boundaries = zoneEvents
    .filter(e => e.zone_tag === 'dt_boundary')
    .map(e => ({
      enter: new Date(e.entered_at).getTime(),
      exit: e.exited_at ? new Date(e.exited_at).getTime() : shiftEndMs,
    }))
    .sort((a, b) => a.enter - b.enter);

  if (boundaries.length === 0) return [{ left: 0, width: 100 }];

  const intervals: { left: number; width: number }[] = [];

  if (boundaries[0].enter > shiftStartMs) {
    const w = ((boundaries[0].enter - shiftStartMs) / shiftLen) * 100;
    if (w > 0.5) intervals.push({ left: 0, width: w });
  }

  for (let i = 0; i < boundaries.length - 1; i++) {
    const gapStart = boundaries[i].exit;
    const gapEnd = boundaries[i + 1].enter;
    if (gapEnd > gapStart) {
      const l = ((gapStart - shiftStartMs) / shiftLen) * 100;
      const w = ((gapEnd - gapStart) / shiftLen) * 100;
      if (w > 0.5) intervals.push({ left: l, width: w });
    }
  }

  const lastExit = boundaries[boundaries.length - 1].exit;
  if (lastExit < shiftEndMs) {
    const l = ((lastExit - shiftStartMs) / shiftLen) * 100;
    const w = ((shiftEndMs - lastExit) / shiftLen) * 100;
    if (w > 0.5) intervals.push({ left: l, width: w });
  }

  return intervals;
}

export function ShiftGanttBar({
  shiftRecordId,
  timezone = 'Asia/Yekaterinburg',
  reloadKey = 0,
  onFetchMissing,
  fetchingMissing = false,
  segments: directSegments,
}: ShiftGanttBarProps) {
  const [fetchedSegments, setFetchedSegments] = useState<ShiftSegment[] | null>(null);
  const [zoneEvents, setZoneEvents] = useState<ZoneEvent[] | null>(null);
  const [error, setError] = useState(false);

  // Direct mode: skip fetching
  const isDirectMode = !!directSegments;

  useEffect(() => {
    if (isDirectMode || shiftRecordId == null) return;

    let cancelled = false;
    setFetchedSegments(null);
    setZoneEvents(null);
    setError(false);

    Promise.all([
      fetchShiftSegments(shiftRecordId, { force: reloadKey > 0 }),
      fetchShiftDetail(shiftRecordId),
    ])
      .then(([segs, detail]) => {
        if (cancelled) return;
        setFetchedSegments(segs);
        setZoneEvents(detail.zoneEvents ?? []);
      })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [shiftRecordId, isDirectMode, reloadKey]);

  const segments: GanttSegment[] | null = isDirectMode ? (directSegments ?? null) : fetchedSegments;

  if (error) return <div className="sv-shift-gantt-empty">Ошибка загрузки сегментов</div>;
  if (segments === null) return <div className="sv-shift-gantt-empty">Загрузка сегментов...</div>;
  if (segments.length === 0) return (
    <div className="sv-shift-gantt-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <span>Сегменты не загружены</span>
      {onFetchMissing && (
        <button
          onClick={onFetchMissing}
          disabled={fetchingMissing}
          style={{
            fontSize: 11,
            cursor: fetchingMissing ? 'default' : 'pointer',
            border: '1px solid currentColor',
            borderRadius: 4,
            background: 'rgba(139,92,246,0.1)',
            color: 'inherit',
            padding: '3px 10px',
            opacity: fetchingMissing ? 0.6 : 1,
          }}
        >
          {fetchingMissing ? 'Выгрузка...' : 'Выгрузить'}
        </button>
      )}
    </div>
  );

  const shiftStartMs = new Date(segments[0].segmentStart).getTime();
  const shiftEndMs = new Date(segments[segments.length - 1].segmentEnd).getTime();
  const totalSegs = segments.length;
  const isIncomplete = totalSegs < 24;

  const outsideIntervals = (!isDirectMode && zoneEvents)
    ? computeOutsideIntervals(zoneEvents, shiftStartMs, shiftEndMs)
    : [];

  return (
    <div className="sv-shift-gantt">
      <div className="sv-shift-gantt-body">
        {/* Y-axis labels */}
        <div className="sv-shift-gantt-yaxis">
          {Y_TICKS.map(pct => (
            <span key={pct} style={{ top: `${100 - pct}%` }}>{pct}%</span>
          ))}
        </div>

        {/* Main chart column */}
        <div className="sv-shift-gantt-main">
          {/* Chart area with grid + bars */}
          <div className="sv-shift-gantt-chart">
            {/* Horizontal grid lines */}
            {Y_TICKS.map(pct => (
              <div
                key={pct}
                className="sv-shift-gantt-gridline"
                style={{ top: `${100 - pct}%` }}
              />
            ))}

            {/* Vertical bars */}
            {segments.map(seg => {
              const kipPct = Math.min(100, (seg.engineTimeSec / SEGMENT_DURATION) * 100);
              const movPct = Math.min(100, (seg.movingTimeSec / SEGMENT_DURATION) * 100);
              const start = fmtTime(seg.segmentStart, timezone);
              const end = fmtTime(seg.segmentEnd, timezone);
              const tooltip = `${start}–${end} | КИП: ${Math.round(kipPct)}% | Движ: ${Math.round(movPct)}%`;

              return (
                <div key={seg.segmentIndex} className="sv-shift-gantt-bar" title={tooltip}>
                  {kipPct > 0 && (
                    <div className="sv-shift-gantt-kip" style={{ height: `${kipPct}%` }} />
                  )}
                  {movPct > 0 && (
                    <div className="sv-shift-gantt-mov" style={{ height: `${movPct}%` }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* X-axis: tick marks + time labels */}
          <div className="sv-shift-gantt-xaxis">
            {LABEL_INDICES.map(i => {
              const seg = segments[i];
              if (!seg) return null;
              return (
                <div key={i} className="sv-shift-gantt-tick" style={{ left: `${(i / totalSegs) * 100}%` }}>
                  <div className="sv-shift-gantt-tick-line" />
                  <span>{fmtTime(seg.segmentStart, timezone)}</span>
                </div>
              );
            })}
            {/* End label */}
            <div className="sv-shift-gantt-tick" style={{ left: '100%' }}>
              <div className="sv-shift-gantt-tick-line" />
              <span>{fmtTime(segments[totalSegs - 1].segmentEnd, timezone)}</span>
            </div>
          </div>

          {/* Boundary red track */}
          {outsideIntervals.length > 0 && (
            <div className="sv-shift-gantt-boundary">
              {outsideIntervals.map((iv, i) => (
                <div
                  key={i}
                  className="sv-shift-gantt-outside"
                  style={{ left: `${iv.left}%`, width: `${iv.width}%` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="sv-shift-gantt-legend">
        <span><span style={{ color: '#8B5CF6' }}>&#9632;</span> КИП</span>
        <span><span style={{ color: '#60A5FA' }}>&#9632;</span> в движении</span>
        {outsideIntervals.length > 0 && (
          <span><span style={{ color: '#ef4444' }}>&#9632;</span> вне объекта</span>
        )}
        {isIncomplete && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{totalSegs}/24 сегм.</span>
            {onFetchMissing && (
              <button
                onClick={onFetchMissing}
                disabled={fetchingMissing}
                style={{
                  fontSize: 10,
                  cursor: fetchingMissing ? 'default' : 'pointer',
                  border: '1px solid currentColor',
                  borderRadius: 4,
                  background: 'rgba(139,92,246,0.1)',
                  color: 'inherit',
                  padding: '1px 7px',
                  opacity: fetchingMissing ? 0.6 : 1,
                }}
              >
                {fetchingMissing ? 'Выгрузка...' : 'Выгрузить'}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
