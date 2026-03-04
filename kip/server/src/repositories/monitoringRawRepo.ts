import type { Pool } from 'pg';

export interface MonitoringRawRow {
  id: number;
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  id_mo: number;
  vehicle_model: string | null;
  company_name: string | null;
  engine_time_sec: number | null;
  fuel_json: unknown[] | null;  // TisFuel[]
  track_json: unknown[] | null; // TisTrackPoint[]
  fetched_at: string;
}

export interface UpsertMonitoringRawParams {
  report_date: string;   // YYYY-MM-DD
  shift_type: string;
  vehicle_id: string;
  id_mo: number;
  vehicle_model: string | null;
  company_name: string | null;
  engine_time_sec: number;
  fuel_json: unknown[];
  track_json: unknown[];
}

/**
 * Insert or update a raw monitoring record.
 * Uses UNIQUE(report_date, shift_type, vehicle_id) for conflict resolution.
 */
export async function upsertMonitoringRaw(
  pool: Pool,
  data: UpsertMonitoringRawParams,
): Promise<void> {
  await pool.query(
    `INSERT INTO monitoring_raw (
       report_date, shift_type, vehicle_id, id_mo,
       vehicle_model, company_name,
       engine_time_sec, fuel_json, track_json, fetched_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (report_date, shift_type, vehicle_id)
     DO UPDATE SET
       id_mo           = EXCLUDED.id_mo,
       vehicle_model   = EXCLUDED.vehicle_model,
       company_name    = EXCLUDED.company_name,
       engine_time_sec = EXCLUDED.engine_time_sec,
       fuel_json       = EXCLUDED.fuel_json,
       track_json      = EXCLUDED.track_json,
       fetched_at      = NOW()`,
    [
      data.report_date,
      data.shift_type,
      data.vehicle_id,
      data.id_mo,
      data.vehicle_model,
      data.company_name,
      data.engine_time_sec,
      JSON.stringify(data.fuel_json),
      JSON.stringify(data.track_json),
    ],
  );
}

/**
 * Get a single raw monitoring record by primary key fields.
 */
export async function getMonitoringRaw(
  pool: Pool,
  date: string,
  shiftType: string,
  vehicleId: string,
): Promise<MonitoringRawRow | null> {
  const res = await pool.query(
    `SELECT * FROM monitoring_raw
     WHERE report_date = $1 AND shift_type = $2 AND vehicle_id = $3`,
    [date, shiftType, vehicleId],
  );
  return res.rows[0] ?? null;
}

/**
 * Get all raw monitoring records for a given date.
 */
export async function getAllMonitoringRaw(
  pool: Pool,
  date: string,
): Promise<MonitoringRawRow[]> {
  const res = await pool.query(
    `SELECT * FROM monitoring_raw WHERE report_date = $1 ORDER BY vehicle_id, shift_type`,
    [date],
  );
  return res.rows;
}

/**
 * List distinct dates that have raw monitoring data in the given range.
 */
export async function listDatesWithRaw(
  pool: Pool,
  from: string,
  to: string,
): Promise<string[]> {
  const res = await pool.query(
    `SELECT DISTINCT report_date::text FROM monitoring_raw
     WHERE report_date BETWEEN $1 AND $2
     ORDER BY report_date`,
    [from, to],
  );
  return res.rows.map((r: { report_date: string }) => r.report_date);
}
