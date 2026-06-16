import { useEffect } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";

import { useSync } from "./useSync";

/**
 * Экраны, на которых периодический фоновый синк РАЗРЕШЁН. Синк пишет в локальный SQLite
 * (bootstrap-дельта + смена статусов outbox), а все чтения — `useLiveQuery`, которые на КАЖДУЮ
 * запись в таблицу транзиентно перерисовываются (список ТС/недавние мигают в пусто) — это и
 * «выкидывало» пользователя с экрана ввода. Поэтому периодический проход крутим только на
 * «спокойных» экранах (главный/смена), а на экранах ВВОДА (передача/получение/добавление ТС/
 * закрытие) — НЕ трогаем БД. Введённые офлайн события догоняются при возврате на /work.
 */
const PERIODIC_SYNC_ROUTES = new Set(["/main", "/work"]);

/**
 * Авто-синк при активной сессии. Первичный bootstrap (подтянет справочники/АТЗ/ТС) — один раз
 * сразу при активации. Периодический проход (раз в минуту) и ресинк при возврате приложения на
 * передний план — только на спокойных экранах (см. PERIODIC_SYNC_ROUTES), чтобы не прерывать ввод.
 */
export function useAutoSync(enabled: boolean) {
  const { sync } = useSync();
  const pathname = usePathname();
  const periodicAllowed = PERIODIC_SYNC_ROUTES.has(pathname);

  // Первичный синк сразу при активации сессии — независимо от экрана (после логина это /main).
  useEffect(() => {
    if (!enabled) return;
    void sync();
  }, [enabled, sync]);

  // Периодический проход + ресинк на foreground — только на спокойных экранах.
  useEffect(() => {
    if (!enabled || !periodicAllowed) return;
    void sync(); // догнать накопленное при возврате на спокойный экран

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    const interval = setInterval(() => void sync(), 60_000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [enabled, periodicAllowed, sync]);
}
