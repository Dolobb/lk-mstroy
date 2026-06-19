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
  /** По ключу vehicleRef|date — наиболее важный статус среди загруженных pipeline. */
  byVehicleDate: Map<string, DataStatusUnit>;
  /** Legacy-ключ без pipeline. Не использовать, если несколько pipeline имеют одинаковый ref. */
  byVehicleDateShift: Map<string, DataStatusUnit>;
  /** Точный ключ pipeline|vehicleRef|date|shift. */
  byPipelineVehicleDateShift: Map<string, DataStatusUnit>;
  /** Все статусы единицы ТС в pipeline за период, по возрастанию даты. */
  byPipelineVehicle: Map<string, DataStatusUnit[]>;
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
  const byPipelineVehicleDateShift = new Map<string, DataStatusUnit>();
  const byPipelineVehicle = new Map<string, DataStatusUnit[]>();

  if (units) {
    for (const unit of units) {
      const ref = unit.vehicleRef.toUpperCase();

      const exactKey = dataStatusUnitKey(unit.pipeline, ref, unit.date, unit.shift);
      byPipelineVehicleDateShift.set(exactKey, unit);

      const vehicleKey = dataStatusVehicleKey(unit.pipeline, ref);
      const vehicleUnits = byPipelineVehicle.get(vehicleKey) ?? [];
      vehicleUnits.push(unit);
      byPipelineVehicle.set(vehicleKey, vehicleUnits);

      // Точный ключ по смене
      const shiftKey = `${ref}|${unit.date}|${unit.shift}`;
      const existingShift = byVehicleDateShift.get(shiftKey);
      if (!existingShift || statusPriority(unit.status) > statusPriority(existingShift.status)) {
        byVehicleDateShift.set(shiftKey, unit);
      }

      // Сводный legacy-ключ по дате: приоритет у проблемы, а не у done.
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
    byPipelineVehicleDateShift,
    byPipelineVehicle,
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}

export function dataStatusUnitKey(
  pipeline: string,
  vehicleRef: string,
  date: string,
  shift: string,
): string {
  return `${pipeline}|${vehicleRef.toUpperCase()}|${date}|${shift}`;
}

export function dataStatusVehicleKey(pipeline: string, vehicleRef: string): string {
  return `${pipeline}|${vehicleRef.toUpperCase()}`;
}

/** Приоритет проблемы для сводного ключа (выше = важнее показать). */
function statusPriority(status: string): number {
  switch (status) {
    case 'failed': return 5;
    case 'running': return 4;
    case 'pending': return 3;
    case 'empty': return 2;
    case 'done': return 1;
    default: return 0;
  }
}
