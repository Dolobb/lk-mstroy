/**
 * Cron-планировщик:
 * - 08:30 (Asia/Yekaterinburg) — shift2 вчерашнего дня (ночная смена)
 * - 20:30 (Asia/Yekaterinburg) — shift1 сегодняшнего дня (дневная смена)
 */

import cron from 'node-cron';
import { runShiftFetch } from './shiftFetchJob';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';
import { tryAcquire as tryAcquireFetchLock, release as releaseFetchLock, getActiveFetch } from '../services/fetchLock';
import type { ShiftType } from '../types/domain';

async function runShiftFetchLocked(date: string, shift: ShiftType): Promise<void> {
  // Если admin-воркер уже что-то крутит — ждём окно. Не запускаем параллельно
  // (параллельные fetch-и контёнтят TIS-токены).
  const MAX_WAIT_MS = 60 * 60 * 1000; // 1 час
  const POLL_MS = 30_000;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (!tryAcquireFetchLock(date, shift)) {
    const a = getActiveFetch();
    if (Date.now() >= deadline) {
      logger.warn(`[Scheduler] fetch lock busy >1h (active=${a?.date}/${a?.shift}), skipping ${date}/${shift}`);
      return;
    }
    logger.info(`[Scheduler] fetch lock busy (active=${a?.date}/${a?.shift}), retry ${date}/${shift} in ${POLL_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    const result = await runShiftFetch(date, shift);
    logger.info(`[Scheduler] ${shift} done`, result);
  } finally {
    releaseFetchLock(date, shift);
  }
}

export function startScheduler(): void {
  if (process.env.CRON_DISABLED === 'true') {
    logger.info('[Scheduler] Cron disabled (CRON_DISABLED=true), skipping');
    return;
  }

  // 08:30 — закрытие ночной смены (shift2 вчера)
  cron.schedule('30 8 * * *', async () => {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    logger.info(`[Scheduler] Triggered: shift2 for ${yesterday}`);
    try {
      await runShiftFetchLocked(yesterday, 'shift2');
    } catch (err) {
      logger.error('[Scheduler] shift2 failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  // 20:30 — закрытие дневной смены (shift1 сегодня)
  cron.schedule('30 20 * * *', async () => {
    const today = dayjs().format('YYYY-MM-DD');
    logger.info(`[Scheduler] Triggered: shift1 for ${today}`);
    try {
      await runShiftFetchLocked(today, 'shift1');
    } catch (err) {
      logger.error('[Scheduler] shift1 failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  logger.info('[Scheduler] Started. Jobs: 08:30 (shift2/yesterday), 20:30 (shift1/today) [Asia/Yekaterinburg]');
}
