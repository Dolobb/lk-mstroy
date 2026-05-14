import { Pool } from 'pg';

let pool: Pool | null = null;
let kipPool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'mstroy',
      user: process.env.DB_USER || 'max',
      password: process.env.DB_PASSWORD || '',
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[analytics-backend] Unexpected PG pool error', err);
    });
  }
  return pool;
}

export function getKipPool(): Pool {
  if (!kipPool) {
    kipPool = new Pool({
      host: process.env.KIP_DB_HOST || 'localhost',
      port: Number(process.env.KIP_DB_PORT || 5432),
      database: process.env.KIP_DB_NAME || 'kip_vehicles',
      user: process.env.KIP_DB_USER || 'max',
      password: process.env.KIP_DB_PASSWORD || '',
      max: 5,
      idleTimeoutMillis: 30000,
    });
    kipPool.on('error', (err) => {
      console.error('[analytics-backend] Unexpected KIP pool error', err);
    });
  }
  return kipPool;
}

export async function closePools(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
  if (kipPool) { await kipPool.end(); kipPool = null; }
}
