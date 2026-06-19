import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { badgeInfo } from '../ledgerLabels';
import type { LedgerStatus } from '../ledgerLabels';

export interface ReasonBadgeUnit {
  status: LedgerStatus;
  reasonCode: string | null;
  reasonLabel: string | null;
  attempt: number;
  lastError: string | null;
}

interface ReasonBadgeProps {
  unit: ReasonBadgeUnit | null | undefined;
  /** undefined = статус ещё неизвестен; null = задачи в ledger нет. */
  missingReason?: 'no_task' | 'ledger_gap' | 'result_mismatch';
  className?: string;
}

/**
 * Бейдж с причиной отсутствия данных из ingest ledger.
 *
 * - unit === undefined → ничего (загрузка/статус не запрашивался)
 * - unit === null → нейтральное отсутствие задачи или подтверждённый пропуск ledger
 * - status='done' без reasonCode → null (ничего не рендерить)
 * - иначе → цветной бейдж с подписью
 *
 * Для failed добавляет ×N (attempt) и title с lastError.
 */
export function ReasonBadge({
  unit,
  missingReason = 'no_task',
  className,
}: ReasonBadgeProps): React.ReactElement | null {
  if (unit === undefined) return null;

  if (unit === null) {
    const isLedgerGap = missingReason === 'ledger_gap';
    const isResultMismatch = missingReason === 'result_mismatch';
    return (
      <Badge
        className={cn(
          'border-none text-[10px] font-normal',
          isLedgerGap || isResultMismatch
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
            : 'bg-muted text-muted-foreground opacity-70',
          className,
        )}
      >
        {isLedgerGap
          ? 'Пропуск ledger'
          : isResultMismatch
            ? 'Ledger done, данных нет'
            : 'Нет задачи выгрузки'}
      </Badge>
    );
  }

  // Берём данные о цвете и подписи
  const { label, color } = badgeInfo(unit.status, unit.reasonCode);

  // done без reasonCode — бейдж не нужен
  if (label === null) return null;

  // Для failed добавляем ×N
  const isFailed = unit.status === 'failed';
  const displayLabel = isFailed && unit.attempt > 0 ? `${label} ×${unit.attempt}` : label;
  const titleAttr = isFailed && unit.lastError ? unit.lastError : undefined;

  return (
    <Badge
      title={titleAttr}
      className={cn(
        'border-none text-[10px] font-normal',
        colorToClass(color),
        className,
      )}
    >
      {displayLabel}
    </Badge>
  );
}

function colorToClass(color: string): string {
  switch (color) {
    case 'gray':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    case 'muted':
      return 'bg-muted text-muted-foreground opacity-70';
    case 'blue':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    case 'red':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'orange':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
    case 'green':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
