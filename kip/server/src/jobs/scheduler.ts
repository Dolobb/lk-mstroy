import cron from 'node-cron';
import { runDailyFetch } from './dailyFetchJob';
import { runSegmentDailyJob } from './segmentDailyJob';
import { logger } from '../utils/logger';

export function startScheduler(): void {
  if (process.env.CRON_DISABLED === 'true') {
    logger.info('Cron disabled (CRON_DISABLED=true), skipping scheduler');
    return;
  }

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

  // Run at 09:30 Yekaterinburg — после основного dailyFetch (08:30),
  // когда vehicle_records за вчера уже выгружены. Ставит в очередь
  // 30-минутные сегменты для всех реально работавших ТС (engine_on_time>0),
  // у которых сегментов ещё нет.
  cron.schedule('30 9 * * *', async () => {
    logger.info('Scheduled segment daily job triggered');
    try {
      await runSegmentDailyJob();
    } catch (err) {
      logger.error('Scheduled segment daily job failed', err);
    }
  }, {
    timezone: 'Asia/Yekaterinburg',
  });

  logger.info('Scheduler started: daily fetch at 08:30, segment daily at 09:30 Asia/Yekaterinburg');
}
