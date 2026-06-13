import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "../db/schema";

/**
 * In-memory БД для unit-тестов sync-ядра. Использует ТЕ ЖЕ drizzle-миграции (`drizzle/*.sql`),
 * что и приложение на устройстве — драйвер другой (better-sqlite3 вместо expo-sqlite), но
 * схема (`sqlite-core`) и SQL общие. Так тесты гоняются без планшета, но проверяют реальную схему.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(join(dir, file), "utf8"));
  }
  return drizzle(sqlite, { schema });
}
