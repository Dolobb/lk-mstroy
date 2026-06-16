import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchDataStatus } from '../api';
import type { DataStatusUnit } from '../types';

/**
 * Хук для загрузки статусов ingest ledger за период [from, to].
 *
 * Возвращает Map с ключом `${vehicleRef}|${date}` → DataStatusUnit
 * (берётся последняя запись, если машина имеет несколько pipeline).
 * Для analytics-track pipeline единица одна — 'full' смена.
 * Для kip-shift/dt-shift может быть несколько записей (morning/evening).
 *
 * Также доступен statusMap с ключом `${vehicleRef}|${date}|${shift}` →
 * DataStatusUnit для точного матчинга по смене.
 */
export interface DataStatusResult {
  /** По ключу vehicleRef|date — последний (наиболее полный) статус */
  byVehicleDate: Map<string, DataStatusUnit>;
  /** По ключу vehicleRef|date|shift — точный матч */
  byVehicleDateShift: Map<string, DataStatusUnit>;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const STALE_MS = 30_000;

export function useDataStatus(
  from: string,
  to: string,
  pipeline?: string,
): DataStatusResult {
  const {
    data: units,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['analytics', 'data-status', from, to, pipeline ?? ''],
    queryFn: () => fetchDataStatus(from, to, undefined, pipeline),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    enabled: !!from && !!to,
  });

  const byVehicleDate = new Map<string, DataStatusUnit>();
  const byVehicleDateShift = new Map<string, DataStatusUnit>();

  if (units) {
    for (const unit of units) {
      const ref = unit.vehicleRef.toUpperCase();

      // Точный ключ по смене
      const shiftKey = `${ref}|${unit.date}|${unit.shift}`;
      byVehicleDateShift.set(shiftKey, unit);

      // Сводный ключ по дате (приоритет: done > empty > failed > running > pending)
      const dayKey = `${ref}|${unit.date}`;
      const existing = byVehicleDate.get(dayKey);
      if (!existing || statusPriority(unit.status) > statusPriority(existing.status)) {
        byVehicleDate.set(dayKey, unit);
      }
    }
  }

  return {
    byVehicleDate,
    byVehicleDateShift,
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}

/** Приоритет статуса для сводного ключа (выше = "интереснее" показывать) */
function statusPriority(status: string): number {
  switch (status) {
    case 'done': return 5;
    case 'failed': return 4;
    case 'empty': return 3;
    case 'running': return 2;
    case 'pending': return 1;
    default: return 0;
  }
}
