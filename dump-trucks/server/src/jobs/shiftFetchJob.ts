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
import { getOrgByIdMO } from '../services/orgLookup';
import { TokenPool } from '../services/tokenPool';
import { PerVehicleRateLimiter } from '../services/rateLimiter';
import { parsePLs, routeListRecordsToParsedPLs } from '../services/plParser';
import { upsertRouteLists, queryRouteListsForShift } from '../repositories/routeListRepo';
import { parseRequests } from '../services/requestParser';
import { analyzeZones, calcOnsiteSec } from '../services/zoneAnalyzer';
import { detectObject } from '../services/vehicleDetector';
import { buildTrips } from '../services/tripBuilder';
import { classifyWorkType } from '../services/workTypeClassifier';
import { calculateKpi } from '../services/kpiCalculator';
import { getAllDtZones, getObjectTimezones, getVehicleLastObjects } from '../repositories/filterRepo';
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

/**
 * Сравнивает два ПЛ: возвращает true если candidateDate ближе к targetDate чем existingDate.
 * Предпочитает ПЛ, чей dateOutPlan ближе к целевой дате.
 */
function isBetterPL(
  candidateDate: Date,
  existingDate: Date | undefined,
  targetDate: ReturnType<typeof dayjs>,
): boolean {
  if (!existingDate) return true;
  const candidateDiff = Math.abs(dayjs(candidateDate).diff(targetDate, 'hour'));
  const existingDiff  = Math.abs(dayjs(existingDate).diff(targetDate, 'hour'));
  return candidateDiff < existingDiff;
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

  const DEFAULT_TZ = 'Asia/Yekaterinburg';

  // --- 0. Вычисляем номинальные границы смены в Екатеринбурге (для ПЛ и KPI) ---
  const dateDay = dayjs(dateStr);
  let shiftStart: Date, shiftEnd: Date;
  if (shiftType === 'shift1') {
    shiftStart = dateDay.hour(7).minute(30).second(0).toDate();
    shiftEnd   = dateDay.hour(19).minute(30).second(0).toDate();
  } else {
    shiftStart = dateDay.hour(19).minute(30).second(0).toDate();
    shiftEnd   = dateDay.add(1, 'day').hour(7).minute(30).second(0).toDate();
  }

  /**
   * Вычисляет границы смены в указанном часовом поясе.
   * Для Бодайбо (UTC+8): 07:30 Irkutsk = 04:30 Yekaterinburg → TIS получит правильное окно.
   */
  function computeShiftWindow(tz: string): { queryStart: Date; queryEnd: Date } {
    if (shiftType === 'shift1') {
      return {
        queryStart: dayjs.tz(`${dateStr} 07:30`, tz).toDate(),
        queryEnd:   dayjs.tz(`${dateStr} 19:30`, tz).toDate(),
      };
    } else {
      const nextDay = dayjs(dateStr).add(1, 'day').format('YYYY-MM-DD');
      return {
        queryStart: dayjs.tz(`${dateStr} 19:30`, tz).toDate(),
        queryEnd:   dayjs.tz(`${nextDay} 07:30`, tz).toDate(),
      };
    }
  }

  // --- 1. Fetch ПЛ из TIS (7-дневное окно) + upsert в БД ---
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

  // Upsert ВСЕ ПЛ в route_lists (non-critical)
  try {
    const upsertedCount = await upsertRouteLists(pool, routeLists);
    logger.info(`[ShiftFetch] Upserted ${upsertedCount} route lists to DB`);
  } catch (err) {
    logger.warn(`[ShiftFetch] Route lists upsert failed (non-critical): ${String(err)}`);
  }

  // --- 2. Запрос ПЛ из БД с перекрытием дат → парсинг ---
  let parsedPLs;
  try {
    const dbRecords = await queryRouteListsForShift(pool, shiftStart, shiftEnd);
    parsedPLs = routeListRecordsToParsedPLs(dbRecords, config.testIdMos);
    logger.info(`[ShiftFetch] DB query: ${dbRecords.length} route lists overlapping shift → ${parsedPLs.length} with target vehicles`);
  } catch (err) {
    // Fallback: парсим из TIS-ответа как раньше
    logger.warn(`[ShiftFetch] DB query failed, fallback to in-memory parse: ${String(err)}`);
    parsedPLs = parsePLs(routeLists, config.testIdMos);
    logger.info(`[ShiftFetch] Fallback parsed ${parsedPLs.length} PLs with target vehicles`);
  }

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

  // --- 4b. Загрузка timezone объектов и последних объектов ТС ---
  let objectTzMap: Map<string, string>;
  let vehicleLastObjects: Map<number, string>;
  try {
    [objectTzMap, vehicleLastObjects] = await Promise.all([
      getObjectTimezones(pool),
      getVehicleLastObjects(pool),
    ]);
    logger.info(`[ShiftFetch] Loaded ${objectTzMap.size} object timezones, ${vehicleLastObjects.size} vehicle→object mappings`);
  } catch (err) {
    logger.warn(`[ShiftFetch] Failed to load timezone data (fallback to ${DEFAULT_TZ}): ${String(err)}`);
    objectTzMap = new Map();
    vehicleLastObjects = new Map();
  }

  // --- 5. Обработка каждого ТС ---
  // В тест-режиме используем idMO из конфига
  // В обычном режиме — берём idMO из распаршенных ПЛ
  const targetDate = dayjs(dateStr).startOf('day');
  const vehiclesMap = new Map<number, { regNumber: string; nameMO: string; plId?: number; requestNumbers: number[]; _dateOutPlan?: Date }>();

  if (config.testIdMos !== null && config.testIdMos.length > 0) {
    // Тест-режим: используем ТС из конфига, без зависимости от ПЛ
    for (const idMO of config.testIdMos) {
      vehiclesMap.set(idMO, {
        regNumber:      '',
        nameMO:         `TestVehicle-${idMO}`,
        requestNumbers: [],
      });
    }
    // Если ТС есть и в ПЛ — мержим requestNumbers из всех валидных ПЛ
    for (const pl of parsedPLs) {
      for (const v of pl.vehicles) {
        if (!vehiclesMap.has(v.idMO)) continue;
        const existing = vehiclesMap.get(v.idMO)!;
        // Мержим requestNumbers
        for (const num of pl.requestNumbers) {
          if (!existing.requestNumbers.includes(num)) {
            existing.requestNumbers.push(num);
          }
        }
        // plId обновляем только если этот ПЛ ближе к целевой дате
        if (!existing.plId || isBetterPL(pl.dateOutPlan, existing._dateOutPlan, targetDate)) {
          existing.regNumber    = v.regNumber;
          existing.nameMO       = v.nameMO;
          existing.plId         = pl.plId;
          existing._dateOutPlan = pl.dateOutPlan;
        }
      }
    }
  } else {
    // Обычный режим: ТС из ПЛ.
    // БД уже отфильтровала ПЛ по перекрытию дат — не нужен splitIntoShifts.
    // Мержим requestNumbers из всех ПЛ, покрывающих смену.
    // plId берём от ПЛ с ближайшим dateOutPlan к целевой дате.
    for (const pl of parsedPLs) {
      for (const v of pl.vehicles) {
        const existing = vehiclesMap.get(v.idMO);
        if (!existing) {
          vehiclesMap.set(v.idMO, {
            regNumber:      v.regNumber,
            nameMO:         v.nameMO,
            plId:           pl.plId,
            requestNumbers: [...pl.requestNumbers],
            _dateOutPlan:   pl.dateOutPlan,
          });
        } else {
          // Мержим requestNumbers из всех валидных ПЛ
          for (const num of pl.requestNumbers) {
            if (!existing.requestNumbers.includes(num)) {
              existing.requestNumbers.push(num);
            }
          }
          // plId обновляем только если этот ПЛ ближе к целевой дате
          if (isBetterPL(pl.dateOutPlan, existing._dateOutPlan, targetDate)) {
            existing.regNumber    = v.regNumber;
            existing.nameMO       = v.nameMO;
            existing.plId         = pl.plId;
            existing._dateOutPlan = pl.dateOutPlan;
          }
        }
      }
    }
  }

  logger.info(`[ShiftFetch] Vehicles to process: ${vehiclesMap.size}`);

  // Обрабатываем ТС последовательно (rate limit)
  for (const [idMO, vehicleInfo] of vehiclesMap) {
    try {
      logger.info(`[ShiftFetch] Processing idMO=${idMO} (${vehicleInfo.nameMO})`);

      // Определяем timezone: последний объект → timezone, fallback к Екатеринбургу
      const lastObjectUid = vehicleLastObjects.get(idMO);
      let usedTz = (lastObjectUid && objectTzMap.get(lastObjectUid)) || DEFAULT_TZ;
      let { queryStart, queryEnd } = computeShiftWindow(usedTz);

      if (usedTz !== DEFAULT_TZ) {
        logger.info(`[ShiftFetch] idMO=${idMO}: using tz=${usedTz} (last object=${lastObjectUid}), queryWindow=${dayjs(queryStart).format('HH:mm')}–${dayjs(queryEnd).format('HH:mm')} local`);
      }

      // Fetch мониторинга
      let monitoring = await client.getMonitoringStats(idMO, queryStart, queryEnd);

      if (!monitoring) {
        logger.warn(`[ShiftFetch] No monitoring data for idMO=${idMO}`);
        result.vehiclesSkipped++;
        continue;
      }

      let track = monitoring.track || [];
      logger.info(`[ShiftFetch] idMO=${idMO}: ${track.length} track points`);

      // Анализ зон
      let zoneEvents = analyzeZones(track, allZones);
      logger.info(`[ShiftFetch] idMO=${idMO}: ${zoneEvents.length} zone events`);

      // Определение объекта
      let objectCandidate = detectObject(track, allZones);

      // Re-query если определённый объект имеет другой timezone
      if (objectCandidate) {
        const detectedTz = objectTzMap.get(objectCandidate.objectUid) || DEFAULT_TZ;
        if (detectedTz !== usedTz) {
          logger.info(`[ShiftFetch] idMO=${idMO}: timezone mismatch! used=${usedTz} detected=${detectedTz} (object=${objectCandidate.objectUid}). Re-querying...`);
          usedTz = detectedTz;
          ({ queryStart, queryEnd } = computeShiftWindow(usedTz));

          monitoring = await client.getMonitoringStats(idMO, queryStart, queryEnd);
          if (!monitoring) {
            logger.warn(`[ShiftFetch] No monitoring data for idMO=${idMO} after re-query`);
            result.vehiclesSkipped++;
            continue;
          }
          track = monitoring.track || [];
          zoneEvents = analyzeZones(track, allZones);
          objectCandidate = detectObject(track, allZones);
          logger.info(`[ShiftFetch] idMO=${idMO}: re-query done. ${track.length} track points, ${zoneEvents.length} zone events`);
        }
      }

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
          organization:   getOrgByIdMO(idMO),
          objectUid,
          objectName,
          objectTimezone: (objectTzMap.get(objectUid)) || DEFAULT_TZ,
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
          rawMonitoring:  {
            engineTime:  monitoring.engineTime,
            movingTime:  monitoring.movingTime,
            distance:    monitoring.distance,
            trackPoints: track.length,
            fuels:       monitoring.fuels  ?? [],
            track:       track,
          },
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
