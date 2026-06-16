import { create } from "zustand";

import type { CachedDriver } from "../sync/session";

/**
 * loading   — проверяем secure-store на старте
 * signed_out — нет кэша → полный вход (логин + PIN, онлайн)
 * locked    — есть кэш → ввод PIN (офлайн-проверка по bcrypt-хэшу)
 * active    — разблокировано
 */
export type AuthStatus = "loading" | "signed_out" | "locked" | "active";

interface SessionState {
  status: AuthStatus;
  driver: CachedDriver | null;
  set: (patch: Partial<Pick<SessionState, "status" | "driver">>) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "loading",
  driver: null,
  set: (patch) => set(patch),
}));
