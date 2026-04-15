import { Pool } from 'pg';

export interface PipelineRun {
  run_id: string;
  pipeline_name: string;
  trigger_type: 'cron' | 'manual' | 'cascade';
  target_date: string;
  shift_type: string | null;
  status: 'running' | 'completed' | 'failed' | 'partial';
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_vehicles: number;
  success_count: number;
  error_count: number;
  errors: unknown[];
  config_snapshot: unknown | null;
}

export interface CronHealthRow {
  pipeline_name: string;
  last_run: string | null;
  last_success: string | null;
  runs_7d: number;
  failures_7d: number;
}

export function createPipelineRunRepo(pool: Pool) {
  return {
    async createRun(params: {
      pipelineName: string;
      triggerType: 'cron' | 'manual' | 'cascade';
      targetDate: string;
      shiftType?: string | null;
      configSnapshot?: unknown;
    }): Promise<string> {
      const res = await pool.query(
        `INSERT INTO public.pipeline_runs (pipeline_name, trigger_type, target_date, shift_type, config_snapshot)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING run_id`,
        [
          params.pipelineName,
          params.triggerType,
          params.targetDate,
          params.shiftType ?? null,
          params.configSnapshot ? JSON.stringify(params.configSnapshot) : null,
        ],
      );
      return res.rows[0].run_id;
    },

    async completeRun(runId: string, stats: {
      totalVehicles?: number;
      successCount?: number;
      errorCount?: number;
      errors?: unknown[];
    }): Promise<void> {
      await pool.query(
        `UPDATE public.pipeline_runs
         SET status = 'completed',
             completed_at = now(),
             duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000,
             total_vehicles = COALESCE($2, total_vehicles),
             success_count = COALESCE($3, success_count),
             error_count = COALESCE($4, error_count),
             errors = COALESCE($5::jsonb, errors)
         WHERE run_id = $1`,
        [
          runId,
          stats.totalVehicles ?? null,
          stats.successCount ?? null,
          stats.errorCount ?? null,
          stats.errors ? JSON.stringify(stats.errors) : null,
        ],
      );
    },

    async failRun(runId: string, errorMessage: string): Promise<void> {
      await pool.query(
        `UPDATE public.pipeline_runs
         SET status = 'failed',
             completed_at = now(),
             duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000,
             error_count = error_count + 1,
             errors = errors || $2::jsonb
         WHERE run_id = $1`,
        [runId, JSON.stringify([{ message: errorMessage, at: new Date().toISOString() }])],
      );
    },

    async addError(runId: string, error: { message: string; vehicleId?: string }): Promise<void> {
      await pool.query(
        `UPDATE public.pipeline_runs
         SET errors = errors || $2::jsonb,
             error_count = error_count + 1
         WHERE run_id = $1`,
        [runId, JSON.stringify([{ ...error, at: new Date().toISOString() }])],
      );
    },

    async getRunsByRange(params: {
      from?: string;
      to?: string;
      pipelineName?: string;
      status?: string;
      limit?: number;
    }): Promise<PipelineRun[]> {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (params.from) {
        conditions.push(`started_at >= $${idx}::timestamptz`);
        values.push(params.from);
        idx++;
      }
      if (params.to) {
        conditions.push(`started_at <= ($${idx}::date + interval '1 day')`);
        values.push(params.to);
        idx++;
      }
      if (params.pipelineName) {
        conditions.push(`pipeline_name = $${idx}`);
        values.push(params.pipelineName);
        idx++;
      }
      if (params.status) {
        conditions.push(`status = $${idx}`);
        values.push(params.status);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = params.limit ?? 50;

      const res = await pool.query(
        `SELECT * FROM public.pipeline_runs ${where} ORDER BY started_at DESC LIMIT ${limit}`,
        values,
      );
      return res.rows;
    },

    async getLastSuccess(pipelineName: string): Promise<PipelineRun | null> {
      const res = await pool.query(
        `SELECT * FROM public.pipeline_runs
         WHERE pipeline_name = $1 AND status = 'completed'
         ORDER BY started_at DESC LIMIT 1`,
        [pipelineName],
      );
      return res.rows[0] ?? null;
    },

    async getCronHealth(): Promise<CronHealthRow[]> {
      const res = await pool.query(`
        SELECT
          pipeline_name,
          MAX(started_at)::text AS last_run,
          MAX(CASE WHEN status = 'completed' THEN started_at END)::text AS last_success,
          COUNT(*) FILTER (WHERE started_at > now() - interval '7 days')::int AS runs_7d,
          COUNT(*) FILTER (WHERE status = 'failed' AND started_at > now() - interval '7 days')::int AS failures_7d
        FROM public.pipeline_runs
        GROUP BY pipeline_name
      `);
      return res.rows;
    },
  };
}
