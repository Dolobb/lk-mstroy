import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getPool } from '../config/database';
import type { ParsedRequest, VehicleRequestRow } from '../types/domain';

const customersMap: Record<string, string> = JSON.parse(
  readFileSync(resolve(__dirname, '../../../config/customers.json'), 'utf-8'),
);

export async function getRequestsForVehicle(
  vehicleId: string,
  from: string,
  to: string,
): Promise<VehicleRequestRow[]> {
  const pool = getPool();

  // Get id_order values linked to this vehicle for the period
  const calcsResult = await pool.query(
    `SELECT DISTINCT pc.extracted_request_number, pc.id_order
     FROM pl_calcs pc
     JOIN route_lists rl ON rl.id = pc.route_list_id
     JOIN vehicles v ON v.route_list_id = rl.id
     WHERE UPPER(v.reg_number) = UPPER($1)
       AND rl.date_out BETWEEN $2 AND $3
       AND pc.extracted_request_number IS NOT NULL`,
    [vehicleId, from, to],
  );

  // Build map: request_number -> id_order[]
  const orderMap = new Map<number, number[]>();
  for (const row of calcsResult.rows) {
    const reqNum = Number(row.extracted_request_number);
    const idOrder = row.id_order != null ? Number(row.id_order) : null;
    if (!orderMap.has(reqNum)) orderMap.set(reqNum, []);
    if (idOrder != null) orderMap.get(reqNum)!.push(idOrder);
  }

  const reqNumbers = Array.from(orderMap.keys());
  if (reqNumbers.length === 0) return [];

  const result = await pool.query(
    `SELECT DISTINCT ON (r.number)
       r.request_id,
       r.number,
       r.status,
       r.date_create::text AS date_create,
       r.contact_person,
       COALESCE(r.raw_json->>'objectName', '') AS object_name,
       r.raw_json
     FROM requests r
     WHERE r.number = ANY($1::int[])
     ORDER BY r.number, r.date_create DESC NULLS LAST`,
    [reqNumbers],
  );

  return result.rows.map(row => {
    const num = Number(row.number);
    const idOrders = orderMap.get(num) ?? [];
    const rawJson = row.raw_json as Record<string, unknown> | null;
    const orders = (rawJson?.orders ?? []) as Array<Record<string, unknown>>;

    // Find matching order by id_order
    let typeOfWork = '';
    let objectExpendName = '';
    if (idOrders.length > 0 && orders.length > 0) {
      const matchedOrder = orders.find((o: Record<string, unknown>) => idOrders.includes(Number(o.id)));
      if (matchedOrder) {
        typeOfWork = String(matchedOrder.typeOfWork ?? '');
        const objExp = matchedOrder.objectExpend as Record<string, unknown> | undefined;
        objectExpendName = String(objExp?.name ?? '');
      }
    }
    // Fallback: use first order if no match
    if (!typeOfWork && !objectExpendName && orders.length > 0) {
      typeOfWork = String(orders[0].typeOfWork ?? '');
      const objExp = orders[0].objectExpend as Record<string, unknown> | undefined;
      objectExpendName = String(objExp?.name ?? '');
    }

    const idOwnCustomer = rawJson?.idOwnCustomer != null ? Number(rawJson.idOwnCustomer) : null;
    const customerName = idOwnCustomer != null
      ? (customersMap[String(idOwnCustomer)] ?? String(idOwnCustomer))
      : '';

    return {
      request_id: Number(row.request_id),
      number: num,
      status: row.status,
      date_create: row.date_create,
      contact_person: row.contact_person || '',
      object_name: row.object_name || '',
      id_own_customer: idOwnCustomer,
      customer_name: customerName,
      type_of_work: typeOfWork,
      object_expend_name: objectExpendName,
    };
  });
}

export async function upsertRequests(requests: ParsedRequest[]): Promise<void> {
  const pool = getPool();

  for (const req of requests) {
    await pool.query(
      `INSERT INTO requests (request_id, number, status, date_create, date_processed, contact_person, raw_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (request_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         date_processed = EXCLUDED.date_processed,
         contact_person = EXCLUDED.contact_person,
         raw_json = EXCLUDED.raw_json`,
      [
        req.requestId,
        req.number,
        req.status,
        req.dateCreate,
        req.dateProcessed,
        req.contactPerson,
        JSON.stringify(req.rawJson),
      ],
    );
  }
}
