import { Pool } from 'pg';
import { getEnvConfig } from './env';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getEnvConfig();
    pool = new Pool({
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      logger.error('Unexpected PG pool error', err);
    });
  }
  return pool;
}

// ─── Main pool (mstroy DB) for geo.zones access ──────────────────────────────

let mainPool: Pool | null = null;

export function getMainPool(): Pool {
  if (!mainPool) {
    mainPool = new Pool({
      host: process.env.MAIN_DB_HOST || 'localhost',
      port: Number(process.env.MAIN_DB_PORT || 5432),
      database: process.env.MAIN_DB_NAME || 'mstroy',
      user: process.env.MAIN_DB_USER || 'postgres',
      password: process.env.MAIN_DB_PASSWORD || process.env.DB_PASSWORD || '',
      max: 3,
      idleTimeoutMillis: 60000,
    });
    mainPool.on('error', (err) => {
      logger.error('Unexpected mainPool error', err);
    });
  }
  return mainPool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
  if (mainPool) { await mainPool.end(); mainPool = null; }
}
