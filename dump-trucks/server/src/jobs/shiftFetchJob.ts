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

import { runSegmentFetch } from './segmentFetchJob';
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
import { detectAllObjects } from '../services/vehicleDetector';
import { buildTrips } from '../services/tripBuilder';
import { classifyWorkType } from '../services/workTypeClassifier';
import { calculateKpi } from '../services/kpiCalculator';
import { getAllDtZones, getObjectTimezones, getVehicleLastObjects } from '../repositories/filterRepo';
import { upsertRequests } from '../repositories/requestRepo';
import { upsertShiftRecord, deleteStaleRecords } from '../repositories/shiftRecordRepo';
import { replaceTrips } from '../repositories/tripRepo';
import { replaceZoneEvents } from '../repositories/zoneEventRepo';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';
import { startPipelineRun, type TriggerType } from '../services/pipelineTracker';
import type { ShiftType, GeoZone, ZoneEvent, Trip, ShiftKpi, WorkType } from '../types/domain';

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
  triggerType: TriggerType = 'cron',
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

  const tracker = await startPipelineRun({
    pipelineName: 'dt-shift-fetch',
    triggerType,
    targetDate: dateStr,
    shiftType,
  });

  try {

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
    await tracker.complete({ errorCount: 1, errors: [{ message: msg }] });
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
    await tracker.complete({ errorCount: 1, errors: [{ message: msg }] });
    return result;
  }

  if (allZones.length === 0) {
    logger.warn('[ShiftFetch] No dt_* zones found in DB. Skipping monitoring fetch.');
    await tracker.complete({ totalVehicles: 0, successCount: 0, errorCount: 0 });
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

  // Карта: objectUid → есть ли dt_onsite зоны (объекты без onsite не могут иметь workType='onsite')
  const objectHasOnsite = new Map<string, boolean>();
  for (const z of allZones) {
    if (z.tag === 'dt_onsite') objectHasOnsite.set(z.objectUid, true);
  }

  const MIN_ENGINE_SEC = 2700; // 45 мин — порог "ТС реально работало"

  const onsiteRecordIds: number[] = [];

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

      // Step A: 45-мин фильтр — ТС с двигателем < 45 мин не работало (ночная стоянка и т.п.)
      const engineTimeSec = monitoring.engineTime ?? 0;
      if (engineTimeSec < MIN_ENGINE_SEC) {
        logger.info(`[ShiftFetch] idMO=${idMO}: engine ${Math.round(engineTimeSec / 60)} min < 45 min threshold, cleaning up stale records`);
        // Удаляем старые записи для этого ТС/дата/смена (если были)
        const dbClient = await pool.connect();
        try {
          await dbClient.query('BEGIN');
          const deleted = await deleteStaleRecords(dbClient, idMO, dayjs(dateStr).toDate(), shiftType, []);
          await dbClient.query('COMMIT');
          if (deleted > 0) {
            logger.info(`[ShiftFetch] idMO=${idMO}: deleted ${deleted} stale records`);
          }
        } catch (dbErr) {
          await dbClient.query('ROLLBACK');
          logger.warn(`[ShiftFetch] idMO=${idMO}: failed to delete stale records: ${String(dbErr)}`);
        } finally {
          dbClient.release();
        }
        result.vehiclesSkipped++;
        continue;
      }

      let track = monitoring.track || [];
      logger.info(`[ShiftFetch] idMO=${idMO}: ${track.length} track points, engine=${Math.round(engineTimeSec / 60)} min`);

      // Анализ зон
      let zoneEvents = analyzeZones(track, allZones);
      logger.info(`[ShiftFetch] idMO=${idMO}: ${zoneEvents.length} zone events`);

      // Step C: Определение ВСЕХ объектов (вместо одного)
      let candidates = detectAllObjects(track, allZones);

      // Re-query если основной объект (candidates[0]) имеет другой timezone
      if (candidates.length > 0) {
        const detectedTz = objectTzMap.get(candidates[0].objectUid) || DEFAULT_TZ;
        if (detectedTz !== usedTz) {
          logger.info(`[ShiftFetch] idMO=${idMO}: timezone mismatch! used=${usedTz} detected=${detectedTz} (object=${candidates[0].objectUid}). Re-querying...`);
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
          candidates = detectAllObjects(track, allZones);
          logger.info(`[ShiftFetch] idMO=${idMO}: re-query done. ${track.length} track points, ${zoneEvents.length} zone events, ${candidates.length} candidate objects`);
        }
      }

      if (candidates.length === 0 && zoneEvents.length === 0) {
        logger.warn(`[ShiftFetch] idMO=${idMO}: no object detected, skipping`);
        result.vehiclesSkipped++;
        continue;
      }

      // Step D: Обработка каждого candidate-объекта
      interface ValidRecord {
        objectUid: string;
        objectName: string;
        trips: Trip[];
        kpi: ShiftKpi;
        events: ZoneEvent[];
        workType: WorkType;
      }
      const validRecords: ValidRecord[] = [];

      for (const candidate of candidates) {
        const objEvents = zoneEvents.filter(e => e.objectUid === candidate.objectUid);
        const objTrips = buildTrips(objEvents);
        const hasOnsite = objectHasOnsite.get(candidate.objectUid) ?? false;

        // Время на объекте: считать только если объект имеет dt_onsite зоны
        const onsiteSec = hasOnsite ? calcOnsiteSec(objEvents, candidate.objectUid) : 0;

        const workType = classifyWorkType(
          engineTimeSec,
          onsiteSec,
          objTrips,
          60,
          hasOnsite,
        );

        // Пропускаем если нет осмысленной работы (ни доставки, ни валидного onsite)
        if (workType === 'unknown') continue;

        const kpi = calculateKpi({
          shiftStart,
          shiftEnd,
          engineTimeSec,
          movingTimeSec: monitoring.movingTime ?? 0,
          distanceKm:    Number(monitoring.distance ?? 0),
          onsiteSec,
          trips: objTrips,
          workType,
        });

        validRecords.push({
          objectUid:  candidate.objectUid,
          objectName: candidate.objectName,
          trips:      objTrips,
          kpi,
          events:     objEvents,
          workType,
        });
      }

      // Step E: Fallback — если нет valid records, берём основной кандидат с workType='unknown'
      if (validRecords.length === 0 && candidates.length > 0) {
        const topCandidate = candidates[0];
        const objEvents = zoneEvents.filter(e => e.objectUid === topCandidate.objectUid);
        const kpi = calculateKpi({
          shiftStart,
          shiftEnd,
          engineTimeSec,
          movingTimeSec: monitoring.movingTime ?? 0,
          distanceKm:    Number(monitoring.distance ?? 0),
          onsiteSec:     0,
          trips:         [],
          workType:      'unknown',
        });
        validRecords.push({
          objectUid:  topCandidate.objectUid,
          objectName: topCandidate.objectName,
          trips:      [],
          kpi,
          events:     objEvents,
          workType:   'unknown',
        });
      }

      // Step F: DB transaction — upsert all + cleanup stale
      const keepObjectUids = validRecords.map(r => r.objectUid);
      const allValidEvents = validRecords.flatMap(r => r.events);

      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        // 1. Удаляем stale записи для объектов, не в validRecords
        const deletedCount = await deleteStaleRecords(dbClient, idMO, dayjs(dateStr).toDate(), shiftType, keepObjectUids);
        if (deletedCount > 0) {
          logger.info(`[ShiftFetch] idMO=${idMO}: deleted ${deletedCount} stale records`);
        }

        // 2. Upsert каждого valid record + replace trips
        for (const rec of validRecords) {
          const shiftRecordId = await upsertShiftRecord(dbClient, {
            reportDate:     dayjs(dateStr).toDate(),
            shiftType,
            vehicleId:      idMO,
            regNumber:      vehicleInfo.regNumber,
            nameMO:         vehicleInfo.nameMO,
            organization:   getOrgByIdMO(idMO),
            objectUid:      rec.objectUid,
            objectName:     rec.objectName,
            objectTimezone: objectTzMap.get(rec.objectUid) || DEFAULT_TZ,
            workType:       rec.kpi.workType,
            shiftStart,
            shiftEnd,
            engineTimeSec:  rec.kpi.engineTimeSec,
            movingTimeSec:  rec.kpi.movingTimeSec,
            distanceKm:     rec.kpi.distanceKm,
            onsiteMin:      rec.kpi.onsiteMin,
            tripsCount:     rec.kpi.tripsCount,
            factVolumeM3:   rec.kpi.factVolumeM3,
            kipPct:         rec.kpi.kipPct,
            movementPct:    rec.kpi.movementPct,
            plId:           vehicleInfo.plId,
            requestNumbers: vehicleInfo.requestNumbers,
            rawMonitoring:  {
              engineTime:  monitoring.engineTime,
              movingTime:  monitoring.movingTime,
              distance:    monitoring.distance,
              trackPoints: track.length,
              fuels:       monitoring.fuels ?? [],
              track:       track,
            },
            trips:          rec.trips,
            zoneEvents:     rec.events,
          });

          await replaceTrips(dbClient, shiftRecordId, rec.trips);

          if (rec.kpi.workType === 'onsite') {
            onsiteRecordIds.push(shiftRecordId);
          }
        }

        // 3. Replace zone_events со ВСЕМИ events из valid objects
        await replaceZoneEvents(dbClient, idMO, dayjs(dateStr).toDate(), shiftType, allValidEvents);

        await dbClient.query('COMMIT');
        result.vehiclesProcessed++;

        const summary = validRecords.map(r => `${r.objectUid}:${r.workType}(trips=${r.trips.length},kip=${r.kpi.kipPct}%)`).join(', ');
        logger.info(`[ShiftFetch] idMO=${idMO}: saved ${validRecords.length} record(s). ${summary}`);

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

  // Fire-and-forget: trigger segment fetch for onsite records
  if (onsiteRecordIds.length > 0) {
    logger.info(`[ShiftFetch] Triggering segment fetch for ${onsiteRecordIds.length} onsite records`);
    runSegmentFetch({ shiftRecordIds: onsiteRecordIds })
      .then(segResult => logger.info('[ShiftFetch] Segment fetch complete', segResult))
      .catch(err => logger.error('[ShiftFetch] Segment fetch failed', err));
  }

  logger.info(`[ShiftFetch] Done: processed=${result.vehiclesProcessed} skipped=${result.vehiclesSkipped} errors=${result.errors.length}`);

  await tracker.complete({
    totalVehicles: result.vehiclesProcessed + result.vehiclesSkipped,
    successCount: result.vehiclesProcessed,
    errorCount: result.errors.length,
    errors: result.errors.length ? result.errors.map(message => ({ message })) : undefined,
  });

  return result;

  } catch (err) {
    await tracker.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
