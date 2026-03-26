import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryGeoData = tool({
  description:
    'Получить данные по геозонам и объектам: координаты, границы площадок, зоны погрузки/выгрузки. ' +
    'Источник: PostgreSQL mstroy, схема geo.',
  inputSchema: z.object({
    objectName: z.string().optional().describe('Название объекта'),
    zoneType: z.enum(['dt_loading', 'dt_unloading', 'dt_boundary', 'dt_onsite']).optional().describe('Тип зоны (тег)'),
  }),
  execute: async ({ objectName, zoneType }) => {
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
        `SELECT o.id, o.uid, o.name, o.smu, o.region, o.timezone
         FROM geo.objects o ${objWhere}
         ORDER BY o.name`,
        params,
      );

      // Зоны (если есть объекты)
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
                  array_agg(zt.tag) AS tags,
                  ST_AsGeoJSON(z.geom)::json AS geometry
           FROM geo.zones z
           JOIN geo.objects o ON z.object_id = o.id
           LEFT JOIN geo.zone_tags zt ON zt.zone_id = z.id
           WHERE ${zoneConditions.join(' AND ')}
           GROUP BY z.id, z.uid, z.name, o.uid, o.name, z.geom`,
          zoneParams,
        );
        zones = rows;
      }

      return { success: true, objects, zones };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
});
