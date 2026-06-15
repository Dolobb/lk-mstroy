import type { SyncEvent } from "./types";

/**
 * Клиентская валидация литров — ЗЕРКАЛО серверного `litersSchema` (sync.types.ts):
 * > 0, ≤ 99999.99, не более 2 знаков после запятой.
 *
 * Зачем на клиенте: сервер валидирует весь батч `POST /sync` через `zod.strict().parse()` —
 * ОДНО невалидное событие роняет ВЕСЬ запрос (400), и тогда вся outbox-очередь встаёт колом
 * («/sync: validation error», синк не проходит). Поэтому невалидное не должно ни попасть в outbox
 * (проверка в mutations), ни уйти в запрос (карантин в pushOutbox).
 */
export const MAX_LITERS = 99999.99;

/** Причина невалидности литров (строка для UI/lastError) либо null, если ок. */
export function litersError(liters: unknown): string | null {
  if (typeof liters !== "number" || !Number.isFinite(liters) || liters <= 0 || liters > MAX_LITERS) {
    return `Литры: допустимо от 0.01 до ${MAX_LITERS}`;
  }
  if (Math.abs(Math.round(liters * 100) - liters * 100) > 1e-6) {
    return "Литры: не более 2 знаков после запятой";
  }
  return null;
}

/** Бросает при невалидных литрах (для mutations — до постановки события в outbox). */
export function assertValidLiters(liters: number): void {
  const err = litersError(liters);
  if (err) throw new Error(err);
}

/**
 * Проверка события ПЕРЕД отправкой в `/sync`. Возвращает причину карантина или null.
 * Сейчас критичный вектор «отравления» батча — литры (выдача/получение); остальные поля
 * рождаются строго типизированными в mutations.
 */
export function validateSyncEvent(event: SyncEvent): string | null {
  switch (event.type) {
    case "dispense_upsert":
    case "receipt_upsert":
      return litersError(event.liters);
    default:
      return null;
  }
}
