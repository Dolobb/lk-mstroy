import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import { config } from '../config';

let db: Database | null = null;

export async function getSqlite(): Promise<Database> {
  if (!db) {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(config.sqlitePath);
    db = new SQL.Database(buffer);
  }
  return db;
}

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
  }
}
