-- Backfill: исторические строки (snapshots + vehicles), записанные ДО фикса
-- substring-бага в repairStatus() (2026-06-18), хранят неверный is_broken
-- («Неисправен» → false) и не-lowercase tech_status. Архив-вид показывал
-- неисправную технику зелёным badge.
--
-- Пересчитываем is_broken из сохранённого tech_status и приводим tech_status
-- к lowercase. Логика зеркалит repairStatus() в sheetsSyncService.ts:
--   middle ПЕРВЫМ (т.к. «требует ремонта» содержит «ремонт»), затем broken.
-- В одном UPDATE CASE видит СТАРЫЕ значения колонок — порядок SET не важен.

UPDATE vehicle_status.snapshots SET
  is_broken = CASE
    WHEN tech_status IS NULL OR btrim(tech_status) = '' THEN 'false'
    WHEN lower(btrim(tech_status)) LIKE '%требует ремонт%'
      OR lower(btrim(tech_status)) LIKE '%требуется ремонт%' THEN 'middle'
    WHEN lower(btrim(tech_status)) ~ 'неисправен|не исправен|ремонт|авария|не на ходу|списание|реализация' THEN 'true'
    ELSE 'false'
  END,
  tech_status = lower(btrim(tech_status));

UPDATE vehicle_status.vehicles SET
  is_broken = CASE
    WHEN tech_status IS NULL OR btrim(tech_status) = '' THEN 'false'
    WHEN lower(btrim(tech_status)) LIKE '%требует ремонт%'
      OR lower(btrim(tech_status)) LIKE '%требуется ремонт%' THEN 'middle'
    WHEN lower(btrim(tech_status)) ~ 'неисправен|не исправен|ремонт|авария|не на ходу|списание|реализация' THEN 'true'
    ELSE 'false'
  END,
  tech_status = lower(btrim(tech_status));
