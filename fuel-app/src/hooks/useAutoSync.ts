import { useEffect } from "react";
import { AppState } from "react-native";

import { useSync } from "./useSync";

/**
 * Авто-синк при активной сессии: первичный проход (bootstrap подтянет справочники/АТЗ/ТС)
 * сразу при разблокировке, далее — при выходе приложения на передний план и раз в минуту.
 * Без этого после логина локальный кэш пуст (был баг «Нет доступных АТЗ»).
 */
export function useAutoSync(enabled: boolean) {
  const { sync } = useSync();

  useEffect(() => {
    if (!enabled) return;
    void sync(); // первичный bootstrap+push

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    const interval = setInterval(() => void sync(), 60_000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [enabled, sync]);
}
