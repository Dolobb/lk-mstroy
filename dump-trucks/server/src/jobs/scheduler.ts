/**
 * Cron-планировщик:
 * - 08:30 (Asia/Yekaterinburg) — shift2 вчерашнего дня (ночная смена)
 * - 20:30 (Asia/Yekaterinburg) — shift1 сегодняшнего дня (дневная смена)
 */

import cron from 'node-cron';
import { runShiftFetch } from './shiftFetchJob';
import { logger } from '../utils/logger';
import { dayjs } from '../utils/dateFormat';

export function startScheduler(): void {
  // 08:30 — закрытие ночной смены (shift2 вчера)
  cron.schedule('30 8 * * *', async () => {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    logger.info(`[Scheduler] Triggered: shift2 for ${yesterday}`);
    try {
      const result = await runShiftFetch(yesterday, 'shift2');
      logger.info('[Scheduler] shift2 done', result);
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
      const result = await runShiftFetch(today, 'shift1');
      logger.info('[Scheduler] shift1 done', result);
    } catch (err) {
      logger.error('[Scheduler] shift1 failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  logger.info('[Scheduler] Started. Jobs: 08:30 (shift2/yesterday), 20:30 (shift1/today) [Asia/Yekaterinburg]');
}
