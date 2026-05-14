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
import { auditLog } from '../utils/auditLog';
import { dayjs, parseDdMmYyyyHhmm } from '../utils/dateFormat';
import { startPipelineRun, type TriggerType } from '../services/pipelineTracker';
import { getJobController, isCancelledError } from '../services/jobController';
import { processTrack, saveTrackForShift } from '../services/trackProcessor';
import type { ShiftType, GeoZone, ZoneEvent, Trip, ShiftKpi, WorkType } from '../types/domain';

// Singleton клиент и лимитер
let tisClient: TisClient | null = null;

export function getTisClient(): TisClient {
  if (!tisClient) {
    const config = getEnvConfig();
    if (config.tisApiTokens.length === 0) {
      throw new Error('TIS_API_TOKENS not configured');
    }
    tisClient = new TisClient({
      baseUrl:     config.tisApiUrl,
      tokenPool:   new TokenPool(config.tisApiTokens),
      rateLimiter: new PerVehicleRateLimiter(config.rateLimitPerVehicleMs),
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
  const jobController = getJobController('fetch');
  // Reset only after a completed cancellation so concurrent shift1/shift2 share the signal
  if (jobController.isCancelled()) jobController.reset();
  const signal = jobController.signal;
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
  // Для shift2 окно расширяем на +1 день: смена заходит в утро следующего дня,
  // и часть ПЛ может быть выписана/опубликована уже в TIS датой N+1 (закрытие
  // ночной смены утром, post-факт оформление). Без +1 такие ПЛ не попадают в fetch.
  const toDate   = (shiftType === 'shift2'
    ? dayjs(dateStr).add(1, 'day')
    : dayjs(dateStr)).toDate();
  const fromDate = dayjs(dateStr).subtract(7, 'day').toDate();

  logger.info(`[ShiftFetch] Fetching route lists: ${dayjs(fromDate).format('DD.MM.YYYY')} – ${dayjs(toDate).format('DD.MM.YYYY')}`);
  let routeLists;
  try {
    jobController.throwIfCancelled();
    routeLists = await client.getRouteListsByDateOut(fromDate, toDate, signal);
  } catch (err) {
    const msg = `Failed to fetch route lists: ${String(err)}`;
    logger.error(`[ShiftFetch] ${msg}`);
    result.errors.push(msg);
    await tracker.complete({ errorCount: 1, errors: [{ message: msg }] });
    return result;
  }
  logger.info(`[ShiftFetch] Got ${routeLists.length} route lists`);

  // Upsert ВСЕ ПЛ в route_lists (non-critical)
  let upsertedCount = 0;
  try {
    upsertedCount = await upsertRouteLists(pool, routeLists);
    logger.info(`[ShiftFetch] Upserted ${upsertedCount} route lists to DB`);
  } catch (err) {
    logger.warn(`[ShiftFetch] Route lists upsert failed (non-critical): ${String(err)}`);
  }

  // --- 2. Запрос ПЛ из БД с перекрытием дат → парсинг ---
  let parsedPLs;
  let dbOverlapCount = 0;
  try {
    const dbRecords = await queryRouteListsForShift(pool, shiftStart, shiftEnd);
    dbOverlapCount = dbRecords.length;
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
    jobController.throwIfCancelled();
    const rawRequests = await client.getRequests(reqFrom, toDate, signal);
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

  const vehiclesFromPL = vehiclesMap.size;

  // --- 5b. Discovery via getPassports ---
  // Дополнительный проход: самосвалы из паспортного справочника TIS, которые
  // не попали в vehiclesMap через ПЛ. Эти ТС работают без заявки → сохраняются
  // с pl_id=null, request_numbers=[]. UI показывает их как «без заявки».
  // Пропускается в тест-режиме (там обрабатываем ровно testIdMos).
  let discoveredCount = 0;
  if (config.testIdMos === null || config.testIdMos.length === 0) {
    try {
      jobController.throwIfCancelled();
      const passports = await client.getPassports(signal);
      const samosvalPassports = passports.filter(p =>
        p.registered === true &&
        (p.modelOrMarkOrModif || '').toLowerCase().includes('самосвал')
      );
      for (const p of samosvalPassports) {
        if (vehiclesMap.has(p.idMO)) continue;
        vehiclesMap.set(p.idMO, {
          regNumber:      p.regNumber || '',
          nameMO:         p.modelOrMarkOrModif || `Vehicle-${p.idMO}`,
          requestNumbers: [],
        });
        discoveredCount++;
      }
      logger.info(`[ShiftFetch] Passport discovery: ${passports.length} total passports, ${samosvalPassports.length} samosvals, +${discoveredCount} new (not in PL)`);
    } catch (err) {
      logger.warn(`[ShiftFetch] getPassports failed (non-critical, skipping discovery): ${String(err)}`);
    }
  }

  logger.info(`[ShiftFetch] Vehicles to process: ${vehiclesMap.size} (from PL: ${vehiclesFromPL}, discovered: ${discoveredCount})`);

  // --- AUDIT: pipeline summary --------------------------------------------
  {
    const dateOutDist: Record<string, number> = {};
    for (const pl of parsedPLs) {
      const d = (pl.dateOut || '').slice(0, 10) || '(unknown)';
      dateOutDist[d] = (dateOutDist[d] || 0) + 1;
    }
    auditLog({
      kind: 'pl_summary',
      runId: tracker.runId,
      date: dateStr,
      shift: shiftType,
      fetchRange: `${dayjs(fromDate).format('DD.MM.YYYY')}..${dayjs(toDate).format('DD.MM.YYYY')}`,
      tisCount: routeLists.length,
      upsertedCount,
      dbOverlapCount,
      plsWithSamosval: parsedPLs.length,
      uniqueVehicles: vehiclesMap.size,
      vehiclesFromPL,
      vehiclesDiscovered: discoveredCount,
      dateOutDist,
    });
  }

  // Карта: objectUid → есть ли dt_onsite зоны (объекты без onsite не могут иметь workType='onsite')
  const objectHasOnsite = new Map<string, boolean>();
  for (const z of allZones) {
    if (z.tag === 'dt_onsite') objectHasOnsite.set(z.objectUid, true);
  }

  const MIN_ENGINE_SEC = 2700; // 45 мин — порог "ТС реально работало"

  const onsiteRecordIds: number[] = [];

  type VehicleEntry = [number, typeof vehiclesMap extends Map<number, infer V> ? V : never];

  const processOneVehicle = async (idMO: number, vehicleInfo: NonNullable<ReturnType<typeof vehiclesMap.get>>): Promise<void> => {
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
      let monitoring = await client.getMonitoringStats(idMO, queryStart, queryEnd, signal);

      if (!monitoring) {
        logger.warn(`[ShiftFetch] No monitoring data for idMO=${idMO}`);
        auditLog({
          kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
          idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
          tz: usedTz, engineSec: 0, trackPoints: 0, zoneEvents: 0,
          detectedObject: null, verdict: 'no_monitoring',
        });
        result.vehiclesSkipped++;
        return;
      }

      // Step A: 45-мин фильтр (с geo-fallback).
      // Сначала анализируем трек/зоны, чтобы при engineTime=0 от сенсора иметь возможность
      // оценить время работы по диапазону GPS-точек (для машин без CAN-bus).
      const sensorEngineSec = monitoring.engineTime ?? 0;
      let track = monitoring.track || [];
      let zoneEvents = analyzeZones(track, allZones);

      let engineTimeSec = sensorEngineSec;
      let engineTimeSource: 'sensor' | 'geo' = 'sensor';

      if (sensorEngineSec < MIN_ENGINE_SEC && zoneEvents.length > 0 && track.length >= 2) {
        const firstTs = parseDdMmYyyyHhmm(track[0]!.time);
        const lastTs = parseDdMmYyyyHhmm(track[track.length - 1]!.time);
        if (firstTs && lastTs && lastTs.getTime() > firstTs.getTime()) {
          const span = Math.round((lastTs.getTime() - firstTs.getTime()) / 1000);
          const shiftSpanSec = Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 1000);
          engineTimeSec = Math.min(span, shiftSpanSec);
          engineTimeSource = 'geo';
          logger.info(
            `[ShiftFetch] idMO=${idMO}: geo-fallback engine=${Math.round(engineTimeSec / 60)}m ` +
            `(sensor=${Math.round(sensorEngineSec / 60)}m, span=${Math.round(span / 60)}m, zoneEvents=${zoneEvents.length})`,
          );
        }
      }

      if (engineTimeSec < MIN_ENGINE_SEC) {
        logger.info(`[ShiftFetch] idMO=${idMO}: engine ${Math.round(engineTimeSec / 60)} min < 45 min threshold (source=${engineTimeSource}), cleaning up stale records`);
        auditLog({
          kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
          idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
          tz: usedTz, engineSec: engineTimeSec, engineSource: engineTimeSource,
          trackPoints: track.length, zoneEvents: zoneEvents.length,
          detectedObject: null, verdict: 'engine_below_threshold',
        });
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
        return;
      }

      logger.info(`[ShiftFetch] idMO=${idMO}: ${track.length} track points, engine=${Math.round(engineTimeSec / 60)} min (source=${engineTimeSource}), ${zoneEvents.length} zone events`);

      // Step C: Определение ВСЕХ объектов (вместо одного)
      let candidates = detectAllObjects(track, allZones);

      // Re-query если основной объект (candidates[0]) имеет другой timezone
      if (candidates.length > 0) {
        const detectedTz = objectTzMap.get(candidates[0].objectUid) || DEFAULT_TZ;
        if (detectedTz !== usedTz) {
          logger.info(`[ShiftFetch] idMO=${idMO}: timezone mismatch! used=${usedTz} detected=${detectedTz} (object=${candidates[0].objectUid}). Re-querying...`);
          usedTz = detectedTz;
          ({ queryStart, queryEnd } = computeShiftWindow(usedTz));

          // Сбрасываем per-idMO лимит, чтобы re-query не ждал 30с
          client.getRateLimiter().reset(idMO);
          monitoring = await client.getMonitoringStats(idMO, queryStart, queryEnd, signal);
          if (!monitoring) {
            logger.warn(`[ShiftFetch] No monitoring data for idMO=${idMO} after re-query`);
            auditLog({
              kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
              idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
              tz: usedTz, engineSec: engineTimeSec, trackPoints: track.length,
              zoneEvents: zoneEvents.length, detectedObject: null,
              verdict: 'no_monitoring', reason: 'after tz re-query',
            });
            result.vehiclesSkipped++;
            return;
          }
          track = monitoring.track || [];
          zoneEvents = analyzeZones(track, allZones);
          candidates = detectAllObjects(track, allZones);

          // Пересчёт engineTimeSec/Source с новыми данными
          const newSensorEngineSec = monitoring.engineTime ?? 0;
          engineTimeSec = newSensorEngineSec;
          engineTimeSource = 'sensor';
          if (newSensorEngineSec < MIN_ENGINE_SEC && zoneEvents.length > 0 && track.length >= 2) {
            const firstTs = parseDdMmYyyyHhmm(track[0]!.time);
            const lastTs = parseDdMmYyyyHhmm(track[track.length - 1]!.time);
            if (firstTs && lastTs && lastTs.getTime() > firstTs.getTime()) {
              const span = Math.round((lastTs.getTime() - firstTs.getTime()) / 1000);
              const shiftSpanSec = Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 1000);
              engineTimeSec = Math.min(span, shiftSpanSec);
              engineTimeSource = 'geo';
            }
          }
          logger.info(`[ShiftFetch] idMO=${idMO}: re-query done. ${track.length} track points, engine=${Math.round(engineTimeSec / 60)}m (source=${engineTimeSource}), ${zoneEvents.length} zone events, ${candidates.length} candidate objects`);
        }
      }

      if (candidates.length === 0 && zoneEvents.length === 0) {
        logger.warn(`[ShiftFetch] idMO=${idMO}: no object detected, skipping`);
        auditLog({
          kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
          idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
          tz: usedTz, engineSec: engineTimeSec, engineSource: engineTimeSource,
          trackPoints: track.length, zoneEvents: zoneEvents.length, detectedObject: null,
          verdict: 'no_object_detected',
        });
        result.vehiclesSkipped++;
        return;
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
          engineTimeSource,
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
          engineTimeSource,
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
        let firstRecordId = 0;
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
            engineTimeSource: rec.kpi.engineTimeSource,
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

          if (firstRecordId === 0) firstRecordId = shiftRecordId;

          if (rec.kpi.workType === 'onsite') {
            onsiteRecordIds.push(shiftRecordId);
          }
        }

        // 3. Replace zone_events со ВСЕМИ events из valid objects
        await replaceZoneEvents(dbClient, idMO, dayjs(dateStr).toDate(), shiftType, allValidEvents);

        await dbClient.query('COMMIT');
        result.vehiclesProcessed++;

        if (firstRecordId > 0 && vehicleInfo.regNumber && track.length >= 2) {
          const processed = processTrack(track, monitoring.ignitionWork);
          if (processed.length > 0) {
            saveTrackForShift(pool, firstRecordId, vehicleInfo.regNumber, dateStr, processed)
              .catch(err => logger.warn(`[ShiftFetch] Track save failed for ${vehicleInfo.regNumber}: ${String(err)}`));
          }
        }

        const summary = validRecords.map(r => `${r.objectUid}:${r.workType}(trips=${r.trips.length},kip=${r.kpi.kipPct}%)`).join(', ');
        logger.info(`[ShiftFetch] idMO=${idMO}: saved ${validRecords.length} record(s). ${summary}`);

        auditLog({
          kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
          idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
          tz: usedTz, engineSec: engineTimeSec, engineSource: engineTimeSource,
          trackPoints: track.length, zoneEvents: zoneEvents.length,
          detectedObject: validRecords[0]?.objectUid ?? null,
          verdict: 'processed',
          reason: validRecords.map(r => `${r.objectUid}:${r.workType}`).join(','),
        });

      } catch (dbErr) {
        await dbClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        dbClient.release();
      }

    } catch (err) {
      if (isCancelledError(err)) {
        logger.info(`[ShiftFetch] Cancelled (caught) idMO=${idMO}`);
        throw err;
      }
      const msg = `idMO=${idMO}: ${String(err)}`;
      logger.error(`[ShiftFetch] Error processing vehicle: ${msg}`);
      auditLog({
        kind: 'vehicle_decision', runId: tracker.runId, date: dateStr, shift: shiftType,
        idMO, nameMO: vehicleInfo.nameMO, plId: vehicleInfo.plId,
        tz: 'unknown', engineSec: 0, trackPoints: 0, zoneEvents: 0,
        detectedObject: null, verdict: 'processing_error', reason: String(err),
      });
      result.errors.push(msg);
      result.vehiclesSkipped++;
    }
  };

  // Worker pool: используем все доступные TIS-токены параллельно.
  // PerVehicleRateLimiter ключуется по idMO — разные ТС не блокируют друг друга.
  const entries: VehicleEntry[] = Array.from(vehiclesMap.entries()) as VehicleEntry[];
  const tokenCount = config.tisApiTokens.length;
  const concurrency = Math.max(1, Math.min(
    config.fetchConcurrency ?? tokenCount,
    entries.length,
  ));
  let taskIndex = 0;
  logger.info(`[ShiftFetch] Worker pool: concurrency=${concurrency} (tokens=${tokenCount}, vehicles=${entries.length})`);

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      if (jobController.isCancelled()) return;
      const i = taskIndex++;
      if (i >= entries.length) return;
      const [idMO, vehicleInfo] = entries[i];
      try {
        await processOneVehicle(idMO, vehicleInfo);
      } catch (err) {
        if (isCancelledError(err)) return;
        // processOneVehicle уже сам ловит non-cancel ошибки; throw сюда не дойдёт.
        // Защита на всякий случай — логируем и продолжаем.
        logger.error(`[ShiftFetch] Worker error idMO=${idMO}`, err);
      }
    }
  });
  await Promise.all(workers);

  if (jobController.isCancelled()) {
    logger.info(`[ShiftFetch] Cancelled during worker pool; processed=${result.vehiclesProcessed}/${entries.length}`);
  }

  // Fire-and-forget: trigger segment fetch for onsite records
  if (onsiteRecordIds.length > 0 && !jobController.isCancelled()) {
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
    if (isCancelledError(err)) {
      logger.info(`[ShiftFetch] Cancelled for ${dateStr} ${shiftType}`);
      await tracker.fail('cancelled');
      result.errors.push('cancelled');
      return result;
    }
    await tracker.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}
