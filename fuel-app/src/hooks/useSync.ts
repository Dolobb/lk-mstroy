import { useCallback } from "react";

import { useSyncStatusStore } from "../stores/sync-status";
import { runSync } from "../sync/engine";
import { api, db, outboxStore, photoQueue } from "../sync/services";
import { getOrCreateDeviceId } from "../sync/session";

/**
 * Сетевой/TLS-сбой (нет связи, VPN-флап, обрыв хендшейка) — это НОРМА офлайн-режима, а не ошибка:
 * данные в outbox целы и уедут позже. Не пугаем водителя красной «Ошибкой» — показываем «Очередь».
 */
function isNetworkError(message: string): boolean {
  return /network request failed|fetch failed|sslhandshake|handshake|timed out|timeout|unable to resolve host|connection (closed|reset|refused|aborted)|econn|enotfound|abort|failed to fetch/i.test(
    message,
  );
}

/**
 * Запуск полного прохода синка + отражение статуса в `sync-pill`.
 * Вызывается: при выходе приложения на передний план, после каждой мутации (enqueue),
 * по интервалу и при возврате сети. Ошибка НЕ бросается наружу как фатальная —
 * статус 'error', но локальный ввод продолжает работать (синк — фоновая мелочь).
 */
export function useSync() {
  const setStatus = useSyncStatusStore((s) => s.set);

  const sync = useCallback(async () => {
    setStatus({ state: "syncing" });
    try {
      const deviceId = await getOrCreateDeviceId();
      const result = await runSync({ db, store: outboxStore, photos: photoQueue, api, deviceId });
      const pending = await outboxStore.pendingCount();
      setStatus({ state: pending > 0 ? "queued" : "synced", pending, lastError: null });
      return result;
    } catch (err) {
      // Видимость причины при отладке (Metro/Console) — иначе ошибка тонет в сторе.
      console.error("[sync] failed:", err);
      const pending = await outboxStore.pendingCount();
      const message = err instanceof Error ? err.message : String(err);
      // Сетевой сбой → «Очередь» (данные целы, уедут позже), а не пугающая «Ошибка».
      if (isNetworkError(message)) {
        setStatus({ state: "queued", pending, lastError: null });
      } else {
        setStatus({ state: "error", pending, lastError: message });
      }
      return null;
    }
  }, [setStatus]);

  return { sync };
}
