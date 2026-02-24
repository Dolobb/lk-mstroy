import { getPool } from '../config/database';
import { getVehicleInfo } from '../services/vehicleRegistry';

export interface VehicleRecordRow {
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  department_unit: string;
  total_stay_time: number;
  engine_on_time: number;
  idle_time: number;
  fuel_consumed_total: number;
  fuel_rate_fact: number;
  max_work_allowed: number;
  fuel_rate_norm: number;
  fuel_max_calc: number;
  fuel_variance: number;
  load_efficiency_pct: number;
  utilization_ratio: number;
  latitude: number | null;
  longitude: number | null;
  track_simplified: object | null;
}

const NUMERIC_FIELDS: (keyof VehicleRecordRow)[] = [
  'total_stay_time', 'engine_on_time', 'idle_time',
  'fuel_consumed_total', 'fuel_rate_fact', 'max_work_allowed',
  'fuel_rate_norm', 'fuel_max_calc', 'fuel_variance',
  'load_efficiency_pct', 'utilization_ratio',
  'latitude', 'longitude',
];

function coerceNumericFields(row: Record<string, unknown>): VehicleRecordRow {
  for (const field of NUMERIC_FIELDS) {
    if (row[field] != null) {
      row[field] = Number(row[field]);
    }
  }
  return row as unknown as VehicleRecordRow;
}

export async function getVehicleRecords(
  date: string,
  shift?: string,
): Promise<VehicleRecordRow[]> {
  const pool = getPool();

  let query = `SELECT * FROM vehicle_records WHERE report_date = $1`;
  const params: unknown[] = [date];

  if (shift) {
    query += ` AND shift_type = $2`;
    params.push(shift);
  }

  query += ` ORDER BY vehicle_id, shift_type`;

  const result = await pool.query(query, params);
  return result.rows.map(coerceNumericFields);
}

/**
 * Get request numbers grouped by vehicle reg number for a given date (and optional shift).
 * Joins vehicles → route_lists → pl_calcs to extract request numbers.
 */
export async function getRequestNumbersForDate(
  date: string,
  shift?: string,
): Promise<Map<string, number[]>> {
  const pool = getPool();

  // route_lists.date_out matches the report date
  // vehicles.reg_number matches vehicle_records.vehicle_id
  const result = await pool.query(
    `SELECT DISTINCT v.reg_number, pc.extracted_request_number
     FROM vehicles v
     JOIN route_lists rl ON rl.id = v.route_list_id
     JOIN pl_calcs pc ON pc.route_list_id = rl.id
     WHERE rl.date_out = $1
       AND pc.extracted_request_number IS NOT NULL`,
    [date],
  );

  const map = new Map<string, number[]>();
  for (const row of result.rows) {
    const regNum: string = row.reg_number;
    const reqNum: number = Number(row.extracted_request_number);
    if (!map.has(regNum)) map.set(regNum, []);
    const arr = map.get(regNum)!;
    if (!arr.includes(reqNum)) arr.push(reqNum);
  }
  return map;
}

export interface WeeklyAggRow {
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  department_unit: string;
  avg_total_stay_time: number;
  avg_engine_on_time: number;
  avg_idle_time: number;
  avg_fuel: number;
  avg_load_efficiency_pct: number;
  avg_utilization_ratio: number;
  latitude: number | null;
  longitude: number | null;
  record_count: number;
}

const WEEKLY_NUMERIC_FIELDS = [
  'avg_total_stay_time', 'avg_engine_on_time', 'avg_idle_time',
  'avg_fuel', 'avg_load_efficiency_pct', 'avg_utilization_ratio',
  'latitude', 'longitude', 'record_count',
] as const;

function coerceWeeklyRow(row: Record<string, unknown>): WeeklyAggRow {
  for (const f of WEEKLY_NUMERIC_FIELDS) {
    if (row[f] != null) row[f] = Number(row[f]);
  }
  return row as unknown as WeeklyAggRow;
}

export async function getWeeklyAggregated(params: {
  from: string;
  to: string;
  shift?: string;
  branches?: string[];
  types?: string[];
  departments?: string[];
  kpiRanges?: string[];
}): Promise<WeeklyAggRow[]> {
  const pool = getPool();

  const hasDepts = params.departments && params.departments.length > 0;

  const query = `
    WITH agg AS (
      SELECT
        vehicle_id,
        MAX(vehicle_model) AS vehicle_model,
        MAX(company_name) AS company_name,
        (ARRAY_AGG(department_unit ORDER BY total_stay_time DESC))[1] AS department_unit,
        AVG(total_stay_time) AS avg_total_stay_time,
        AVG(engine_on_time) AS avg_engine_on_time,
        GREATEST(AVG(idle_time), 0) AS avg_idle_time,
        AVG(fuel_consumed_total) AS avg_fuel,
        AVG(load_efficiency_pct) AS avg_load_efficiency_pct,
        AVG(utilization_ratio) AS avg_utilization_ratio,
        (ARRAY_AGG(latitude ORDER BY report_date DESC, shift_type DESC) FILTER (WHERE latitude IS NOT NULL))[1] AS latitude,
        (ARRAY_AGG(longitude ORDER BY report_date DESC, shift_type DESC) FILTER (WHERE longitude IS NOT NULL))[1] AS longitude,
        COUNT(*)::int AS record_count
      FROM vehicle_records
      WHERE report_date BETWEEN $1 AND $2
        AND ($3::varchar IS NULL OR shift_type = $3)
        AND ($4::bool = false OR department_unit = ANY($5::varchar[]))
      GROUP BY vehicle_id
    )
    SELECT * FROM agg
    ORDER BY vehicle_id
  `;

  const result = await pool.query(query, [
    params.from,
    params.to,
    params.shift || null,
    hasDepts,
    hasDepts ? params.departments : [],
  ]);

  let rows = result.rows.map(coerceWeeklyRow);

  // Filter by branches and types from vehicle registry (not in DB)
  const hasBranches = params.branches && params.branches.length > 0;
  const hasTypes = params.types && params.types.length > 0;
  if (hasBranches || hasTypes) {
    rows = rows.filter(r => {
      const info = getVehicleInfo(r.vehicle_id);
      if (!info) return false;
      if (hasBranches && !params.branches!.includes(info.branch)) return false;
      if (hasTypes && !params.types!.includes(info.type)) return false;
      return true;
    });
  }

  // Filter by KPI ranges (e.g. ['0-25', '25-50'])
  if (params.kpiRanges && params.kpiRanges.length > 0) {
    const ranges = params.kpiRanges.map(r => {
      const [lo, hi] = r.split('-').map(Number);
      return { lo, hi };
    });
    rows = rows.filter(r => {
      return ranges.some(({ lo, hi }) =>
        r.avg_utilization_ratio >= lo && r.avg_utilization_ratio <= hi
      );
    });
  }

  return rows;
}

export async function getVehicleDetails(
  vehicleId: string,
  from: string,
  to: string,
): Promise<VehicleRecordRow[]> {
  const pool = getPool();

  const result = await pool.query(
    `SELECT * FROM vehicle_records
     WHERE vehicle_id = $1 AND report_date BETWEEN $2 AND $3
     ORDER BY report_date DESC, shift_type`,
    [vehicleId, from, to],
  );

  return result.rows.map(coerceNumericFields);
}

export async function getRequestNumbersForDateRange(
  from: string,
  to: string,
): Promise<Map<string, number[]>> {
  const pool = getPool();

  const result = await pool.query(
    `SELECT DISTINCT v.reg_number, pc.extracted_request_number
     FROM vehicles v
     JOIN route_lists rl ON rl.id = v.route_list_id
     JOIN pl_calcs pc ON pc.route_list_id = rl.id
     WHERE rl.date_out BETWEEN $1 AND $2
       AND pc.extracted_request_number IS NOT NULL`,
    [from, to],
  );

  const map = new Map<string, number[]>();
  for (const row of result.rows) {
    const regNum: string = row.reg_number;
    const reqNum: number = Number(row.extracted_request_number);
    if (!map.has(regNum)) map.set(regNum, []);
    const arr = map.get(regNum)!;
    if (!arr.includes(reqNum)) arr.push(reqNum);
  }
  return map;
}

export async function upsertVehicleRecord(record: VehicleRecordRow): Promise<void> {
  const pool = getPool();

  await pool.query(
    `INSERT INTO vehicle_records (
       report_date, shift_type, vehicle_id, vehicle_model, company_name,
       department_unit, total_stay_time, engine_on_time, idle_time,
       fuel_consumed_total, fuel_rate_fact, max_work_allowed,
       fuel_rate_norm, fuel_max_calc, fuel_variance,
       load_efficiency_pct, utilization_ratio, latitude, longitude, track_simplified
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (report_date, shift_type, vehicle_id)
     DO UPDATE SET
       vehicle_model = EXCLUDED.vehicle_model,
       company_name = EXCLUDED.company_name,
       department_unit = EXCLUDED.department_unit,
       total_stay_time = EXCLUDED.total_stay_time,
       engine_on_time = EXCLUDED.engine_on_time,
       idle_time = EXCLUDED.idle_time,
       fuel_consumed_total = EXCLUDED.fuel_consumed_total,
       fuel_rate_fact = EXCLUDED.fuel_rate_fact,
       max_work_allowed = EXCLUDED.max_work_allowed,
       fuel_rate_norm = EXCLUDED.fuel_rate_norm,
       fuel_max_calc = EXCLUDED.fuel_max_calc,
       fuel_variance = EXCLUDED.fuel_variance,
       load_efficiency_pct = EXCLUDED.load_efficiency_pct,
       utilization_ratio = EXCLUDED.utilization_ratio,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       track_simplified = EXCLUDED.track_simplified`,
    [
      record.report_date,
      record.shift_type,
      record.vehicle_id,
      record.vehicle_model,
      record.company_name,
      record.department_unit,
      record.total_stay_time,
      record.engine_on_time,
      record.idle_time,
      record.fuel_consumed_total,
      record.fuel_rate_fact,
      record.max_work_allowed,
      record.fuel_rate_norm,
      record.fuel_max_calc,
      record.fuel_variance,
      record.load_efficiency_pct,
      record.utilization_ratio,
      record.latitude,
      record.longitude,
      record.track_simplified ? JSON.stringify(record.track_simplified) : null,
    ],
  );
}
