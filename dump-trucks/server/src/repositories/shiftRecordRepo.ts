import { Pool, PoolClient } from 'pg';
import type { ShiftRecordInput } from '../types/domain';

export interface ShiftRecord {
  id: number;
  reportDate: Date;
  shiftType: string;
  vehicleId: number;
  regNumber: string | null;
  nameMO: string | null;
  objectUid: string;
  objectName: string | null;
  workType: string;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  onsiteMin: number;
  tripsCount: number;
  factVolumeM3: number;
  kipPct: number;
  movementPct: number;
  plId: number | null;
  requestNumbers: number[];
  avgLoadingDwellSec: number | null;
  avgUnloadingDwellSec: number | null;
}

/**
 * Upsert смены и возвращает id записи.
 * Выполняется внутри переданного клиента (для транзакции).
 */
export async function upsertShiftRecord(
  client: PoolClient,
  input: ShiftRecordInput,
): Promise<number> {
  const result = await client.query<{ id: number }>(`
    INSERT INTO dump_trucks.shift_records (
      report_date, shift_type, vehicle_id, reg_number, name_mo,
      object_uid, object_name, work_type,
      shift_start, shift_end,
      engine_time_sec, moving_time_sec, distance_km,
      onsite_min, trips_count, fact_volume_m3,
      kip_pct, movement_pct,
      pl_id, request_numbers,
      raw_monitoring, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18,
      $19, $20,
      $21, NOW()
    )
    ON CONFLICT (report_date, shift_type, vehicle_id, object_uid) DO UPDATE SET
      reg_number      = EXCLUDED.reg_number,
      name_mo         = EXCLUDED.name_mo,
      work_type       = EXCLUDED.work_type,
      shift_start     = EXCLUDED.shift_start,
      shift_end       = EXCLUDED.shift_end,
      engine_time_sec = EXCLUDED.engine_time_sec,
      moving_time_sec = EXCLUDED.moving_time_sec,
      distance_km     = EXCLUDED.distance_km,
      onsite_min      = EXCLUDED.onsite_min,
      trips_count     = EXCLUDED.trips_count,
      fact_volume_m3  = EXCLUDED.fact_volume_m3,
      kip_pct         = EXCLUDED.kip_pct,
      movement_pct    = EXCLUDED.movement_pct,
      pl_id           = EXCLUDED.pl_id,
      request_numbers = EXCLUDED.request_numbers,
      raw_monitoring  = EXCLUDED.raw_monitoring,
      updated_at      = NOW()
    RETURNING id
  `, [
    input.reportDate,
    input.shiftType,
    input.vehicleId,
    input.regNumber || null,
    input.nameMO || null,
    input.objectUid,
    input.objectName || null,
    input.workType,
    input.shiftStart,
    input.shiftEnd,
    input.engineTimeSec,
    input.movingTimeSec,
    input.distanceKm,
    input.onsiteMin,
    input.tripsCount,
    input.factVolumeM3,
    input.kipPct,
    input.movementPct,
    input.plId ?? null,
    input.requestNumbers.length > 0 ? input.requestNumbers : null,
    input.rawMonitoring ? JSON.stringify(input.rawMonitoring) : null,
  ]);

  return result.rows[0].id;
}

/**
 * Запрос смен для API (с JOIN на geo.objects для названия объекта).
 */
export async function queryShiftRecords(
  pool: Pool,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    objectUid?: string;
    shiftType?: string;
  },
): Promise<ShiftRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`sr.report_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`sr.report_date <= $${params.length}`);
  }
  if (filters.objectUid) {
    params.push(filters.objectUid);
    conditions.push(`sr.object_uid = $${params.length}`);
  }
  if (filters.shiftType) {
    params.push(filters.shiftType);
    conditions.push(`sr.shift_type = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<{
    id: string;
    report_date: Date;
    shift_type: string;
    vehicle_id: string;
    reg_number: string | null;
    name_mo: string | null;
    object_uid: string;
    object_name: string | null;
    work_type: string;
    shift_start: Date | null;
    shift_end: Date | null;
    engine_time_sec: string;
    moving_time_sec: string;
    distance_km: string;
    onsite_min: string;
    trips_count: string;
    fact_volume_m3: string;
    kip_pct: string;
    movement_pct: string;
    pl_id: string | null;
    request_numbers: number[] | null;
    avg_loading_dwell_sec: string | null;
    avg_unloading_dwell_sec: string | null;
  }>(`
    SELECT
      sr.id, sr.report_date, sr.shift_type,
      sr.vehicle_id, sr.reg_number, sr.name_mo,
      sr.object_uid, sr.object_name, sr.work_type,
      sr.shift_start, sr.shift_end,
      sr.engine_time_sec, sr.moving_time_sec,
      sr.distance_km, sr.onsite_min,
      sr.trips_count, sr.fact_volume_m3,
      sr.kip_pct, sr.movement_pct,
      sr.pl_id, sr.request_numbers,
      dwell.avg_loading_dwell_sec,
      dwell.avg_unloading_dwell_sec
    FROM dump_trucks.shift_records sr
    LEFT JOIN LATERAL (
      SELECT
        AVG(duration_sec) FILTER (WHERE zone_tag = 'dt_loading'  AND duration_sec >= 180) AS avg_loading_dwell_sec,
        AVG(duration_sec) FILTER (WHERE zone_tag = 'dt_unloading' AND duration_sec >= 180) AS avg_unloading_dwell_sec
      FROM dump_trucks.zone_events ze
      WHERE ze.vehicle_id  = sr.vehicle_id
        AND ze.report_date = sr.report_date
        AND ze.shift_type  = sr.shift_type
    ) dwell ON true
    ${where}
    ORDER BY sr.report_date DESC, sr.shift_type, sr.vehicle_id
  `, params);

  return result.rows.map(r => ({
    id:            Number(r.id),
    reportDate:    r.report_date,
    shiftType:     r.shift_type,
    vehicleId:     Number(r.vehicle_id),
    regNumber:     r.reg_number,
    nameMO:        r.name_mo,
    objectUid:     r.object_uid,
    objectName:    r.object_name,
    workType:      r.work_type,
    shiftStart:    r.shift_start,
    shiftEnd:      r.shift_end,
    engineTimeSec: Number(r.engine_time_sec),
    movingTimeSec: Number(r.moving_time_sec),
    distanceKm:    Number(r.distance_km),
    onsiteMin:     Number(r.onsite_min),
    tripsCount:    Number(r.trips_count),
    factVolumeM3:  Number(r.fact_volume_m3),
    kipPct:        Number(r.kip_pct),
    movementPct:   Number(r.movement_pct),
    plId:          r.pl_id ? Number(r.pl_id) : null,
    requestNumbers: r.request_numbers ?? [],
    avgLoadingDwellSec:   r.avg_loading_dwell_sec   ? Number(r.avg_loading_dwell_sec)   : null,
    avgUnloadingDwellSec: r.avg_unloading_dwell_sec ? Number(r.avg_unloading_dwell_sec) : null,
  }));
}
