import { Router } from 'express';
import { runAnalyticsFetch } from '../jobs/analyticsFetchJob';
import { getPool } from '../db';
import { computeVisitedObjectsForPoints } from '../services/visitedObjects';
import { logger } from '../utils/logger';

const JOB_TTL_MS = 3600_000;
const jobs = new Map<string, { status: string; result?: unknown; error?: string }>();

function scheduleCleanup(jobId: string) {
  setTimeout(() => { jobs.delete(jobId); }, JOB_TTL_MS);
}

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
    scheduleCleanup(jobId);

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

  router.post('/analytics/admin/backfill-objects', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    if (!from || !to) {
      res.status(400).json({ error: '"from" and "to" required in YYYY-MM-DD format' });
      return;
    }

    const jobId = `backfill-${from}-${to}-${Date.now()}`;
    jobs.set(jobId, { status: 'running' });
    scheduleCleanup(jobId);

    logger.info(`Backfill objects: ${from} to ${to} job=${jobId}`);

    runBackfillObjects(from, to, jobId)
      .then(result => {
        jobs.set(jobId, { status: 'done', result });
        logger.info(`Backfill objects done: ${from} to ${to}`, result);
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        jobs.set(jobId, { status: 'error', error: msg });
        logger.error(`Backfill objects failed: ${from} to ${to}`, err);
      });

    res.json({ status: 'accepted', jobId, from, to });
  });

  return router;
}

async function runBackfillObjects(from: string, to: string, jobId: string): Promise<{ updated: number; errors: string[] }> {
  const pool = getPool();
  const result = { updated: 0, errors: [] as string[] };

  const sessions = await pool.query<{ id: string; vehicle_id: string }>(
    `SELECT id, vehicle_id FROM analytics.track_sessions
     WHERE date >= $1 AND date <= $2
       AND cardinality(visited_objects) = 0`,
    [from, to],
  );

  logger.info(`Backfill ${jobId}: ${sessions.rows.length} sessions to process`);

  for (const session of sessions.rows) {
    try {
      const points = await pool.query<{ lat: number; lng: number }>(
        `SELECT lat, lng FROM analytics.track_points
         WHERE session_id = $1
         ORDER BY ts`,
        [session.id],
      );

      if (points.rows.length === 0) continue;

      const visited = await computeVisitedObjectsForPoints(pool, points.rows);
      if (visited.length > 0) {
        await pool.query(
          `UPDATE analytics.track_sessions SET visited_objects = $1 WHERE id = $2`,
          [visited, session.id],
        );
        result.updated++;
      }
    } catch (err) {
      result.errors.push(`${session.vehicle_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
