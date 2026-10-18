import { KpiColor } from '../types/vehicle';

export function getKpiColor(value: number): KpiColor {
  if (value < 50) return 'RED';
  if (value < 75) return 'BLUE';
  return 'GREEN';
}

export const KPI_COLORS: Record<KpiColor, string> = {
  RED: '#FF0000',
  BLUE: '#0000FF',
  GREEN: '#00C853',
};

export function capDisplay(value: number): number {
  return Math.min(value, 100);
}

export function vehicleKpiPresentation(value: number | null, isGhost = false) {
  const missing = isGhost || value == null;
  return {
    color: missing ? '#94a3b8' : KPI_COLORS[getKpiColor(capDisplay(value))],
    label: missing ? 'Н/Д' : `${capDisplay(value).toFixed(0)}%`,
  };
}
