import { useCallback } from "react";

import { useSessionStore } from "../stores/session";
import { verifyPinOffline } from "../sync/auth";
import { api, setAuthToken } from "../sync/services";
import { clearSession, getOrCreateDeviceId, loadSession, saveSession } from "../sync/session";

/**
 * Аутентификация водителя на общем планшете:
 * - `restore()` (на старте): гарантирует deviceId, читает кэш → locked | signed_out;
 * - `loginOnline(login, pin)`: первый вход — сервер проверяет, кэшируем токен+профиль+pinHash;
 * - `unlockOffline(pin)`: повторный вход — локальная bcrypt-проверка PIN, используем кэш-токен;
 * - `logout()`: чистим сессию (deviceId остаётся).
 */
export function useAuth() {
  const set = useSessionStore((s) => s.set);

  const restore = useCallback(async () => {
    await getOrCreateDeviceId();
    const session = await loadSession();
    if (session) {
      setAuthToken(session.token);
      set({ status: "locked", driver: session.driver });
    } else {
      set({ status: "signed_out", driver: null });
    }
  }, [set]);

  const loginOnline = useCallback(
    async (login: string, pin: string) => {
      const res = await api.login(login, pin);
      await saveSession({ token: res.token, driver: res.driver, pinHash: res.driver.pinHash });
      setAuthToken(res.token);
      set({
        status: "active",
        driver: { id: res.driver.id, login: res.driver.login, fullName: res.driver.fullName },
      });
    },
    [set]
  );

  const unlockOffline = useCallback(
    async (pin: string): Promise<boolean> => {
      const session = await loadSession();
      if (!session || !verifyPinOffline(pin, session.pinHash)) return false;
      setAuthToken(session.token);
      set({ status: "active", driver: session.driver });
      return true;
    },
    [set]
  );

  const logout = useCallback(async () => {
    await clearSession();
    setAuthToken(null);
    set({ status: "signed_out", driver: null });
  }, [set]);

  return { restore, loginOnline, unlockOffline, logout };
}
