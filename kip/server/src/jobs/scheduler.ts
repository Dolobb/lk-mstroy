import cron from 'node-cron';
import { runDailyFetch } from './dailyFetchJob';
import { logger } from '../utils/logger';

export function startScheduler(): void {
  // Run at 08:30 Yekaterinburg time (UTC+5).
  // Вечерняя смена заканчивается в 07:30 — запускаем через час,
  // чтобы TIS API успел обработать все данные за смену.
  cron.schedule('30 8 * * *', async () => {
    logger.info('Scheduled daily fetch triggered');
    try {
      await runDailyFetch();
    } catch (err) {
      logger.error('Scheduled daily fetch failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  logger.info('Scheduler started: daily fetch at 08:30 Asia/Yekaterinburg');
}
