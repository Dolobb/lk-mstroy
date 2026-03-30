import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { config } from './config';
import { chatHandler } from './chat/handler';
import { metaHandler } from './reports/meta';
import { generateHandler } from './reports/generate';
import { closePg16 } from './db/pg16';
import { closePg17 } from './db/pg17';
import { closeSqlite } from './db/sqlite';

const app = express();
app.use(cors());
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────────────────

app.get('/api/reports/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ai-reports', port: config.port });
});

// ─── Report constructor ─────────────────────────────────────────────────────

app.get('/api/reports/meta', metaHandler);
app.post('/api/reports/generate', generateHandler);

// ─── Chat endpoint (SSE streaming) ──────────────────────────────────────────

app.post('/api/reports/chat', chatHandler);

// ─── File download ───────────────────────────────────────────────────────────

app.get('/api/reports/files/:id', (req, res) => {
  const filePath = `${config.outputDir}/${req.params.id}.xlsx`;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.xlsx"`);
  fs.createReadStream(filePath).pipe(res);
});

// ─── Ensure output dir ──────────────────────────────────────────────────────

if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// ─── Graceful shutdown ──────────────────────────────────────────────────────

async function shutdown() {
  console.log('[ai-reports] Shutting down...');
  await closePg16();
  await closePg17();
  closeSqlite();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[ai-reports] Running on :${config.port}`);
});
