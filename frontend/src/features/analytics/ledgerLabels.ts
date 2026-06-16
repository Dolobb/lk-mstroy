// Словарь reason_code → русская подпись (UI бейдж).
// Контракт: INGEST_LEDGER_SPEC.md, таблица «Канонические reason_code + русские подписи».
// Дублирует analytics-backend/server/src/services/ledgerLabels.ts (офлайн-маппинг для фронта).

export type LedgerStatus = 'pending' | 'running' | 'done' | 'empty' | 'failed';

export type BadgeColor = 'gray' | 'blue' | 'red' | 'orange' | 'green' | 'muted';

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

/**
 * Определяет цвет бейджа по status и reasonCode согласно спецификации
 * INGEST_LEDGER_SPEC.md раздел «Канонические reason_code».
 *
 * Возвращает { label, color } где:
 * - label — готовая русская строка для отображения (null если бейдж не нужен)
 * - color — один из 'gray'|'blue'|'red'|'orange'|'green'|'muted'
 *
 * Когда label === null и status === 'done' (без reasonCode) — бейдж не нужен.
 */
export function badgeInfo(
  status: LedgerStatus,
  reasonCode: string | null | undefined,
): { label: string | null; color: BadgeColor } {
  // pending / running — статусные
  if (status === 'pending') return { label: 'Ещё не выгружено', color: 'muted' };
  if (status === 'running') return { label: 'Выгружается…', color: 'orange' };

  // done без reasonCode — всё нормально, бейдж не нужен
  if (status === 'done' && !reasonCode) return { label: null, color: 'green' };

  // done + gap_filled_onsite — синий
  if (reasonCode === 'gap_filled_onsite') {
    return { label: REASON_LABELS['gap_filled_onsite'] ?? 'Восстановлено', color: 'blue' };
  }

  // empty — серые причины
  const emptyReasons: string[] = [
    'no_monitoring', 'no_track', 'engine_below_threshold',
    'no_object_detected', 'no_segments_source', 'future_date',
  ];
  if (status === 'empty' || (reasonCode && emptyReasons.includes(reasonCode))) {
    const label = reasonCode ? (REASON_LABELS[reasonCode] ?? reasonCode) : null;
    return { label, color: 'gray' };
  }

  // failed — красные или оранжевые
  if (status === 'failed') {
    if (reasonCode === 'cancelled') {
      return { label: REASON_LABELS['cancelled'] ?? 'Выгрузка прервана', color: 'orange' };
    }
    const label = reasonCode ? (REASON_LABELS[reasonCode] ?? reasonCode) : 'Ошибка';
    return { label, color: 'red' };
  }

  // done с неизвестным reasonCode
  const label = reasonCode ? (REASON_LABELS[reasonCode] ?? reasonCode) : null;
  return { label, color: 'green' };
}
