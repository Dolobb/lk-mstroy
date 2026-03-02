import type { PoolClient, Pool } from 'pg';

export interface OpenRepair {
  id: number;
  dateStart: string;
}

export interface StatusRecord {
  id: number;
  plateNumber: string;
  statusText: string | null;
  isRepairing: boolean;
  dateStart: string;
  dateEnd: string | null;
  daysInRepair: number;
  category: string | null;
  lastCheckDate: string | null;
}

export async function findOpenRepair(
  client: PoolClient,
  plateNumber: string,
): Promise<OpenRepair | null> {
  const result = await client.query<{ id: number; date_start: string }>(
    `SELECT id, date_start
     FROM vehicle_status.status_history
     WHERE plate_number = $1 AND date_end IS NULL
     LIMIT 1`,
    [plateNumber],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { id: row.id, dateStart: row.date_start };
}

export async function insertRepair(
  client: PoolClient,
  data: { plateNumber: string; statusText: string; today: string; category: string },
): Promise<void> {
  await client.query(
    `INSERT INTO vehicle_status.status_history
       (plate_number, status_text, is_repairing, date_start, category, last_check_date)
     VALUES ($1, $2, TRUE, $3, $4, $3)`,
    [data.plateNumber, data.statusText, data.today, data.category],
  );
}

export async function updateRepairProgress(
  client: PoolClient,
  id: number,
  today: string,
  days: number,
  statusText: string,
): Promise<void> {
  await client.query(
    `UPDATE vehicle_status.status_history
     SET last_check_date = $1, days_in_repair = $2, status_text = $3
     WHERE id = $4`,
    [today, days, statusText, id],
  );
}

export async function closeRepair(
  client: PoolClient,
  id: number,
  today: string,
  days: number,
  statusText: string,
): Promise<void> {
  await client.query(
    `UPDATE vehicle_status.status_history
     SET date_end = $1, days_in_repair = $2, is_repairing = FALSE, status_text = $3
     WHERE id = $4`,
    [today, days, statusText, id],
  );
}

export async function queryAll(
  pool: Pool,
  filters: { isRepairing?: boolean; category?: string },
): Promise<StatusRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.isRepairing !== undefined) {
    params.push(filters.isRepairing);
    conditions.push(`is_repairing = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<{
    id: number;
    plate_number: string;
    status_text: string | null;
    is_repairing: boolean;
    date_start: string;
    date_end: string | null;
    days_in_repair: number;
    category: string | null;
    last_check_date: string | null;
  }>(
    `SELECT id, plate_number, status_text, is_repairing, date_start, date_end,
            days_in_repair, category, last_check_date
     FROM vehicle_status.status_history
     ${where}
     ORDER BY is_repairing DESC, last_check_date DESC NULLS LAST, plate_number`,
    params,
  );

  return result.rows.map(r => ({
    id:            r.id,
    plateNumber:   r.plate_number,
    statusText:    r.status_text,
    isRepairing:   r.is_repairing,
    dateStart:     r.date_start,
    dateEnd:       r.date_end,
    daysInRepair:  r.days_in_repair,
    category:      r.category,
    lastCheckDate: r.last_check_date,
  }));
}
