const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'kip_vehicles', user: 'postgres', password: '888' });

async function test() {
  const vehicleId = '7296\u041E\u041272';
  const date = '2026-04-02';

  const lastRes = await pool.query(
    `SELECT report_date::text, shift_type, latitude, longitude, fuel_value_end, fuel_value_begin
     FROM vehicle_records WHERE vehicle_id = $1 AND report_date < $2
     AND report_date >= $2::date - interval '10 days'
     ORDER BY report_date DESC, shift_type DESC LIMIT 1`,
    [vehicleId, date]
  );
  console.log('lastRecord rows:', lastRes.rows.length);
  console.log('lastRecord:', JSON.stringify(lastRes.rows, null, 2));

  const nextRes = await pool.query(
    `SELECT report_date::text, shift_type, latitude, longitude, fuel_value_end, fuel_value_begin
     FROM vehicle_records WHERE vehicle_id = $1 AND report_date > $2
     AND report_date <= $2::date + interval '10 days'
     ORDER BY report_date ASC, shift_type ASC LIMIT 1`,
    [vehicleId, date]
  );
  console.log('nextRecord rows:', nextRes.rows.length);
  console.log('nextRecord:', JSON.stringify(nextRes.rows, null, 2));

  if (lastRes.rows.length > 0) {
    const last = lastRes.rows[0];
    const next = nextRes.rows[0] || null;

    const hasLastGps = last.latitude != null && last.longitude != null;
    const hasNextGps = next != null && next.latitude != null && next.longitude != null;
    console.log('\n--- Decision Logic ---');
    console.log('hasLastGps:', hasLastGps);
    console.log('hasNextGps:', hasNextGps);
    console.log('gpsOk (hasLastGps || hasNextGps):', hasLastGps || hasNextGps);

    console.log('last.fuel_value_end:', last.fuel_value_end, 'type:', typeof last.fuel_value_end, 'isNull:', last.fuel_value_end === null);
    console.log('next?.fuel_value_begin:', next?.fuel_value_begin, 'type:', typeof next?.fuel_value_begin, 'isNull:', next?.fuel_value_begin === null);

    const hasFuelData = last.fuel_value_end != null && next?.fuel_value_begin != null;
    console.log('hasFuelData:', hasFuelData);

    const gpsOk = hasLastGps || hasNextGps;
    const onSite = hasFuelData ? (gpsOk && false) : gpsOk; // simplified
    console.log('onSite:', onSite);

    // Check: what about the early exit condition
    if (!next && !last.latitude && !last.longitude) {
      console.log('WOULD SKIP: no next record and no GPS');
    } else {
      console.log('WOULD NOT skip on early exit');
    }

    // Check fuel_value_end === 0 vs null
    if (last.fuel_value_end === 0) {
      console.log('WARNING: fuel_value_end is exactly 0, not null! This triggers hasFuelData check');
    }
  }

  await pool.end();
}

test().catch(e => console.error(e));
