/**
 * Доменная логика: правила, которые не зависят от Telegram.
 *
 * Всё, что здесь лежит, можно проверить обычными тестами без запуска бота —
 * см. domain.test.ts. Хендлеры отвечают только за диалог, решения принимаются тут.
 */
import { randomUUID } from "node:crypto";
import { db, getAtz, getOpenShiftForAtz, getShift, shiftTotals, type Shift } from "./db.ts";

/** Верхняя граница объёма. Такая же, как в боевом приложении. */
export const MAX_LITERS = 99999.99;

export type Parsed = { ok: true; value: number } | { ok: false; error: string };
export type ParsedText = { ok: true; value: string } | { ok: false; error: string };

/**
 * Разбор объёма из текста сообщения.
 *
 * Водитель пишет как удобно: «120», «120,5», « 120.50 ». Всё это валидно.
 * Отдельно ловим случаи, которые в боевом приложении однажды уронили
 * синхронизацию: отрицательные значения, ноль и слишком большие числа.
 */
export function parseLiters(raw: string): Parsed {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { ok: false, error: "Пустое значение. Введите число, например 120.5" };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "Нужно число с точностью до сотых, например 120.5" };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: "Не похоже на число" };
  if (value <= 0) return { ok: false, error: "Объём должен быть больше нуля" };
  if (value > MAX_LITERS) return { ok: false, error: `Слишком много. Максимум ${MAX_LITERS} л` };
  return { ok: true, value };
}

/** Имя получателя топлива — свободный текст, но не пустой и не роман. */
export function parseRecipient(raw: string): ParsedText {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < 2) return { ok: false, error: "Слишком короткое имя. Например: Петров П.П." };
  if (text.length > 80) return { ok: false, error: "Слишком длинное имя, до 80 символов" };
  return { ok: true, value: text };
}

/** Текущий остаток в цистерне: сколько было на старте, минус выдачи, плюс приёмки. */
export function currentRemaining(shift: Shift): number {
  const { dispensed, received } = shiftTotals(shift.id);
  return round2(shift.opening_remaining_liters - dispensed + received);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatLiters(n: number): string {
  return round2(n).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── Операции ─────────────────────────────────────────────────────────────────

export type OpResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Открыть смену.
 *
 * Инвариант: на один АТЗ — одна открытая смена. Проверяем и в коде (понятная
 * ошибка водителю), и уникальным индексом в базе (гарантия при гонке).
 */
export function openShift(driverId: string, atzId: string, openingLiters: number): OpResult<Shift> {
  const atz = getAtz(atzId);
  if (!atz) return { ok: false, error: "АТЗ не найден" };

  const busy = getOpenShiftForAtz(atzId);
  if (busy) return { ok: false, error: `По ${atz.gos_number} уже открыта смена. Сначала закройте её.` };

  const shift: Shift = {
    id: randomUUID(),
    driver_id: driverId,
    atz_id: atzId,
    status: "open",
    opening_remaining_liters: round2(openingLiters),
    closing_remaining_liters: null,
    started_at: new Date().toISOString(),
    ended_at: null
  };

  try {
    db.prepare(
      `INSERT INTO shifts (id, driver_id, atz_id, status, opening_remaining_liters, started_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).run(shift.id, shift.driver_id, shift.atz_id, shift.opening_remaining_liters, shift.started_at);
  } catch {
    // Сюда попадём, если уникальный индекс сработал раньше нашей проверки.
    return { ok: false, error: "По этому АТЗ только что открыли смену. Обновите меню." };
  }

  return { ok: true, value: shift };
}

/** Записать выдачу топлива. Больше, чем есть в цистерне, выдать нельзя. */
export function dispense(
  shift: Shift,
  vehicleId: string,
  liters: number,
  recipientName: string
): OpResult<{ remaining: number }> {
  // Та же причина, что и в closeShift: смену могли закрыть, пока водитель
  // вводил данные. Пишем события только в открытую смену.
  const fresh = getShift(shift.id);
  if (!fresh || fresh.status !== "open") return { ok: false, error: "Смена закрыта — записать выдачу нельзя." };

  const remaining = currentRemaining(fresh);
  if (liters > remaining) {
    return { ok: false, error: `В цистерне только ${formatLiters(remaining)} л — выдать ${formatLiters(liters)} л нельзя.` };
  }

  db.prepare(
    `INSERT INTO dispense_events (id, shift_id, vehicle_id, liters, recipient_name, happened_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), shift.id, vehicleId, round2(liters), recipientName, new Date().toISOString());

  return { ok: true, value: { remaining: round2(remaining - liters) } };
}

/** Записать приёмку топлива в цистерну. */
export function receive(shift: Shift, liters: number): OpResult<{ remaining: number }> {
  const fresh = getShift(shift.id);
  if (!fresh || fresh.status !== "open") return { ok: false, error: "Смена закрыта — записать приёмку нельзя." };

  const remaining = currentRemaining(fresh);
  if (remaining + liters > MAX_LITERS) {
    return { ok: false, error: `Столько не влезет: в цистерне уже ${formatLiters(remaining)} л.` };
  }

  db.prepare("INSERT INTO receipt_events (id, shift_id, liters, happened_at) VALUES (?, ?, ?, ?)").run(
    randomUUID(),
    shift.id,
    round2(liters),
    new Date().toISOString()
  );

  return { ok: true, value: { remaining: round2(remaining + liters) } };
}

/**
 * Закрыть смену и зафиксировать остаток в АТЗ.
 *
 * Статус проверяем по базе, а не по переданному объекту: объект мог быть
 * прочитан раньше и уже устареть. Без этого двойное нажатие на кнопку
 * закрывало бы смену дважды и второй раз перезаписывало остаток в АТЗ.
 */
export function closeShift(shift: Shift): OpResult<{ closing: number; dispensed: number; count: number }> {
  const fresh = getShift(shift.id);
  if (!fresh) return { ok: false, error: "Смена не найдена" };
  if (fresh.status !== "open") return { ok: false, error: "Смена уже закрыта" };

  const closing = currentRemaining(fresh);
  const { dispensed, count } = shiftTotals(fresh.id);

  db.prepare("UPDATE shifts SET status = 'closed', closing_remaining_liters = ?, ended_at = ? WHERE id = ?").run(
    closing,
    new Date().toISOString(),
    shift.id
  );
  db.prepare("UPDATE atz SET remaining_liters = ? WHERE id = ?").run(closing, shift.atz_id);

  return { ok: true, value: { closing, dispensed, count } };
}
