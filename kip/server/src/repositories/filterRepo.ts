import { getPool } from '../config/database';
import { getDistinctTypes, getDistinctBranches, getVehicleInfo } from '../services/vehicleRegistry';
import type { FilterOptions } from '../types/domain';

export async function getFilterOptions(
  from: string,
  to: string,
  branches?: string[],
  types?: string[],
): Promise<FilterOptions> {
  const pool = getPool();

  // Types and branches come from vehicle registry (CSV)
  const allTypes = getDistinctTypes();
  const allBranches = getDistinctBranches();

  // Departments come from DB for the given period, filtered by branch/type via registry
  const result = await pool.query(
    `SELECT DISTINCT vehicle_id, department_unit
     FROM vehicle_records
     WHERE report_date BETWEEN $1 AND $2
       AND department_unit IS NOT NULL
       AND department_unit != ''`,
    [from, to],
  );

  const hasBranches = branches && branches.length > 0;
  const hasTypes = types && types.length > 0;

  const departments = new Set<string>();
  for (const row of result.rows) {
    const info = getVehicleInfo(row.vehicle_id);
    if (!info) continue;
    if (hasBranches && !branches!.includes(info.branch)) continue;
    if (hasTypes && !types!.includes(info.type)) continue;
    departments.add(row.department_unit);
  }

  return {
    branches: allBranches,
    types: allTypes,
    departments: Array.from(departments).sort(),
  };
}
