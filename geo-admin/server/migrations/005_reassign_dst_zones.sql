-- Переносим dst_zone зоны из объектов-заглушек в реальные объекты самосвалов.
-- Для каждой dst_zone берём объект с dt_boundary, имеющий максимальную площадь пересечения.
-- После переноса удаляем объекты, ставшие пустыми.

WITH best_match AS (
  SELECT DISTINCT ON (dst_z.id)
    dst_z.id             AS zone_id,
    real_obj.id          AS new_object_id
  FROM geo.zones dst_z
  JOIN geo.zone_tags dst_zt  ON dst_zt.zone_id = dst_z.id AND dst_zt.tag = 'dst_zone'
  JOIN geo.zones bnd_z       ON ST_Intersects(dst_z.geom, bnd_z.geom)
  JOIN geo.zone_tags bnd_zt  ON bnd_zt.zone_id = bnd_z.id AND bnd_zt.tag = 'dt_boundary'
  JOIN geo.objects real_obj  ON real_obj.id = bnd_z.object_id
  WHERE real_obj.uid IN (
    'ekaterinburg', 'tobolsk-osnova', 'pyt-yakh', 'asfaltno-betonnyy-zavod', 'g-bodaybo-karer'
  )
  ORDER BY dst_z.id, ST_Area(ST_Intersection(dst_z.geom::geography, bnd_z.geom::geography)) DESC
)
UPDATE geo.zones z
SET object_id = bm.new_object_id
FROM best_match bm
WHERE z.id = bm.zone_id
  AND z.object_id != bm.new_object_id;

DELETE FROM geo.objects o
WHERE NOT EXISTS (SELECT 1 FROM geo.zones z WHERE z.object_id = o.id);
