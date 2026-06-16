import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { atz, organizations, outbox, shifts, syncMeta, vehicles } from "../db/schema";
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

/** Прошлые смены водителя из bootstrap-кэша (профиль/история), новые сверху. */
export function useShifts() {
  return useLiveQuery(db.select().from(shifts).orderBy(desc(shifts.startedAtClient)).limit(100));
}

/** Все организации (id → имя/вид) — выбор при добавлении ТС, lookup и группировка в передаче. */
export function useOrganizations() {
  return useLiveQuery(db.select().from(organizations).orderBy(asc(organizations.name)));
}

/**
 * Недавние выдачи (по всем сменам), новые сверху — для «быстрого выбора» машины в передаче,
 * когда поиск пуст. Возвращает сырые outbox-строки выдач; вызывающий парсит payload,
 * отбрасывает isDeleted и дедуплицирует по vehicleId, сохраняя порядок «недавности».
 */
export function useRecentDispenses(limit = 40) {
  return useLiveQuery(
    db
      .select({ id: outbox.id, payload: outbox.payload, happenedAtClient: outbox.happenedAtClient })
      .from(outbox)
      .where(eq(outbox.type, "dispense_upsert"))
      .orderBy(desc(outbox.happenedAtClient))
      .limit(limit),
    [limit],
  );
}

/** ТС по набору id (lookup госномеров в таблице операций). Пустой набор → пусто. */
export function useVehiclesByIds(ids: readonly string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const key = unique.slice().sort().join(",");
  return useLiveQuery(
    db
      .select()
      .from(vehicles)
      .where(unique.length > 0 ? inArray(vehicles.id, unique) : eq(vehicles.id, "")),
    [key]
  );
}
