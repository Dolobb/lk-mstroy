import dotenv from 'dotenv';
import { resolve } from 'path';
import type { EnvConfig } from '../types/domain';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function loadEnvConfig(): EnvConfig {
  const tokensRaw = requireEnv('TIS_API_TOKENS');
  const tokens = tokensRaw.split(',').map(t => t.trim()).filter(Boolean);

  if (tokens.length === 0) {
    throw new Error('TIS_API_TOKENS must contain at least one token');
  }

  return {
    dbHost: optionalEnv('DB_HOST', 'localhost'),
    dbPort: parseInt(optionalEnv('DB_PORT', '5432'), 10),
    dbName: requireEnv('DB_NAME'),
    dbUser: optionalEnv('DB_USER', 'postgres'),
    dbPassword: optionalEnv('DB_PASSWORD', ''),
    tisApiUrl: requireEnv('TIS_API_URL'),
    tisApiTokens: tokens,
    serverPort: parseInt(optionalEnv('SERVER_PORT', '3001'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    rateLimitPerVehicleMs: parseInt(optionalEnv('RATE_LIMIT_PER_VEHICLE_MS', '30000'), 10),
  };
}

let _config: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!_config) {
    _config = loadEnvConfig();
  }
  return _config;
}
