import { abortableSleep } from './jobController';
import { logger } from '../utils/logger';

export class PerTokenRateLimiter {
  private lastCallMap: Map<string, number> = new Map();
  private intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  private key(token: string, idMO: number): string {
    return `${token}|${idMO}`;
  }

  async waitForSlot(token: string, idMO: number, signal?: AbortSignal): Promise<void> {
    const k = this.key(token, idMO);
    const now = Date.now();
    const lastCall = this.lastCallMap.get(k) || 0;
    const elapsed = now - lastCall;

    if (elapsed < this.intervalMs) {
      const waitMs = this.intervalMs - elapsed;
      logger.debug(`Rate limit wait: token=${token.slice(0, 6)}... idMO=${idMO} wait=${waitMs}ms`);
      await abortableSleep(waitMs, signal);
    }

    this.lastCallMap.set(k, Date.now());
  }
}
