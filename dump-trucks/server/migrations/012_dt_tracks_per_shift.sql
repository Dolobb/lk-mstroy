-- 012_dt_tracks_per_shift.sql
-- Трек хранится по СМЕНЕ (shift_record_id), а не по (vehicle_id, date).
--
-- Причина: в календарных сутках 2 смены (день 07:30–19:30 + ночь 19:30–07:30),
-- у обеих report_date = эта дата. Старый UNIQUE(vehicle_id, date) разрешал лишь
-- одну строку трека на машину в сутки → трек второй сохранённой смены терял место
-- (INSERT падал на unique-конфликте), и на карте появлялась «дыра»/«склейка» ~13 ч
-- между сменами. saveTrackForShift уже удаляет по shift_record_id; не хватало только
-- снять блокирующий констрейнт. dtTrackReader уже мёрджит несколько строк за день,
-- поэтому переход на «строка = смена» безопасен на стороне чтения.

ALTER TABLE dump_trucks.dt_tracks
  DROP CONSTRAINT IF EXISTS dt_tracks_vehicle_id_date_key;

-- Дедуп существующих дублей по shift_record_id (наследие старой схемы: при reuse
-- serial-id и delete-by-date накопились дубли, в основном вырожденные 2-точечные
-- треки). Оставляем лучшую строку: больше точек → позже создана → больший id.
DELETE FROM dump_trucks.dt_tracks t
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY shift_record_id
           ORDER BY jsonb_array_length(track_simplified) DESC, created_at DESC, id DESC
         ) AS rn
  FROM dump_trucks.dt_tracks
  WHERE shift_record_id IS NOT NULL
) d
WHERE t.id = d.id AND d.rn > 1;

-- Целостность: одна строка трека на смену (shift_record_id может быть NULL
-- из-за ON DELETE SET NULL — такие осиротевшие строки под уникальность не попадают).
CREATE UNIQUE INDEX IF NOT EXISTS dt_tracks_shift_record_id_key
  ON dump_trucks.dt_tracks (shift_record_id)
  WHERE shift_record_id IS NOT NULL;

-- Индекс для чтения по (vehicle_id, date) уже существует:
-- dt_tracks_vehicle_id_date_idx (создан в 011).
