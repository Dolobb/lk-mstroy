/**
 * Recalculate dump-trucks shift data from stored raw_monitoring.
 *
 * Reads shift_records.raw_monitoring (which now includes full `track` and `fuels`)
 * and re-runs: zoneAnalysis → detectObject → buildTrips → kpi → upsert in a transaction.
 *
 * Does NOT call TIS API.
 */

import type { Pool } from 'pg';
import { dayjs } from '../utils/dateFormat';
import { analyzeZones, calcOnsiteSec } from '../services/zoneAnalyzer';
import { detectObject } from '../services/vehicleDetector';
import { buildTrips } from '../services/tripBuilder';
import { classifyWorkType } from '../services/workTypeClassifier';
import { calculateKpi } from '../services/kpiCalculator';
import { getAllDtZones } from '../repositories/filterRepo';
import { upsertShiftRecord } from '../repositories/shiftRecordRepo';
import { replaceTrips } from '../repositories/tripRepo';
import { replaceZoneEvents } from '../repositories/zoneEventRepo';
import { logger } from '../utils/logger';
import type { ShiftType, GeoZone } from '../types/domain';

interface RawTrackPoint {
  lat: number;
  lon: number;
  time: string;
  speed?: number;
  direction?: number;
}

interface RawMonitoring {
  engineTime?: number;
  movingTime?: number;
  distance?: number;
  trackPoints?: number;
  track?: RawTrackPoint[];
  fuels?: unknown[];
}

interface ShiftRecordWithRaw {
  id: number;
  report_date: Date;
  shift_type: string;
  vehicle_id: number;
  reg_number: string | null;
  name_mo: string | null;
  object_uid: string;
  object_name: string | null;
  object_timezone: string | null;
  shift_start: Date | null;
  shift_end: Date | null;
  pl_id: number | null;
  request_numbers: number[] | null;
  raw_monitoring: RawMonitoring | null;
}

export interface RecalculateResult {
  date: string;
  shiftType: string;
  processed: number;
  skipped: number;
  errors: string[];
}

/**
 * Recalculate all shift_records for a given date and shift from stored raw_monitoring.
 */
export async function recalculateShift(
  pool: Pool,
  dateStr: string,
  shiftType: ShiftType,
): Promise<RecalculateResult> {
  const result: RecalculateResult = { date: dateStr, shiftType, processed: 0, skipped: 0, errors: [] };

  logger.info(`[DT Recalculate] Starting: date=${dateStr} shift=${shiftType}`);

  // --- Load geo zones ---
  let allZones: GeoZone[];
  try {
    allZones = await getAllDtZones(pool);
    logger.info(`[DT Recalculate] Loaded ${allZones.length} dt_* zones`);
  } catch (err) {
    const msg = `Failed to load geo zones: ${String(err)}`;
    logger.error(`[DT Recalculate] ${msg}`);
    result.errors.push(msg);
    return result;
  }

  if (allZones.length === 0) {
    result.errors.push('No dt_* zones in DB');
    return result;
  }

  // --- Query shift records with raw_monitoring ---
  const { rows } = await pool.query<ShiftRecordWithRaw>(`
    SELECT
      id, report_date, shift_type, vehicle_id,
      reg_number, name_mo,
      object_uid, object_name, object_timezone,
      shift_start, shift_end,
      pl_id, request_numbers,
      raw_monitoring
    FROM dump_trucks.shift_records
    WHERE report_date = $1 AND shift_type = $2
    ORDER BY vehicle_id
  `, [dateStr, shiftType]);

  logger.info(`[DT Recalculate] Found ${rows.length} shift records for ${dateStr} ${shiftType}`);

  if (rows.length === 0) {
    result.errors.push(`No shift records for ${dateStr} ${shiftType}. Run fetch first.`);
    return result;
  }

  // Reconstruct shift time window from dateStr + shiftType
  const dateDay = dayjs(dateStr);
  const shiftStart = shiftType === 'shift1'
    ? dateDay.hour(7).minute(30).second(0).toDate()
    : dateDay.hour(19).minute(30).second(0).toDate();
  const shiftEnd = shiftType === 'shift1'
    ? dateDay.hour(19).minute(30).second(0).toDate()
    : dateDay.add(1, 'day').hour(7).minute(30).second(0).toDate();

  // --- Process each shift record ---
  for (const sr of rows) {
    try {
      const raw = sr.raw_monitoring;

      if (!raw?.track || raw.track.length === 0) {
        logger.warn(`[DT Recalculate] Skipping idMO=${sr.vehicle_id}: no track in raw_monitoring`);
        result.skipped++;
        continue;
      }

      const track = raw.track as RawTrackPoint[];
      logger.info(`[DT Recalculate] idMO=${sr.vehicle_id}: ${track.length} track points`);

      // Zone analysis
      const zoneEvents = analyzeZones(track, allZones);

      // Object detection
      const objectCandidate = detectObject(track, allZones);
      const objectUid  = objectCandidate?.objectUid  ?? sr.object_uid;  // fallback to existing
      const objectName = objectCandidate?.objectName ?? sr.object_name ?? 'Неизвестный объект';

      if (!objectCandidate && zoneEvents.length === 0) {
        logger.warn(`[DT Recalculate] idMO=${sr.vehicle_id}: no object detected and no zone events — skipping`);
        result.skipped++;
        continue;
      }

      // Zones & events for detected object
      const objectZones = allZones.filter(z => z.objectUid === objectUid);
      void objectZones; // loaded but available for future use
      const objectZoneEvents = zoneEvents.filter(e => e.objectUid === objectUid);

      // Trips
      const trips = buildTrips(objectZoneEvents);

      // Onsite time
      const onsiteSec = calcOnsiteSec(objectZoneEvents, objectUid);

      // Work type
      const engineTimeSec = raw.engineTime ?? 0;
      const workType = classifyWorkType(engineTimeSec, onsiteSec, trips);

      // KPI
      const kpi = calculateKpi({
        shiftStart,
        shiftEnd,
        engineTimeSec,
        movingTimeSec: raw.movingTime  ?? 0,
        distanceKm:    Number(raw.distance ?? 0),
        onsiteSec,
        trips,
        workType,
      });

      // Save in transaction
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        const shiftRecordId = await upsertShiftRecord(dbClient, {
          reportDate:     sr.report_date,
          shiftType:      sr.shift_type as ShiftType,
          vehicleId:      sr.vehicle_id,
          regNumber:      sr.reg_number ?? '',
          nameMO:         sr.name_mo ?? '',
          objectUid,
          objectName,
          objectTimezone: sr.object_timezone ?? 'Asia/Yekaterinburg',
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
          plId:           sr.pl_id ?? undefined,
          requestNumbers: sr.request_numbers ?? [],
          rawMonitoring:  raw, // preserve existing raw_monitoring unchanged
          trips,
          zoneEvents:     objectZoneEvents,
        });

        await replaceTrips(dbClient, shiftRecordId, trips);
        await replaceZoneEvents(
          dbClient,
          sr.vehicle_id,
          sr.report_date,
          sr.shift_type as ShiftType,
          objectZoneEvents,
        );

        await dbClient.query('COMMIT');
        result.processed++;
        logger.info(
          `[DT Recalculate] idMO=${sr.vehicle_id}: kip=${kpi.kipPct}% trips=${trips.length} workType=${workType}`,
        );
      } catch (dbErr) {
        await dbClient.query('ROLLBACK');
        throw dbErr;
      } finally {
        dbClient.release();
      }
    } catch (err) {
      const msg = `idMO=${sr.vehicle_id}: ${String(err)}`;
      logger.error(`[DT Recalculate] Error: ${msg}`);
      result.errors.push(msg);
    }
  }

  logger.info(
    `[DT Recalculate] Done for ${dateStr} ${shiftType}: processed=${result.processed} skipped=${result.skipped} errors=${result.errors.length}`,
  );
  return result;
}
