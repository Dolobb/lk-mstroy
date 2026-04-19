import type { Pool } from 'pg';
import { point } from '@turf/helpers';
import distance from '@turf/distance';
import { getRegisteredVehicles } from '../services/vehicleRegistry';
import { matchFuelNorm } from '../services/vehicleFilter';
import { upsertVehicleRecord, type VehicleRecordRow } from '../repositories/vehicleRecordRepo';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';

const MAX_GAP_DAYS = 10;
export const GPS_THRESHOLD_M = 500;
export const FUEL_THRESHOLD_L = 10;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return distance(point([lon1, lat1]), point([lon2, lat2]), { units: 'meters' });
}

/**
 * Чистая функция: по границам пропуска (lastRecord / nextRecord) решает, стояла ли
 * машина на объекте. Вынесена из fillGapsForDate для тестируемости.
 *
 * onSite = true → создаём синтетическую запись (is_gap_filled=true).
 *
 * Правила:
 *   - Нет ни last, ни next GPS → нельзя определить, skip.
 *   - Обе GPS → стояла, если distance < GPS_THRESHOLD_M.
 *   - Только одна сторона GPS → считаем, что стояла (недостаточно данных для опровержения).
 *   - Если есть данные по топливу (last.end и next.begin) → требуется |Δ| < FUEL_THRESHOLD_L.
 */
export function evaluateOnSite(
  last: { latitude: number | null; longitude: number | null; fuel_value_end: number | null } | null,
  next: { latitude: number | null; longitude: number | null; fuel_value_begin: number | null } | null,
): { onSite: boolean; gpsOk: boolean; hasFuelData: boolean; fuelOk: boolean } {
  if (!last && !next) return { onSite: false, gpsOk: false, hasFuelData: false, fuelOk: false };

  const hasLastGps = last?.latitude != null && last?.longitude != null;
  const hasNextGps = next?.latitude != null && next?.longitude != null;

  let gpsOk: boolean;
  if (hasLastGps && hasNextGps) {
    const distM = haversineMeters(
      Number(last!.latitude), Number(last!.longitude),
      Number(next!.latitude), Number(next!.longitude),
    );
    gpsOk = distM < GPS_THRESHOLD_M;
  } else if (hasLastGps || hasNextGps) {
    gpsOk = true;
  } else {
    return { onSite: false, gpsOk: false, hasFuelData: false, fuelOk: false };
  }

  let hasFuelData = false;
  let fuelOk = false;
  if (last?.fuel_value_end != null && next?.fuel_value_begin != null) {
    hasFuelData = true;
    const fuelDiff = Math.abs(Number(last.fuel_value_end) - Number(next.fuel_value_begin));
    fuelOk = fuelDiff < FUEL_THRESHOLD_L;
  }

  const onSite = hasFuelData ? (gpsOk && fuelOk) : gpsOk;
  return { onSite, gpsOk, hasFuelData, fuelOk };
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

    if (vehicleId.includes('7296')) {
      logger.info('[GapFill-DEBUG] Processing vehicleId=' + vehicleId + ' date=' + date + ' missingShifts=' + JSON.stringify(missingShifts));
    }

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
    if (vehicleId.includes('7296')) {
      logger.info('[GapFill-DEBUG] lastRecord=' + JSON.stringify(lastRecord));
    }
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
    if (vehicleId.includes('7296')) {
      logger.info('[GapFill-DEBUG] nextRecord=' + JSON.stringify(nextRecord));
      logger.info('[GapFill-DEBUG] hasLastGps=' + (lastRecord.latitude != null && lastRecord.longitude != null) + ' hasNextGps=' + (nextRecord?.latitude != null && nextRecord?.longitude != null));
      logger.info('[GapFill-DEBUG] earlyExit=' + (!nextRecord && !lastRecord.latitude && !lastRecord.longitude));
    }
    const decision = evaluateOnSite(lastRecord, nextRecord);
    if (vehicleId.includes('7296')) {
      logger.info('[GapFill-DEBUG] ' + JSON.stringify(decision));
    }
    if (!decision.onSite) { result.skipped++; continue; }

    const { gpsOk, hasFuelData, fuelOk } = decision;
    const hasLastGps = lastRecord.latitude != null && lastRecord.longitude != null;
    const hasNextGps = nextRecord?.latitude != null && nextRecord?.longitude != null;

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
          latitude: synthLat,
          longitude: synthLon,
          track_simplified: null,
          fuel_value_begin: synthFuelBegin,
          fuel_value_end: synthFuelEnd,
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
