import { getPg17 } from '../../db/pg17';

export interface DtTripRow {
  report_date: string;
  shift_type: string;
  reg_number: string;
  name_mo: string;
  object_name: string;
  trips_count: number;
  shift_start: string;  // HH:MM local
  shift_end: string;    // HH:MM local
  trip_number: number | null;
  // Per-trip zone data (from zone_events correlation)
  loading_enter: string;
  loading_exit: string;
  loading_dwell: number;   // minutes
  unloading_enter: string;
  unloading_exit: string;
  unloading_dwell: number; // minutes
  // Aggregates per vehicle (computed in code)
  avg_loading_dwell: number;
  avg_unloading_dwell: number;
  avg_travel_load_unload: number;
  avg_travel_unload_load: number;
}

// Intermediate types for query results
interface TripQueryRow {
  report_date: string;
  shift_type: string;
  shift_record_id: number;
  reg_number: string;
  name_mo: string;
  object_name: string;
  trips_count: number;
  shift_start: string;
  shift_end: string;
  trip_number: number | null;
  loaded_at: string;
  unloaded_at: string;
  travel_to_unload_min: number | null;
  return_to_load_min: number | null;
}

interface ZoneEventRow {
  shift_record_id: number;
  vehicle_id: number;
  zone_tag: string;
  entered_at: string;
  exited_at: string;
  duration_min: number;
}

// Grouped result for XLSX template
export interface DateShiftGroup {
  date: string;       // YYYY-MM-DD
  shiftLabel: string; // "Смена 1" / "Смена 2"
  shiftType: string;
  vehicles: VehicleGroup[];
}

export interface VehicleGroup {
  reg_number: string;
  name_mo: string;
  trips_count: number;
  shift_start: string;
  shift_end: string;
  avg_loading_dwell: number;
  avg_unloading_dwell: number;
  avg_travel_load_unload: number;
  avg_travel_unload_load: number;
  trips: TripDetail[];
}

export interface TripDetail {
  trip_number: number;
  loading_enter: string;
  loading_exit: string;
  loading_dwell: string;   // MM:SS or minutes
  unloading_enter: string;
  unloading_exit: string;
  unloading_dwell: string;
}

interface DtFilters {
  objectUid?: string;
  vehicles?: string[];
}

export async function queryDtTripsData(
  dateFrom: string,
  dateTo: string,
  filters: DtFilters = {},
): Promise<DateShiftGroup[]> {
  const pool = getPg17();
  const params: any[] = [dateFrom || null, dateTo || null, filters.objectUid || null];

  // Query 1: Trips with shift records
  const tripsResult = await pool.query<TripQueryRow>(`
    SELECT
      TO_CHAR(sr.report_date, 'YYYY-MM-DD') AS report_date,
      sr.shift_type,
      sr.id AS shift_record_id,
      sr.reg_number,
      sr.name_mo,
      sr.object_name,
      sr.trips_count,
      TO_CHAR(sr.shift_start AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS shift_start,
      TO_CHAR(sr.shift_end   AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS shift_end,
      t.trip_number,
      TO_CHAR(t.loaded_at   AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS loaded_at,
      TO_CHAR(t.unloaded_at AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS unloaded_at,
      t.travel_to_unload_min,
      t.return_to_load_min
    FROM dump_trucks.shift_records sr
    LEFT JOIN dump_trucks.trips t ON t.shift_record_id = sr.id
    WHERE ($1::date IS NULL OR sr.report_date >= $1)
      AND ($2::date IS NULL OR sr.report_date <= $2)
      AND ($3::text IS NULL OR sr.object_uid = $3)
      ${filters.vehicles?.length ? `AND sr.reg_number = ANY($4::varchar[])` : ''}
    ORDER BY sr.report_date, sr.shift_type, sr.reg_number, t.trip_number
  `, filters.vehicles?.length ? [...params, filters.vehicles] : params);

  // Query 2: Zone events for loading/unloading enter/exit times
  const zeResult = await pool.query<ZoneEventRow>(`
    SELECT
      sr.id AS shift_record_id,
      ze.vehicle_id,
      ze.zone_tag,
      TO_CHAR(ze.entered_at AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS entered_at,
      TO_CHAR(ze.exited_at  AT TIME ZONE COALESCE(sr.object_timezone, 'Asia/Yekaterinburg'), 'HH24:MI') AS exited_at,
      ROUND(ze.duration_sec::numeric / 60, 1) AS duration_min
    FROM dump_trucks.zone_events ze
    JOIN dump_trucks.shift_records sr
      ON sr.vehicle_id = ze.vehicle_id
      AND sr.report_date = ze.report_date
      AND sr.shift_type = ze.shift_type
    WHERE ($1::date IS NULL OR ze.report_date >= $1)
      AND ($2::date IS NULL OR ze.report_date <= $2)
      AND ze.zone_tag IN ('dt_loading', 'dt_unloading')
      AND ($3::text IS NULL OR sr.object_uid = $3)
      ${filters.vehicles?.length ? `AND sr.reg_number = ANY($4::varchar[])` : ''}
    ORDER BY sr.id, ze.entered_at
  `, filters.vehicles?.length ? [...params, filters.vehicles] : params);

  // Build zone events index: shift_record_id → loading events[], unloading events[]
  const zeByShift = new Map<number, { loading: ZoneEventRow[]; unloading: ZoneEventRow[] }>();
  for (const ze of zeResult.rows) {
    if (!zeByShift.has(ze.shift_record_id)) {
      zeByShift.set(ze.shift_record_id, { loading: [], unloading: [] });
    }
    const bucket = zeByShift.get(ze.shift_record_id)!;
    if (ze.zone_tag === 'dt_loading') bucket.loading.push(ze);
    else bucket.unloading.push(ze);
  }

  // Group trips: date+shift → vehicle → trips
  const grouped = new Map<string, Map<string, { sr: TripQueryRow; trips: TripQueryRow[] }>>();

  for (const row of tripsResult.rows) {
    const dsKey = `${row.report_date}|${row.shift_type}`;
    if (!grouped.has(dsKey)) grouped.set(dsKey, new Map());
    const vehicleMap = grouped.get(dsKey)!;
    const vKey = `${row.reg_number}|${row.shift_record_id}`;
    if (!vehicleMap.has(vKey)) {
      vehicleMap.set(vKey, { sr: row, trips: [] });
    }
    if (row.trip_number != null) {
      vehicleMap.get(vKey)!.trips.push(row);
    }
  }

  // Build final structure
  const result: DateShiftGroup[] = [];

  for (const [dsKey, vehicleMap] of grouped) {
    const [date, shiftType] = dsKey.split('|');
    const shiftLabel = shiftType === 'shift1' ? 'Смена 1' : 'Смена 2';

    const vehicles: VehicleGroup[] = [];

    for (const [, { sr, trips }] of vehicleMap) {
      const zones = zeByShift.get(sr.shift_record_id) || { loading: [], unloading: [] };

      // Match zone events to trips by sequential order
      const tripDetails: TripDetail[] = trips.map((t, i) => {
        const loadZe = zones.loading[i];
        const unloadZe = zones.unloading[i];
        return {
          trip_number: t.trip_number!,
          loading_enter: loadZe?.entered_at || '',
          loading_exit: loadZe?.exited_at || '',
          loading_dwell: loadZe ? formatMin(Number(loadZe.duration_min)) : '',
          unloading_enter: unloadZe?.entered_at || '',
          unloading_exit: unloadZe?.exited_at || '',
          unloading_dwell: unloadZe ? formatMin(Number(unloadZe.duration_min)) : '',
        };
      });

      // Compute averages
      const loadDurations = zones.loading.map(z => Number(z.duration_min)).filter(v => v > 0);
      const unloadDurations = zones.unloading.map(z => Number(z.duration_min)).filter(v => v > 0);
      const travelTo = trips.map(t => Number(t.travel_to_unload_min)).filter(v => v > 0);
      const travelBack = trips.map(t => Number(t.return_to_load_min)).filter(v => v > 0);

      vehicles.push({
        reg_number: sr.reg_number,
        name_mo: sr.name_mo || sr.reg_number,
        trips_count: sr.trips_count || trips.length,
        shift_start: sr.shift_start || '',
        shift_end: sr.shift_end || '',
        avg_loading_dwell: avg(loadDurations),
        avg_unloading_dwell: avg(unloadDurations),
        avg_travel_load_unload: avg(travelTo),
        avg_travel_unload_load: avg(travelBack),
        trips: tripDetails.length > 0 ? tripDetails : [{
          trip_number: 0,
          loading_enter: '', loading_exit: '', loading_dwell: '',
          unloading_enter: '', unloading_exit: '', unloading_dwell: '',
        }],
      });
    }

    result.push({ date, shiftLabel, shiftType, vehicles });
  }

  return result;
}

export async function queryDtFilters(dateFrom: string, dateTo: string) {
  const pool = getPg17();

  const [objects, vehicles] = await Promise.all([
    pool.query(
      `SELECT DISTINCT object_uid, object_name FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2 AND object_uid IS NOT NULL
       ORDER BY object_name`,
      [dateFrom, dateTo],
    ),
    pool.query(
      `SELECT DISTINCT reg_number FROM dump_trucks.shift_records
       WHERE report_date BETWEEN $1 AND $2 AND reg_number IS NOT NULL
       ORDER BY reg_number`,
      [dateFrom, dateTo],
    ),
  ]);

  return {
    objects: objects.rows.map(r => ({ uid: r.object_uid, name: r.object_name })),
    vehicles: vehicles.rows.map(r => ({ id: r.reg_number, label: r.reg_number })),
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function formatMin(minutes: number): string {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
