import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function migrate() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'mstroy',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  // Ensure _migrations tracking table exists (in geo schema)
  // First need the schema itself
  await pool.query('CREATE SCHEMA IF NOT EXISTS geo');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo._migrations (
      name       VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const applied = await pool.query('SELECT name FROM geo._migrations ORDER BY name');
  const appliedSet = new Set(applied.rows.map((r: { name: string }) => r.name));

  // Read migration files
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  skip: ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`  applying: ${file}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO geo._migrations (name) VALUES ($1)', [file]);
    console.log(`  done: ${file}`);
  }

  await pool.end();
  console.log('All migrations applied.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
