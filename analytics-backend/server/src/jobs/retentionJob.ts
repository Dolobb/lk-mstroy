import { getPool } from '../db';
import { logger } from '../utils/logger';

const RETENTION_DAYS = 7;

export async function runRetention(): Promise<{ deletedSessions: number }> {
  const pool = getPool();
  try {
    const res = await pool.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM analytics.track_sessions
         WHERE date < CURRENT_DATE - INTERVAL '${RETENTION_DAYS} days'
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM deleted`,
    );

    const count = Number(res.rows[0]?.count ?? 0);
    if (count > 0) {
      logger.info(`Retention: deleted ${count} old track sessions (>= ${RETENTION_DAYS} days)`);
    }
    return { deletedSessions: count };
  } catch (err) {
    logger.error('Retention job failed', err);
    return { deletedSessions: 0 };
  }
}
