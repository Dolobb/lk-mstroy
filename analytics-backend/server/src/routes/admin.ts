import { Router } from 'express';
import { runAnalyticsFetch } from '../jobs/analyticsFetchJob';
import { logger } from '../utils/logger';

const jobs = new Map<string, { status: string; result?: unknown; error?: string }>();

export function adminRouter(): Router {
  const router = Router();

  router.post('/analytics/admin/fetch', (req, res) => {
    const date = req.query.date as string | undefined;
    const force = req.query.force === 'true';

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: '"date" required in YYYY-MM-DD format' });
      return;
    }

    const jobId = `fetch-${date}-${Date.now()}`;
    jobs.set(jobId, { status: 'running' });

    logger.info(`Manual analytics fetch: ${date} force=${force} job=${jobId}`);
    runAnalyticsFetch(date, force)
      .then(result => {
        jobs.set(jobId, { status: 'done', result });
        logger.info(`Analytics fetch done: ${date}`, result);
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        jobs.set(jobId, { status: 'error', error: msg });
        logger.error(`Analytics fetch failed: ${date}`, err);
      });

    res.json({ status: 'accepted', jobId, date });
  });

  router.get('/analytics/admin/fetch/status', (req, res) => {
    const jobId = req.query.jobId as string | undefined;
    if (!jobId) {
      res.status(400).json({ error: '"jobId" required' });
      return;
    }
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ status: 'not_found' });
      return;
    }
    res.json(job);
  });

  return router;
}
