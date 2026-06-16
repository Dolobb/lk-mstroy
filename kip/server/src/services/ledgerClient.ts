/**
 * Ingest Ledger client — write-through учёт единиц работы пайплайнов КИП.
 *
 * Контракт описан в корневом INGEST_LEDGER_SPEC.md. Таблицы ingest.tasks /
 * ingest.task_events живут в БД mstroy (второй пул — getMainPool()).
 *
 * **Best-effort**: любая ошибка ledger'а НЕ должна валить пайплайн —
 * только logger.warn. Поэтому все публичные функции ловят исключения.
 * Каждый mark* дополнительно пишет строку в ingest.task_events.
 */

import { getMainPool } from '../config/database';
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

/**
 * Записать событие в ingest.task_events. Best-effort, не бросает.
 */
async function appendEvent(
  taskId: number,
  status: LedgerStatus,
  reasonCode?: string | null,
  error?: string | null,
  meta?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await getMainPool().query(
      `INSERT INTO ingest.task_events (task_id, status, reason_code, error, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        taskId,
        status,
        reasonCode ?? null,
        error ?? null,
        meta != null ? JSON.stringify(meta) : null,
      ],
    );
  } catch (err) {
    logger.warn(`[ledger] appendEvent failed for task ${taskId}: ${String(err)}`);
  }
}

/**
 * Upsert pending-задачи. ON CONFLICT (pipeline, unit_key) DO NOTHING + SELECT id.
 * Возвращает id задачи или null при любой ошибке.
 */
export async function ensureTask(p: EnsureTaskParams): Promise<number | null> {
  try {
    const res = await getMainPool().query<{ id: number }>(
      `INSERT INTO ingest.tasks
         (pipeline, unit_key, target_date, shift_type, vehicle_ref, vehicle_label, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (pipeline, unit_key) DO NOTHING
       RETURNING id`,
      [
        p.pipeline,
        p.unitKey,
        p.targetDate,
        p.shiftType ?? null,
        p.vehicleRef,
        p.vehicleLabel ?? null,
      ],
    );
    if (res.rows[0]?.id != null) {
      return res.rows[0].id;
    }
    // Конфликт — задача уже есть, дочитываем её id.
    const existing = await getMainPool().query<{ id: number }>(
      `SELECT id FROM ingest.tasks WHERE pipeline = $1 AND unit_key = $2`,
      [p.pipeline, p.unitKey],
    );
    return existing.rows[0]?.id ?? null;
  } catch (err) {
    logger.warn(`[ledger] ensureTask failed (${p.pipeline} ${p.unitKey}): ${String(err)}`);
    return null;
  }
}

export async function markRunning(taskId: number, runId?: string): Promise<void> {
  try {
    await getMainPool().query(
      `UPDATE ingest.tasks
          SET status = 'running',
              run_id = COALESCE($2, run_id),
              started_at = now()
        WHERE id = $1`,
      [taskId, runId ?? null],
    );
    await appendEvent(taskId, 'running', null, null, runId ? { runId } : null);
  } catch (err) {
    logger.warn(`[ledger] markRunning failed for task ${taskId}: ${String(err)}`);
  }
}

export async function markDone(
  taskId: number,
  result?: Record<string, unknown>,
  reasonCode?: string,
): Promise<void> {
  try {
    await getMainPool().query(
      `UPDATE ingest.tasks
          SET status = 'done',
              reason_code = $2,
              result = $3,
              last_error = NULL,
              finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode ?? null, result != null ? JSON.stringify(result) : null],
    );
    await appendEvent(taskId, 'done', reasonCode, null, result ?? null);
  } catch (err) {
    logger.warn(`[ledger] markDone failed for task ${taskId}: ${String(err)}`);
  }
}

export async function markEmpty(
  taskId: number,
  reasonCode: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await getMainPool().query(
      `UPDATE ingest.tasks
          SET status = 'empty',
              reason_code = $2,
              finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode],
    );
    await appendEvent(taskId, 'empty', reasonCode, null, meta ?? null);
  } catch (err) {
    logger.warn(`[ledger] markEmpty failed for task ${taskId}: ${String(err)}`);
  }
}

/**
 * Пометить задачу failed: инкрементировать attempt, записать last_error.
 */
export async function markFailed(
  taskId: number,
  reasonCode: string,
  error: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await getMainPool().query(
      `UPDATE ingest.tasks
          SET status = 'failed',
              reason_code = $2,
              last_error = $3,
              attempt = attempt + 1,
              finished_at = now()
        WHERE id = $1`,
      [taskId, reasonCode, error],
    );
    await appendEvent(taskId, 'failed', reasonCode, error, meta ?? null);
  } catch (err) {
    logger.warn(`[ledger] markFailed failed for task ${taskId}: ${String(err)}`);
  }
}
