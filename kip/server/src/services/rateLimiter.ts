import { abortableSleep } from './jobController';

export class PerVehicleRateLimiter {
  private lastCallMap: Map<number, number> = new Map();
  private intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  async waitForSlot(idMO: number, signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const lastCall = this.lastCallMap.get(idMO) || 0;
    const elapsed = now - lastCall;

    if (elapsed < this.intervalMs) {
      const waitMs = this.intervalMs - elapsed;
      await abortableSleep(waitMs, signal);
    }

    this.lastCallMap.set(idMO, Date.now());
  }
}
