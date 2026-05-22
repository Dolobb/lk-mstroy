import { getPg17 } from '../../db/pg17';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface OnsiteSegment {
  index: number;
  engineUtilPct: number;   // 0-100, total bar height (engine time / 30min)
  movingUtilPct: number;   // 0-100, blue portion (<= engineUtilPct)
  inBoundary: boolean;
  timeLabel: string;       // HH:MM segment start (object timezone)
}

export interface OnsiteVehicle {
  shift_record_id: number;
  reg_number: string;
  name_mo: string;
  engine_time_sec: number;
  engine_time_source: string;
  moving_time_sec: number;
  onsite_min: number;
  distance_km: number;
  kip_pct: number;
  movement_pct: number;
  fuel_consumed: number;
  shift_start: string;     // HH:MM
  shift_end: string;       // HH:MM
  segments: OnsiteSegment[];
}

export interface OnsiteObjectGroup {
  object_name: string;
  vehicles: OnsiteVehicle[];
}

export interface OnsiteDateShiftGroup {
  date: string;        // YYYY-MM-DD
  shiftLabel: string;  // "Смена 1" / "Смена 2"
  shiftType: string;
  objects: OnsiteObjectGroup[];
}

interface DtOnsiteFilters {
  objectUid?: string;
  vehicles?: string[];
}

const SEGMENT_DURATION_SEC = 30 * 60;

// ─── Internal query row types ───────────────────────────────────────────────

interface OnsiteRecordRow {
  report_date: string;
  shift_type: string;
  shift_record_id: number;
  reg_number: string;
  name_mo: string | null;
  object_name: string | null;
  engine_time_sec: string;
  engine_time_source: string;
  moving_time_sec: string;
  distance_km: string;
  onsite_min: string;
  kip_pct: string;
  movement_pct: string;
  fuel_consumed: string;
  shift_start: string | null;
  shift_end: string | null;
}

interface SegmentRow {
  shift_record_id: number;
  segment_index: number;
  engine_time_sec: number;
  moving_time_sec: number;
  in_boundary: boolean;
  seg_start: string;
}

// ─── Main query ─────────────────────────────────────────────────────────────

/**
 * Onsite ("по месту") dump-truck shift records grouped date+shift → object → vehicle.
 *
 * Reads the raw `dump_trucks.shift_records` table (NOT shift_records_active): the active
 * view filters by `trips_count >= min_trips_per_shift`, which would drop 0-trip onsite
 * records. work_type='onsite' is itself a reliable signal of genuine onsite work.
 */
export async function queryDtOnsiteData(
  dateFrom: string,
  dateTo: string,
  filters: DtOnsiteFilters = {},
): Promise<OnsiteDateShiftGroup[]> {
  const pool = getPg17();
  const params: any[] = [dateFrom || null, dateTo || null, filters.objectUid || null];

  // Query 1: onsite shift records (+ aggregated fuel from raw_monitoring JSON)
  const recRes = await pool.query<OnsiteRecordRow>(`
    SELECT
      TO_CHAR(sr.report_date, 'YYYY-MM-DD') AS report_date,
      sr.shift_type,
      sr.id AS shift_record_id,
      sr.reg_number,
      sr.name_mo,
      sr.object_name,
      sr.engine_time_sec,
      sr.engine_time_source,
      sr.moving_time_sec,
      sr.distance_km,
      sr.onsite_min,
      sr.kip_pct,
      sr.movement_pct,
      TO_CHAR(sr.shift_start AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS shift_start,
      TO_CHAR(sr.shift_end   AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS shift_end,
      COALESCE((
        SELECT SUM((f->>'rate')::numeric)
        FROM jsonb_array_elements(COALESCE(sr.raw_monitoring->'fuels', '[]'::jsonb)) f
      ), 0) AS fuel_consumed
    FROM dump_trucks.shift_records sr
    WHERE sr.work_type = 'onsite'
      AND ($1::date IS NULL OR sr.report_date >= $1)
      AND ($2::date IS NULL OR sr.report_date <= $2)
      AND ($3::text IS NULL OR sr.object_uid = $3)
      ${filters.vehicles?.length ? `AND sr.reg_number = ANY($4::varchar[])` : ''}
    ORDER BY sr.report_date, sr.shift_type, sr.object_name, sr.reg_number
  `, filters.vehicles?.length ? [...params, filters.vehicles] : params);

  if (recRes.rows.length === 0) return [];

  // Query 2: 30-min segments for those records
  const recordIds = recRes.rows.map(r => r.shift_record_id);
  const segRes = await pool.query<SegmentRow>(`
    SELECT
      ss.shift_record_id,
      ss.segment_index,
      ss.engine_time_sec,
      ss.moving_time_sec,
      ss.in_boundary,
      TO_CHAR(ss.segment_start AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS seg_start
    FROM dump_trucks.shift_segments ss
    JOIN dump_trucks.shift_records sr ON sr.id = ss.shift_record_id
    WHERE ss.shift_record_id = ANY($1::bigint[])
    ORDER BY ss.shift_record_id, ss.segment_index
  `, [recordIds]);

  // Index segments by shift_record_id
  const segByRecord = new Map<number, OnsiteSegment[]>();
  for (const s of segRes.rows) {
    const engine = Number(s.engine_time_sec) || 0;
    const moving = Number(s.moving_time_sec) || 0;
    const engineUtilPct = Math.min(100, Math.round((engine / SEGMENT_DURATION_SEC) * 100));
    const movingUtilPct = Math.min(engineUtilPct, Math.round((moving / SEGMENT_DURATION_SEC) * 100));
    if (!segByRecord.has(s.shift_record_id)) segByRecord.set(s.shift_record_id, []);
    segByRecord.get(s.shift_record_id)!.push({
      index: s.segment_index,
      engineUtilPct,
      movingUtilPct,
      inBoundary: s.in_boundary,
      timeLabel: s.seg_start,
    });
  }

  // Group: date+shift → object → vehicle
  const grouped = new Map<string, Map<string, OnsiteVehicle[]>>();

  for (const row of recRes.rows) {
    const dsKey = `${row.report_date}|${row.shift_type}`;
    if (!grouped.has(dsKey)) grouped.set(dsKey, new Map());
    const objectMap = grouped.get(dsKey)!;
    const objKey = row.object_name || 'Без объекта';
    if (!objectMap.has(objKey)) objectMap.set(objKey, []);

    objectMap.get(objKey)!.push({
      shift_record_id: row.shift_record_id,
      reg_number: row.reg_number,
      name_mo: row.name_mo || row.reg_number,
      engine_time_sec: Number(row.engine_time_sec) || 0,
      engine_time_source: row.engine_time_source,
      moving_time_sec: Number(row.moving_time_sec) || 0,
      distance_km: Number(row.distance_km) || 0,
      onsite_min: Number(row.onsite_min) || 0,
      kip_pct: Number(row.kip_pct) || 0,
      movement_pct: Number(row.movement_pct) || 0,
      fuel_consumed: Math.round((Number(row.fuel_consumed) || 0) * 10) / 10,
      shift_start: row.shift_start || '',
      shift_end: row.shift_end || '',
      segments: (segByRecord.get(row.shift_record_id) || []).sort((a, b) => a.index - b.index),
    });
  }

  // Build final structure
  const result: OnsiteDateShiftGroup[] = [];
  for (const [dsKey, objectMap] of grouped) {
    const [date, shiftType] = dsKey.split('|');
    const shiftLabel = shiftType === 'shift1' ? 'Смена 1' : 'Смена 2';
    const objects: OnsiteObjectGroup[] = [];
    for (const [object_name, vehicles] of objectMap) {
      objects.push({ object_name, vehicles });
    }
    result.push({ date, shiftLabel, shiftType, objects });
  }

  return result;
}

// ─── Filters ────────────────────────────────────────────────────────────────

export async function queryDtOnsiteFilters(dateFrom: string, dateTo: string) {
  const pool = getPg17();

  const [objects, vehicles] = await Promise.all([
    pool.query(
      `SELECT DISTINCT object_uid, object_name FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2 AND work_type = 'onsite' AND object_uid IS NOT NULL
       ORDER BY object_name`,
      [dateFrom, dateTo],
    ),
    pool.query(
      `SELECT DISTINCT reg_number FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2 AND work_type = 'onsite' AND reg_number IS NOT NULL
       ORDER BY reg_number`,
      [dateFrom, dateTo],
    ),
  ]);

  return {
    objects: objects.rows.map(r => ({ uid: r.object_uid, name: r.object_name })),
    vehicles: vehicles.rows.map(r => ({ id: r.reg_number, label: r.reg_number })),
  };
}
