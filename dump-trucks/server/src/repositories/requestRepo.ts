import { Pool } from 'pg';
import type { ParsedRequest } from '../services/requestParser';

export async function upsertRequests(
  pool: Pool,
  requests: ParsedRequest[],
): Promise<void> {
  if (requests.length === 0) return;

  for (const req of requests) {
    await pool.query(`
      INSERT INTO dump_trucks.requests (
        request_id, number, status,
        date_create, date_processed,
        contact_person, raw_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (request_id) DO UPDATE SET
        status         = EXCLUDED.status,
        date_processed = EXCLUDED.date_processed,
        raw_json       = EXCLUDED.raw_json,
        updated_at     = NOW()
    `, [
      req.requestId,
      req.number,
      req.status,
      req.dateCreate,
      req.dateProcessed,
      req.contactPerson,
      JSON.stringify(req.rawJson),
    ]);
  }
}
