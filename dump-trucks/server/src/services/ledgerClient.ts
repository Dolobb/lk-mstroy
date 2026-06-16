/**
 * Ledger client для dump-trucks (pipeline dt-shift / dt-segments).
 *
 * Контракт: INGEST_LEDGER_SPEC.md (корень монорепо).
 * Best-effort: ошибки ledger'а никогда не валят пайплайн — только logger.warn.
 * Каждый mark* пишет строку в ingest.task_events.
 *
 * Использует существующий пул из config/database.ts (уже смотрит в mstroy).
 */

import { getPool } from '../config/database';
import { logger } from '../utils/logger';

export type LedgerStatus = 'pending' | 'running' | 'done' | 'empty' | 'failed';

export interface EnsureTaskParams {
  pipeline: string;
  unitKey: string;
  targetDate: string;       // YYYY-MM-DD
  shiftType?: string;
  vehicleRef: string;
  vehicleLabel?: string;
}

// ---------------------------------------------------------------------------
// ensureTask
// ---------------------------------------------------------------------------

/**
 * Upsert pending (ON CONFLICT DO NOTHING) и вернуть id.
 * Возвращает null при любой ошибке.
 */
export async function ensureTask(p: EnsureTaskParams): Promise<number | null> {
  try {
    const pool = getPool();
    // Insert if not exists, then SELECT id regardless.
    const res = await pool.query<{ id: number }>(
      `INSERT INTO ingest.tasks
         (pipeline, unit_key, target_date, shift_type, vehicle_ref, vehicle_label, status, attempt)
       VALUES ($1, $2, $3::date, $4, $5, $6, 'pending', 0)
       ON CONFLICT (pipeline, unit_key) DO NOTHING
       RETURNING id`,
      [p.pipeline, p.unitKey, p.targetDate, p.shiftType ?? null, p.vehicleRef, p.vehicleLabel ?? null],
    );

    if (res.rows.length > 0) {
      return res.rows[0]!.id;
    }

    // Row already existed — fetch its id
    const sel = await pool.query<{ id: number }>(
      `SELECT id FROM ingest.tasks WHERE pipeline = $1 AND unit_key = $2`,
      [p.pipeline, p.unitKey],
    );
    return sel.rows[0]?.id ?? null;
  } catch (err) {
    logger.warn(`[Ledger] ensureTask failed (${p.pipeline}/${p.unitKey}): ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// markRunning
// ---------------------------------------------------------------------------

export async function markRunning(taskId: number, runId?: string): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE ingest.tasks
          SET status = 'running', run_id = $2, started_at = now(), finished_at = NULL
        WHERE id = $1`,
      [taskId, runId ?? null],
    );
    await pool.query(
      `INSERT INTO ingest.task_events (task_id, status) VALUES ($1, 'running')`,
      [taskId],
    );
  } catch (err) {
    logger.warn(`[Ledger] markRunning(${taskId}) failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// markDone
// ---------------------------------------------------------------------------

export async function markDone(
  taskId: number,
  result?: Record<string, unknown>,
  reasonCode?: string,
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE ingest.tasks
          SET status = 'done', reason_code = $2, result = $3, finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode ?? null, result ? JSON.stringify(result) : null],
    );
    await pool.query(
      `INSERT INTO ingest.task_events (task_id, status, reason_code, meta)
       VALUES ($1, 'done', $2, $3)`,
      [taskId, reasonCode ?? null, result ? JSON.stringify(result) : null],
    );
  } catch (err) {
    logger.warn(`[Ledger] markDone(${taskId}) failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// markEmpty
// ---------------------------------------------------------------------------

export async function markEmpty(
  taskId: number,
  reasonCode: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE ingest.tasks
          SET status = 'empty', reason_code = $2, finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode],
    );
    await pool.query(
      `INSERT INTO ingest.task_events (task_id, status, reason_code, meta)
       VALUES ($1, 'empty', $2, $3)`,
      [taskId, reasonCode, meta ? JSON.stringify(meta) : null],
    );
  } catch (err) {
    logger.warn(`[Ledger] markEmpty(${taskId}, ${reasonCode}) failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// markFailed — инкрементирует attempt
// ---------------------------------------------------------------------------

export async function markFailed(
  taskId: number,
  reasonCode: string,
  error: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE ingest.tasks
          SET status = 'failed', reason_code = $2, last_error = $3,
              attempt = attempt + 1, finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode, error],
    );
    await pool.query(
      `INSERT INTO ingest.task_events (task_id, status, reason_code, error, meta)
       VALUES ($1, 'failed', $2, $3, $4)`,
      [taskId, reasonCode, error, meta ? JSON.stringify(meta) : null],
    );
  } catch (err) {
    logger.warn(`[Ledger] markFailed(${taskId}, ${reasonCode}) failed: ${String(err)}`);
  }
}
