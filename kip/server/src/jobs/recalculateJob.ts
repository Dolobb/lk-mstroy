/**
 * Recalculate KIP metrics from stored raw monitoring data.
 *
 * Reads monitoring_raw for a given date and re-runs:
 *   geozoneAnalysis → matchFuelNorm → calculateKpi → upsertVehicleRecord
 *
 * Does NOT call TIS API — only uses data already saved in monitoring_raw.
 *
 * Условие 1: зажигание вкл., расход = 0 → специальная обработка (см. kpiCalculator).
 * Условие 2: КИП/нагрузка 0–100% (клампинг в calculateKpi).
 * Условие 3: смена без данных → 0% КИП/нагрузка (постобработка после цикла).
 */

import type { Pool } from 'pg';
import { getAllMonitoringRaw } from '../repositories/monitoringRawRepo';
import { upsertVehicleRecord, hadEngineOffInPastWeek } from '../repositories/vehicleRecordRepo';
import { analyzeTrackGeozones } from '../services/geozoneAnalyzer';
import { matchFuelNorm } from '../services/vehicleFilter';
import { calculateKpi, type FuelSensorInfo } from '../services/kpiCalculator';
import { logger } from '../utils/logger';

const TRACK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

interface RawTrackPoint {
  lat: number;
  lon: number;
  time: string; // DD.MM.YYYY HH:mm:ss (TIS format)
  speed?: number;
  direction?: number;
}

interface RawFuel {
  rate: number;
  valueBegin?: number;
  valueEnd?: number;
  charges?: number;
  discharges?: number;
  [key: string]: unknown;
}

function simplifyTrack(
  track: Array<{ lat: number; lon: number; timestamp: string }>,
): Array<{ lat: number; lon: number; timestamp: string }> {
  if (track.length === 0) return [];
  const result = [track[0]];
  let lastTs = new Date(track[0].timestamp.replace(
    /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2})/,
    '$3-$2-$1T$4',
  )).getTime();

  for (let i = 1; i < track.length; i++) {
    const ts = new Date(track[i].timestamp.replace(
      /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2})/,
      '$3-$2-$1T$4',
    )).getTime();
    if (ts - lastTs >= TRACK_INTERVAL_MS) {
      result.push(track[i]);
      lastTs = ts;
    }
  }

  const last = track[track.length - 1];
  if (result[result.length - 1].timestamp !== last.timestamp) {
    result.push(last);
  }
  return result;
}

export interface RecalculateResult {
  date: string;
  processed: number;
  skipped: number;
  condition1Applied: number;
  condition3Applied: number;
  errors: string[];
}

/**
 * Recalculate all vehicle_records for a given date from stored raw monitoring data.
 */
export async function recalculateForDate(
  pool: Pool,
  date: string,
): Promise<RecalculateResult> {
  const result: RecalculateResult = { date, processed: 0, skipped: 0, condition1Applied: 0, condition3Applied: 0, errors: [] };

  logger.info(`[Recalculate] Starting recalculate for date=${date}`);

  const rawRecords = await getAllMonitoringRaw(pool, date);
  logger.info(`[Recalculate] Found ${rawRecords.length} raw records for ${date}`);

  if (rawRecords.length === 0) {
    result.errors.push(`No raw monitoring data for ${date}. Run fetch first.`);
    return result;
  }

  // Для условия 3: отслеживаем какие смены обработаны по каждому ТС
  const processedShifts = new Map<string, Set<string>>(); // vehicle_id → Set<shift_type>
  // Последняя известная позиция по ТС (для условия 3 синтетических записей)
  const lastPositions = new Map<string, { lat: number | null; lon: number | null }>();

  for (const raw of rawRecords) {
    try {
      if (!raw.track_json || !raw.fuel_json || raw.engine_time_sec == null) {
        logger.warn(`[Recalculate] Skipping ${raw.vehicle_id} (${raw.shift_type}): missing raw data`);
        result.skipped++;
        continue;
      }

      // Convert raw TIS track format [{lat, lon, time}] → [{lat, lon, timestamp}]
      const rawTrack = raw.track_json as RawTrackPoint[];
      const fullTrack = rawTrack.map(p => ({
        lat: p.lat,
        lon: p.lon,
        timestamp: p.time,
      }));

      const fuels = raw.fuel_json as RawFuel[];
      const engineOnTime = raw.engine_time_sec / 3600; // seconds → hours
      const fuelConsumedTotal = fuels.reduce((sum, f) => sum + (f.rate ?? 0), 0);

      // Условие 1: датчик расхода = 0, двигатель работает
      let fuelSensor: FuelSensorInfo | undefined;
      if (fuels.length > 0 && fuels[0].rate === 0 && engineOnTime > 0) {
        const actualConsumed = fuels.reduce((sum, f) => {
          return sum + ((f.valueBegin ?? 0) - (f.valueEnd ?? 0) + (f.charges ?? 0) - (f.discharges ?? 0));
        }, 0);
        const ignitionResult = await hadEngineOffInPastWeek(raw.vehicle_id, raw.report_date);
        fuelSensor = {
          rateSensorValue: 0,
          actualConsumed: Math.max(0, actualConsumed),
          // null (нет данных за неделю) → считаем что зажигание выключалось (benefit of doubt)
          ignitionOffInWeek: ignitionResult !== false,
        };
        result.condition1Applied++;
        logger.info(
          `[Recalculate] Condition 1 for ${raw.vehicle_id} (${raw.shift_type}): ` +
          `actualConsumed=${actualConsumed.toFixed(1)}L ignitionOff=${ignitionResult}`,
        );
      }

      // Geozone analysis
      const geozoneResult = analyzeTrackGeozones(fullTrack);
      const totalStayTime = geozoneResult.totalStayTime > 0
        ? geozoneResult.totalStayTime
        : engineOnTime; // fallback: no zones matched or empty track
      const departmentUnit = geozoneResult.departmentUnit;

      const fuelRateNorm = matchFuelNorm(raw.vehicle_id);

      const kpi = calculateKpi({
        total_stay_time:      totalStayTime,
        engine_on_time:       engineOnTime,
        fuel_consumed_total:  fuelConsumedTotal,
        fuel_rate_norm:       fuelRateNorm,
        fuelSensor,
      });

      // Last GPS position
      const lastPoint = fullTrack.length > 0 ? fullTrack[fullTrack.length - 1] : null;

      // Simplified track for map display
      const trackSimplified = simplifyTrack(fullTrack);

      await upsertVehicleRecord({
        report_date:         raw.report_date,
        shift_type:          raw.shift_type,
        vehicle_id:          raw.vehicle_id,
        vehicle_model:       raw.vehicle_model ?? '',
        company_name:        raw.company_name  ?? '',
        department_unit:     departmentUnit,
        total_stay_time:     totalStayTime,
        engine_on_time:      engineOnTime,
        idle_time:           kpi.idle_time,
        fuel_consumed_total: fuelConsumedTotal,
        fuel_rate_fact:      kpi.fuel_rate_fact,
        max_work_allowed:    kpi.max_work_allowed,
        fuel_rate_norm:      fuelRateNorm,
        fuel_max_calc:       kpi.fuel_max_calc,
        fuel_variance:       kpi.fuel_variance,
        load_efficiency_pct: kpi.load_efficiency_pct,
        utilization_ratio:   kpi.utilization_ratio,
        latitude:            lastPoint?.lat ?? null,
        longitude:           lastPoint?.lon ?? null,
        track_simplified:    trackSimplified,
      });

      // Фиксируем обработанную смену и позицию для условия 3
      if (!processedShifts.has(raw.vehicle_id)) processedShifts.set(raw.vehicle_id, new Set());
      processedShifts.get(raw.vehicle_id)!.add(raw.shift_type);
      lastPositions.set(raw.vehicle_id, { lat: lastPoint?.lat ?? null, lon: lastPoint?.lon ?? null });

      result.processed++;
      logger.info(
        `[Recalculate] ${raw.vehicle_id} (${raw.shift_type}): ` +
        `kip=${kpi.utilization_ratio.toFixed(1)}% load=${kpi.load_efficiency_pct.toFixed(1)}% dept=${departmentUnit || 'n/a'}`,
      );
    } catch (err) {
      const msg = `${raw.vehicle_id} (${raw.shift_type}): ${String(err)}`;
      logger.error(`[Recalculate] Error: ${msg}`);
      result.errors.push(msg);
    }
  }

  // ── Условие 3: создать нулевые записи для отсутствующих смен ──────────────
  // Для каждого ТС у которого есть только одна смена в monitoring_raw:
  // создать запись с KIP=0%, нагрузка=0% для второй смены.
  // Это обозначает «ТС не работало в эту смену, так как в соседней смене работало».
  const allShifts = ['morning', 'evening'] as const;

  for (const [vehicleId, shifts] of processedShifts) {
    if (shifts.size >= 2) continue; // обе смены есть — ок

    const existingShift = [...shifts][0] as 'morning' | 'evening';
    const missingShift = allShifts.find(s => s !== existingShift)!;

    const pos = lastPositions.get(vehicleId) ?? { lat: null, lon: null };
    const fuelRateNorm = matchFuelNorm(vehicleId);

    // Ищем raw-запись существующей смены для метаданных
    const existingRaw = rawRecords.find(r => r.vehicle_id === vehicleId && r.shift_type === existingShift);
    if (!existingRaw) continue;

    try {
      await upsertVehicleRecord({
        report_date:         date,
        shift_type:          missingShift,
        vehicle_id:          vehicleId,
        vehicle_model:       existingRaw.vehicle_model ?? '',
        company_name:        existingRaw.company_name  ?? '',
        department_unit:     '',
        total_stay_time:     12,  // стандартная смена 12 часов
        engine_on_time:      0,
        idle_time:           12,
        fuel_consumed_total: 0,
        fuel_rate_fact:      0,
        max_work_allowed:    12 * (22 / 24),
        fuel_rate_norm:      fuelRateNorm,
        fuel_max_calc:       0,
        fuel_variance:       0,
        load_efficiency_pct: 0,
        utilization_ratio:   0,
        latitude:            pos.lat,
        longitude:           pos.lon,
        track_simplified:    null,
      });

      result.condition3Applied++;
      logger.info(
        `[Recalculate] Condition 3: created zero-record for ${vehicleId} (${missingShift}) — other shift had data`,
      );
    } catch (err) {
      const msg = `Condition3 ${vehicleId} (${missingShift}): ${String(err)}`;
      logger.error(`[Recalculate] ${msg}`);
      result.errors.push(msg);
    }
  }

  logger.info(
    `[Recalculate] Done for ${date}: ` +
    `processed=${result.processed} skipped=${result.skipped} ` +
    `cond1=${result.condition1Applied} cond3=${result.condition3Applied} ` +
    `errors=${result.errors.length}`,
  );
  return result;
}
