import type { SyncApi } from "../api/client";
import type { OutboxStore } from "./outbox";
import type { AtzBalance, SyncEvent, SyncRequest } from "./types";

/** Собрать запрос `/sync` из строк outbox: `payload` уже = канонический строгий event. */
export function buildSyncRequest(
  deviceId: string,
  rows: { payload: string }[]
): SyncRequest {
  return { deviceId, events: rows.map((r) => JSON.parse(r.payload) as SyncEvent) };
}

export interface PushResult {
  /** сколько строк ушло в этот проход */
  sent: number;
  /** авторитетные остатки АТЗ с сервера (применяет вызывающий к локальному кэшу) */
  balances: AtzBalance[];
}

/**
 * Push-полупроход синка: outbox → `POST /sync` → применить результаты по id.
 *
 * Гарантии:
 * - пустой outbox → нет сетевого вызова;
 * - успех → applied/conflict/error разложены по строкам; «зависшие» in_flight (id не пришёл
 *   в результатах) возвращаются в pending;
 * - обрыв/ошибка → ВСЕ забранные строки возвращаются в pending (releaseInFlight) и ошибка
 *   пробрасывается — потерь нет, переотправится с тем же id (сервер upsert → без дублей).
 */
export async function pushOutbox(
  store: OutboxStore,
  api: SyncApi,
  deviceId: string
): Promise<PushResult> {
  const rows = await store.claimBatch();
  if (rows.length === 0) return { sent: 0, balances: [] };

  try {
    const response = await api.sync(buildSyncRequest(deviceId, rows));
    await store.applyResults(response.results);
    await store.releaseInFlight();
    return { sent: rows.length, balances: response.atzBalances };
  } catch (err) {
    await store.releaseInFlight();
    throw err;
  }
}
