import type { Pool } from 'pg';
import { point } from '@turf/helpers';
import distance from '@turf/distance';
import { getRegisteredVehicles } from '../services/vehicleRegistry';
import { matchFuelNorm } from '../services/vehicleFilter';
import { upsertVehicleRecord, type VehicleRecordRow } from '../repositories/vehicleRecordRepo';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';

const MAX_GAP_DAYS = 10;
const GPS_THRESHOLD_M = 500;
const FUEL_THRESHOLD_L = 10;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return distance(point([lon1, lat1]), point([lon2, lat2]), { units: 'meters' });
}

interface BoundaryRecord {
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  department_unit: string;
  latitude: number | null;
  longitude: number | null;
  fuel_value_end: number | null;
  fuel_value_begin: number | null;
}

export interface GapFillResult {
  date: string;
  filled: number;
  skipped: number;
  errors: string[];
}

export async function fillGapsForDate(
  pool: Pool,
  date: string,
): Promise<GapFillResult> {
  const result: GapFillResult = { date, filled: 0, skipped: 0, errors: [] };
  const allShifts: ('morning' | 'evening')[] = ['morning', 'evening'];

  logger.info(`[GapFill] Starting gap fill for date=${date}`);

  const existingRes = await pool.query(
    `SELECT vehicle_id, array_agg(shift_type ORDER BY shift_type) AS shift_types
     FROM vehicle_records
     WHERE report_date = $1
     GROUP BY vehicle_id`,
    [date],
  );
  interface ExistingRow { vehicle_id: string; shift_types: string[] }
  const existingMap = new Map<string, Set<string>>();
  for (const row of existingRes.rows as ExistingRow[]) {
    existingMap.set(row.vehicle_id.toUpperCase(), new Set(row.shift_types));
  }

  const registry = getRegisteredVehicles();

  for (const vehicle of registry) {
    const vehicleId = vehicle.regNumber.toUpperCase();
    const existingShifts = existingMap.get(vehicleId);
    const missingShifts = allShifts.filter(s => !existingShifts?.has(s));

    if (missingShifts.length === 0) continue;

    const lastRes = await pool.query<BoundaryRecord>(
      `SELECT report_date::text AS report_date, shift_type, vehicle_id,
              vehicle_model, company_name, department_unit,
              latitude, longitude, fuel_value_end, fuel_value_begin
       FROM vehicle_records
       WHERE vehicle_id = $1 AND report_date < $2
         AND report_date >= $2::date - interval '${MAX_GAP_DAYS} days'
       ORDER BY report_date DESC, shift_type DESC
       LIMIT 1`,
      [vehicleId, date],
    );
    const lastRecord = lastRes.rows[0] ?? null;
    if (!lastRecord) { result.skipped++; continue; }

    const nextRes = await pool.query<BoundaryRecord>(
      `SELECT report_date::text AS report_date, shift_type, vehicle_id,
              vehicle_model, company_name, department_unit,
              latitude, longitude, fuel_value_end, fuel_value_begin
       FROM vehicle_records
       WHERE vehicle_id = $1 AND report_date > $2
         AND report_date <= $2::date + interval '${MAX_GAP_DAYS} days'
       ORDER BY report_date ASC, shift_type ASC
       LIMIT 1`,
      [vehicleId, date],
    );
    const nextRecord = nextRes.rows[0] ?? null;
    if (!nextRecord && !lastRecord.latitude && !lastRecord.longitude) {
      // No next record and no GPS — can't determine if on site
      result.skipped++; continue;
    }

    let gpsOk = false;
    let fuelOk = false;
    let hasFuelData = false;
    const hasLastGps = lastRecord.latitude != null && lastRecord.longitude != null;
    const hasNextGps = nextRecord?.latitude != null && nextRecord?.longitude != null;

    if (hasLastGps && hasNextGps) {
      const distM = haversineMeters(
        Number(lastRecord.latitude), Number(lastRecord.longitude),
        Number(nextRecord!.latitude), Number(nextRecord!.longitude),
      );
      gpsOk = distM < GPS_THRESHOLD_M;
    } else if (hasLastGps || hasNextGps) {
      gpsOk = true;
    } else {
      result.skipped++; continue;
    }

    if (lastRecord.fuel_value_end != null && nextRecord.fuel_value_begin != null) {
      hasFuelData = true;
      const fuelDiff = Math.abs(Number(lastRecord.fuel_value_end) - Number(nextRecord.fuel_value_begin));
      fuelOk = fuelDiff < FUEL_THRESHOLD_L;
    }

    const onSite = hasFuelData ? (gpsOk && fuelOk) : gpsOk;
    if (!onSite) { result.skipped++; continue; }

    const fuelRateNorm = matchFuelNorm(vehicle.regNumber);

    const synthLat = hasLastGps ? Number(lastRecord.latitude) : (hasNextGps ? Number(nextRecord!.latitude) : null);
    const synthLon = hasLastGps ? Number(lastRecord.longitude) : (hasNextGps ? Number(nextRecord!.longitude) : null);
    const synthFuelBegin = lastRecord.fuel_value_end != null ? Number(lastRecord.fuel_value_end) : (nextRecord?.fuel_value_begin != null ? Number(nextRecord!.fuel_value_begin) : null);
    const synthFuelEnd = nextRecord?.fuel_value_begin != null ? Number(nextRecord!.fuel_value_begin) : (lastRecord.fuel_value_end != null ? Number(lastRecord.fuel_value_end) : null);

    for (const shiftType of missingShifts) {
      try {
        await upsertVehicleRecord({
          report_date: date,
          shift_type: shiftType,
          vehicle_id: vehicle.regNumber,
          vehicle_model: lastRecord.vehicle_model,
          company_name: lastRecord.company_name,
          department_unit: lastRecord.department_unit,
          total_stay_time: 12,
          engine_on_time: 0,
          idle_time: 12,
          fuel_consumed_total: 0,
          fuel_rate_fact: 0,
          max_work_allowed: 12 * (22 / 24),
          fuel_rate_norm: fuelRateNorm,
          fuel_max_calc: 0,
          fuel_variance: 0,
          load_efficiency_pct: 0,
          utilization_ratio: 0,
          latitude: Number(lastRecord.latitude),
          longitude: Number(lastRecord.longitude),
          track_simplified: null,
          fuel_value_begin: lastRecord.fuel_value_end != null ? Number(lastRecord.fuel_value_end) : null,
          fuel_value_end: nextRecord.fuel_value_begin != null ? Number(nextRecord.fuel_value_begin) : (lastRecord.fuel_value_end != null ? Number(lastRecord.fuel_value_end) : null),
          is_gap_filled: true,
        });
        result.filled++;
        logger.info(`[GapFill] Created synthetic: ${vehicle.regNumber} ${shiftType} ${date} (gps=${gpsOk}, fuel=${hasFuelData ? fuelOk : 'n/a'})`);
      } catch (err) {
        const msg = `${vehicle.regNumber} (${shiftType}): ${String(err)}`;
        logger.error(`[GapFill] Error: ${msg}`);
        result.errors.push(msg);
      }
    }
  }

  logger.info(`[GapFill] Done for ${date}: filled=${result.filled} skipped=${result.skipped} errors=${result.errors.length}`);
  return result;
}
