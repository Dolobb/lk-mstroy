export interface RepairPeriod {
  status: 'middle' | 'true';
  techStatus: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export function getRepairOnDate(periods: RepairPeriod[], date: string): RepairPeriod | null {
  return periods.find(p => p.from <= date && date <= p.to) ?? null;
}

export function repairIntersects(period: RepairPeriod, from: string, to: string): boolean {
  return period.from <= to && period.to >= from;
}

export function fmtDateShort(iso: string): string {
  const parts = iso.split('-');
  return `${parts[2]}.${parts[1]}`;
}
