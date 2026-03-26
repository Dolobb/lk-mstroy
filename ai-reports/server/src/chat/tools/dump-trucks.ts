import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryDumpTruckData = tool({
  description:
    'Получить данные по самосвалам за период: KPI за смену (КИП%, движение%, моточасы, рейсы, время на объекте). ' +
    'Одна запись = 1 ТС x 1 дата x 1 смена x 1 объект. ' +
    'Источник: PostgreSQL mstroy, схема dump_trucks.',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    objectName: z.string().optional().describe('Фильтр по объекту (напр. Тобольск)'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
    shiftType: z.enum(['shift1', 'shift2']).optional().describe('Фильтр по смене'),
  }),
  execute: async ({ dateFrom, dateTo, objectName, regNumbers, shiftType }) => {
    console.log('[queryDumpTruckData]', { dateFrom, dateTo, objectName, regNumbers, shiftType });
    const pool = getPg17();

    const conditions: string[] = ['sr.report_date >= $1', 'sr.report_date <= $2'];
    const params: unknown[] = [dateFrom, dateTo];
    let idx = 3;

    if (objectName) {
      conditions.push(`sr.object_name ILIKE $${idx}`);
      params.push(`%${objectName}%`);
      idx++;
    }
    if (regNumbers?.length) {
      conditions.push(`sr.reg_number = ANY($${idx})`);
      params.push(regNumbers);
      idx++;
    }
    if (shiftType) {
      conditions.push(`sr.shift_type = $${idx}`);
      params.push(shiftType);
      idx++;
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           sr.id, sr.vehicle_id, sr.reg_number, sr.name_mo,
           sr.report_date, sr.shift_type, sr.object_name,
           sr.kip_pct, sr.movement_pct,
           sr.engine_time_sec, sr.moving_time_sec,
           sr.distance_km, sr.onsite_min,
           sr.trips_count, sr.work_type,
           sr.request_numbers, sr.pl_id,
           COALESCE(avg_load.avg_loading_sec, 0) AS avg_loading_dwell_sec,
           COALESCE(avg_unload.avg_unloading_sec, 0) AS avg_unloading_dwell_sec
         FROM dump_trucks.shift_records sr
         LEFT JOIN LATERAL (
           SELECT AVG(ze.duration_sec) AS avg_loading_sec
           FROM dump_trucks.zone_events ze
           WHERE ze.vehicle_id = sr.vehicle_id
             AND ze.report_date = sr.report_date
             AND ze.shift_type = sr.shift_type
             AND ze.object_uid = sr.object_uid
             AND ze.zone_tag = 'dt_loading'
         ) avg_load ON true
         LEFT JOIN LATERAL (
           SELECT AVG(ze.duration_sec) AS avg_unloading_sec
           FROM dump_trucks.zone_events ze
           WHERE ze.vehicle_id = sr.vehicle_id
             AND ze.report_date = sr.report_date
             AND ze.shift_type = sr.shift_type
             AND ze.object_uid = sr.object_uid
             AND ze.zone_tag = 'dt_unloading'
         ) avg_unload ON true
         WHERE ${conditions.join(' AND ')}
         ORDER BY sr.report_date, sr.reg_number, sr.shift_type`,
        params,
      );
      console.log('[queryDumpTruckData] result:', { success: true, count: rows.length });
      return { success: true, count: rows.length, data: rows };
    } catch (err) {
      console.error('[queryDumpTruckData] error:', err);
      return { success: false, error: String(err) };
    }
  },
});

export const queryDumpTruckTrips = tool({
  description:
    'Получить детализацию рейсов самосвала: каждый рейс с зонами погрузки/выгрузки, ' +
    'длительностью, временем в пути до выгрузки и возврата на погрузку. ' +
    'Источник: dump_trucks.trips + dump_trucks.zone_events.',
  inputSchema: z.object({
    shiftRecordId: z.number().optional().describe('ID записи смены (shift_records.id)'),
    dateFrom: z.string().optional().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().optional().describe('Конец периода, формат YYYY-MM-DD'),
    regNumber: z.string().optional().describe('Госномер'),
  }),
  execute: async ({ shiftRecordId, dateFrom, dateTo, regNumber }) => {
    console.log('[queryDumpTruckTrips]', { shiftRecordId, dateFrom, dateTo, regNumber });
    const pool = getPg17();

    try {
      let tripsQuery: string;
      let params: unknown[];

      if (shiftRecordId) {
        tripsQuery = `SELECT * FROM dump_trucks.trips WHERE shift_record_id = $1 ORDER BY trip_number`;
        params = [shiftRecordId];
      } else {
        tripsQuery = `
          SELECT t.* FROM dump_trucks.trips t
          JOIN dump_trucks.shift_records sr ON t.shift_record_id = sr.id
          WHERE sr.report_date >= $1 AND sr.report_date <= $2
            AND sr.reg_number = $3
          ORDER BY sr.report_date, t.trip_number`;
        params = [dateFrom, dateTo, regNumber];
      }

      const { rows: trips } = await pool.query(tripsQuery, params);
      console.log('[queryDumpTruckTrips] result:', { success: true, count: trips.length });
      return { success: true, count: trips.length, data: trips };
    } catch (err) {
      console.error('[queryDumpTruckTrips] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
