import axios, { AxiosInstance, AxiosError } from 'axios';
import { TokenPool } from './tokenPool';
import { PerVehicleRateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';
import { formatDateParam, formatDateTimeParam } from '../utils/dateFormat';
import { CancelledError, abortableSleep, isCancelledError } from './jobController';
import type {
  TisRequest,
  TisRouteList,
  TisMonitoringStats,
} from '../types/tis-api';

interface TisClientOptions {
  baseUrl: string;
  tokenPool: TokenPool;
  rateLimiter: PerVehicleRateLimiter;
}

const MAX_RETRY_TIMEOUT = 3;
const BACKOFF_TIMEOUT_BASE_MS = 1_000; // exponential: 1s, 2s, 4s

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
  private rateLimiter: PerVehicleRateLimiter;
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

  /**
   * All API calls: POST {baseUrl}?token=...&format=json&command=...&params
   * Empty body, all params in query string.
   *
   * 429 strategy: rotate through all tokens immediately (no wait);
   * only if ALL tokens return 429 — wait 30s and try once more.
   */
  private async requestWithRetry<T>(
    command: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const baseParams = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    );

    // Outer loop: on 429 rotate to next token; after all tokens exhausted — wait 30s once
    const totalTokens = this.tokenPool.size;
    for (let tokenAttempt = 0; tokenAttempt <= totalTokens; tokenAttempt++) {
      if (signal?.aborted) throw new CancelledError();
      if (tokenAttempt === totalTokens) {
        // All tokens returned 429 — wait 30s before final attempt
        logger.warn(`429 on all ${totalTokens} tokens for ${command}, waiting 30s`);
        await abortableSleep(30_000, signal);
      }

      const token = this.tokenPool.next();
      const url = `${this.baseUrl}?${new URLSearchParams({ token, format: 'json', command, ...baseParams })}`;

      let got429 = false;

      // Inner loop: retry on network timeout with same token
      for (let attemptTimeout = 0; attemptTimeout <= MAX_RETRY_TIMEOUT; attemptTimeout++) {
        if (signal?.aborted) throw new CancelledError();
        try {
          this.stats.requests++;
          const response = await axios.post<T>(url, null, { timeout: 30_000, signal });
          return response.data;
        } catch (err) {
          if (isCancelledError(err)) throw new CancelledError();
          const axiosErr = err as AxiosError;

          // 404 → no data
          if (axiosErr.response?.status === 404) {
            this.stats.http404++;
            logger.warn(`404 Not Found: ${command}`, params);
            return null;
          }

          // 429 → try next token immediately
          if (axiosErr.response?.status === 429) {
            this.stats.retry429++;
            logger.warn(`429 on token attempt ${tokenAttempt + 1}/${totalTokens} for ${command}`);
            got429 = true;
            break;
          }

          // Timeout → exponential backoff, retry inner loop
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

          // Other errors — throw immediately
          this.stats.otherErrors++;
          throw err;
        }
      }

      if (!got429) break; // timeout loop completed normally (shouldn't reach here, but safety)
    }

    throw new Error(`429 for all ${totalTokens + 1} token attempts on ${command}`);
  }

  async getRequests(fromDate: Date, toDate: Date, signal?: AbortSignal): Promise<TisRequest[]> {
    const result = await this.requestWithRetry<{ list: TisRequest[] }>(
      'getRequests',
      {
        fromDate: formatDateParam(fromDate),
        toDate: formatDateParam(toDate),
      },
      signal,
    );
    return result?.list ?? [];
  }

  async getRouteListsByDateOut(fromDate: Date, toDate: Date, signal?: AbortSignal): Promise<TisRouteList[]> {
    const result = await this.requestWithRetry<{ list: TisRouteList[] }>(
      'getRouteListsByDateOut',
      {
        fromDate: formatDateParam(fromDate),
        toDate: formatDateParam(toDate),
      },
      signal,
    );
    return result?.list ?? [];
  }

  async getMonitoringStats(
    idMO: number,
    fromDate: Date,
    toDate: Date,
    signal?: AbortSignal,
  ): Promise<TisMonitoringStats | null> {
    await this.rateLimiter.waitForSlot(idMO, signal);
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

  /**
   * Direct request with a specific token — no rate limiter, no token rotation.
   * Used for parallel segment fetching (24 tokens × 24 segments).
   * On 429/404: returns null. On timeout: retries with backoff.
   */
  async getMonitoringStatsDirect(
    token: string,
    idMO: number,
    fromDate: Date,
    toDate: Date,
    signal?: AbortSignal,
  ): Promise<TisMonitoringStats | null> {
    const params = new URLSearchParams({
      token,
      format: 'json',
      command: 'getMonitoringStats',
      idMO: String(idMO),
      fromDate: formatDateTimeParam(fromDate),
      toDate: formatDateTimeParam(toDate),
    });
    const url = `${this.baseUrl}?${params}`;

    for (let attempt = 0; attempt <= MAX_RETRY_TIMEOUT; attempt++) {
      if (signal?.aborted) throw new CancelledError();
      try {
        const response = await axios.post<TisMonitoringStats>(url, null, { timeout: 30_000, signal });
        return response.data;
      } catch (err) {
        if (isCancelledError(err)) throw new CancelledError();
        const axiosErr = err as AxiosError;

        if (axiosErr.response?.status === 404) {
          return null;
        }

        if (axiosErr.response?.status === 429) {
          logger.warn(`[Direct] 429 for idMO=${idMO}, token ${token.slice(0, 6)}...`);
          return null;
        }

        if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
          if (attempt < MAX_RETRY_TIMEOUT) {
            const waitMs = BACKOFF_TIMEOUT_BASE_MS * Math.pow(2, attempt);
            logger.warn(`[Direct] Timeout idMO=${idMO} seg, retry ${attempt + 1}/${MAX_RETRY_TIMEOUT} in ${waitMs}ms`);
            await abortableSleep(waitMs, signal);
            continue;
          }
          logger.error(`[Direct] Timeout after ${MAX_RETRY_TIMEOUT} retries for idMO=${idMO}`);
          return null;
        }

        logger.error(`[Direct] Unexpected error for idMO=${idMO}: ${String(err)}`);
        return null;
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
