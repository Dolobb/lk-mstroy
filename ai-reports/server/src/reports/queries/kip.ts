import { getPg16 } from '../../db/pg16';

export interface KipRow {
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  vehicle_model: string;
  department_unit: string;
  utilization_ratio: number;
  load_efficiency_pct: number;
  engine_on_time: number;
  total_stay_time: number;
  idle_time: number;
  fuel_consumed_total: number;
  fuel_rate_fact: number;
  fuel_rate_norm: number;
  fuel_variance: number;
}

interface KipFilters {
  departments?: string[];
  vehicles?: string[];
  shiftType?: string;
}

export async function queryKipData(
  dateFrom: string,
  dateTo: string,
  filters: KipFilters = {},
): Promise<KipRow[]> {
  const pool = getPg16();
  const params: any[] = [dateFrom, dateTo];
  let idx = 3;

  let where = `WHERE report_date BETWEEN $1 AND $2
    AND (utilization_ratio > 0 OR total_stay_time > 0 OR engine_on_time > 0)`;

  if (filters.departments?.length) {
    where += ` AND department_unit = ANY($${idx}::varchar[])`;
    params.push(filters.departments);
    idx++;
  }
  if (filters.vehicles?.length) {
    where += ` AND vehicle_id = ANY($${idx}::varchar[])`;
    params.push(filters.vehicles);
    idx++;
  }
  if (filters.shiftType && filters.shiftType !== 'all') {
    where += ` AND shift_type = $${idx}`;
    params.push(filters.shiftType);
    idx++;
  }

  const result = await pool.query(`
    SELECT
      report_date::text,
      shift_type,
      vehicle_id,
      vehicle_model,
      department_unit,
      utilization_ratio,
      load_efficiency_pct,
      engine_on_time,
      total_stay_time,
      idle_time,
      fuel_consumed_total,
      fuel_rate_fact,
      fuel_rate_norm,
      fuel_variance
    FROM vehicle_records
    ${where}
    ORDER BY vehicle_model, department_unit, vehicle_id, report_date, shift_type
  `, params);

  // NUMERIC → Number() (PG returns strings for NUMERIC)
  return result.rows.map(r => ({
    report_date: r.report_date,
    shift_type: r.shift_type,
    vehicle_id: r.vehicle_id,
    vehicle_model: r.vehicle_model || '',
    department_unit: r.department_unit || '',
    utilization_ratio: Number(r.utilization_ratio) || 0,
    load_efficiency_pct: Number(r.load_efficiency_pct) || 0,
    engine_on_time: Number(r.engine_on_time) || 0,
    total_stay_time: Number(r.total_stay_time) || 0,
    idle_time: Number(r.idle_time) || 0,
    fuel_consumed_total: Number(r.fuel_consumed_total) || 0,
    fuel_rate_fact: Number(r.fuel_rate_fact) || 0,
    fuel_rate_norm: Number(r.fuel_rate_norm) || 0,
    fuel_variance: Number(r.fuel_variance) || 0,
  }));
}

export async function queryKipFilters(dateFrom: string, dateTo: string) {
  const pool = getPg16();

  const [depts, vehicles] = await Promise.all([
    pool.query(
      `SELECT DISTINCT department_unit FROM vehicle_records
       WHERE report_date BETWEEN $1 AND $2 AND department_unit IS NOT NULL
       ORDER BY department_unit`,
      [dateFrom, dateTo],
    ),
    pool.query(
      `SELECT DISTINCT vehicle_id, vehicle_model FROM vehicle_records
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY vehicle_id`,
      [dateFrom, dateTo],
    ),
  ]);

  return {
    departments: depts.rows.map(r => r.department_unit),
    vehicles: vehicles.rows.map(r => ({
      id: r.vehicle_id,
      label: `${r.vehicle_id} (${r.vehicle_model || '?'})`,
    })),
  };
}
