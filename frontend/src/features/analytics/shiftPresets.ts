// Единый источник истины для границ смен и «сменных» пресетов диапазона дат.
//
// Смены (как везде в проекте, см. NAVIGATION.md):
//   • дневная (shift1): 07:30 – 19:30
//   • ночная  (shift2): 19:30 – 07:30 следующего дня
//
// Все вычисления — в календарных компонентах (год/месяц/день/часы), а не через
// вычитание миллисекунд, чтобы быть устойчивыми к возможному DST браузерной TZ.
// (Екатеринбург DST не имеет, но логика не должна на это закладываться.)

export interface ShiftRange {
  from: Date;
  to: Date;
}

const SHIFT_START_MIN = 7 * 60 + 30; // 07:30 — начало дневной / конец ночной
const SHIFT_MID_MIN = 19 * 60 + 30; // 19:30 — конец дневной / начало ночной

/** Дата = (база + plusDays) с временем minutesOfDay, секунды/мс обнулены. */
function atTime(base: Date, plusDays: number, minutesOfDay: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + plusDays);
  d.setHours(Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, 0);
  return d;
}

/**
 * Смена, идущая прямо СЕЙЧАС (в процессе).
 *  • 07:30–19:30  → дневная сегодня
 *  • ≥19:30       → ночная: сегодня 19:30 → завтра 07:30
 *  • <07:30       → ночная: вчера 19:30 → сегодня 07:30
 */
export function currentShift(now: Date = new Date()): ShiftRange {
  const min = now.getHours() * 60 + now.getMinutes();
  if (min >= SHIFT_START_MIN && min < SHIFT_MID_MIN) {
    return { from: atTime(now, 0, SHIFT_START_MIN), to: atTime(now, 0, SHIFT_MID_MIN) };
  }
  if (min >= SHIFT_MID_MIN) {
    return { from: atTime(now, 0, SHIFT_MID_MIN), to: atTime(now, 1, SHIFT_START_MIN) };
  }
  return { from: atTime(now, -1, SHIFT_MID_MIN), to: atTime(now, 0, SHIFT_START_MIN) };
}

/** Смена, ЗАКАНЧИВАЮЩАЯСЯ ровно на границе `boundary` (07:30 или 19:30). */
function shiftBefore(boundary: Date): ShiftRange {
  const min = boundary.getHours() * 60 + boundary.getMinutes();
  if (min === SHIFT_START_MIN) {
    // заканчивается в 07:30 → это ночная смена, начавшаяся вчера в 19:30
    return { from: atTime(boundary, -1, SHIFT_MID_MIN), to: boundary };
  }
  // заканчивается в 19:30 → это дневная смена того же дня с 07:30
  return { from: atTime(boundary, 0, SHIFT_START_MIN), to: boundary };
}

/**
 * Последняя ПОЛНОСТЬЮ завершённая смена (идёт прямо перед текущей).
 *  • сейчас 06:00 8 июня → дневная 7 июня (07:30–19:30)
 *  • сейчас 10:00 8 июня → ночная 7→8 июня (19:30–07:30)
 */
export function previousShift(now: Date = new Date()): ShiftRange {
  return shiftBefore(currentShift(now).from);
}

/** Две последние полностью завершённые смены (непрерывное 24-часовое окно). */
export function lastTwoShifts(now: Date = new Date()): ShiftRange {
  const prev = previousShift(now);
  const prevPrev = shiftBefore(prev.from);
  return { from: prevPrev.from, to: prev.to };
}
