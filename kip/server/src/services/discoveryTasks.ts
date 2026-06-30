import * as fs from 'fs';
import * as path from 'path';
import { dayjs } from '../utils/dateFormat';
import type { ShiftWindow, VehicleTask, ShiftConfig } from '../types/domain';
import type { TisPassport } from '../types/tis-api';
import { getRegisteredVehicles } from './vehicleRegistry';
import { getOrgByIdMO } from './orgLookup';
import { logger } from '../utils/logger';

let _shiftConfig: ShiftConfig | null = null;
function loadShiftConfig(): ShiftConfig {
  if (!_shiftConfig) {
    const filePath = path.resolve(__dirname, '../../../config/shifts.json');
    _shiftConfig = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ShiftConfig;
  }
  return _shiftConfig;
}

function atTime(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  return dayjs(dateStr).hour(h).minute(m).second(0).millisecond(0).toDate();
}

/**
 * Стандартные окна смен для одной даты (без привязки к ПЛ).
 *   morning: 07:30 – 19:30 того же дня
 *   evening: 19:30 того же дня – 07:30 следующего (report_date = дата начала)
 */
export function buildStandardShifts(dateStr: string): ShiftWindow[] {
  const cfg = loadShiftConfig();
  const nextDayStr = dayjs(dateStr).add(1, 'day').format('YYYY-MM-DD');
  return [
    {
      shiftType: 'morning',
      date: dateStr,
      from: atTime(dateStr, cfg.morning.start),
      to: atTime(dateStr, cfg.morning.end),
    },
    {
      shiftType: 'evening',
      date: dateStr,
      from: atTime(dateStr, cfg.evening.start),
      to: atTime(nextDayStr, cfg.morning.start), // 07:30 следующего дня
    },
  ];
}

/**
 * Discovery ТС без ПЛ (по образцу самосвалов `shiftFetchJob` блок 5b).
 *
 * Для каждого реестрового ТС, у которого НЕТ задачи из ПЛ на targetDate,
 * создаём синтетические задачи на обе смены этого дня. idMO берём из
 * паспортного справочника (getPassports). Такие задачи помечаются plId=0
 * (без ПЛ), requestNumbers=[].
 *
 * @param targetDateStr  целевая дата (YYYY-MM-DD)
 * @param passports      ответ getPassports (весь парк)
 * @param coveredKeys    Set ключей `regNumber.toUpperCase()|shiftType` уже покрытых ПЛ на targetDate
 */
export function buildDiscoveryTasks(
  targetDateStr: string,
  passports: TisPassport[],
  coveredKeys: Set<string>,
): VehicleTask[] {
  // regNumber(upper) → idMO/name из паспортов (только зарегистрированные)
  const passByReg = new Map<string, TisPassport>();
  for (const p of passports) {
    if (!p.registered || !p.regNumber) continue;
    passByReg.set(p.regNumber.toUpperCase().trim(), p);
  }

  const shifts = buildStandardShifts(targetDateStr);
  const tasks: VehicleTask[] = [];
  let noPassport = 0;
  const discoveredRegs = new Set<string>();

  for (const v of getRegisteredVehicles()) {
    const reg = v.regNumber.toUpperCase().trim();
    const p = passByReg.get(reg);
    if (!p) { noPassport++; continue; }          // нет idMO в справочнике

    for (const shift of shifts) {
      if (coveredKeys.has(`${reg}|${shift.shiftType}`)) continue; // эта смена уже из ПЛ
      discoveredRegs.add(reg);
      tasks.push({
        idMO: p.idMO,
        regNumber: v.regNumber,
        nameMO: p.modelOrMarkOrModif || v.regNumber,
        category: '',
        garageNumber: p.garageNumber || '',
        plId: 0,                                  // 0 = без ПЛ
        companyName: getOrgByIdMO(p.idMO) || '',
        shift,
        requestNumbers: [],
      });
    }
  }

  logger.info(
    `[KIP discovery] ${targetDateStr}: реестр=${getRegisteredVehicles().length}, ` +
    `добавлено без-ПЛ ${discoveredRegs.size} ТС / ${tasks.length} задач ` +
    `(нет в getPassports=${noPassport})`,
  );

  return tasks;
}
