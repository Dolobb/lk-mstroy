/**
 * Парсит дату формата "DD.MM.YYYY HH:MM:SS" или "DD.MM.YYYY HH:MM"
 * в объект Date. Тягачи используют этот формат везде.
 */
export function parseRuDateTime(str: string | null): Date | null {
  if (!str) return null;
  const [datePart, timePart = '00:00:00'] = str.split(' ');
  const [d, m, y] = datePart.split('.');
  const [hh, mm, ss = '00'] = timePart.split(':');
  if (!d || !m || !y) return null;
  return new Date(+y, +m - 1, +d, +hh, +mm, +ss);
}

/** Форматирует "DD.MM.YYYY HH:MM:SS" → "25.01 07:30" */
export function fmtRuDT(str: string | null): string {
  if (!str) return '—';
  const d = parseRuDateTime(str);
  if (!d) return str;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Форматирует часы в "Xч YYм" */
export function fmtHours(hours: number | null | undefined): string {
  if (hours == null || isNaN(hours)) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

/** Форматирует ISO-дату → локальная дата/время */
export function fmtIsoDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** Статус заявки → читаемый текст */
export function fmtRequestStatus(status: string | null): string {
  if (!status) return '—';
  const map: Record<string, string> = {
    SUCCESSFULLY_COMPLETED: 'Завершена',
    IN_PROGRESS: 'В работе',
    CANCELLED: 'Отменена',
    CREATED: 'Создана',
  };
  return map[status] ?? status;
}

/** Стабильность → readable */
export function fmtStability(s: 'stable' | 'in_progress'): string {
  return s === 'stable' ? 'Финал' : 'В работе';
}
