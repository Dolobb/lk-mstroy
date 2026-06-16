import { eq } from "drizzle-orm";

import { atz, organizations, outbox, shifts, syncMeta, vehicles } from "../db/schema";
import { normalizeGosNumber } from "./normalize";
import type { SqliteDb } from "./outbox";
import type { AtzBalance, BootstrapData, BootstrapShift } from "./types";

export type { BootstrapData };

const SINCE_KEY = "bootstrapSince";

/** Курсор дельты: значение `serverTime` последнего успешного bootstrap (или null — первый раз). */
export async function getBootstrapSince(db: SqliteDb): Promise<string | null> {
  const rows = await db.select().from(syncMeta).where(eq(syncMeta.key, SINCE_KEY)).limit(1);
  return rows[0]?.value ?? null;
}

/**
 * Применить ответ `/bootstrap`:
 * - organizations / vehicles / atz — дельта по `since` (в покое массивы пустые → ни одной записи);
 * - vehicles — пересчитать `gosNumberNorm` для поиска;
 * - shifts — сервер всегда отдаёт последние 30 (НЕ дельта) → reconcile по id, не delete-all;
 * - курсор `bootstrapSince := serverTime` пишем ТОЛЬКО если что-то реально изменилось.
 *
 * ⚠️ Write-minimal специально: `useLiveQuery` перерисовывает экран на КАЖДУЮ запись в его таблицу.
 * Раньше bootstrap каждые 60с безусловно перезаливал `shifts` и двигал курсор в `syncMeta`
 * (его слушает `useCurrentShift`) → рабочий экран дёргался ровно раз в минуту. Теперь в покое
 * (пустые дельты + смены совпали) не пишем НИЧЕГО → ни одного ререндера.
 */
export async function applyBootstrap(db: SqliteDb, data: BootstrapData): Promise<void> {
  let changed = false;

  for (const o of data.organizations) {
    await db
      .insert(organizations)
      .values(o)
      .onConflictDoUpdate({ target: organizations.id, set: { name: o.name, kind: o.kind, source: o.source } });
    changed = true;
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
    changed = true;
  }

  for (const a of data.atz) {
    await db
      .insert(atz)
      .values(a)
      .onConflictDoUpdate({
        target: atz.id,
        set: { gosNumber: a.gosNumber, title: a.title, remainingLiters: a.remainingLiters, isActive: a.isActive },
      });
    changed = true;
  }

  if (await reconcileShifts(db, data.shifts)) changed = true;

  if (changed) {
    await db
      .insert(syncMeta)
      .values({ key: SINCE_KEY, value: data.serverTime })
      .onConflictDoUpdate({ target: syncMeta.key, set: { value: data.serverTime } });
  }
}

type LocalShiftRow = typeof shifts.$inferSelect;

/** Локальная смена расходится с серверной (тогда перезаписываем). Null-нормализация — local nullable, поля сервера — нет. */
function shiftRowDiffers(local: LocalShiftRow | undefined, s: BootstrapShift): boolean {
  if (!local) return true;
  return (
    local.atzId !== s.atzId ||
    (local.atzGosNumber ?? null) !== (s.atzGosNumber ?? null) ||
    local.startedAtClient !== s.startedAtClient ||
    (local.endedAtClient ?? null) !== (s.endedAtClient ?? null) ||
    local.status !== s.status ||
    (local.openingRemainingLiters ?? null) !== (s.openingRemainingLiters ?? null) ||
    (local.closingRemainingLiters ?? null) !== (s.closingRemainingLiters ?? null) ||
    (local.dispenseCount ?? null) !== (s.dispenseCount ?? null) ||
    (local.dispenseLiters ?? null) !== (s.dispenseLiters ?? null) ||
    (local.receiptLiters ?? null) !== (s.receiptLiters ?? null)
  );
}

/**
 * Свести локальные смены с серверными (последние 30):
 * - upsert каждой серверной, что РЕАЛЬНО изменилась (сервер авторитетен);
 * - удалить локальные, которых нет в ответе И чей shift_open уже подтверждён (выпали из окна 30);
 * - сохранить оптимистичные локальные (shift_open ещё не подтверждён = офлайн, не синхронизировано).
 * Возвращает true, если была хоть одна запись (для курсора и понимания «изменилось ли»).
 */
async function reconcileShifts(db: SqliteDb, incoming: BootstrapShift[]): Promise<boolean> {
  const localRows: LocalShiftRow[] = await db.select().from(shifts);
  const localById = new Map(localRows.map((r) => [r.id, r]));
  const incomingIds = new Set(incoming.map((s) => s.id));

  const openEvents = await db
    .select({ id: outbox.id, status: outbox.status })
    .from(outbox)
    .where(eq(outbox.type, "shift_open"));
  const unsynced = new Set(openEvents.filter((e) => e.status !== "confirmed").map((e) => e.id));

  let changed = false;

  for (const s of incoming) {
    if (shiftRowDiffers(localById.get(s.id), s)) {
      await db.insert(shifts).values(s).onConflictDoUpdate({ target: shifts.id, set: s });
      changed = true;
    }
  }

  for (const r of localRows) {
    if (!incomingIds.has(r.id) && !unsynced.has(r.id)) {
      await db.delete(shifts).where(eq(shifts.id, r.id));
      changed = true;
    }
  }

  return changed;
}

/** Применить авторитетные остатки АТЗ (из ответа `/sync`) к локальному кэшу. */
export async function applyAtzBalances(db: SqliteDb, balances: AtzBalance[]): Promise<void> {
  for (const b of balances) {
    await db.update(atz).set({ remainingLiters: b.remainingLiters }).where(eq(atz.id, b.atzId));
  }
}
