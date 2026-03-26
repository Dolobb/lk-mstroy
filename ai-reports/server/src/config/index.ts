import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: Number(process.env.PORT || 3006),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  pg16: {
    host: process.env.PG16_HOST || 'localhost',
    port: Number(process.env.PG16_PORT || 5432),
    database: process.env.PG16_DATABASE || 'kip_vehicles',
    user: process.env.PG16_USER || 'postgres',
    password: process.env.PG16_PASSWORD || '',
  },

  pg17: {
    host: process.env.PG17_HOST || 'localhost',
    port: Number(process.env.PG17_PORT || 5432),
    database: process.env.PG17_DATABASE || 'mstroy',
    user: process.env.PG17_USER || 'postgres',
    password: process.env.PG17_PASSWORD || '',
  },

  sqlitePath: path.resolve(
    __dirname,
    process.env.SQLITE_PATH || '../../../tyagachi/archive.db',
  ),

  outputDir: path.resolve(__dirname, '../../output'),
};
