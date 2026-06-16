// Unified data-status API поверх ingest.tasks (mstroy).
// Контракт: INGEST_LEDGER_SPEC.md → «Unified API статусов».
//
// GET /api/analytics/data-status?from=YYYY-MM-DD&to=YYYY-MM-DD[&vehicle=REF][&pipeline=...]
// → { units: [ { pipeline, vehicleRef, vehicleLabel, date, shift,
//                status, reasonCode, reasonLabel, attempt, lastError, finishedAt } ] }
//
// Назначение: ни одна машина не «загадочно пустая» — UI берёт причину отсюда.

import { Router } from 'express';
import { getPool } from '../db';
import { reasonLabel } from '../services/ledgerLabels';
import type { LedgerStatus } from '../services/ledgerClient';
import { logger } from '../utils/logger';

interface TaskRow {
  pipeline: string;
  vehicle_ref: string;
  vehicle_label: string | null;
  date: string;
  shift_type: string | null;
  status: LedgerStatus;
  reason_code: string | null;
  attempt: number;
  last_error: string | null;
  finished_at: Date | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dataStatusRouter(): Router {
  const router = Router();

  router.get('/analytics/data-status', async (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const vehicle = req.query.vehicle as string | undefined;
    const pipeline = req.query.pipeline as string | undefined;

    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      res.status(400).json({ error: '"from" and "to" required in YYYY-MM-DD format' });
      return;
    }

    const params: unknown[] = [from, to];
    const where: string[] = ['target_date >= $1', 'target_date <= $2'];
    if (vehicle) {
      params.push(vehicle);
      where.push(`UPPER(vehicle_ref) = UPPER($${params.length})`);
    }
    if (pipeline) {
      params.push(pipeline);
      where.push(`pipeline = $${params.length}`);
    }

    try {
      const result = await getPool().query<TaskRow>(
        `SELECT pipeline,
                vehicle_ref,
                vehicle_label,
                to_char(target_date, 'YYYY-MM-DD') AS date,
                shift_type,
                status,
                reason_code,
                attempt,
                last_error,
                finished_at
           FROM ingest.tasks
          WHERE ${where.join(' AND ')}
          ORDER BY target_date, pipeline, vehicle_ref, shift_type`,
        params,
      );

      const units = result.rows.map(r => ({
        pipeline: r.pipeline,
        vehicleRef: r.vehicle_ref,
        vehicleLabel: r.vehicle_label,
        date: r.date,
        shift: r.shift_type,
        status: r.status,
        reasonCode: r.reason_code,
        reasonLabel: reasonLabel(r.reason_code, r.status),
        attempt: r.attempt,
        lastError: r.last_error,
        finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
      }));

      res.json({ units });
    } catch (err) {
      logger.error('data-status query failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
