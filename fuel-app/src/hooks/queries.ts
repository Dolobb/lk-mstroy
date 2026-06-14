import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { atz, outbox, syncMeta, vehicles } from "../db/schema";
import { normalizeGosNumber } from "../sync/normalize";
import { db } from "../sync/services";

/**
 * Реактивные чтения локального кэша (drizzle `useLiveQuery`, перерисовка при изменении БД —
 * `enableChangeListener: true` уже включён в client). Экраны читают только отсюда, не из БД напрямую.
 */

/** Активные АТЗ водителя (для экрана старта смены). */
export function useDriverAtz() {
  return useLiveQuery(db.select().from(atz).where(eq(atz.isActive, true)).orderBy(asc(atz.gosNumber)));
}

/** Один АТЗ (госномер/название/остаток) — для рабочего режима. */
export function useAtz(atzId: string | null) {
  return useLiveQuery(db.select().from(atz).where(eq(atz.id, atzId ?? "")), [atzId]);
}

/** Текущая открытая смена ({shiftId, atzId} JSON в sync_meta, ставится при старте). */
export function useCurrentShift() {
  return useLiveQuery(db.select().from(syncMeta).where(eq(syncMeta.key, "currentShift")));
}

/** Поиск ТС по госномеру (нормализованная подстрока — можно искать по любой части номера). Пустой запрос → пусто. */
export function useVehicleSearch(query: string) {
  const norm = normalizeGosNumber(query);
  return useLiveQuery(
    db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.isActive, true), norm.length > 0 ? like(vehicles.gosNumberNorm, `%${norm}%`) : eq(vehicles.id, "")))
      .orderBy(asc(vehicles.gosNumber))
      .limit(50),
    [norm]
  );
}

/** События смены (выдачи/получения) для таблицы рабочего режима, новые сверху. */
export function useShiftEvents(shiftId: string | null) {
  return useLiveQuery(
    db
      .select()
      .from(outbox)
      .where(
        and(eq(outbox.shiftId, shiftId ?? ""), inArray(outbox.type, ["dispense_upsert", "receipt_upsert"]))
      )
      .orderBy(desc(outbox.happenedAtClient)),
    [shiftId]
  );
}
