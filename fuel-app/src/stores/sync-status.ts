import { create } from "zustand";

/**
 * Состояние индикатора синка (`sync-pill` из app.css):
 * idle/synced — всё отправлено · syncing — идёт проход · queued — есть несинхронизированное ·
 * error — последняя попытка не удалась (показываем, но ввод не блокируем).
 */
export type SyncUiState = "idle" | "syncing" | "synced" | "queued" | "error";

interface SyncStatusState {
  state: SyncUiState;
  pending: number;
  lastError: string | null;
  set: (patch: Partial<Pick<SyncStatusState, "state" | "pending" | "lastError">>) => void;
}

export const useSyncStatusStore = create<SyncStatusState>((set) => ({
  state: "idle",
  pending: 0,
  lastError: null,
  set: (patch) => set(patch),
}));
