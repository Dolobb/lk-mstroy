import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryGeoData = tool({
  description:
    'Получить список объектов строительства и их зон (погрузка, выгрузка, граница площадки). ' +
    'Источник: PostgreSQL mstroy, схема geo. Геометрия (координаты) не возвращается — только метаданные.',
  inputSchema: z.object({
    objectName: z.string().optional().describe('Фильтр по названию объекта (частичное совпадение)'),
    zoneType: z.enum(['dt_loading', 'dt_unloading', 'dt_boundary', 'dt_onsite']).optional().describe('Тип зоны (тег)'),
    limit: z.number().int().min(1).max(200).optional().default(100).describe('Макс. объектов (по умолчанию 100)'),
  }),
  execute: async ({ objectName, zoneType, limit = 100 }) => {
    console.log('[queryGeoData]', { objectName, zoneType, limit });
    const pool = getPg17();

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (objectName) {
        conditions.push(`o.name ILIKE $${idx}`);
        params.push(`%${objectName}%`);
        idx++;
      }

      const objWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows: objects } = await pool.query(
        `SELECT o.id, o.uid, o.name, o.timezone, o.min_trips_per_shift
         FROM geo.objects o ${objWhere}
         ORDER BY o.name
         LIMIT $${idx}`,
        [...params, limit],
      );

      // Зоны без геометрии (GeoJSON слишком большой для контекста модели)
      let zones: unknown[] = [];
      if (objects.length > 0) {
        const objectIds = objects.map((o: any) => o.id);
        const zoneConditions: string[] = [`z.object_id = ANY($1)`];
        const zoneParams: unknown[] = [objectIds];

        if (zoneType) {
          zoneConditions.push(`zt.tag = $2`);
          zoneParams.push(zoneType);
        }

        const { rows } = await pool.query(
          `SELECT z.id, z.uid AS zone_uid, z.name AS zone_name,
                  o.uid AS object_uid, o.name AS object_name,
                  array_agg(zt.tag) AS tags
           FROM geo.zones z
           JOIN geo.objects o ON z.object_id = o.id
           LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
           WHERE ${zoneConditions.join(' AND ')}
           GROUP BY z.id, z.uid, z.name, o.uid, o.name`,
          zoneParams,
        );
        zones = rows;
      }

      const totalObjects = objects.length;
      console.log('[queryGeoData] result:', { success: true, objectCount: totalObjects, zoneCount: zones.length });
      return { success: true, objects, zones, objectCount: totalObjects, zoneCount: zones.length };
    } catch (err) {
      console.error('[queryGeoData] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
