import { TokenPool } from './tokenPool';
import { TisClient } from './tisClient';
import { PerTokenRateLimiter } from './rateLimiter';
import { logger } from '../utils/logger';

let client: TisClient | null = null;

export function createTisClient(): TisClient {
  if (client) return client;

  const baseUrl = process.env.TIS_API_URL;
  if (!baseUrl) throw new Error('TIS_API_URL is not set');

  const rawTokens = process.env.TIS_API_TOKENS || '';
  const tokens = rawTokens.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error('TIS_API_TOKENS is empty');

  const intervalMs = Number(process.env.RATE_LIMIT_PER_VEHICLE_MS || 30000);

  const tokenPool = new TokenPool(tokens);
  const rateLimiter = new PerTokenRateLimiter(intervalMs);

  client = new TisClient({ baseUrl, tokenPool, rateLimiter });
  logger.info(`TIS client created: ${tokens.length} tokens, rate limit ${intervalMs}ms per (token, idMO)`);
  return client;
}

export function getTisClient(): TisClient {
  if (!client) return createTisClient();
  return client;
}
