/**
 * Pipeline run tracker — тонкая обёртка над admin REST API (`/api/admin/pipeline-runs/*`).
 *
 * Feature-gated: если admin недоступен или `PIPELINE_TRACKING=false`,
 * все методы — no-op. Никогда не бросает.
 *
 * Дублирует kip/server/src/services/pipelineTracker.ts — имеет смысл вынести
 * в общий пакет, но монорепо пока без shared-workspace.
 */

import { logger } from '../utils/logger';

const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3005';
const TRACKING_ENABLED = process.env.PIPELINE_TRACKING !== 'false';

export type TriggerType = 'cron' | 'manual' | 'cascade';

export interface PipelineTracker {
  runId: string | null;
  complete(stats: { totalVehicles?: number; successCount?: number; errorCount?: number; errors?: unknown[] }): Promise<void>;
  fail(message: string): Promise<void>;
  addError(error: { message: string; vehicleId?: string }): Promise<void>;
}

async function post(path: string, body: unknown): Promise<Response | null> {
  try {
    const r = await fetch(`${ADMIN_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      logger.warn(`[pipelineTracker] ${path} responded ${r.status}`);
      return null;
    }
    return r;
  } catch (err) {
    logger.warn(`[pipelineTracker] ${path} failed`, err);
    return null;
  }
}

export async function startPipelineRun(params: {
  pipelineName: string;
  triggerType: TriggerType;
  targetDate: string;
  shiftType?: string | null;
  configSnapshot?: unknown;
}): Promise<PipelineTracker> {
  const noopTracker: PipelineTracker = {
    runId: null,
    async complete() {},
    async fail() {},
    async addError() {},
  };

  if (!TRACKING_ENABLED) return noopTracker;

  const res = await post('/api/admin/pipeline-runs/start', params);
  if (!res) return noopTracker;

  const data = (await res.json().catch(() => null)) as { runId?: string } | null;
  const runId = data?.runId ?? null;
  if (!runId) return noopTracker;

  return {
    runId,
    async complete(stats) {
      await post(`/api/admin/pipeline-runs/${runId}/complete`, stats);
    },
    async fail(message) {
      await post(`/api/admin/pipeline-runs/${runId}/fail`, { message });
    },
    async addError(error) {
      await post(`/api/admin/pipeline-runs/${runId}/errors`, error);
    },
  };
}
