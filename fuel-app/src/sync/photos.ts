import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { outbox, photoQueue } from "../db/schema";
import type { SqliteDb } from "./outbox";

export type PhotoRow = typeof photoQueue.$inferSelect;

const RETRYABLE = ["pending", "error"];

/**
 * PhotoQueueStore — отдельная от событий очередь фото ТТН (ЯДРО).
 * Инвариант (§3): фото грузится `POST /uploads/ttn` ТОЛЬКО когда соответствующее
 * receipt-событие уже подтверждено сервером (иначе сервер не знает про receiptId → 404).
 * Поэтому `claimReady()` джойнит outbox и берёт лишь фото для confirmed-receipt'ов.
 * State-machine как у outbox: pending → in_flight → (uploaded | error); строка живёт до загрузки.
 */
export class PhotoQueueStore {
  constructor(private readonly db: SqliteDb) {}

  /** Поставить фото в очередь (ключ — receiptId события; повторное фото перезаписывает). */
  async enqueue(receiptId: string, localUri: string, now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .insert(photoQueue)
      .values({ receiptId, localUri, status: "pending", attemptCount: 0, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: photoQueue.receiptId,
        set: { localUri, status: "pending", updatedAt: now, lastError: null },
      });
  }

  /** Забрать готовые к загрузке (receipt подтверждён) → in_flight, attemptCount++. */
  async claimReady(limit = 5, now: string = new Date().toISOString()): Promise<PhotoRow[]> {
    const ready = await this.db
      .select({
        receiptId: photoQueue.receiptId,
        localUri: photoQueue.localUri,
        status: photoQueue.status,
        attemptCount: photoQueue.attemptCount,
        lastAttemptAt: photoQueue.lastAttemptAt,
        lastError: photoQueue.lastError,
        createdAt: photoQueue.createdAt,
        updatedAt: photoQueue.updatedAt,
      })
      .from(photoQueue)
      .innerJoin(outbox, eq(photoQueue.receiptId, outbox.id))
      .where(and(inArray(photoQueue.status, RETRYABLE), eq(outbox.status, "confirmed")))
      .orderBy(asc(photoQueue.createdAt))
      .limit(limit);
    if (ready.length === 0) return [];
    const ids = ready.map((r) => r.receiptId);
    await this.db
      .update(photoQueue)
      .set({
        status: "in_flight",
        lastAttemptAt: now,
        updatedAt: now,
        attemptCount: sql`${photoQueue.attemptCount} + 1`,
      })
      .where(inArray(photoQueue.receiptId, ids));
    return ready.map((r) => ({ ...r, status: "in_flight", attemptCount: r.attemptCount + 1 }));
  }

  async markUploaded(receiptId: string, now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .update(photoQueue)
      .set({ status: "uploaded", lastError: null, updatedAt: now })
      .where(eq(photoQueue.receiptId, receiptId));
  }

  async markFailed(receiptId: string, message: string, now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .update(photoQueue)
      .set({ status: "error", lastError: message, updatedAt: now })
      .where(eq(photoQueue.receiptId, receiptId));
  }

  /** Вернуть зависшие in_flight в pending (обрыв загрузки) — без потери, переотправится. */
  async releaseInFlight(now: string = new Date().toISOString()): Promise<void> {
    await this.db
      .update(photoQueue)
      .set({ status: "pending", updatedAt: now })
      .where(eq(photoQueue.status, "in_flight"));
  }

  async pendingCount(): Promise<number> {
    const rows = await this.db
      .select({ id: photoQueue.receiptId })
      .from(photoQueue)
      .where(inArray(photoQueue.status, ["pending", "in_flight", "error"]));
    return rows.length;
  }
}
