/**
 * Shift Fetch Job — главный пайплайн самосвалов.
 *
 * Для заданной даты и смены:
 * 1. Fetch ПЛ за 7 дней
 * 2. Парсинг + фильтрация самосвалов (или тест-режим по idMO)
 * 3. Fetch заявок за 2 месяца + upsert в БД
 * 4. Загрузка dt_* зон из БД
 * 5. Для каждого ТС: fetch мониторинг → анализ зон → определить объект →
 *    построить рейсы → KPI → upsert в БД (транзакция)
 */

import { getPool } from '../config/database';
import { getEnvConfig } from '../config/env';
import { TisClient } from '../services/tisClient';
import { TokenPool } from '../services/tokenPool';
import { PerVehicleRateLimiter } from '../services/rateLimiter';
import { parsePLs, splitIntoShifts } from '../services/plParser';
import { parseRequests } from '../services/requestParser';
import { analyzeZones, calcOnsiteSec } from '../services/zoneAnalyzer';
import { detectObject } from '../services/vehicleDetector';
import { buildTrips } from '../services/tripBuilder';
import { classifyWorkType } from '../services/workTypeClassifier';
import { calculateKpi } from '../services/kpiCalculator';
import { getAllDtZones } from '../repositories/filterRepo';
import { upsertRequests } from '../repositories/requestRepo';
import { upsertShiftRecord } from '../repositories/shiftRecordRepo';
import { replaceTrips } from '../repositories/tripRepo';
import { replaceZoneEvents } from '../repositories/zoneEventRepo';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';
import type { ShiftType, GeoZone } from '../types/domain';

// Singleton клиент и лимитер
let tisClient: TisClient | null = null;

function getTisClient(): TisClient {
  if (!tisClient) {
    const config = getEnvConfig();
    if (config.tisApiTokens.length === 0) {
      throw new Error('TIS_API_TOKENS not configured');
    }
    tisClient = new TisClient({
      baseUrl:     config.tisApiUrl,
      tokenPool:   new TokenPool(config.tisApiTokens),
      rateLimiter: new PerVehicleRateLimiter(30_000),
    });
  }
  return tisClient;
}

export interface FetchJobResult {
  date: string;
  shiftType: ShiftType;
  vehiclesProcessed: number;
  vehiclesSkipped: number;
  errors: string[];
}

/**
 * Запускает пайплайн для заданной даты и смены.
 * @param dateStr  дата в формате YYYY-MM-DD
 * @param shiftType  'shift1' | 'shift2'
 */
export async function runShiftFetch(
  dateStr: string,
  shiftType: ShiftType,
): Promise<FetchJobResult> {
  const config = getEnvConfig();
  const pool = getPool();
  const client = getTisClient();
  const result: FetchJobResult = {
    date: dateStr,
    shiftType,
    vehiclesProcessed: 0,
    vehiclesSkipped: 0,
    errors: [],
  };

  logger.info(`[ShiftFetch] Start: date=${dateStr} shift=${shiftType}`);

  // --- 1. Fetch ПЛ за 7 дней ---
  const toDate   = dayjs(dateStr).toDate();
  const fromDate = dayjs(dateStr).subtract(7, 'day').toDate();

  logger.info(`[ShiftFetch] Fetching route lists: ${dayjs(fromDate).format('DD.MM.YYYY')} – ${dayjs(toDate).format('DD.MM.YYYY')}`);
  let routeLists;
  try {
    routeLists = await client.getRouteListsByDateOut(fromDate, toDate);
  } catch (err) {
    const msg = `Failed to fetch route lists: ${String(err)}`;
    logger.error(`[ShiftFetch] ${msg}`);
    result.errors.push(msg);
    return result;
  }
  logger.info(`[ShiftFetch] Got ${routeLists.length} route lists`);

  // --- 2. Парсинг ПЛ ---
  const parsedPLs = parsePLs(routeLists, config.testIdMos);
  logger.info(`[ShiftFetch] Parsed ${parsedPLs.length} PLs with target vehicles`);

  // --- 3. Fetch заявок за 2 месяца ---
  const reqFrom = dayjs(dateStr).subtract(2, 'month').toDate();
  logger.info(`[ShiftFetch] Fetching requests: ${dayjs(reqFrom).format('DD.MM.YYYY')} – ${dayjs(toDate).format('DD.MM.YYYY')}`);
  try {
    const rawRequests = await client.getRequests(reqFrom, toDate);
    const parsedRequests = parseRequests(rawRequests);
    await upsertRequests(pool, parsedRequests);
    logger.info(`[ShiftFetch] Upserted ${parsedRequests.length} requests`);
  } catch (err) {
    logger.warn(`[ShiftFetch] Requests fetch failed (non-critical): ${String(err)}`);
  }

  // --- 4. Загрузка зон из БД ---
  let allZones: GeoZone[];
  try {
    allZones = await getAllDtZones(pool);
    logger.info(`[ShiftFetch] Loaded ${allZones.length} dt_* zones`);
  } catch (err) {
    const msg = `Failed to load geo zones: ${String(err)}`;
    logger.error(`[ShiftFetch] ${msg}`);
    result.errors.push(msg);
    return result;
  }

  if (allZones.length === 0) {
    logger.warn('[ShiftFetch] No dt_* zones found in DB. Skipping monitoring fetch.');
    return result;
  }

  // --- 5. Обработка каждого ТС ---
  // В тест-режиме используем idMO из конфига
  // В обычном режиме — берём idMO из распаршенных ПЛ
  const vehiclesMap = new Map<number, { regNumber: string; nameMO: string; plId?: number; requestNumbers: number[] }>();

  if (config.testIdMos !== null && config.testIdMos.length > 0) {
    // Тест-режим: используем ТС из конфига, без зависимости от ПЛ
    for (const idMO of config.testIdMos) {
      vehiclesMap.set(idMO, {
        regNumber:      '',
        nameMO:         `TestVehicle-${idMO}`,
        requestNumbers: [],
      });
    }
    // Если ТС есть и в ПЛ — обновим данные
    for (const pl of parsedPLs) {
      for (const v of pl.vehicles) {
        if (vehiclesMap.has(v.idMO)) {
          vehiclesMap.set(v.idMO, {
            regNumber:      v.regNumber,
            nameMO:         v.nameMO,
            plId:           pl.plId,
            requestNumbers: pl.requestNumbers,
          });
        }
      }
    }
  } else {
    // Обычный режим: ТС из ПЛ
    for (const pl of parsedPLs) {
      const shifts = splitIntoShifts(pl.dateOutPlan, pl.dateInPlan);
      const hasTargetShift = shifts.some(s => s.shiftType === shiftType);
      if (!hasTargetShift) continue;

      for (const v of pl.vehicles) {
        if (!vehiclesMap.has(v.idMO)) {
          vehiclesMap.set(v.idMO, {
            regNumber:      v.regNumber,
            nameMO:         v.nameMO,
            plId:           pl.plId,
            requestNumbers: pl.requestNumbers,
          });
        }
      }
    }
  }

  logger.info(`[ShiftFetch] Vehicles to process: ${vehiclesMap.size}`);

  // Определяем временные границы смены для заданной даты
  const dateDay = dayjs(dateStr);
  let shiftStart: Date, shiftEnd: Date;
  if (shiftType === 'shift1') {
    shiftStart = dateDay.hour(7).minute(30).second(0).toDate();
    shiftEnd   = dateDay.hour(19).minute(30).second(0).toDate();
  } else {
    shiftStart = dateDay.hour(19).minute(30).second(0).toDate();
    shiftEnd   = dateDay.add(1, 'day').hour(7).minute(30).second(0).toDate();
  }

  // Обрабатываем ТС последовательно (rate limit)
  for (const [idMO, vehicleInfo] of vehiclesMap) {
    try {
      logger.info(`[ShiftFetch] Processing idMO=${idMO} (${vehicleInfo.nameMO})`);

      // Fetch мониторинга
      const monitoring = await client.getMonitoringStats(idMO, shiftStart, shiftEnd);

      if (!monitoring) {
        logger.warn(`[ShiftFetch] No monitoring data for idMO=${idMO}`);
        result.vehiclesSkipped++;
        continue;
      }

      const track = monitoring.track || [];
      logger.info(`[ShiftFetch] idMO=${idMO}: ${track.length} track points`);

      // Анализ зон
      const zoneEvents = analyzeZones(track, allZones);
      logger.info(`[ShiftFetch] idMO=${idMO}: ${zoneEvents.length} zone events`);

      // Определение объекта
      const objectCandidate = detectObject(track, allZones);

      if (!objectCandidate && zoneEvents.length === 0) {
        logger.warn(`[ShiftFetch] idMO=${idMO}: no object detected, skipping`);
        result.vehiclesSkipped++;
        continue;
      }

      const objectUid  = objectCandidate?.objectUid  ?? 'unknown';
      const objectName = objectCandidate?.objectName ?? 'Неизвестный объект';

      // Зоны только для этого объекта
      const objectZones = allZones.filter(z => z.objectUid === objectUid);
      const objectZoneEvents = zoneEvents.filter(e => e.objectUid === objectUid);

      // Рейсы
      const trips = buildTrips(objectZoneEvents);

      // Время на объекте
      const onsiteSec = calcOnsiteSec(objectZoneEvents, objectUid);

      // Тип работы
      const workType = classifyWorkType(
        monitoring.engineTime ?? 0,
        onsiteSec,
        trips,
      );

      // KPI
      const kpi = calculateKpi({
        shiftStart,
        shiftEnd,
        engineTimeSec: monitoring.engineTime ?? 0,
        movingTimeSec: monitoring.movingTime  ?? 0,
        distanceKm:    Number(monitoring.distance ?? 0),
        onsiteSec,
        trips,
        workType,
      });

      // Сохраняем в БД (транзакция)
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        const shiftRecordId = await upsertShiftRecord(dbClient, {
          reportDate:     dayjs(dateStr).toDate(),
          shiftType,
          vehicleId:      idMO,
          regNumber:      vehicleInfo.regNumber,
          nameMO:         vehicleInfo.nameMO,
          objectUid,
          objectName,
          workType:       kpi.workType,
          shiftStart,
          shiftEnd,
          engineTimeSec:  kpi.engineTimeSec,
          movingTimeSec:  kpi.movingTimeSec,
          distanceKm:     kpi.distanceKm,
          onsiteMin:      kpi.onsiteMin,
          tripsCount:     kpi.tripsCount,
          factVolumeM3:   kpi.factVolumeM3,
          kipPct:         kpi.kipPct,
          movementPct:    kpi.movementPct,
          plId:           vehicleInfo.plId,
          requestNumbers: vehicleInfo.requestNumbers,
          rawMonitoring:  { engineTime: monitoring.engineTime, movingTime: monitoring.movingTime, distance: monitoring.distance, trackPoints: track.length },
          trips,
          zoneEvents:     objectZoneEvents,
        });

        await replaceTrips(dbClient, shiftRecordId, trips);
        await replaceZoneEvents(dbClient, idMO, dayjs(dateStr).toDate(), shiftType, objectZoneEvents);

        await dbClient.query('COMMIT');
        result.vehiclesProcessed++;
        logger.info(`[ShiftFetch] idMO=${idMO}: saved. kip=${kpi.kipPct}% trips=${trips.length} workType=${workType}`);
      } catch (dbErr) {
        await dbClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        dbClient.release();
      }

    } catch (err) {
      const msg = `idMO=${idMO}: ${String(err)}`;
      logger.error(`[ShiftFetch] Error processing vehicle: ${msg}`);
      result.errors.push(msg);
      result.vehiclesSkipped++;
    }
  }

  logger.info(`[ShiftFetch] Done: processed=${result.vehiclesProcessed} skipped=${result.vehiclesSkipped} errors=${result.errors.length}`);
  return result;
}
