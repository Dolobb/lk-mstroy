import type { FuelApi, SyncApi } from "../api/client";
import { applyAtzBalances, applyBootstrap, getBootstrapSince } from "./bootstrap";
import type { OutboxRow, OutboxStore, SqliteDb } from "./outbox";
import type { PhotoQueueStore } from "./photos";
import type { AtzBalance, SyncEvent, SyncRequest } from "./types";
import { validateSyncEvent } from "./validate";

/** Собрать запрос `/sync` из строк outbox: `payload` уже = канонический строгий event. */
export function buildSyncRequest(deviceId: string, rows: { payload: string }[]): SyncRequest {
  return { deviceId, events: rows.map((r) => JSON.parse(r.payload) as SyncEvent) };
}

export interface PushResult {
  /** сколько строк ушло в этот проход */
  sent: number;
  /** авторитетные остатки АТЗ с сервера */
  balances: AtzBalance[];
}

/**
 * Push-полупроход: outbox → `POST /sync` → применить результаты по id.
 * Пусто → нет вызова. Успех → applied/conflict/error по строкам + зависшие in_flight назад в pending.
 * Обрыв → ВСЕ забранные строки назад в pending (releaseInFlight) и ошибка проброшена (без потерь).
 */
export async function pushOutbox(store: OutboxStore, api: SyncApi, deviceId: string): Promise<PushResult> {
  const rows = await store.claimBatch();
  if (rows.length === 0) return { sent: 0, balances: [] };

  // Карантин невалидного ПЕРЕД отправкой: сервер валидирует весь батч `.strict().parse()` — одно
  // битое событие (напр. литры вне диапазона) роняет ВЕСЬ `/sync` (400) и клинит очередь навсегда.
  // Отсеиваем такие в conflict(client_invalid), валидное — шлём.
  const valid: OutboxRow[] = [];
  for (const r of rows) {
    const reason = validateSyncEvent(JSON.parse(r.payload) as SyncEvent);
    if (reason) await store.markInvalid(r.id, reason);
    else valid.push(r);
  }
  if (valid.length === 0) {
    await store.releaseInFlight();
    return { sent: 0, balances: [] };
  }

  try {
    const response = await api.sync(buildSyncRequest(deviceId, valid));
    await store.applyResults(response.results);
    await store.releaseInFlight();
    return { sent: valid.length, balances: response.atzBalances };
  } catch (err) {
    await store.releaseInFlight();
    throw err;
  }
}

export interface SyncDeps {
  db: SqliteDb;
  store: OutboxStore;
  photos: PhotoQueueStore;
  api: FuelApi;
  deviceId: string;
}

export interface RunSyncResult {
  pushed: number;
  uploaded: number;
  photoErrors: number;
}

/**
 * Полный проход синка:
 *  1) push outbox → применить серверные остатки АТЗ к локальному кэшу;
 *  2) фото-очередь — грузим только подтверждённые receipt'ы (claimReady гарантирует), ошибка одного
 *     фото не валит проход;
 *  3) дельта `/bootstrap` (pull справочников/смен/остатков).
 * Сетевой обрыв на push/bootstrap пробрасывается — данные не теряются (переотправятся с тем же id).
 */
export async function runSync(deps: SyncDeps): Promise<RunSyncResult> {
  const { db, store, photos, api, deviceId } = deps;

  const push = await pushOutbox(store, api, deviceId);
  if (push.balances.length > 0) await applyAtzBalances(db, push.balances);

  const ready = await photos.claimReady();
  let uploaded = 0;
  let photoErrors = 0;
  for (const photo of ready) {
    try {
      await api.uploadTtn(photo.receiptId, photo.localUri);
      await photos.markUploaded(photo.receiptId);
      uploaded += 1;
    } catch (err) {
      await photos.markFailed(photo.receiptId, err instanceof Error ? err.message : String(err));
      photoErrors += 1;
    }
  }

  const data = await api.bootstrap(await getBootstrapSince(db));
  await applyBootstrap(db, data);

  return { pushed: push.sent, uploaded, photoErrors };
}
