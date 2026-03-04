\echo '=== 5351: именно 19.02 ==='
SELECT report_date, shift_type,
       round(load_efficiency_pct::numeric, 1) AS load_pct,
       round(fuel_rate_fact::numeric, 2)      AS fuel_fact,
       round(engine_on_time::numeric, 2)      AS engine_h,
       round(total_stay_time::numeric, 2)     AS stay_h
FROM vehicle_records
WHERE vehicle_id ILIKE '5351%72'
  AND report_date = '2026-02-19';

\echo ''
\echo '=== 0455: колонки route_lists ==='
SELECT column_name FROM information_schema.columns
WHERE table_name = 'route_lists' ORDER BY ordinal_position;

\echo ''
\echo '=== 0455: все записи в vehicle_records ==='
SELECT report_date, shift_type,
       round(engine_on_time::numeric,2) AS engine_h,
       round(utilization_ratio::numeric,2) AS util
FROM vehicle_records
WHERE vehicle_id ILIKE '0455%72'
ORDER BY report_date DESC LIMIT 10;

\echo ''
\echo '=== fuel_json rate=0 + engine>0 примеры (усл.1) ==='
SELECT vehicle_id, report_date, shift_type,
       engine_time_sec,
       (fuel_json->0->>'rate')::numeric AS fuel_rate,
       (fuel_json->0->>'valueBegin')::numeric AS tank_begin,
       (fuel_json->0->>'valueEnd')::numeric AS tank_end
FROM monitoring_raw
WHERE fuel_json IS NOT NULL
  AND fuel_json::text != '[]'
  AND engine_time_sec > 0
  AND (fuel_json->0->>'rate')::numeric = 0
LIMIT 10;
