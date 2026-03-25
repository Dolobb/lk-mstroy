import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryGeoData = tool({
  description:
    'Получить данные по геозонам и объектам: координаты, границы площадок, зоны погрузки/выгрузки. ' +
    'Источник: PostgreSQL mstroy, схема geo.',
  inputSchema: z.object({
    objectName: z.string().optional().describe('Название объекта'),
    zoneType: z.enum(['dt_loading', 'dt_unloading', 'dt_boundary']).optional().describe('Тип зоны'),
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
        `SELECT o.uid, o.name, o.smu, o.region
         FROM geo.objects o ${objWhere}
         ORDER BY o.name`,
        params,
      );

      // Зоны (если запрошены)
      let zones: unknown[] = [];
      if (objects.length > 0) {
        const zoneConditions: string[] = [`z.object_uid = ANY($1)`];
        const zoneParams: unknown[] = [objects.map((o: any) => o.uid)];

        if (zoneType) {
          zoneConditions.push(`z.tag = $2`);
          zoneParams.push(zoneType);
        }

        const { rows } = await pool.query(
          `SELECT z.id, z.object_uid, z.tag, z.name,
                  ST_AsGeoJSON(z.geom)::json AS geometry
           FROM geo.zones z
           WHERE ${zoneConditions.join(' AND ')}`,
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
