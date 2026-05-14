import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

export function parseDdMmYyyy(dateStr: string): Date | null {
  const d = dayjs(dateStr, 'DD.MM.YYYY', true);
  return d.isValid() ? d.toDate() : null;
}

export function parseDdMmYyyyHhmm(dateStr: string): Date | null {
  let d = dayjs(dateStr, 'DD.MM.YYYY HH:mm:ss', true);
  if (!d.isValid()) {
    d = dayjs(dateStr, 'DD.MM.YYYY HH:mm', true);
  }
  return d.isValid() ? d.toDate() : null;
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
