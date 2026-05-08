import { TisClient } from '../services/tisClient';
import { TokenPool } from '../services/tokenPool';
import { PerVehicleRateLimiter } from '../services/rateLimiter';
import { buildVehicleTasks, interleaveTasks } from '../services/plParser';
import { parseMonitoringStats } from '../services/monitoringParser';
import { parseRequests } from '../services/requestParser';
import { matchFuelNorm } from '../services/vehicleFilter';
import { calculateKpi } from '../services/kpiCalculator';
import { analyzeTrackGeozones } from '../services/geozoneAnalyzer';
import { upsertRequests } from '../repositories/requestRepo';
import { upsertRouteLists } from '../repositories/routeListRepo';
import { upsertVehicleRecord, hadEngineOffInPastWeek } from '../repositories/vehicleRecordRepo';
import { upsertMonitoringRaw } from '../repositories/monitoringRawRepo';
import type { FuelSensorInfo } from '../services/kpiCalculator';
import { getPool } from '../config/database';
import { getEnvConfig } from '../config/env';
import { logger } from '../utils/logger';
import { dayjs, parseDdMmYyyyHhmm, secondsToHours } from '../utils/dateFormat';
import { fillGapsForDate } from './gapFillJob';
import { startPipelineRun, type TriggerType } from '../services/pipelineTracker';
import { getJobController, isCancelledError } from '../services/jobController';

// Сохраняем последний созданный TisClient для чтения stats через /api/admin/tis-stats.
// Каждый вызов runDailyFetch создаёт новый клиент, и нам интересны метрики самого
// свежего/текущего прогона.
let lastDailyClient: TisClient | null = null;
export function getLastDailyTisClient(): TisClient | null {
  return lastDailyClient;
}

export async function runDailyFetch(dateStr?: string, triggerType: TriggerType = 'cron'): Promise<void> {
  const jobController = getJobController('fetch');
  // Reset only after a completed cancellation so concurrent calls share the signal
  if (jobController.isCancelled()) jobController.reset();
  const signal = jobController.signal;
  const config = getEnvConfig();
  const targetDate = dateStr
    ? dayjs(dateStr).toDate()
    : dayjs().subtract(1, 'day').toDate();
  const dateLabel = dayjs(targetDate).format('YYYY-MM-DD');
  const MAX_GAP_DAYS = 10;

  logger.info(`=== Daily fetch started for ${dateLabel} ===`);

  const tracker = await startPipelineRun({
    pipelineName: 'kip-daily-fetch',
    triggerType,
    targetDate: dateLabel,
  });

  try {

  const tokenPool = new TokenPool(config.tisApiTokens);
  const rateLimiter = new PerVehicleRateLimiter(config.rateLimitPerVehicleMs);
  const client = new TisClient({
    baseUrl: config.tisApiUrl,
    tokenPool,
    rateLimiter,
  });
  lastDailyClient = client;

  // 1. Fetch route lists (путевые листы) — 7 days back from target
  const plFrom = dayjs(targetDate).subtract(7, 'day').toDate();
  const plTo = targetDate;
  logger.info(`Fetching route lists ${dayjs(plFrom).format('DD.MM.YYYY')} – ${dayjs(plTo).format('DD.MM.YYYY')}...`);
  jobController.throwIfCancelled();
  const routeLists = await client.getRouteListsByDateOut(plFrom, plTo, signal);
  logger.info(`Fetched ${routeLists.length} route lists`);

  // 2. Save route lists to DB
  await upsertRouteLists(routeLists);
  logger.info('Route lists saved to DB');

  // 3. Build & interleave vehicle tasks (filter → split shifts → interleave)
  const tasks = buildVehicleTasks(routeLists);
  const interleaved = interleaveTasks(tasks);
  logger.info(`${interleaved.length} vehicle tasks after filtering and shift splitting`);

  if (interleaved.length === 0) {
    logger.info('No matching vehicles found, skipping monitoring fetch');
    await tracker.complete({ totalVehicles: 0, successCount: 0, errorCount: 0 });
    return;
  }

  // 4. Collect unique request numbers, fetch and save requests
  const allReqNumbers = new Set<number>();
  for (const task of interleaved) {
    task.requestNumbers.forEach(n => allReqNumbers.add(n));
  }

  if (allReqNumbers.size > 0) {
    const reqFrom = dayjs(targetDate).subtract(2, 'month').toDate();
    const reqTo = targetDate;
    logger.info(`Fetching requests (${allReqNumbers.size} unique numbers) ${dayjs(reqFrom).format('DD.MM.YYYY')} – ${dayjs(reqTo).format('DD.MM.YYYY')}...`);
    try {
      jobController.throwIfCancelled();
      const requests = await client.getRequests(reqFrom, reqTo, signal);
      const parsed = parseRequests(requests);
      await upsertRequests(parsed);
      logger.info(`Saved ${parsed.length} requests`);
    } catch (err) {
      logger.error('Failed to fetch/save requests (continuing with vehicles)', err);
    }
  }

  // 5. Process vehicle tasks with concurrency (different idMO — no rate limit conflict)
  // По умолчанию задействуем все TIS-токены; можно сузить через FETCH_CONCURRENCY env.
  const CONCURRENCY = Math.max(1, Math.min(
    config.fetchConcurrency ?? config.tisApiTokens.length,
    interleaved.length,
  ));
  logger.info(`Worker pool: concurrency=${CONCURRENCY} (tokens=${config.tisApiTokens.length}, tasks=${interleaved.length})`);
  let taskIndex = 0;
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  const processOneTask = async (task: (typeof interleaved)[0]) => {
    if (jobController.isCancelled()) return;
    try {
      const stats = await client.getMonitoringStats(
        task.idMO,
        task.shift.from,
        task.shift.to,
        signal,
      );

      if (!stats) {
        skipCount++;
        logger.debug(`Skipped ${task.regNumber} (${task.shift.shiftType} ${task.shift.date}) — no monitoring data`);
        return;
      }

      const monitoring = parseMonitoringStats(stats);

      // Save raw monitoring data for future recalculation without TIS API
      try {
        const pool = getPool();
        await upsertMonitoringRaw(pool, {
          report_date:     task.shift.date,
          shift_type:      task.shift.shiftType,
          vehicle_id:      task.regNumber,
          id_mo:           task.idMO,
          vehicle_model:   task.nameMO,
          company_name:    task.companyName,
          engine_time_sec: stats.engineTime,
          fuel_json:       stats.fuels,
          track_json:      stats.track,
        });
      } catch (rawErr) {
        logger.warn(`Failed to save raw monitoring for ${task.regNumber} (non-critical)`, rawErr);
      }

      // Geozone analysis: determine time inside work zones and department unit
      const geozoneResult = await analyzeTrackGeozones(monitoring.fullTrack);

      // Geo-fallback: если CAN-bus датчик молчит (engineTime=0), но машина пересекала
      // рабочие зоны — оценить engine_on_time по диапазону GPS-точек смены.
      const MIN_ENGINE_SEC_KIP = 2700; // 45 мин — синхронно с самосвалами
      const sensorEngineSec = stats.engineTime ?? 0;
      let engineOnTime = monitoring.engineOnTime; // часы (от parseMonitoringStats)
      let engineTimeSource: 'sensor' | 'geo' = 'sensor';
      if (
        sensorEngineSec < MIN_ENGINE_SEC_KIP &&
        geozoneResult.totalStayTime > 0 &&
        stats.track.length >= 2
      ) {
        const firstTs = parseDdMmYyyyHhmm(stats.track[0]!.time);
        const lastTs = parseDdMmYyyyHhmm(stats.track[stats.track.length - 1]!.time);
        if (firstTs && lastTs && lastTs.getTime() > firstTs.getTime()) {
          const spanSec = Math.round((lastTs.getTime() - firstTs.getTime()) / 1000);
          const shiftSpanSec = Math.round((task.shift.to.getTime() - task.shift.from.getTime()) / 1000);
          const cappedSec = Math.min(spanSec, shiftSpanSec);
          engineOnTime = secondsToHours(cappedSec);
          engineTimeSource = 'geo';
          logger.info(
            `[KIP geo-fallback] ${task.regNumber} (${task.shift.shiftType} ${task.shift.date}): ` +
            `engine=${engineOnTime.toFixed(2)}h (sensor=${(sensorEngineSec/3600).toFixed(2)}h, span=${(spanSec/3600).toFixed(2)}h)`,
          );
        }
      }

      let totalStayTime = geozoneResult.totalStayTime > 0
        ? geozoneResult.totalStayTime
        : engineOnTime; // fallback if no zones matched or track empty
      const departmentUnit = geozoneResult.departmentUnit;

      // Изменение B: if vehicle started and ended in the same zone but totalStayTime < 12h,
      // cap to 12h (engine off → data transmission stops, track is truncated)
      if (geozoneResult.firstZoneId
          && geozoneResult.firstZoneId === geozoneResult.lastZoneId
          && totalStayTime > 0
          && totalStayTime < 12) {
        logger.debug(`${task.regNumber}: capping totalStayTime ${totalStayTime.toFixed(2)}h → 12h (same zone start/end)`);
        totalStayTime = 12;
      }

      if (geozoneResult.zoneExits.length > 0) {
        logger.debug(
          `${task.regNumber}: ${geozoneResult.zoneExits.length} zone exit(s)`,
          geozoneResult.zoneExits,
        );
      }

      const fuelRateNorm = matchFuelNorm(task.regNumber);

      // Условие 1: датчик расхода = 0, двигатель работает
      let fuelSensor: FuelSensorInfo | undefined;
      if (stats.fuels.length > 0 && stats.fuels[0].rate === 0 && monitoring.engineOnTime > 0) {
        const actualConsumed = stats.fuels.reduce((sum, f) => {
          return sum + (f.valueBegin - f.valueEnd + (f.charges ?? 0) - (f.discharges ?? 0));
        }, 0);
        const ignitionResult = await hadEngineOffInPastWeek(task.regNumber, task.shift.date);
        fuelSensor = {
          rateSensorValue: 0,
          actualConsumed: Math.max(0, actualConsumed),
          ignitionOffInWeek: ignitionResult !== false,
        };
        logger.info(
          `Condition 1 for ${task.regNumber} (${task.shift.shiftType} ${task.shift.date}): ` +
          `actualConsumed=${actualConsumed.toFixed(1)}L ignitionOff=${ignitionResult}`,
        );
      }

      const kpi = calculateKpi({
        total_stay_time: totalStayTime,
        engine_on_time: engineOnTime,
        fuel_consumed_total: monitoring.fuelConsumedTotal,
        fuel_rate_norm: fuelRateNorm,
        fuelSensor,
      });

      await upsertVehicleRecord({
        report_date: task.shift.date,
        shift_type: task.shift.shiftType,
        vehicle_id: task.regNumber,
        vehicle_model: task.nameMO,
        company_name: task.companyName,
        department_unit: departmentUnit,
        total_stay_time: totalStayTime,
        engine_on_time: engineOnTime,
        idle_time: kpi.idle_time,
        fuel_consumed_total: monitoring.fuelConsumedTotal,
        fuel_rate_fact: kpi.fuel_rate_fact,
        max_work_allowed: kpi.max_work_allowed,
        fuel_rate_norm: fuelRateNorm,
        fuel_max_calc: kpi.fuel_max_calc,
        fuel_variance: kpi.fuel_variance,
        load_efficiency_pct: kpi.load_efficiency_pct,
        utilization_ratio: kpi.utilization_ratio,
        latitude: monitoring.lastLat,
        longitude: monitoring.lastLon,
        track_simplified: monitoring.trackSimplified,
        fuel_value_begin: monitoring.fuelValueBegin,
        fuel_value_end: monitoring.fuelValueEnd,
        is_gap_filled: false,
        object_timezone: geozoneResult.objectTimezone,
        engine_time_source: engineTimeSource,
      });

      successCount++;
    } catch (err) {
      if (isCancelledError(err)) throw err;
      errorCount++;
      logger.error(`Error processing ${task.regNumber} (${task.shift.shiftType} ${task.shift.date})`, err);
    }
  };

  // Worker pool: taskIndex++ is synchronous (before any await) — safe in Node.js single-threaded model
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      if (jobController.isCancelled()) break;
      const i = taskIndex++;
      if (i >= interleaved.length) break;
      try {
        await processOneTask(interleaved[i]);
      } catch (err) {
        if (isCancelledError(err)) break;
        throw err;
      }
    }
  });
  await Promise.all(workers);

  if (jobController.isCancelled()) {
    logger.info(`[Daily fetch] Cancelled for ${dateLabel} after ${successCount} success / ${errorCount} errors`);
    await tracker.complete({ totalVehicles: interleaved.length, successCount, errorCount });
    return;
  }

  // Gap-fill: fill missing days for vehicles that stayed on site
  // Process range [targetDate - 10, targetDate] to cover full 10-day gap window
  const pool = getPool();
  for (let d = -MAX_GAP_DAYS; d <= 0; d++) {
    if (jobController.isCancelled()) break;
    const gapDate = dayjs(targetDate).add(d, 'day').format('YYYY-MM-DD');
    try {
      await fillGapsForDate(pool, gapDate);
    } catch (err) {
      logger.error(`Gap fill failed for ${gapDate}`, err);
    }
  }

  await tracker.complete({
    totalVehicles: interleaved.length,
    successCount,
    errorCount,
  });

  logger.info(
    `=== Daily fetch complete for ${dateLabel}: ${successCount} success, ${skipCount} skipped, ${errorCount} errors ===`,
  );

  } catch (err) {
    if (isCancelledError(err)) {
      logger.info(`[Daily fetch] Cancelled for ${dateLabel}`);
      await tracker.fail('cancelled');
      return;
    }
    await tracker.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
