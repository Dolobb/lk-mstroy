import React from 'react';
import type { RepairPeriod } from './repairPeriods';

export function useRepairPeriods(from: string, to: string): Map<string, RepairPeriod[]> {
  const [map, setMap] = React.useState<Map<string, RepairPeriod[]>>(new Map());
  const key = `${from}__${to}`;
  React.useEffect(() => {
    if (!from || !to) return;
    fetch(`/api/vs/repair-periods?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { data: Record<string, RepairPeriod[]> } | null) => {
        if (!d) return;
        setMap(new Map(Object.entries(d.data)));
      })
      .catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return map;
}
