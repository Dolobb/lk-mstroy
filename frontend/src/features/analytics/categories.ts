import type { UnifiedVehicleRow } from './types';

export const SUBGROUP_LABELS: Record<string, string> = {
  samosvaly: 'Самосвалы',
  ekskav: 'Экскаваторы',
  kip: 'ДСТ',
  krany: 'Краны',
};

export const SUBGROUP_COLORS: Record<string, string> = {
  samosvaly: '#F97316',
  ekskav: '#A78BFA',
  kip: '#60A5FA',
  krany: '#22C55E',
};

export const SUBGROUP_ORDER = ['samosvaly', 'ekskav', 'kip', 'krany'];

export function vehicleCategory(v: UnifiedVehicleRow): string {
  if (v.source === 'dump_truck') return 'samosvaly';
  const vt = v.vehicleType.toLowerCase();
  if (vt.includes('экскаватор')) return 'ekskav';
  if (vt.includes('кран')) return 'krany';
  return 'kip';
}
