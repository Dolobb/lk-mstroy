import { Pool } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function getPg16(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.pg16.host,
      port: config.pg16.port,
      database: config.pg16.database,
      user: config.pg16.user,
      max: 5,
    });
  }
  return pool;
}

export async function closePg16(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
