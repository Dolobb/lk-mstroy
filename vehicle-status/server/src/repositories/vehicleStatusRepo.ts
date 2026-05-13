import type { PoolClient, Pool } from 'pg';

export interface VehicleRecord {
  id: number;
  plateNumber: string;
  branch: string | null;
  vehicleType: string | null;
  brand: string | null;
  constructionObject: string | null;
  techStatus: string | null;
  workType: string | null;
  category: string;
  isBroken: boolean;
  lastCheckDate: string | null;
  updatedAt: string;
}

export async function deleteByCategory(client: PoolClient, category: string): Promise<void> {
  await client.query(
    'DELETE FROM vehicle_status.vehicles WHERE category = $1',
    [category],
  );
}

export async function insertVehicle(
  client: PoolClient,
  data: {
    plateNumber: string;
    branch: string;
    vehicleType: string;
    brand: string;
    constructionObject: string;
    techStatus: string;
    workType: string;
    category: string;
    isBroken: boolean;
    today: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO vehicle_status.vehicles
       (plate_number, branch, vehicle_type, brand, construction_object,
        tech_status, work_type, category, is_broken, last_check_date, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      data.plateNumber,
      data.branch || null,
      data.vehicleType || null,
      data.brand || null,
      data.constructionObject || null,
      data.techStatus || null,
      data.workType || null,
      data.category,
      data.isBroken,
      data.today,
    ],
  );
}

export async function queryAllVehicles(
  pool: Pool,
): Promise<VehicleRecord[]> {
  const result = await pool.query(
    `SELECT id, plate_number, branch, vehicle_type, brand, construction_object,
            tech_status, work_type, category, is_broken, last_check_date, updated_at
     FROM vehicle_status.vehicles
     ORDER BY plate_number ASC`,
  );
  return result.rows.map(r => ({
    id: r.id,
    plateNumber: r.plate_number,
    branch: r.branch,
    vehicleType: r.vehicle_type,
    brand: r.brand,
    constructionObject: r.construction_object,
    techStatus: r.tech_status,
    workType: r.work_type,
    category: r.category,
    isBroken: r.is_broken,
    lastCheckDate: r.last_check_date,
    updatedAt: r.updated_at,
  }));
}

export interface FilterOptions {
  categories: string[];
  branches: string[];
  vehicleTypes: string[];
  brands: string[];
  constructionObjects: string[];
  techStatuses: string[];
  workTypes: string[];
}

export async function getFilterOptions(pool: Pool): Promise<FilterOptions> {
  const run = async (col: string): Promise<string[]> => {
    const r = await pool.query(
      `SELECT DISTINCT ${col} FROM vehicle_status.vehicles
       WHERE ${col} IS NOT NULL AND BTRIM(${col}) <> '' ORDER BY ${col}`,
    );
    return r.rows.map((row: Record<string, string | null>) => row[col]).filter((v): v is string => !!v);
  };
  const [categories, branches, vehicleTypes, brands, constructionObjects, techStatuses, workTypes] =
    await Promise.all([
      pool.query('SELECT DISTINCT category FROM vehicle_status.vehicles ORDER BY category').then(r => r.rows.map((row: Record<string, string>) => row.category)),
      run('branch'),
      run('vehicle_type'),
      run('brand'),
      run('construction_object'),
      run('tech_status'),
      run('work_type'),
    ]);
  return { categories, branches, vehicleTypes, brands, constructionObjects, techStatuses, workTypes };
}

export async function insertSnapshot(
  client: PoolClient,
  data: {
    plateNumber: string;
    branch: string;
    vehicleType: string;
    brand: string;
    constructionObject: string;
    techStatus: string;
    workType: string;
    category: string;
    isBroken: boolean;
    snapshotDate: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO vehicle_status.snapshots
       (snapshot_date, plate_number, branch, vehicle_type, brand, construction_object,
        tech_status, work_type, category, is_broken)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (snapshot_date, plate_number, category) DO UPDATE SET
       branch = EXCLUDED.branch,
       vehicle_type = EXCLUDED.vehicle_type,
       brand = EXCLUDED.brand,
       construction_object = EXCLUDED.construction_object,
       tech_status = EXCLUDED.tech_status,
       work_type = EXCLUDED.work_type,
       is_broken = EXCLUDED.is_broken,
       created_at = NOW()`,
    [
      data.snapshotDate,
      data.plateNumber,
      data.branch || null,
      data.vehicleType || null,
      data.brand || null,
      data.constructionObject || null,
      data.techStatus || null,
      data.workType || null,
      data.category,
      data.isBroken,
    ],
  );
}

export async function querySnapshotsByDate(pool: Pool, date: string): Promise<VehicleRecord[]> {
  const result = await pool.query(
    `SELECT id, plate_number, branch, vehicle_type, brand, construction_object,
            tech_status, work_type, category, is_broken, snapshot_date as last_check_date, created_at as updated_at
     FROM vehicle_status.snapshots
     WHERE snapshot_date = $1
     ORDER BY plate_number ASC`,
    [date],
  );
  return result.rows.map(r => ({
    id: r.id,
    plateNumber: r.plate_number,
    branch: r.branch,
    vehicleType: r.vehicle_type,
    brand: r.brand,
    constructionObject: r.construction_object,
    techStatus: r.tech_status,
    workType: r.work_type,
    category: r.category,
    isBroken: r.is_broken,
    lastCheckDate: r.last_check_date,
    updatedAt: r.updated_at,
  }));
}

export async function querySnapshotDates(pool: Pool): Promise<string[]> {
  const result = await pool.query(
    'SELECT DISTINCT snapshot_date FROM vehicle_status.snapshots ORDER BY snapshot_date DESC',
  );
  return result.rows.map((r: { snapshot_date: string }) => r.snapshot_date);
}

export interface SyncLogEntry {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  processed: number;
  errors: string[];
  errorMessage: string | null;
  downloadMs: number | null;
  parseMs: number | null;
  writeMs: number | null;
  snapshotDate: string | null;
}

export async function insertSyncLog(
  pool: Pool,
  trigger: string,
  snapshotDate: string,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO vehicle_status.sync_log (trigger, snapshot_date, status)
     VALUES ($1, $2, 'in_progress')
     RETURNING id`,
    [trigger, snapshotDate],
  );
  return result.rows[0].id;
}

export async function updateSyncLog(
  pool: Pool,
  id: number,
  data: {
    status: string;
    processed?: number;
    errors?: string[];
    errorMessage?: string;
    downloadMs?: number;
    parseMs?: number;
    writeMs?: number;
  },
): Promise<void> {
  await pool.query(
    `UPDATE vehicle_status.sync_log SET
       finished_at = NOW(),
       status = $2,
       processed = COALESCE($3, processed),
       errors = $4,
       error_message = $5,
       download_ms = COALESCE($6, download_ms),
       parse_ms = COALESCE($7, parse_ms),
       write_ms = COALESCE($8, write_ms)
     WHERE id = $1`,
    [
      id,
      data.status,
      data.processed ?? null,
      data.errors ?? null,
      data.errorMessage ?? null,
      data.downloadMs ?? null,
      data.parseMs ?? null,
      data.writeMs ?? null,
    ],
  );
}

export async function querySyncLogs(
  pool: Pool,
  limit: number = 50,
): Promise<SyncLogEntry[]> {
  const result = await pool.query(
    `SELECT id, started_at, finished_at, status, trigger, processed,
            errors, error_message, download_ms, parse_ms, write_ms, snapshot_date
     FROM vehicle_status.sync_log
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(r => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    trigger: r.trigger,
    processed: r.processed,
    errors: r.errors || [],
    errorMessage: r.error_message,
    downloadMs: r.download_ms,
    parseMs: r.parse_ms,
    writeMs: r.write_ms,
    snapshotDate: r.snapshot_date,
  }));
}

export async function queryMissingSnapshotDates(
  pool: Pool,
  lookbackDays: number = 30,
): Promise<string[]> {
  const result = await pool.query(
    `WITH date_series AS (
       SELECT generate_series(
         CURRENT_DATE - $1::integer,
         CURRENT_DATE,
         '1 day'::interval
       )::date AS dt
     )
     SELECT ds.dt
     FROM date_series ds
     LEFT JOIN vehicle_status.snapshots s ON s.snapshot_date = ds.dt
     WHERE s.snapshot_date IS NULL
     ORDER BY ds.dt DESC`,
    [lookbackDays],
  );
  return result.rows.map((r: { dt: string }) => r.dt);
}

export async function queryRecentSyncErrors(
  pool: Pool,
  sinceHours: number = 24,
): Promise<SyncLogEntry[]> {
  const result = await pool.query(
    `SELECT id, started_at, finished_at, status, trigger, processed,
            errors, error_message, download_ms, parse_ms, write_ms, snapshot_date
     FROM vehicle_status.sync_log
     WHERE status IN ('error', 'partial')
       AND started_at > NOW() - $1::interval
     ORDER BY started_at DESC`,
    [`${sinceHours} hours`],
  );
  return result.rows.map(r => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    trigger: r.trigger,
    processed: r.processed,
    errors: r.errors || [],
    errorMessage: r.error_message,
    downloadMs: r.download_ms,
    parseMs: r.parse_ms,
    writeMs: r.write_ms,
    snapshotDate: r.snapshot_date,
  }));
}
