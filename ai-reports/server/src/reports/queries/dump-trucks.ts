import { getPg17 } from '../../db/pg17';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface DateShiftGroup {
  date: string;       // YYYY-MM-DD
  shiftLabel: string; // "Смена 1" / "Смена 2"
  shiftType: string;
  objects: ObjectGroup[];
}

export interface ObjectGroup {
  object_name: string;
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

export type TripStatus = 'complete' | 'no_unloading' | 'no_loading';

export interface TripDetail {
  trip_number: number;
  status: TripStatus;
  loading_enter: string;
  loading_exit: string;
  loading_dwell: string;
  loading_zone_name: string;
  unloading_enter: string;
  unloading_exit: string;
  unloading_dwell: string;
  unloading_zone_name: string;
}

// ─── Internal query row types ───────────────────────────────────────────────

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
  zone_name: string;
  entered_at: string;
  exited_at: string;
  duration_min: number;
}

interface DtFilters {
  objectUid?: string;
  vehicles?: string[];
}

// ─── Main query ─────────────────────────────────────────────────────────────

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
    ORDER BY sr.report_date, sr.shift_type, sr.object_name, sr.reg_number, t.trip_number
  `, filters.vehicles?.length ? [...params, filters.vehicles] : params);

  // Query 2: Zone events for loading/unloading enter/exit times + zone_name
  const zeResult = await pool.query<ZoneEventRow>(`
    SELECT
      sr.id AS shift_record_id,
      ze.vehicle_id,
      ze.zone_tag,
      COALESCE(ze.zone_name, '') AS zone_name,
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

  // Build zone events index: shift_record_id → events sorted by entered_at
  const zeByShift = new Map<number, { loading: ZoneEventRow[]; unloading: ZoneEventRow[] }>();
  for (const ze of zeResult.rows) {
    if (!zeByShift.has(ze.shift_record_id)) {
      zeByShift.set(ze.shift_record_id, { loading: [], unloading: [] });
    }
    const bucket = zeByShift.get(ze.shift_record_id)!;
    if (ze.zone_tag === 'dt_loading') bucket.loading.push(ze);
    else bucket.unloading.push(ze);
  }

  // Group trips: date+shift → object → vehicle → trips
  const grouped = new Map<string, Map<string, Map<string, { sr: TripQueryRow; trips: TripQueryRow[] }>>>();

  for (const row of tripsResult.rows) {
    const dsKey = `${row.report_date}|${row.shift_type}`;
    if (!grouped.has(dsKey)) grouped.set(dsKey, new Map());
    const objectMap = grouped.get(dsKey)!;

    const objKey = row.object_name || 'Без объекта';
    if (!objectMap.has(objKey)) objectMap.set(objKey, new Map());
    const vehicleMap = objectMap.get(objKey)!;

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

  for (const [dsKey, objectMap] of grouped) {
    const [date, shiftType] = dsKey.split('|');
    const shiftLabel = shiftType === 'shift1' ? 'Смена 1' : 'Смена 2';

    const objects: ObjectGroup[] = [];

    for (const [objectName, vehicleMap] of objectMap) {
      const vehicles: VehicleGroup[] = [];

      for (const [, { sr, trips }] of vehicleMap) {
        const zones = zeByShift.get(sr.shift_record_id) || { loading: [], unloading: [] };

        // Chronological matching of loading ↔ unloading events
        const tripDetails = matchZoneEvents(zones.loading, zones.unloading);

        // Compute averages from zone events
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
            status: 'complete' as TripStatus,
            loading_enter: '', loading_exit: '', loading_dwell: '', loading_zone_name: '',
            unloading_enter: '', unloading_exit: '', unloading_dwell: '', unloading_zone_name: '',
          }],
        });
      }

      objects.push({ object_name: objectName, vehicles });
    }

    result.push({ date, shiftLabel, shiftType, objects });
  }

  return result;
}

// ─── Chronological matching ─────────────────────────────────────────────────

/**
 * Match loading and unloading zone events chronologically.
 * A loading event is paired with the next unloading event.
 * If two loadings in a row → first one = "no_unloading".
 * If unloading without preceding loading → "no_loading".
 */
function matchZoneEvents(
  loading: ZoneEventRow[],
  unloading: ZoneEventRow[],
): TripDetail[] {
  // Merge into unified timeline
  interface TaggedEvent {
    type: 'loading' | 'unloading';
    event: ZoneEventRow;
  }

  const allEvents: TaggedEvent[] = [
    ...loading.map(e => ({ type: 'loading' as const, event: e })),
    ...unloading.map(e => ({ type: 'unloading' as const, event: e })),
  ];

  // Sort by entered_at (HH:MM string comparison works for same-day)
  allEvents.sort((a, b) => a.event.entered_at.localeCompare(b.event.entered_at));

  const trips: TripDetail[] = [];
  let tripNum = 0;
  let pendingLoading: ZoneEventRow | null = null;

  for (const item of allEvents) {
    if (item.type === 'loading') {
      // If we already have a pending loading, it has no unloading pair
      if (pendingLoading) {
        tripNum++;
        trips.push(makeTripDetail(tripNum, 'no_unloading', pendingLoading, null));
      }
      pendingLoading = item.event;
    } else {
      // Unloading event
      if (pendingLoading) {
        // Complete pair
        tripNum++;
        trips.push(makeTripDetail(tripNum, 'complete', pendingLoading, item.event));
        pendingLoading = null;
      } else {
        // Unloading without loading
        tripNum++;
        trips.push(makeTripDetail(tripNum, 'no_loading', null, item.event));
      }
    }
  }

  // Trailing loading without unloading
  if (pendingLoading) {
    tripNum++;
    trips.push(makeTripDetail(tripNum, 'no_unloading', pendingLoading, null));
  }

  return trips;
}

function makeTripDetail(
  num: number,
  status: TripStatus,
  load: ZoneEventRow | null,
  unload: ZoneEventRow | null,
): TripDetail {
  return {
    trip_number: num,
    status,
    loading_enter: load?.entered_at || '',
    loading_exit: load?.exited_at || '',
    loading_dwell: load ? formatMin(Number(load.duration_min)) : '',
    loading_zone_name: load?.zone_name || '',
    unloading_enter: unload?.entered_at || '',
    unloading_exit: unload?.exited_at || '',
    unloading_dwell: unload ? formatMin(Number(unload.duration_min)) : '',
    unloading_zone_name: unload?.zone_name || '',
  };
}

// ─── Filters ────────────────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function formatMin(minutes: number): string {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
