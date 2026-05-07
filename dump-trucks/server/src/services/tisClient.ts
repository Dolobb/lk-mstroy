import axios, { AxiosError } from 'axios';
import { TokenPool } from './tokenPool';
import { PerVehicleRateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';
import { formatDateParam, formatDateTimeParam } from '../utils/dateFormat';
import { CancelledError, abortableSleep, isCancelledError } from './jobController';
import type {
  TisRequest,
  TisRouteList,
  TisMonitoringStats,
  TisPassport,
  TisPassportsResponse,
} from '../types/tis-api';

interface TisClientOptions {
  baseUrl: string;
  tokenPool: TokenPool;
  rateLimiter: PerVehicleRateLimiter;
}

const MAX_RETRY_429 = 5;
const BACKOFF_429_BASE_MS = 10_000;

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
  private rateLimiter: PerVehicleRateLimiter;
  public stats: TisClientStats = {
    requests: 0, retry429: 0, retryTimeout: 0, http404: 0, otherErrors: 0,
  };

  constructor(options: TisClientOptions) {
    this.baseUrl = options.baseUrl;
    this.tokenPool = options.tokenPool;
    this.rateLimiter = options.rateLimiter;
  }

  getRateLimiter(): PerVehicleRateLimiter {
    return this.rateLimiter;
  }

  resetStats(): void {
    this.stats = { requests: 0, retry429: 0, retryTimeout: 0, http404: 0, otherErrors: 0 };
  }

  private async requestWithRetry<T>(
    command: string,
    params: Record<string, string | number>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const token = this.tokenPool.next();
    const urlParams = new URLSearchParams({
      token,
      format: 'json',
      command,
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ),
    });
    const url = `${this.baseUrl}?${urlParams}`;

    for (let attempt429 = 0; attempt429 <= MAX_RETRY_429; attempt429++) {
      if (signal?.aborted) throw new CancelledError();
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
            if (attempt429 < MAX_RETRY_429) {
              const waitMs = BACKOFF_429_BASE_MS * (attempt429 + 1);
              logger.warn(`429 Rate limit on ${command}, retry ${attempt429 + 1}/${MAX_RETRY_429} in ${waitMs}ms`);
              await abortableSleep(waitMs, signal);
              break;
            }
            throw new Error(`429 Rate limit exceeded after ${MAX_RETRY_429} retries: ${command}`);
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
    }

    throw new Error(`Exceeded all retries for ${command}`);
  }

  async getRequests(fromDate: Date, toDate: Date, signal?: AbortSignal): Promise<TisRequest[]> {
    const result = await this.requestWithRetry<{ list: TisRequest[] }>(
      'getRequests',
      {
        fromDate: formatDateParam(fromDate),
        toDate:   formatDateParam(toDate),
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
        toDate:   formatDateParam(toDate),
      },
      signal,
    );
    return result?.list ?? [];
  }

  async getPassports(signal?: AbortSignal): Promise<TisPassport[]> {
    const result = await this.requestWithRetry<TisPassportsResponse>(
      'getPassports',
      {},
      signal,
    );
    return result?.passports ?? [];
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
        toDate:   formatDateTimeParam(toDate),
      },
      signal,
    );
  }

}
