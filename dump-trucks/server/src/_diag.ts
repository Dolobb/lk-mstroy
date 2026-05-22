import { getPool } from './config/database';

async function main() {
  const pool = getPool();
  const reg = process.argv[2] || 'С225МН72';
  const date = process.argv[3] || '2026-05-18';
  const shift = process.argv[4] || 'shift1';

  const sr = await pool.query(
    `SELECT id, vehicle_id, reg_number, report_date, shift_type, trips_count,
            onsite_min, work_type, updated_at
       FROM dump_trucks.shift_records
      WHERE reg_number = $1 AND report_date = $2 AND shift_type = $3`,
    [reg, date, shift],
  );
  console.log('=== shift_records ===');
  console.table(sr.rows);

  if (sr.rows.length === 0) {
    // fallback: try with same reg ignoring alphabet
    const alt = await pool.query(
      `SELECT id, vehicle_id, reg_number, report_date, shift_type, trips_count, updated_at
         FROM dump_trucks.shift_records
        WHERE report_date = $1 AND shift_type = $2 AND reg_number ILIKE $3`,
      [date, shift, '%225%72%'],
    );
    console.log('=== fallback by ILIKE %225%72% ===');
    console.table(alt.rows);
  }

  for (const row of sr.rows) {
    const trips = await pool.query(
      `SELECT trip_number, loaded_at, unloaded_at, loading_zone, unloading_zone,
              duration_min
         FROM dump_trucks.trips WHERE shift_record_id = $1 ORDER BY trip_number`,
      [row.id],
    );
    console.log(`=== trips for shift_record ${row.id} (trips_count=${row.trips_count}) ===`);
    console.table(trips.rows);

    const ze = await pool.query(
      `SELECT zone_tag, zone_name, entered_at, exited_at, duration_sec
         FROM dump_trucks.zone_events
        WHERE vehicle_id = $1 AND report_date = $2 AND shift_type = $3
        ORDER BY entered_at`,
      [row.vehicle_id, date, shift],
    );
    console.log(`=== zone_events (${ze.rows.length}) ===`);
    console.table(ze.rows.map(r => ({
      tag: r.zone_tag,
      zone: r.zone_name,
      in: r.entered_at && new Date(r.entered_at).toISOString().slice(11, 16),
      out: r.exited_at && new Date(r.exited_at).toISOString().slice(11, 16),
      durMin: r.duration_sec != null ? Math.round(r.duration_sec / 60) : null,
    })));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
