// Ingest ledger client — контракт: INGEST_LEDGER_SPEC.md в корне монорепо.
//
// Best-effort: ошибки ledger'а НИКОГДА не валят пайплайн — только logger.warn.
// Каждый mark* пишет также строку в ingest.task_events.
// Пул — существующий getPool() (mstroy, PG17).

import { getPool } from '../db';
import { logger } from '../utils/logger';

export type LedgerStatus = 'pending' | 'running' | 'done' | 'empty' | 'failed';

export interface EnsureTaskParams {
  pipeline: string;
  unitKey: string;
  targetDate: string;
  shiftType?: string;
  vehicleRef: string;
  vehicleLabel?: string;
}

async function recordEvent(
  taskId: number,
  status: LedgerStatus,
  reasonCode: string | null,
  error: string | null,
  meta: Record<string, unknown> | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO ingest.task_events (task_id, status, reason_code, error, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [taskId, status, reasonCode, error, meta ? JSON.stringify(meta) : null],
  );
}

/**
 * Upsert pending task. ON CONFLICT (pipeline, unit_key) DO NOTHING + SELECT id.
 * Возвращает id задачи или null при ошибке (best-effort).
 */
export async function ensureTask(p: EnsureTaskParams): Promise<number | null> {
  try {
    const pool = getPool();
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ingest.tasks
         (pipeline, unit_key, target_date, shift_type, vehicle_ref, vehicle_label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (pipeline, unit_key) DO NOTHING
       RETURNING id`,
      [p.pipeline, p.unitKey, p.targetDate, p.shiftType ?? null, p.vehicleRef, p.vehicleLabel ?? null],
    );

    if (res.rows[0]?.id) {
      return Number(res.rows[0].id);
    }

    // Конфликт: задача уже есть — достаём её id.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM ingest.tasks WHERE pipeline = $1 AND unit_key = $2 LIMIT 1`,
      [p.pipeline, p.unitKey],
    );
    return existing.rows[0]?.id ? Number(existing.rows[0].id) : null;
  } catch (err) {
    logger.warn(`ledger.ensureTask failed (${p.pipeline} ${p.unitKey}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function markRunning(taskId: number, runId?: string): Promise<void> {
  try {
    await getPool().query(
      `UPDATE ingest.tasks
         SET status = 'running',
             started_at = now(),
             run_id = COALESCE($2, run_id)
       WHERE id = $1`,
      [taskId, runId ?? null],
    );
    await recordEvent(taskId, 'running', null, null, null);
  } catch (err) {
    logger.warn(`ledger.markRunning failed (task ${taskId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function markDone(
  taskId: number,
  result?: Record<string, unknown>,
  reasonCode?: string,
): Promise<void> {
  try {
    await getPool().query(
      `UPDATE ingest.tasks
         SET status = 'done',
             reason_code = $2,
             result = $3,
             last_error = NULL,
             finished_at = now()
       WHERE id = $1`,
      [taskId, reasonCode ?? null, result ? JSON.stringify(result) : null],
    );
    await recordEvent(taskId, 'done', reasonCode ?? null, null, result ?? null);
  } catch (err) {
    logger.warn(`ledger.markDone failed (task ${taskId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function markEmpty(
  taskId: number,
  reasonCode: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await getPool().query(
      `UPDATE ingest.tasks
         SET status = 'empty',
             reason_code = $2,
             last_error = NULL,
             finished_at = now()
       WHERE id = $1`,
      [taskId, reasonCode],
    );
    await recordEvent(taskId, 'empty', reasonCode, null, meta ?? null);
  } catch (err) {
    logger.warn(`ledger.markEmpty failed (task ${taskId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** markFailed инкрементирует attempt. */
export async function markFailed(
  taskId: number,
  reasonCode: string,
  error: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await getPool().query(
      `UPDATE ingest.tasks
         SET status = 'failed',
             reason_code = $2,
             last_error = $3,
             attempt = attempt + 1,
             finished_at = now()
       WHERE id = $1`,
      [taskId, reasonCode, error],
    );
    await recordEvent(taskId, 'failed', reasonCode, error, meta ?? null);
  } catch (err) {
    logger.warn(`ledger.markFailed failed (task ${taskId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
