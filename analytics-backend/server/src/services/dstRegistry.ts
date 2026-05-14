import { getKipPool } from '../db';
import { logger } from '../utils/logger';

export interface DstVehicle {
  vehicle_id: string;
  idMO: number;
}

let cachedVehicles: DstVehicle[] | null = null;
let cacheTime: number = 0;
const CACHE_TTL_MS = 3600_000;

export async function getDstVehicles(): Promise<DstVehicle[]> {
  if (cachedVehicles && (Date.now() - cacheTime) < CACHE_TTL_MS) {
    return cachedVehicles;
  }

  const pool = getKipPool();
  try {
    const result = await pool.query<{ reg_number: string; id_mo: string }>(`
      SELECT DISTINCT v.reg_number, v.id_mo
      FROM vehicles v
      WHERE v.id_mo IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM vehicle_records vr
          WHERE vr.vehicle_id = v.reg_number
            AND vr.report_date >= CURRENT_DATE - INTERVAL '30 days'
          LIMIT 1
        )
      ORDER BY v.reg_number
    `);

    cachedVehicles = result.rows.map(r => ({
      vehicle_id: r.reg_number,
      idMO: Number(r.id_mo),
    }));
    cacheTime = Date.now();

    logger.info(`DST registry loaded: ${cachedVehicles.length} active vehicles (TTL ${CACHE_TTL_MS / 1000}s)`);
    return cachedVehicles;
  } catch (err) {
    logger.error('Failed to load DST vehicle registry', err);
    if (cachedVehicles) return cachedVehicles;
    return [];
  }
}

export function clearDstCache(): void {
  cachedVehicles = null;
  cacheTime = 0;
}
