import { useMemo } from "react";

import { useAtz, useShiftEvents } from "./queries";

type ShiftEventRow = { status: string; type: string; payload: string };

/**
 * Сумма ещё НЕ подтверждённых дельт смены (приход receipt + / расход dispense −).
 * Подтверждённые (status='confirmed') уже учтены в серверном остатке — их пропускаем.
 * Мягко удалённые (isDeleted) не учитываем. Чистая функция — переиспользуется там, где
 * строки outbox уже загружены (рабочий экран), без повторной подписки на live-query.
 */
export function sumPendingDelta(rows: readonly ShiftEventRow[]): number {
  let delta = 0;
  for (const row of rows) {
    if (row.status === "confirmed") continue;
    let payload: { liters?: number; isDeleted?: boolean } | null = null;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (!payload || payload.isDeleted === true || typeof payload.liters !== "number") continue;
    delta += row.type === "receipt_upsert" ? payload.liters : -payload.liters;
  }
  return delta;
}

/**
 * Оптимистичный остаток АТЗ для UI (Shift-Model: «последнее известное + локальные
 * несинхронизированные дельты»).
 *
 * `serverRemaining` — авторитетное значение из кэша (обновляется `applyAtzBalances` после `/sync`
 * и bootstrap'ом); оно уже включает все ПОДТВЕРЖДЁННЫЕ сервером события. Поэтому к нему добавляем
 * только ещё НЕ подтверждённые (status ≠ confirmed) выдачи/получения текущей смены, иначе двойной счёт.
 *
 * Удаление мягкое (isDeleted) — такие события в дельту не идут (литры «возвращаются»).
 */
export function useAtzRemaining(atzId: string | null, shiftId: string | null) {
  const atzRows = useAtz(atzId);
  const events = useShiftEvents(shiftId);
  const atz = atzRows.data[0];
  const serverRemaining = atz?.remainingLiters ?? 0;

  const pendingDelta = useMemo(() => sumPendingDelta(events.data), [events.data]);

  return {
    atz,
    serverRemaining,
    /** остаток для показа/валидации (не опускаем ниже 0 в отображении) */
    remaining: serverRemaining + pendingDelta,
    pendingDelta,
  };
}
