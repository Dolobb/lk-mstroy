import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { outbox } from "../db/schema";
import type { SyncEvent, SyncResult } from "./types";

/**
 * Любой drizzle-sqlite handle: expo-sqlite в приложении, better-sqlite3 в тестах.
 * Запросы типобезопасны через переданные таблицы, поэтому схема-дженерик здесь = any.
 */
export type SqliteDb = BaseSQLiteDatabase<any, any, any>;

export type OutboxRow = typeof outbox.$inferSelect;

/** Денорм-поля для запросов/группировки UI. Источник истины при отправке — `payload`. */
function denorm(event: SyncEvent): { shiftId: string | null; happenedAtClient: string | null } {
  switch (event.type) {
    case "dispense_upsert":
    case "receipt_upsert":
      return { shiftId: event.shiftId, happenedAtClient: event.happenedAtClient };
    case "shift_open":
      return { shiftId: event.id, happenedAtClient: event.startedAtClient };
    case "shift_close":
      return { shiftId: event.id, happenedAtClient: event.endedAtClient };
    default:
      return { shiftId: null, happenedAtClient: null };
  }
}

/** Строки, которые можно (пере)отправлять. conflict — терминально до явного retry/правки. */
const RETRYABLE = ["pending", "error"] as const;

/**
 * OutboxStore — журнал локальных мутаций + state-machine отправки (ЯДРО, риск №1).
 *
 * Инвариант: строка НЕ удаляется до ACK сервера. Жизненный цикл:
 *   pending → in_flight → (confirmed | conflict | error)
 * Повторная отправка с тем же `id` на сервере = upsert по UUID → дублей не бывает.
 */
export class OutboxStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Поставить событие в очередь. Создание, правка и удаление — это UPSERT по `id`
   * (один client-UUID): правка/удаление перезаписывают `payload` и возвращают строку в `pending`,
   * сбрасывая прошлый конфликт/ошибку. Время фиксируется вызывающим в МОМЕНТ ВВОДА (внутри payload).
   */
  async enqueue(event: SyncEvent, now: string = new Date().toISOString()): Promise<void> {
    const { shiftId, happenedAtClient } = denorm(event);
    const payload = JSON.stringify(event);
    await this.db
      .insert(outbox)
      .values({
        id: event.id,
        type: event.type,
        payload,
        status: "pending",
        shiftId,
        happenedAtClient,
        createdAt: now,
        updatedAt: now,
        attemptCount: 0,
      })
      .onConflictDoUpdate({
        target: outbox.id,
        set: {
          type: event.type,
          payload,
          status: "pending",
          shiftId,
          happenedAtClient,
          updatedAt: now,
          conflictCode: null,
          lastError: null,
        },
      });
  }

  /**
   * Забрать пачку на отправку: ретраебельные строки (pending|error) → перевод в `in_flight`,
   * `attemptCount++`. Порядок — по созданию; зависимости (org→vehicle→shift→событие) сервер
   * упорядочивает сам. Возвращает строки (уже как in_flight) для сборки запроса.
   */
  async claimBatch(limit = 500, now: string = new Date().toISOString()): Promise<OutboxRow[]> {
    const rows = await this.db
      .select()
      .from(outbox)
      .where(inArray(outbox.status, RETRYABLE as unknown as string[]))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];
    const ids = rows.map((r: OutboxRow) => r.id);
    await this.db
      .update(outbox)
      .set({
        status: "in_flight",
        lastAttemptAt: now,
        updatedAt: now,
        attemptCount: sql`${outbox.attemptCount} + 1`,
      })
      .where(inArray(outbox.id, ids));
    return rows.map((r: OutboxRow) => ({ ...r, status: "in_flight", attemptCount: r.attemptCount + 1 }));
  }

  /**
   * Применить результаты сервера (по `id`, сопоставление — у вызывающего по индексу запроса):
   * applied→confirmed, conflict→conflict+code, error→error. Строки, оставшиеся `in_flight`
   * (их id не пришёл в результатах), возвращаются в pending через releaseInFlight().
   */
  async applyResults(results: SyncResult[], now: string = new Date().toISOString()): Promise<void> {
    for (const r of results) {
      if (r.status === "applied") {
        await this.db
          .update(outbox)
          .set({ status: "confirmed", conflictCode: null, lastError: null, updatedAt: now })
          .where(eq(outbox.id, r.id));
      } else if (r.status === "conflict") {
        await this.db
          .update(outbox)
          .set({ status: "conflict", conflictCode: r.code ?? null, lastError: r.message ?? null, updatedAt: now })
          .where(eq(outbox.id, r.id));
      } else {
        await this.db
          .update(outbox)
          .set({ status: "error", lastError: r.message ?? null, updatedAt: now })
          .where(eq(outbox.id, r.id));
      }
    }
  }

  /**
   * Вернуть «зависшие» `in_flight` обратно в `pending` (обрыв сети, нет ответа, либо id строки
   * не пришёл в результатах). Гарантия отсутствия потерь: неподтверждённое уедет снова с тем же id.
   */
  async releaseInFlight(now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .update(outbox)
      .set({ status: "pending", updatedAt: now })
      .where(eq(outbox.status, "in_flight"));
  }

  /** Перевести конфликт/ошибку обратно в pending (после разрешения зависимости или правки). */
  async retry(id: string, now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .update(outbox)
      .set({ status: "pending", conflictCode: null, lastError: null, updatedAt: now })
      .where(eq(outbox.id, id));
  }

  /** Кол-во несинхронизированных (для индикатора синка). */
  async pendingCount(): Promise<number> {
    const rows = await this.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(inArray(outbox.status, ["pending", "in_flight", "error"]));
    return rows.length;
  }

  /** События смены (выдачи/получения) для таблицы рабочего режима, включая подтверждённые. */
  async eventsForShift(shiftId: string): Promise<OutboxRow[]> {
    return this.db
      .select()
      .from(outbox)
      .where(
        and(eq(outbox.shiftId, shiftId), inArray(outbox.type, ["dispense_upsert", "receipt_upsert"]))
      )
      .orderBy(asc(outbox.happenedAtClient));
  }

  async byId(id: string): Promise<OutboxRow | undefined> {
    const rows = await this.db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
    return rows[0];
  }
}
