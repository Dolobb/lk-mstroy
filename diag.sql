\echo '=== стр.20: нагрузка 5351ОА72 ==='
SELECT report_date, shift_type,
       round(load_efficiency_pct::numeric, 1) AS load_pct,
       round(fuel_rate_fact::numeric, 2)      AS fuel_fact,
       round(fuel_rate_norm::numeric, 2)      AS fuel_norm,
       round(engine_on_time::numeric, 2)      AS engine_h,
       round(total_stay_time::numeric, 2)     AS stay_h
FROM vehicle_records
WHERE vehicle_id ILIKE '5351%72'
ORDER BY report_date DESC LIMIT 15;

\echo ''
\echo '=== стр.21: 2314 последние записи ==='
SELECT report_date, shift_type,
       round(engine_on_time::numeric, 2)   AS engine_h,
       round(utilization_ratio::numeric, 2) AS util
FROM vehicle_records
WHERE vehicle_id ILIKE '2314%72'
ORDER BY report_date DESC LIMIT 10;

\echo ''
\echo '=== стр.21: 0455 путевые листы ==='
SELECT date_out_plan::text, status, pl_id
FROM route_lists
WHERE reg_number ILIKE '0455%72'
ORDER BY date_out_plan DESC LIMIT 10;

\echo ''
\echo '=== стр.22: 7719 смещение суток ==='
SELECT report_date, shift_type,
       round(engine_on_time::numeric, 2)    AS engine_h,
       round(utilization_ratio::numeric, 2) AS util,
       round(total_stay_time::numeric, 2)   AS stay_h
FROM vehicle_records
WHERE vehicle_id ILIKE '7719%72'
  AND report_date BETWEEN '2026-02-22' AND '2026-02-25'
ORDER BY report_date, shift_type;

\echo ''
\echo '=== fuel_json структура ==='
SELECT vehicle_id, report_date, shift_type, engine_time_sec,
       fuel_json::text
FROM monitoring_raw
WHERE engine_time_sec > 0
  AND fuel_json IS NOT NULL
  AND fuel_json::text != '[]'
LIMIT 3;

\echo ''
\echo '=== track_json структура ==='
SELECT vehicle_id, report_date, shift_type,
       jsonb_array_length(track_json) AS pts,
       track_json->0                  AS first_pt,
       track_json->(jsonb_array_length(track_json)-1) AS last_pt
FROM monitoring_raw
WHERE track_json IS NOT NULL
  AND jsonb_array_length(track_json) > 0
LIMIT 3;
