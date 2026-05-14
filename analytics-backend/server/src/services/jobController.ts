export class CancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
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

export function isCancelledError(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  const e = err as { code?: string; name?: string; message?: string };
  if (e?.code === 'ERR_CANCELED') return true;
  if (e?.name === 'CanceledError' || e?.name === 'AbortError') return true;
  return false;
}
