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
import { upsertVehicleRecord } from '../repositories/vehicleRecordRepo';
import { getEnvConfig } from '../config/env';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';

export async function runDailyFetch(dateStr?: string): Promise<void> {
  const config = getEnvConfig();
  const targetDate = dateStr
    ? dayjs(dateStr).toDate()
    : dayjs().subtract(1, 'day').toDate();
  const dateLabel = dayjs(targetDate).format('YYYY-MM-DD');

  logger.info(`=== Daily fetch started for ${dateLabel} ===`);

  const tokenPool = new TokenPool(config.tisApiTokens);
  const rateLimiter = new PerVehicleRateLimiter(config.rateLimitPerVehicleMs);
  const client = new TisClient({
    baseUrl: config.tisApiUrl,
    tokenPool,
    rateLimiter,
  });

  // 1. Fetch route lists (путевые листы) — 7 days back from target
  const plFrom = dayjs(targetDate).subtract(7, 'day').toDate();
  const plTo = targetDate;
  logger.info(`Fetching route lists ${dayjs(plFrom).format('DD.MM.YYYY')} – ${dayjs(plTo).format('DD.MM.YYYY')}...`);
  const routeLists = await client.getRouteListsByDateOut(plFrom, plTo);
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
      const requests = await client.getRequests(reqFrom, reqTo);
      const parsed = parseRequests(requests);
      await upsertRequests(parsed);
      logger.info(`Saved ${parsed.length} requests`);
    } catch (err) {
      logger.error('Failed to fetch/save requests (continuing with vehicles)', err);
    }
  }

  // 5. Process each vehicle task sequentially
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const task of interleaved) {
    try {
      const stats = await client.getMonitoringStats(
        task.idMO,
        task.shift.from,
        task.shift.to,
      );

      if (!stats) {
        skipCount++;
        logger.debug(`Skipped ${task.regNumber} (${task.shift.shiftType} ${task.shift.date}) — no monitoring data`);
        continue;
      }

      const monitoring = parseMonitoringStats(stats);

      // Geozone analysis: determine time inside work zones and department unit
      const geozoneResult = analyzeTrackGeozones(monitoring.fullTrack);
      const totalStayTime = geozoneResult.totalStayTime > 0
        ? geozoneResult.totalStayTime
        : monitoring.engineOnTime; // fallback if no zones matched or track empty
      const departmentUnit = geozoneResult.departmentUnit;

      if (geozoneResult.zoneExits.length > 0) {
        logger.debug(
          `${task.regNumber}: ${geozoneResult.zoneExits.length} zone exit(s)`,
          geozoneResult.zoneExits,
        );
      }

      const fuelRateNorm = matchFuelNorm(task.regNumber);

      const kpi = calculateKpi({
        total_stay_time: totalStayTime,
        engine_on_time: monitoring.engineOnTime,
        fuel_consumed_total: monitoring.fuelConsumedTotal,
        fuel_rate_norm: fuelRateNorm,
      });

      await upsertVehicleRecord({
        report_date: task.shift.date,
        shift_type: task.shift.shiftType,
        vehicle_id: task.regNumber,
        vehicle_model: task.nameMO,
        company_name: task.companyName,
        department_unit: departmentUnit,
        total_stay_time: totalStayTime,
        engine_on_time: monitoring.engineOnTime,
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
      });

      successCount++;
    } catch (err) {
      errorCount++;
      logger.error(`Error processing ${task.regNumber} (${task.shift.shiftType} ${task.shift.date})`, err);
      // Individual vehicle errors do not stop the process
    }
  }

  logger.info(
    `=== Daily fetch complete for ${dateLabel}: ${successCount} success, ${skipCount} skipped, ${errorCount} errors ===`,
  );
}
