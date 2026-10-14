/**
 * Состояние диалога — конечный автомат (FSM).
 *
 * Telegram не помнит, «где» находится пользователь: каждое сообщение приходит
 * само по себе. Поэтому шаг диалога хранится явно, и текстовые сообщения
 * трактуются в зависимости от текущего шага: «120» — это литры при выдаче,
 * но остаток при старте смены.
 *
 * Состояние держим в памяти процесса: боту-демо этого достаточно. Для боевого
 * бота сюда подставляется таблица в базе или Redis — меняется только хранилище,
 * логика шагов остаётся той же.
 */

/** Шаг, на котором сейчас находится пользователь. */
export type Step =
  | { name: "idle" }
  | { name: "await_pin" }
  /* старт смены */
  | { name: "await_opening_liters"; atzId: string }
  /* выдача топлива */
  | { name: "await_vehicle_query" }
  | { name: "await_dispense_liters"; vehicleId: string }
  | { name: "await_recipient"; vehicleId: string; liters: number }
  | { name: "confirm_dispense"; vehicleId: string; liters: number; recipient: string }
  /* приёмка топлива */
  | { name: "await_receipt_liters" }
  | { name: "confirm_receipt"; liters: number };

export type SessionData = {
  driverId: string | null;
  step: Step;
  /** id последнего сообщения-меню — чтобы не плодить их в чате. */
  menuMessageId?: number;
};

export function initial(): SessionData {
  return { driverId: null, step: { name: "idle" } };
}

const store = new Map<number, SessionData>();

export function getSession(tgUserId: number): SessionData {
  let s = store.get(tgUserId);
  if (!s) {
    s = initial();
    store.set(tgUserId, s);
  }
  return s;
}

export function resetStep(tgUserId: number): void {
  getSession(tgUserId).step = { name: "idle" };
}
