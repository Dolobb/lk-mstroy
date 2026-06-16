import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { openDatabaseSync } from "expo-sqlite";

import migrations from "../../drizzle/migrations";
import * as schema from "./schema";

export const sqlite = openDatabaseSync("fuelapp.db", {
  enableChangeListener: true,
});

export const db = drizzle(sqlite, { schema });

export function useDbMigrations() {
  return useMigrations(db, migrations);
}
