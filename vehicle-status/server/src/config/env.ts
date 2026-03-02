import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export interface VsEnvConfig {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  serverPort: number;
  googleCredsPath: string;
  googleSheetId: string;
}

let _config: VsEnvConfig | null = null;

export function getEnvConfig(): VsEnvConfig {
  if (_config) return _config;

  _config = {
    dbHost:          optionalEnv('DB_HOST', 'localhost'),
    dbPort:          parseInt(optionalEnv('DB_PORT', '5433'), 10),
    dbName:          optionalEnv('DB_NAME', 'mstroy'),
    dbUser:          optionalEnv('DB_USER', 'postgres'),
    dbPassword:      optionalEnv('DB_PASSWORD', ''),
    serverPort:      parseInt(optionalEnv('VS_SERVER_PORT', '3004'), 10),
    googleCredsPath: requireEnv('GOOGLE_CREDS_PATH'),
    googleSheetId:   requireEnv('GOOGLE_SHEET_ID'),
  };

  return _config;
}
