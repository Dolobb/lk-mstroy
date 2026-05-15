import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'mstroy',
  user: process.env.DB_USER || 'max',
  password: process.env.DB_PASSWORD || '',
});

const MIGRATIONS = [
  '001_schema_analytics.sql',
  '002_track_sessions.sql',
  '003_track_points.sql',
  '004_idx_track_points_vehicle_ts.sql',
  '005_visited_objects.sql',
];

async function initializeMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics.schema_migrations (
      filename varchar PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    )
  `);
}

async function isApplied(filename: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM analytics.schema_migrations WHERE filename = $1`,
    [filename],
  );
  return (res.rowCount ?? 0) > 0;
}

async function recordMigration(filename: string): Promise<void> {
  await pool.query(
    `INSERT INTO analytics.schema_migrations (filename) VALUES ($1)`,
    [filename],
  );
}

async function runMigrations(): Promise<void> {
  console.log('[migrate] Initializing migrations table...');
  await initializeMigrationsTable();

  console.log('[migrate] Starting migrations...');
  for (const file of MIGRATIONS) {
    if (await isApplied(file)) {
      console.log(`[migrate] - ${file} (already applied, skip)`);
      continue;
    }
    const path = join(__dirname, file);
    const sql = readFileSync(path, 'utf-8');
    try {
      await pool.query(sql);
      await recordMigration(file);
      console.log(`[migrate] + ${file}`);
    } catch (err) {
      console.error(`[migrate] x ${file}:`, err);
      throw err;
    }
  }

  console.log('[migrate] All migrations applied successfully.');
  await pool.end();
}

runMigrations().catch(err => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
