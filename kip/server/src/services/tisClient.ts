import axios, { AxiosInstance, AxiosError } from 'axios';
import { TokenPool } from './tokenPool';
import { PerVehicleRateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';
import { formatDateParam, formatDateTimeParam } from '../utils/dateFormat';
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

const MAX_RETRY_429 = 5;
const BACKOFF_429_BASE_MS = 10_000;   // linear: 10s, 20s, 30s, 40s, 50s

const MAX_RETRY_TIMEOUT = 3;
const BACKOFF_TIMEOUT_BASE_MS = 1_000; // exponential: 1s, 2s, 4s

export class TisClient {
  private baseUrl: string;
  private tokenPool: TokenPool;
  private rateLimiter: PerVehicleRateLimiter;

  constructor(options: TisClientOptions) {
    this.baseUrl = options.baseUrl;
    this.tokenPool = options.tokenPool;
    this.rateLimiter = options.rateLimiter;
  }

  /**
   * All API calls: POST {baseUrl}?token=...&format=json&command=...&params
   * Empty body, all params in query string.
   */
  private async requestWithRetry<T>(
    command: string,
    params: Record<string, string | number>,
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
      for (let attemptTimeout = 0; attemptTimeout <= MAX_RETRY_TIMEOUT; attemptTimeout++) {
        try {
          const response = await axios.post<T>(url, null, { timeout: 30_000 });
          return response.data;
        } catch (err) {
          const axiosErr = err as AxiosError;

          // 404 → return null (no data)
          if (axiosErr.response?.status === 404) {
            logger.warn(`404 Not Found: ${command}`, params);
            return null;
          }

          // 429 → linear backoff, retry outer loop
          if (axiosErr.response?.status === 429) {
            if (attempt429 < MAX_RETRY_429) {
              const waitMs = BACKOFF_429_BASE_MS * (attempt429 + 1);
              logger.warn(`429 Rate limit on ${command}, retry ${attempt429 + 1}/${MAX_RETRY_429} in ${waitMs}ms`);
              await this.sleep(waitMs);
              break; // break timeout loop, continue 429 loop
            }
            throw new Error(`429 Rate limit exceeded after ${MAX_RETRY_429} retries: ${command}`);
          }

          // Timeout → exponential backoff, retry inner loop
          if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
            if (attemptTimeout < MAX_RETRY_TIMEOUT) {
              const waitMs = BACKOFF_TIMEOUT_BASE_MS * Math.pow(2, attemptTimeout);
              logger.warn(`Timeout on ${command}, retry ${attemptTimeout + 1}/${MAX_RETRY_TIMEOUT} in ${waitMs}ms`);
              await this.sleep(waitMs);
              continue;
            }
            throw new Error(`Timeout after ${MAX_RETRY_TIMEOUT} retries: ${command}`);
          }

          // Other errors — throw immediately
          throw err;
        }
      }
    }

    throw new Error(`Exceeded all retries for ${command}`);
  }

  async getRequests(fromDate: Date, toDate: Date): Promise<TisRequest[]> {
    const result = await this.requestWithRetry<{ list: TisRequest[] }>(
      'getRequests',
      {
        fromDate: formatDateParam(fromDate),
        toDate: formatDateParam(toDate),
      },
    );
    return result?.list ?? [];
  }

  async getRouteListsByDateOut(fromDate: Date, toDate: Date): Promise<TisRouteList[]> {
    const result = await this.requestWithRetry<{ list: TisRouteList[] }>(
      'getRouteListsByDateOut',
      {
        fromDate: formatDateParam(fromDate),
        toDate: formatDateParam(toDate),
      },
    );
    return result?.list ?? [];
  }

  async getMonitoringStats(
    idMO: number,
    fromDate: Date,
    toDate: Date,
  ): Promise<TisMonitoringStats | null> {
    await this.rateLimiter.waitForSlot(idMO);

    return this.requestWithRetry<TisMonitoringStats>(
      'getMonitoringStats',
      {
        idMO,
        fromDate: formatDateTimeParam(fromDate),
        toDate: formatDateTimeParam(toDate),
      },
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
