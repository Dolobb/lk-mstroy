import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export interface GeoEnvConfig {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  serverPort: number;
  nodeEnv: string;
}

export function getEnvConfig(): GeoEnvConfig {
  return {
    dbHost:     optionalEnv('DB_HOST', 'localhost'),
    dbPort:     parseInt(optionalEnv('DB_PORT', '5433'), 10),
    dbName:     optionalEnv('DB_NAME', 'mstroy'),
    dbUser:     optionalEnv('DB_USER', 'postgres'),
    dbPassword: optionalEnv('DB_PASSWORD', ''),
    serverPort: parseInt(optionalEnv('GEO_SERVER_PORT', '3003'), 10),
    nodeEnv:    optionalEnv('NODE_ENV', 'development'),
  };
}
