-- Объект как полноценная сущность: добавляем min_trips_per_shift, удаляем мусорные smu/region.
-- min_trips_per_shift = 0 → фильтр выключен (default).

ALTER TABLE geo.objects
  ADD COLUMN IF NOT EXISTS min_trips_per_shift INTEGER NOT NULL DEFAULT 0;

ALTER TABLE geo.objects DROP COLUMN IF EXISTS smu;
ALTER TABLE geo.objects DROP COLUMN IF EXISTS region;
