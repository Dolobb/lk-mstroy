import { eq } from "drizzle-orm";

import { atz, organizations, shifts, syncMeta, vehicles } from "../db/schema";
import { normalizeGosNumber } from "./normalize";
import type { SqliteDb } from "./outbox";
import type { AtzBalance, BootstrapData } from "./types";

export type { BootstrapData };

const SINCE_KEY = "bootstrapSince";

/** Курсор дельты: значение `serverTime` последнего успешного bootstrap (или null — первый раз). */
export async function getBootstrapSince(db: SqliteDb): Promise<string | null> {
  const rows = await db.select().from(syncMeta).where(eq(syncMeta.key, SINCE_KEY)).limit(1);
  return rows[0]?.value ?? null;
}

/**
 * Применить ответ `/bootstrap`:
 * - organizations / vehicles / atz — дельта-upsert по id (что пришло, то обновили; ничего не удаляем);
 * - vehicles — пересчитать `gosNumberNorm` для поиска;
 * - shifts — ПОЛНАЯ замена (сервер всегда отдаёт последние 30 смены водителя, не дельту);
 * - курсор `bootstrapSince := serverTime`.
 *
 * Без транзакции: кэш справочников идемпотентно перезаливается при каждом bootstrap,
 * частичный сбой самовосстанавливается на следующем проходе.
 */
export async function applyBootstrap(db: SqliteDb, data: BootstrapData): Promise<void> {
  for (const o of data.organizations) {
    await db
      .insert(organizations)
      .values(o)
      .onConflictDoUpdate({ target: organizations.id, set: { name: o.name, kind: o.kind, source: o.source } });
  }

  for (const v of data.vehicles) {
    const gosNumberNorm = normalizeGosNumber(v.gosNumber);
    await db
      .insert(vehicles)
      .values({ ...v, gosNumberNorm })
      .onConflictDoUpdate({
        target: vehicles.id,
        set: {
          gosNumber: v.gosNumber,
          gosNumberNorm,
          mark: v.mark,
          vehicleType: v.vehicleType,
          organizationId: v.organizationId,
          source: v.source,
          isActive: v.isActive,
        },
      });
  }

  for (const a of data.atz) {
    await db
      .insert(atz)
      .values(a)
      .onConflictDoUpdate({
        target: atz.id,
        set: { gosNumber: a.gosNumber, title: a.title, remainingLiters: a.remainingLiters, isActive: a.isActive },
      });
  }

  // Смены — полная замена последних 30.
  await db.delete(shifts);
  if (data.shifts.length > 0) {
    await db.insert(shifts).values(data.shifts);
  }

  await db
    .insert(syncMeta)
    .values({ key: SINCE_KEY, value: data.serverTime })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value: data.serverTime } });
}

/** Применить авторитетные остатки АТЗ (из ответа `/sync`) к локальному кэшу. */
export async function applyAtzBalances(db: SqliteDb, balances: AtzBalance[]): Promise<void> {
  for (const b of balances) {
    await db.update(atz).set({ remainingLiters: b.remainingLiters }).where(eq(atz.id, b.atzId));
  }
}
