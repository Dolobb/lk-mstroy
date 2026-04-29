import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
  | 'spawn'
  | 'cron'
  | 'handler'
  | 'http'
  | 'reconcile'
  | 'pipeline'
  | 'boss'
  | 'admin';

export interface LogEvent {
  ts: string;
  level: LogLevel;
  category: LogCategory;
  service?: string;
  runId?: string;
  pipeline?: string;
  date?: string;
  shift?: string;
  msg: string;
  fields?: Record<string, unknown>;
}

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const JSONL_PATH = path.join(LOG_DIR, 'admin.jsonl');
const HUMAN_PATH = path.join(LOG_DIR, 'admin.log');
const MAX_BYTES = 20 * 1024 * 1024;

function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* exists */ }
}

function rotateIfNeeded(file: string) {
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_BYTES) {
      try { fs.rmSync(file + '.1', { force: true }); } catch { /* nothing to remove */ }
      fs.renameSync(file, file + '.1');
    }
  } catch { /* file missing → first write creates it */ }
}

export function logEvent(ev: Omit<LogEvent, 'ts'>): void {
  const full: LogEvent = { ts: new Date().toISOString(), ...ev };
  try {
    ensureDir();
    rotateIfNeeded(JSONL_PATH);
    fs.appendFileSync(JSONL_PATH, JSON.stringify(full) + '\n', 'utf8');
    rotateIfNeeded(HUMAN_PATH);
    const tag = `[${full.category}${full.service ? '/' + full.service : ''}]`;
    const ctx = full.runId ? ` run=${full.runId.slice(0, 8)}` : '';
    const ctx2 = full.pipeline ? ` pipe=${full.pipeline}` : '';
    fs.appendFileSync(
      HUMAN_PATH,
      `${full.ts} ${full.level.toUpperCase().padEnd(5)} ${tag}${ctx2}${ctx} ${full.msg}\n`,
      'utf8',
    );
  } catch { /* never let logging break the caller */ }
  if (full.level === 'error') {
    console.error(`[${full.category}] ${full.msg}`, full.fields ?? '');
  } else if (full.level === 'warn') {
    console.warn(`[${full.category}] ${full.msg}`, full.fields ?? '');
  }
}

export const log = {
  info:  (e: Omit<LogEvent, 'ts' | 'level'>) => logEvent({ ...e, level: 'info' }),
  warn:  (e: Omit<LogEvent, 'ts' | 'level'>) => logEvent({ ...e, level: 'warn' }),
  error: (e: Omit<LogEvent, 'ts' | 'level'>) => logEvent({ ...e, level: 'error' }),
  debug: (e: Omit<LogEvent, 'ts' | 'level'>) => logEvent({ ...e, level: 'debug' }),
};

export const LOG_PATHS = { jsonl: JSONL_PATH, human: HUMAN_PATH, dir: LOG_DIR };
