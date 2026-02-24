import { getPool } from '../config/database';
import type { TisRouteList } from '../types/tis-api';
import { parseDdMmYyyy, parseDdMmYyyyHhmm } from '../utils/dateFormat';
import { extractRequestNumber } from '../services/plParser';

export async function upsertRouteList(pl: TisRouteList): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Upsert route_lists
    const rlResult = await client.query(
      `INSERT INTO route_lists (pl_id, ts_number, ts_type, date_out, date_out_plan, date_in_plan, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pl_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         date_out_plan = EXCLUDED.date_out_plan,
         date_in_plan = EXCLUDED.date_in_plan
       RETURNING id`,
      [
        pl.id,
        pl.tsNumber,
        pl.tsType,
        parseDdMmYyyy(pl.dateOut),
        parseDdMmYyyyHhmm(pl.dateOutPlan),
        parseDdMmYyyyHhmm(pl.dateInPlan),
        pl.status,
      ],
    );

    const routeListId = rlResult.rows[0].id;

    // Delete old calcs and vehicles (re-insert fresh)
    await client.query('DELETE FROM pl_calcs WHERE route_list_id = $1', [routeListId]);
    await client.query('DELETE FROM vehicles WHERE route_list_id = $1', [routeListId]);

    // Insert calcs
    for (const calc of pl.calcs) {
      const reqNum = extractRequestNumber(calc.orderDescr);
      await client.query(
        `INSERT INTO pl_calcs (route_list_id, order_descr, extracted_request_number, object_expend, driver_task, id_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [routeListId, calc.orderDescr, reqNum, calc.objectExpend, calc.driverTask, calc.idOrder ?? null],
      );
    }

    // Insert vehicles
    for (const ts of pl.ts) {
      await client.query(
        `INSERT INTO vehicles (route_list_id, id_mo, reg_number, name_mo, category, garage_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [routeListId, ts.idMO, ts.regNumber, ts.nameMO, ts.category, ts.garageNumber],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertRouteLists(pls: TisRouteList[]): Promise<void> {
  for (const pl of pls) {
    await upsertRouteList(pl);
  }
}
