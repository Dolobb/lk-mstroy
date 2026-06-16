// Общие строительные блоки для админских write-операций (закрытие смены, правка событий).
//
// Инварианты — те же, что в services/sync.ts (этот файл sync.ts НЕ импортирует и НЕ редактирует):
// - Остаток АТЗ — инкрементальный running tally: применяем ДЕЛЬТУ, а не пересчёт с нуля,
//   иначе затрётся ручная psql-калибровка.
// - Любая мутация остатка бампает atz.updated_at → планшеты увидят новый остаток через /bootstrap.
// - Каждая правка пишет before/after в event_edits.
//
// Знаки дельты (зеркало sync.ts): dispense уменьшает остаток, receipt увеличивает.
// Вычисление знака — на стороне вызывающего эндпоинта; сюда приходит уже знаковая дельта в центилитрах.

import { eq, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { atz, eventEdits } from "../db/schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EventEditType = "shift" | "dispense" | "receipt";

export function toCenti(liters: number): number {
  return Math.round(liters * 100);
}

export function numericToCenti(value: string | null): number {
  return value === null ? 0 : Math.round(Number(value) * 100);
}

export function toNumeric(liters: number): string {
  return liters.toFixed(2);
}

/**
 * Применяет знаковую дельту (в центилитрах) к остатку АТЗ и бампает updated_at.
 * Вызывать только при deltaCenti !== 0 — нулевая дельта не должна двигать updated_at напрасно.
 */
export async function applyAtzDelta(tx: Tx, atzId: string, deltaCenti: number): Promise<void> {
  await tx
    .update(atz)
    .set({
      remainingLiters: sql`${atz.remainingLiters} + ${toNumeric(deltaCenti / 100)}::numeric`,
      updatedAt: new Date()
    })
    .where(eq(atz.id, atzId));
}

/** Запись before/after в журнал правок. */
export async function writeEventEdit(
  tx: Tx,
  entry: {
    eventId: string;
    eventType: EventEditType;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }
): Promise<void> {
  await tx.insert(eventEdits).values({
    eventId: entry.eventId,
    eventType: entry.eventType,
    before: entry.before,
    after: entry.after
  });
}
