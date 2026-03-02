import pg, { Pool } from 'pg';
import { getEnvConfig } from './env';

// Return DATE columns as plain strings ("YYYY-MM-DD"), not JS Date objects.
pg.types.setTypeParser(1082, (val: string) => val);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getEnvConfig();
    pool = new Pool({
      host:              config.dbHost,
      port:              config.dbPort,
      database:          config.dbName,
      user:              config.dbUser,
      password:          config.dbPassword,
      max:               10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[PG] Unexpected pool error', err);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
