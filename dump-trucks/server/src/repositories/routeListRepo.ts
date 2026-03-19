import { Pool } from 'pg';
import type { TisRouteList } from '../types/tis-api';
import { extractRequestNumber } from '../services/plParser';
import { parseDdMmYyyyHhmm, parseDdMmYyyy } from '../utils/dateFormat';

export interface RouteListRecord {
  id: number;
  tsNumber: number;
  dateOut: Date | null;
  dateOutPlan: Date;
  dateInPlan: Date;
  status: string;
  vehicleIds: number[];
  requestNumbers: number[];
  objectExpends: string[];
  rawJson: TisRouteList;
}

/**
 * Upsert ПЛ из TIS в таблицу route_lists.
 * Сохраняет ВСЕ ТС (без фильтрации по типу) — фильтрация при parse.
 */
export async function upsertRouteLists(
  pool: Pool,
  routeLists: TisRouteList[],
): Promise<number> {
  let count = 0;

  for (const pl of routeLists) {
    const dateOutPlan = parseDdMmYyyyHhmm(pl.dateOutPlan);
    const dateInPlan  = parseDdMmYyyyHhmm(pl.dateInPlan);
    if (!dateOutPlan || !dateInPlan) continue;

    const dateOut = parseDdMmYyyy(pl.dateOut);

    const vehicleIds = (pl.ts || []).map(t => t.idMO);

    const requestNumbers: number[] = [];
    const objectExpends: string[] = [];
    for (const calc of pl.calcs || []) {
      const num = extractRequestNumber(calc.orderDescr);
      if (num !== null && !requestNumbers.includes(num)) {
        requestNumbers.push(num);
      }
      if (calc.objectExpend && !objectExpends.includes(calc.objectExpend)) {
        objectExpends.push(calc.objectExpend);
      }
    }

    await pool.query(`
      INSERT INTO dump_trucks.route_lists (
        id, ts_number, date_out, date_out_plan, date_in_plan,
        status, vehicle_ids, request_numbers, object_expends,
        raw_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (id) DO UPDATE SET
        ts_number       = EXCLUDED.ts_number,
        date_out        = EXCLUDED.date_out,
        date_out_plan   = EXCLUDED.date_out_plan,
        date_in_plan    = EXCLUDED.date_in_plan,
        status          = EXCLUDED.status,
        vehicle_ids     = EXCLUDED.vehicle_ids,
        request_numbers = EXCLUDED.request_numbers,
        object_expends  = EXCLUDED.object_expends,
        raw_json        = EXCLUDED.raw_json,
        updated_at      = NOW()
    `, [
      pl.id,
      pl.tsNumber,
      dateOut,
      dateOutPlan,
      dateInPlan,
      pl.status,
      vehicleIds,
      requestNumbers,
      objectExpends,
      JSON.stringify(pl),
    ]);

    count++;
  }

  return count;
}

/**
 * Запрос ПЛ из БД с перекрытием дат для заданной смены.
 * Минимум 2 часа перекрытия — отсекает «хвосты» вчерашних ПЛ
 * (ПЛ 08:00→08:00, смена 07:30 → 30-мин перекрытие = отброшено).
 * Исключает NOTUSED.
 */
export async function queryRouteListsForShift(
  pool: Pool,
  shiftStart: Date,
  shiftEnd: Date,
): Promise<RouteListRecord[]> {
  const { rows } = await pool.query(`
    SELECT
      id, ts_number, date_out, date_out_plan, date_in_plan,
      status, vehicle_ids, request_numbers, object_expends, raw_json
    FROM dump_trucks.route_lists
    WHERE date_out_plan < $2
      AND date_in_plan  > $1
      AND LEAST(date_in_plan, $2::timestamp) - GREATEST(date_out_plan, $1::timestamp) >= interval '2 hours'
      AND status NOT IN ('NOTUSED')
    ORDER BY date_out_plan
  `, [shiftStart, shiftEnd]);

  return rows.map(r => ({
    id:             r.id,
    tsNumber:       r.ts_number,
    dateOut:        r.date_out,
    dateOutPlan:    r.date_out_plan,
    dateInPlan:     r.date_in_plan,
    status:         r.status,
    vehicleIds:     r.vehicle_ids,
    requestNumbers: r.request_numbers,
    objectExpends:  r.object_expends,
    rawJson:        r.raw_json,
  }));
}
