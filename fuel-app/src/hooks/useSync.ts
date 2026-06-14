import { useCallback } from "react";

import { useSyncStatusStore } from "../stores/sync-status";
import { runSync } from "../sync/engine";
import { api, db, outboxStore, photoQueue } from "../sync/services";
import { getOrCreateDeviceId } from "../sync/session";

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
      setStatus({ state: "error", pending, lastError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [setStatus]);

  return { sync };
}
