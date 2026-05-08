-- 010: shift_records_active VIEW — отфильтрованные смены с учётом min_trips_per_shift объекта.
-- Решает проблему дубликатов: машина проезжает через вложенный объект мимоходом и получает
-- 1 фантомный рейс. Если у этого объекта min_trips_per_shift > 0, такая смена скрывается
-- целиком (рейсы + КИП + топливо).
-- Raw таблица shift_records остаётся нетронутой — recalculate и админ-инструменты работают
-- на ней. Все user-facing API/views читают только shift_records_active.

CREATE OR REPLACE VIEW dump_trucks.shift_records_active AS
SELECT sr.*
FROM dump_trucks.shift_records sr
LEFT JOIN geo.objects o ON o.uid = sr.object_uid
WHERE sr.trips_count >= COALESCE(o.min_trips_per_shift, 0);

-- Бэкфилл: object_name исторически хранил имя dt_boundary зоны вместо имени объекта
-- (см. vehicleDetector.ts:52 и filterRepo.ts::getAllDtZones — баг исправлен в коде).
-- Подтягиваем настоящее имя объекта в существующих записях.
UPDATE dump_trucks.shift_records sr
SET object_name = o.name
FROM geo.objects o
WHERE o.uid = sr.object_uid
  AND sr.object_uid IS NOT NULL
  AND sr.object_uid != 'unknown';
