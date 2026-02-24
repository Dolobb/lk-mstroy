import * as fs from 'fs';
import * as path from 'path';
import { dayjs } from '../utils/dateFormat';
import type { ShiftConfig, ShiftWindow } from '../types/domain';

let _config: ShiftConfig | null = null;

function loadShiftConfig(): ShiftConfig {
  if (!_config) {
    const filePath = path.resolve(__dirname, '../../../config/shifts.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    _config = JSON.parse(raw) as ShiftConfig;
  }
  return _config;
}

function parseTime(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  return dayjs(dateStr).hour(h).minute(m).second(0).millisecond(0).toDate();
}

/**
 * Split a PL period into shift windows.
 *
 * Shifts:
 *   morning: 07:30 – 19:30 (report_date = same day)
 *   evening: 19:30 – 07:30 next day (report_date = day evening starts)
 *
 * Rule: period 00:00-07:30 belongs to the evening shift of the PREVIOUS day.
 * This is naturally handled because evening spans 19:30 day X → 07:30 day X+1.
 */
export function splitIntoShifts(dateOutPlan: Date, dateInPlan: Date): ShiftWindow[] {
  const config = loadShiftConfig();
  const shifts: ShiftWindow[] = [];

  // Start from 1 day before to catch evening shift spanning midnight
  const startDay = dayjs(dateOutPlan).startOf('day').subtract(1, 'day');
  const endDay = dayjs(dateInPlan).startOf('day');

  let currentDay = startDay;
  while (currentDay.isBefore(endDay) || currentDay.isSame(endDay, 'day')) {
    const dateStr = currentDay.format('YYYY-MM-DD');

    // Morning shift: 07:30 – 19:30 of same day
    const morningStart = parseTime(dateStr, config.morning.start);
    const morningEnd = parseTime(dateStr, config.morning.end);

    if (dateOutPlan < morningEnd && dateInPlan > morningStart) {
      const from = new Date(Math.max(dateOutPlan.getTime(), morningStart.getTime()));
      const to = new Date(Math.min(dateInPlan.getTime(), morningEnd.getTime()));
      if (from < to) {
        shifts.push({ shiftType: 'morning', date: dateStr, from, to });
      }
    }

    // Evening shift: 19:30 of this day – 07:30 of next day
    const eveningStart = parseTime(dateStr, config.evening.start);
    const nextDayStr = currentDay.add(1, 'day').format('YYYY-MM-DD');
    const eveningEnd = parseTime(nextDayStr, config.morning.start); // 07:30 next day

    if (dateOutPlan < eveningEnd && dateInPlan > eveningStart) {
      const from = new Date(Math.max(dateOutPlan.getTime(), eveningStart.getTime()));
      const to = new Date(Math.min(dateInPlan.getTime(), eveningEnd.getTime()));
      if (from < to) {
        shifts.push({ shiftType: 'evening', date: dateStr, from, to });
      }
    }

    currentDay = currentDay.add(1, 'day');
  }

  return shifts;
}
