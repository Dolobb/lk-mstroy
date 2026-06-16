// Словарь reason_code → русская подпись (UI бейдж).
// Контракт: INGEST_LEDGER_SPEC.md, таблица «Канонические reason_code + русские подписи».
// Фронт дублирует словарь в frontend/src/features/analytics/ledgerLabels.ts.

import type { LedgerStatus } from './ledgerClient';

export const REASON_LABELS: Record<string, string> = {
  no_monitoring: 'TIS: нет данных мониторинга',
  no_track: 'Трек пуст (<2 GPS-точек)',
  engine_below_threshold: 'Двигатель работал < 45 мин',
  no_object_detected: 'Вне рабочих геозон',
  no_segments_source: 'Нет смены для сегментов',
  future_date: 'ПЛ выписан заранее (дата не наступила)',
  gap_filled_onsite: 'Восстановлено: стояла на объекте',
  tis_error: 'Ошибка запроса к TIS',
  db_error: 'Ошибка записи в БД',
  validation_error: 'Некорректный ответ TIS',
  cancelled: 'Выгрузка прервана',
  internal_error: 'Внутренняя ошибка обработки',
};

/**
 * Возвращает русскую подпись для бейджа.
 * status='pending' → «Ещё не выгружено», 'running' → «Выгружается…».
 * Иначе — подпись по reason_code; при отсутствии кода/маппинга — null.
 */
export function reasonLabel(
  code: string | null | undefined,
  status: LedgerStatus,
): string | null {
  if (status === 'pending') return 'Ещё не выгружено';
  if (status === 'running') return 'Выгружается…';
  if (!code) return null;
  return REASON_LABELS[code] ?? null;
}
