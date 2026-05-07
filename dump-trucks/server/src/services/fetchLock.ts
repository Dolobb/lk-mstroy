// Глобальный лок: один runShiftFetch одновременно на весь сервер.
// Параллельные fetch-и контёнтят TIS-токены и затягивают каждую задачу в 2-3×.
// HTTP endpoint и cron-scheduler оба идут через этот лок.

import type { ShiftType } from '../types/domain';

export interface ActiveFetch {
  date: string;
  shift: ShiftType;
  startedAt: number;
}

let active: ActiveFetch | null = null;

export function getActiveFetch(): ActiveFetch | null {
  return active;
}

export function tryAcquire(date: string, shift: ShiftType): boolean {
  if (active) return false;
  active = { date, shift, startedAt: Date.now() };
  return true;
}

export function release(date: string, shift: ShiftType): void {
  if (active && active.date === date && active.shift === shift) {
    active = null;
  }
}
