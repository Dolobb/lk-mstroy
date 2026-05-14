import { getKipPool } from '../db';
import { logger } from '../utils/logger';

export interface VehiclePosition {
  vehicle_id: string;
  latitude: number | null;
  longitude: number | null;
  last_seen: Date;
  kip_utilization?: number;
  kip_engine_on_time?: number;
}

export interface KipAggregate {
  vehicle_id: string;
  department_unit: string;
  avg_total_stay_time: number;
  avg_engine_on_time: number;
  avg_idle_time: number;
  avg_fuel: number;
  avg_load_efficiency_pct: number;
  avg_utilization_ratio: number;
}

export async function getLatestPositions(): Promise<VehiclePosition[]> {
  const pool = getKipPool();
  try {
    const result = await pool.query<{
      vehicle_id: string;
      latitude: string | null;
      longitude: string | null;
      last_seen: string;
      avg_utilization_ratio: string | null;
      avg_engine_on_time: string | null;
    }>(`
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id,
        latitude,
        longitude,
        GREATEST(report_date, COALESCE(last_activity_time::date, report_date)) AS last_seen,
        avg_utilization_ratio,
        avg_engine_on_time
      FROM vehicle_records
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND report_date >= CURRENT_DATE - INTERVAL '14 days'
      ORDER BY vehicle_id, report_date DESC
    `);

    return result.rows.map(r => ({
      vehicle_id: r.vehicle_id,
      latitude: r.latitude ? Number(r.latitude) : null,
      longitude: r.longitude ? Number(r.longitude) : null,
      last_seen: new Date(r.last_seen),
      kip_utilization: r.avg_utilization_ratio ? Number(r.avg_utilization_ratio) : undefined,
      kip_engine_on_time: r.avg_engine_on_time ? Number(r.avg_engine_on_time) : undefined,
    }));
  } catch (err) {
    logger.error('Failed to fetch KIP latest positions', err);
    return [];
  }
}

export async function getAggregatesForPeriod(from: string, to: string): Promise<KipAggregate[]> {
  const pool = getKipPool();
  try {
    const result = await pool.query<KipAggregate & { avg_total_stay_time: string; avg_engine_on_time: string; avg_idle_time: string; avg_fuel: string; avg_load_efficiency_pct: string; avg_utilization_ratio: string }>(`
      SELECT
        vehicle_id,
        MAX(department_unit) AS department_unit,
        AVG(total_stay_time)::numeric(10,2) AS avg_total_stay_time,
        AVG(engine_on_time)::numeric(10,2) AS avg_engine_on_time,
        AVG(idle_time)::numeric(10,2) AS avg_idle_time,
        AVG(fuel_consumed_total)::numeric(10,2) AS avg_fuel,
        AVG(load_efficiency_pct)::numeric(10,2) AS avg_load_efficiency_pct,
        AVG(utilization_ratio)::numeric(10,2) AS avg_utilization_ratio
      FROM vehicle_records
      WHERE report_date BETWEEN $1 AND $2
        AND COALESCE(is_gap_filled, false) = false
      GROUP BY vehicle_id
    `, [from, to]);

    return result.rows.map(r => ({
      vehicle_id: r.vehicle_id,
      department_unit: r.department_unit,
      avg_total_stay_time: Number(r.avg_total_stay_time),
      avg_engine_on_time: Number(r.avg_engine_on_time),
      avg_idle_time: Number(r.avg_idle_time),
      avg_fuel: Number(r.avg_fuel),
      avg_load_efficiency_pct: Number(r.avg_load_efficiency_pct),
      avg_utilization_ratio: Number(r.avg_utilization_ratio),
    }));
  } catch (err) {
    logger.error('Failed to fetch KIP aggregates', err);
    return [];
  }
}

export async function getVehicleIds(idMO: number): Promise<string | null> {
  const pool = getKipPool();
  try {
    const result = await pool.query<{ vehicle_id: string }>(`
      SELECT DISTINCT v.vehicle_id
      FROM vehicles v
      JOIN vehicle_records vr ON vr.vehicle_id = v.vehicle_id
      WHERE vr.idmo = $1
      LIMIT 1
    `, [idMO]);

    return result.rows[0]?.vehicle_id ?? null;
  } catch (err) {
    logger.error(`Failed to resolve idMO=${idMO} to vehicle_id`, err);
    return null;
  }
}

export async function getVehicleIdMOMap(): Promise<Map<number, string>> {
  const pool = getKipPool();
  const map = new Map<number, string>();
  try {
    const result = await pool.query<{ idmo: number; vehicle_id: string }>(`
      SELECT DISTINCT v.idmo, v.vehicle_id
      FROM vehicles v
      WHERE v.idmo IS NOT NULL
    `);
    for (const row of result.rows) {
      map.set(Number(row.idmo), row.vehicle_id);
    }
  } catch (err) {
    logger.error('Failed to fetch idMO→vehicle_id map', err);
  }
  return map;
}
