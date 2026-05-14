import axios, { AxiosError } from 'axios';
import { TokenPool } from './tokenPool';
import { PerTokenRateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';
import { formatDateTimeParam } from '../utils/dateFormat';
import { CancelledError, abortableSleep, isCancelledError } from './jobController';
import type { TisMonitoringStats } from '../types/tis-api';

interface TisClientOptions {
  baseUrl: string;
  tokenPool: TokenPool;
  rateLimiter: PerTokenRateLimiter;
}

const MAX_RETRY_TIMEOUT = 3;
const BACKOFF_TIMEOUT_BASE_MS = 1_000;

export interface TisClientStats {
  requests: number;
  retry429: number;
  retryTimeout: number;
  http404: number;
  otherErrors: number;
}

export class TisClient {
  private baseUrl: string;
  private tokenPool: TokenPool;
  private rateLimiter: PerTokenRateLimiter;
  public stats: TisClientStats = {
    requests: 0, retry429: 0, retryTimeout: 0, http404: 0, otherErrors: 0,
  };

  constructor(options: TisClientOptions) {
    this.baseUrl = options.baseUrl;
    this.tokenPool = options.tokenPool;
    this.rateLimiter = options.rateLimiter;
  }

  get tokens(): TokenPool {
    return this.tokenPool;
  }

  resetStats(): void {
    this.stats = { requests: 0, retry429: 0, retryTimeout: 0, http404: 0, otherErrors: 0 };
  }

  private async requestWithRetry<T>(
    command: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const baseParams = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    );

    const totalTokens = this.tokenPool.size;
    for (let tokenAttempt = 0; tokenAttempt <= totalTokens; tokenAttempt++) {
      if (signal?.aborted) throw new CancelledError();
      if (tokenAttempt === totalTokens) {
        logger.warn(`429 on all ${totalTokens} tokens for ${command}, waiting 30s`);
        await abortableSleep(30_000, signal);
      }

      const token = this.tokenPool.next();

      const idMO = params.idMO as number | undefined;
      if (idMO !== undefined) {
        await this.rateLimiter.waitForSlot(token, idMO, signal);
      }

      const url = `${this.baseUrl}?${new URLSearchParams({ token, format: 'json', command, ...baseParams })}`;

      let got429 = false;

      for (let attemptTimeout = 0; attemptTimeout <= MAX_RETRY_TIMEOUT; attemptTimeout++) {
        if (signal?.aborted) throw new CancelledError();
        try {
          this.stats.requests++;
          const response = await axios.post<T>(url, null, { timeout: 30_000, signal });
          return response.data;
        } catch (err) {
          if (isCancelledError(err)) throw new CancelledError();
          const axiosErr = err as AxiosError;

          if (axiosErr.response?.status === 404) {
            this.stats.http404++;
            logger.warn(`404 Not Found: ${command}`, params);
            return null;
          }

          if (axiosErr.response?.status === 429) {
            this.stats.retry429++;
            logger.warn(`429 on token attempt ${tokenAttempt + 1}/${totalTokens} for ${command}`);
            got429 = true;
            break;
          }

          if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
            this.stats.retryTimeout++;
            if (attemptTimeout < MAX_RETRY_TIMEOUT) {
              const waitMs = BACKOFF_TIMEOUT_BASE_MS * Math.pow(2, attemptTimeout);
              logger.warn(`Timeout on ${command}, retry ${attemptTimeout + 1}/${MAX_RETRY_TIMEOUT} in ${waitMs}ms`);
              await abortableSleep(waitMs, signal);
              continue;
            }
            throw new Error(`Timeout after ${MAX_RETRY_TIMEOUT} retries: ${command}`);
          }

          this.stats.otherErrors++;
          throw err;
        }
      }

      if (!got429) break;
    }

    throw new Error(`429 for all ${totalTokens + 1} token attempts on ${command}`);
  }

  async getMonitoringStats(
    idMO: number,
    fromDate: Date,
    toDate: Date,
    signal?: AbortSignal,
  ): Promise<TisMonitoringStats | null> {
    if (signal?.aborted) throw new CancelledError();

    return this.requestWithRetry<TisMonitoringStats>(
      'getMonitoringStats',
      {
        idMO,
        fromDate: formatDateTimeParam(fromDate),
        toDate: formatDateTimeParam(toDate),
      },
      signal,
    );
  }
}
