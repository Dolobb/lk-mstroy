/**
 * PL Parser для самосвалов.
 * Портирован с tyagachi/src/parsers/pl_parser.py
 *
 * Основная логика:
 * - flatten calcs[] из ПЛ
 * - extract idMO/regNumber/nameMO из ts[]
 * - в тест-режиме фильтр по idMO из DT_TEST_ID_MOS,
 *   иначе по nameMO.includes('самосвал')
 * - extract номер заявки через regex ^(\d+) из orderDescr
 */

import type { TisRouteList } from '../types/tis-api';
import type { ParsedPL, ParsedVehicle } from '../types/domain';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

/**
 * Извлекает номер заявки из orderDescr.
 * Правило (из tyagachi pl_parser.py):
 *   Удалить ведущий '№', убрать пробелы, найти (\d+) в начале строки.
 *   "№120360/1 от 31.12.2025..." → 120360
 *   "120360/1" → 120360
 *   "Без номера" → null
 */
export function extractRequestNumber(orderDescr: string | null | undefined): number | null {
  if (!orderDescr) return null;
  const cleaned = orderDescr.replace(/^№\s*/, '').trimStart();
  const match = cleaned.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Проверяет, является ли ТС целевым самосвалом.
 * В тест-режиме: по idMO из testIdMos
 * В обычном режиме: по nameMO.toLowerCase().includes('самосвал')
 */
function isTargetVehicle(
  vehicle: { idMO: number; nameMO: string },
  testIdMos: number[] | null,
): boolean {
  if (testIdMos !== null) {
    return testIdMos.includes(vehicle.idMO);
  }
  return vehicle.nameMO.toLowerCase().includes('самосвал');
}

/**
 * Разбирает список путевых листов и возвращает ParsedPL[].
 * Фильтрует по типу ТС (самосвал).
 * ПЛ без подходящих ТС пропускаются.
 */
export function parsePLs(
  routeLists: TisRouteList[],
  testIdMos: number[] | null,
): ParsedPL[] {
  const result: ParsedPL[] = [];

  for (const pl of routeLists) {
    // Фильтрация ТС
    const vehicles: ParsedVehicle[] = (pl.ts || [])
      .filter(t => isTargetVehicle(t, testIdMos))
      .map(t => ({
        idMO:      t.idMO,
        regNumber: t.regNumber,
        nameMO:    t.nameMO,
      }));

    if (vehicles.length === 0) continue;

    const dateOutPlan = parseDdMmYyyyHhmm(pl.dateOutPlan);
    const dateInPlan  = parseDdMmYyyyHhmm(pl.dateInPlan);

    if (!dateOutPlan || !dateInPlan) continue;

    // Номера заявок из calcs
    const requestNumbers: number[] = [];
    const objectExpendList: string[] = [];

    for (const calc of pl.calcs || []) {
      const num = extractRequestNumber(calc.orderDescr);
      if (num !== null && !requestNumbers.includes(num)) {
        requestNumbers.push(num);
      }
      if (calc.objectExpend && !objectExpendList.includes(calc.objectExpend)) {
        objectExpendList.push(calc.objectExpend);
      }
    }

    result.push({
      plId:            pl.id,
      tsNumber:        pl.tsNumber,
      dateOut:         pl.dateOut,
      dateOutPlan,
      dateInPlan,
      status:          pl.status,
      vehicles,
      requestNumbers,
      objectExpendList,
    });
  }

  return result;
}

/**
 * Разбивает период ПЛ на смены.
 * shift1: 07:30–19:30 (утренняя)
 * shift2: 19:30–07:30 (вечерняя/ночная)
 *
 * Возвращает только те смены, которые попадают в период ПЛ.
 */
export interface ShiftPeriod {
  shiftType: 'shift1' | 'shift2';
  start: Date;
  end: Date;
}

export function splitIntoShifts(dateOutPlan: Date, dateInPlan: Date): ShiftPeriod[] {
  const shifts: ShiftPeriod[] = [];
  const start = dateOutPlan.getTime();
  const end   = dateInPlan.getTime();

  // Перебираем дни в диапазоне
  const startDay = new Date(dateOutPlan);
  startDay.setHours(0, 0, 0, 0);

  for (let d = new Date(startDay); d.getTime() <= end; d.setDate(d.getDate() + 1)) {
    // shift1: 07:30–19:30 текущего дня
    const s1Start = new Date(d);
    s1Start.setHours(7, 30, 0, 0);
    const s1End = new Date(d);
    s1End.setHours(19, 30, 0, 0);

    if (s1End.getTime() > start && s1Start.getTime() < end) {
      shifts.push({
        shiftType: 'shift1',
        start: new Date(Math.max(s1Start.getTime(), start)),
        end:   new Date(Math.min(s1End.getTime(), end)),
      });
    }

    // shift2: 19:30 текущего дня – 07:30 следующего дня
    const s2Start = new Date(d);
    s2Start.setHours(19, 30, 0, 0);
    const s2End = new Date(d);
    s2End.setDate(s2End.getDate() + 1);
    s2End.setHours(7, 30, 0, 0);

    if (s2End.getTime() > start && s2Start.getTime() < end) {
      shifts.push({
        shiftType: 'shift2',
        start: new Date(Math.max(s2Start.getTime(), start)),
        end:   new Date(Math.min(s2End.getTime(), end)),
      });
    }
  }

  return shifts;
}
