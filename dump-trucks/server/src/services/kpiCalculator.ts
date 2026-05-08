/**
 * KPI Calculator для самосвалов.
 * Считает:
 *   - kipPct:        engine_time / shift_duration * 100
 *   - movementPct:   moving_time / shift_duration * 100
 *   - onsiteMin:     секунды в dt_boundary / 60
 *   - tripsCount:    кол-во рейсов
 *   - factVolumeM3:  суммарный объём из рейсов (если известен)
 */

import type { Trip, ShiftKpi, WorkType, EngineTimeSource } from '../types/domain';

export function calculateKpi(params: {
  shiftStart: Date;
  shiftEnd: Date;
  engineTimeSec: number;
  engineTimeSource: EngineTimeSource;
  movingTimeSec: number;
  distanceKm: number;
  onsiteSec: number;
  trips: Trip[];
  workType: WorkType;
}): ShiftKpi {
  const { shiftStart, shiftEnd, engineTimeSec, engineTimeSource, movingTimeSec, distanceKm, onsiteSec, trips, workType } = params;

  const shiftDurationSec = Math.max(1, (shiftEnd.getTime() - shiftStart.getTime()) / 1000);

  const kipPct = Math.min(100, Number(((engineTimeSec / shiftDurationSec) * 100).toFixed(2)));

  const movementPct = Math.min(100, Number(((movingTimeSec / shiftDurationSec) * 100).toFixed(2)));

  const onsiteMin = Math.round(onsiteSec / 60);

  const factVolumeM3 = trips.reduce((acc, t) => acc + (t.volumeM3 ?? 0), 0);

  return {
    engineTimeSec,
    engineTimeSource,
    movingTimeSec,
    distanceKm,
    onsiteMin,
    tripsCount:  trips.length,
    factVolumeM3,
    kipPct,
    movementPct,
    workType,
  };
}
