import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getPool, getKipPool } from './db';
import { logger } from './utils/logger';
import { tracksRouter } from './routes/tracks';
import { positionsRouter } from './routes/positions';
import { groupsRouter } from './routes/groups';
import { adminRouter } from './routes/admin';
import { dataStatusRouter } from './routes/dataStatus';
import { runRetention } from './jobs/retentionJob';

dotenv.config();

const app = express();
const PORT = Number(process.env.SERVER_PORT || 3007);

app.use(cors());
app.use(express.json());

app.get('/api/analytics/health', async (_req, res) => {
  let dbOk = false;
  let kipDbOk = false;
  try {
    await getPool().query('SELECT 1');
    dbOk = true;
  } catch { /* ignore */ }
  try {
    await getKipPool().query('SELECT 1');
    kipDbOk = true;
  } catch { /* ignore */ }

  const allOk = dbOk && kipDbOk;
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db: dbOk ? 'connected' : 'error',
    kipDb: kipDbOk ? 'connected' : 'error',
  });
});

app.use('/api', tracksRouter());
app.use('/api', positionsRouter());
app.use('/api', groupsRouter());
app.use('/api', adminRouter());
app.use('/api', dataStatusRouter());

export default app;

if (require.main === module || process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Analytics backend running on port ${PORT}`);
    runRetention().catch(err => logger.error('Startup retention failed', err));
  });
}
