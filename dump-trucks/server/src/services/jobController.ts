/**
 * Cooperative job cancellation primitive.
 *
 * Each "job kind" (fetch, recalculate, segments) owns one controller registered
 * via `getJobController(kind)`. Routes that start a job call `reset()` to obtain
 * a fresh AbortController; routes that cancel a job call `cancel()` to abort
 * the in-flight signal AND set a polled flag.
 *
 * Long-running runners check `throwIfCancelled()` between iterations, and pass
 * `signal` to TIS API calls so axios aborts mid-request.
 */

export type JobKind = 'fetch' | 'recalculate' | 'segments';

export class CancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export class JobController {
  private controller: AbortController = new AbortController();
  private cancelled = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  reset(): void {
    this.cancelled = false;
    this.controller = new AbortController();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    try { this.controller.abort(); } catch { /* noop */ }
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError();
  }
}

const controllers: Record<JobKind, JobController> = {
  fetch:       new JobController(),
  recalculate: new JobController(),
  segments:    new JobController(),
};

export function getJobController(kind: JobKind): JobController {
  return controllers[kind];
}

export function isCancelledError(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  const e = err as { code?: string; name?: string };
  if (e?.code === 'ERR_CANCELED') return true;
  if (e?.name === 'CanceledError' || e?.name === 'AbortError') return true;
  return false;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new CancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
