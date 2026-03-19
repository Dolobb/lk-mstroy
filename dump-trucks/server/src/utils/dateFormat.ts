import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

export function parseDdMmYyyy(dateStr: string): Date | null {
  const d = dayjs(dateStr, 'DD.MM.YYYY', true);
  return d.isValid() ? d.toDate() : null;
}

export function parseDdMmYyyyHhmm(dateStr: string): Date | null {
  // Try with seconds first, then without
  let d = dayjs(dateStr, 'DD.MM.YYYY HH:mm:ss', true);
  if (!d.isValid()) {
    d = dayjs(dateStr, 'DD.MM.YYYY HH:mm', true);
  }
  return d.isValid() ? d.toDate() : null;
}

export function secondsToHours(seconds: number): number {
  return seconds / 3600;
}

export function formatDateParam(date: Date): string {
  return dayjs(date).format('DD.MM.YYYY');
}

export function formatDateTimeParam(date: Date): string {
  return dayjs(date).format('DD.MM.YYYY HH:mm');
}

export function formatDateIso(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD');
}

export { dayjs };
