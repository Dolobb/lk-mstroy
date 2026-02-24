import cron from 'node-cron';
import { runDailyFetch } from './dailyFetchJob';
import { logger } from '../utils/logger';

export function startScheduler(): void {
  // Run at 07:30 Yekaterinburg time (UTC+5)
  cron.schedule('30 7 * * *', async () => {
    logger.info('Scheduled daily fetch triggered');
    try {
      await runDailyFetch();
    } catch (err) {
      logger.error('Scheduled daily fetch failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  logger.info('Scheduler started: daily fetch at 07:30 Asia/Yekaterinburg');
}
