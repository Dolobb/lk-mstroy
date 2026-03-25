import { Pool } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPg17(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.pg17.host,
      port: config.pg17.port,
      database: config.pg17.database,
      user: config.pg17.user,
      max: 5,
    });
  }
  return pool;
}

export async function closePg17(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
