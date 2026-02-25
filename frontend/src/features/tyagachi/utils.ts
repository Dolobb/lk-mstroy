import type { TyagachiRequest } from './types';

export interface TimelineSegment {
  type: 'stable' | 'in_progress' | 'gap';
  startPct: number;
  widthPct: number;
  request?: TyagachiRequest;
}

export interface StackedTimelineSegment {
  startPct: number;   // % within window (0–100)
  widthPct: number;   // min 0.5%
  request: TyagachiRequest;
  plStatus: string | null;
  plId: string | null;
  plDateOut: string | null;   // pl_date_out_plan — начало ПЛ
  plDateIn: string | null;    // pl_date_in_plan  — конец ПЛ
  zIndex: number;
}

export function buildTimelineSegments(requests: TyagachiRequest[], viewStart: Date, viewEnd: Date): TimelineSegment[] {
  const totalMs = viewEnd.getTime() - viewStart.getTime();

  const sorted = [...requests]
    .filter(r => r.route_start_date && r.route_end_date)
    .sort((a, b) => {
      const aTime = parseRuDateTime(a.route_start_date!)?.getTime() ?? 0;
      const bTime = parseRuDateTime(b.route_start_date!)?.getTime() ?? 0;
      return aTime - bTime;
    });

  const segments: TimelineSegment[] = [];
  let cursor = 0;

  for (const req of sorted) {
    const startDate = parseRuDateTime(req.route_start_date!);
    const endDate = parseRuDateTime(req.route_end_date!);
    if (!startDate || !endDate) continue;

    const s = Math.max(0, (startDate.getTime() - viewStart.getTime()) / totalMs * 100);
    const e = Math.min(100, (endDate.getTime() - viewStart.getTime()) / totalMs * 100);

    if (e <= 0) continue;
    if (s >= 100) break;

    if (s > cursor + 0.5) {
      segments.push({ type: 'gap', startPct: cursor, widthPct: s - cursor });
    }
    segments.push({
      type: req.stability_status,
      startPct: s,
      widthPct: Math.max(0.5, e - s),
      request: req,
    });
    cursor = Math.max(cursor, e);
  }

  if (cursor < 99.5) {
    segments.push({ type: 'gap', startPct: cursor, widthPct: 100 - cursor });
  }
  return segments;
}

/**
 * Строит сегменты таймлайна: один сегмент = один ПЛ.
 * Позиция и ширина определяются pl_date_out_plan / pl_date_in_plan.
 * Каждый сегмент несёт ссылку на родительскую заявку для тултипа.
 */
export function buildStackedSegments(requests: TyagachiRequest[], viewStart: Date, viewEnd: Date): StackedTimelineSegment[] {
  const totalMs = viewEnd.getTime() - viewStart.getTime();
  if (totalMs <= 0) return [];

  const result: StackedTimelineSegment[] = [];

  for (const req of requests) {
    const pls = req.pl_records ?? [];
    for (const pl of pls) {
      const startDate = parseRuDateTime(pl.pl_date_out_plan);
      const endDate = parseRuDateTime(pl.pl_date_in_plan);
      if (!startDate || !endDate || endDate <= startDate) continue;

      const s = (startDate.getTime() - viewStart.getTime()) / totalMs * 100;
      const e = (endDate.getTime() - viewStart.getTime()) / totalMs * 100;

      if (e <= 0 || s >= 100) continue;

      const clampedS = Math.max(0, s);
      const clampedE = Math.min(100, e);

      result.push({
        startPct: clampedS,
        widthPct: Math.max(0.5, clampedE - clampedS),
        request: req,
        plStatus: pl.pl_status,
        plId: pl.pl_id,
        plDateOut: pl.pl_date_out_plan,
        plDateIn: pl.pl_date_in_plan,
        zIndex: result.length + 1,
      });
    }
  }

  // Сортируем по startPct для корректного z-index (позже → выше)
  result.sort((a, b) => a.startPct - b.startPct);
  result.forEach((seg, i) => { seg.zIndex = i + 1; });

  return result;
}

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
