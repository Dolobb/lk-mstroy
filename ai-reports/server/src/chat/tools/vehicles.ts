import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';
import { getPg16 } from '../../db/pg16';

export const queryVehicleRegistry = tool({
  description:
    'Получить реестр ТС из двух источников: самосвалы (dump_trucks.shift_records) и КИП (kip_vehicles.vehicle_records). ' +
    'Возвращает: госномер, название/модель, компания, подразделение, источник данных. ' +
    'Используй для группировки данных или поиска ТС по госномеру.',
  inputSchema: z.object({
    search: z.string().optional().describe('Поиск по госномеру или названию ТС'),
    source: z.enum(['all', 'dump_trucks', 'kip']).optional().describe('Источник: all (оба), dump_trucks, kip'),
  }),
  execute: async ({ search, source = 'all' }) => {
    console.log('[queryVehicleRegistry]', { search, source });
    const results: any[] = [];

    // Самосвалы из dump_trucks
    if (source === 'all' || source === 'dump_trucks') {
      try {
        const pool = getPg17();
        const dtConditions: string[] = [];
        const dtParams: unknown[] = [];
        let idx = 1;

        if (search) {
          dtConditions.push(`(sr.reg_number ILIKE $${idx} OR sr.name_mo ILIKE $${idx})`);
          dtParams.push(`%${search}%`);
          idx++;
        }

        const dtWhere = dtConditions.length ? `WHERE ${dtConditions.join(' AND ')}` : '';

        const { rows } = await pool.query(
          `SELECT DISTINCT
             sr.reg_number,
             sr.name_mo AS vehicle_name,
             sr.vehicle_id AS id_mo,
             'dump_trucks' AS source
           FROM dump_trucks.shift_records sr
           ${dtWhere}
           ORDER BY sr.reg_number`,
          dtParams,
        );
        results.push(...rows);
      } catch (err) {
        // Пропускаем если PG17 недоступен
      }
    }

    // КИП из vehicle_records
    if (source === 'all' || source === 'kip') {
      try {
        const pool = getPg16();
        const kipConditions: string[] = [];
        const kipParams: unknown[] = [];
        let idx = 1;

        if (search) {
          kipConditions.push(`(vr.vehicle_id ILIKE $${idx} OR vr.vehicle_model ILIKE $${idx})`);
          kipParams.push(`%${search}%`);
          idx++;
        }

        const kipWhere = kipConditions.length ? `WHERE ${kipConditions.join(' AND ')}` : '';

        const { rows } = await pool.query(
          `SELECT DISTINCT
             vr.vehicle_id AS reg_number,
             vr.vehicle_model AS vehicle_name,
             vr.company_name,
             vr.department_unit,
             'kip' AS source
           FROM vehicle_records vr
           ${kipWhere}
           ORDER BY vr.vehicle_id`,
          kipParams,
        );
        results.push(...rows);
      } catch (err) {
        // Пропускаем если PG16 недоступен
      }
    }

    console.log('[queryVehicleRegistry] result:', { success: true, count: results.length });
    return {
      success: true,
      count: results.length,
      data: results,
    };
  },
});
