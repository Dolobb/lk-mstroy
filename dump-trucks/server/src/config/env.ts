import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export interface DtEnvConfig {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  serverPort: number;
  nodeEnv: string;
  tisApiUrl: string;
  tisApiTokens: string[];
  testIdMos: number[] | null;  // null = не тест-режим
}

let _config: DtEnvConfig | null = null;

export function getEnvConfig(): DtEnvConfig {
  if (_config) return _config;

  const testIdMosRaw = process.env['DT_TEST_ID_MOS'];
  const testIdMos = testIdMosRaw
    ? testIdMosRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : null;

  const tokensRaw = optionalEnv('TIS_API_TOKENS', '');
  const tokens = tokensRaw ? tokensRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  _config = {
    dbHost:     optionalEnv('DB_HOST', 'localhost'),
    dbPort:     parseInt(optionalEnv('DB_PORT', '5433'), 10),
    dbName:     optionalEnv('DB_NAME', 'mstroy'),
    dbUser:     optionalEnv('DB_USER', 'postgres'),
    dbPassword: optionalEnv('DB_PASSWORD', ''),
    serverPort: parseInt(optionalEnv('DT_SERVER_PORT', '3002'), 10),
    nodeEnv:    optionalEnv('NODE_ENV', 'development'),
    tisApiUrl:  optionalEnv('TIS_API_URL', ''),
    tisApiTokens: tokens,
    testIdMos,
  };

  return _config;
}
