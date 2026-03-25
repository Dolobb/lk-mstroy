import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryVehicleRegistry = tool({
  description:
    'Получить реестр ТС: госномер, название, модель, тип, принадлежность к СМУ/филиалу. ' +
    'Полезно для группировки данных по подразделению или типу техники. ' +
    'Источник: PostgreSQL mstroy, таблица geo.objects + TIS API vehicle cache.',
  inputSchema: z.object({
    vehicleType: z.string().optional().describe('Тип ТС (самосвал, тягач, бульдозер, экскаватор и др.)'),
    smu: z.string().optional().describe('Подразделение СМУ'),
    search: z.string().optional().describe('Поиск по госномеру или названию'),
  }),
  execute: async ({ vehicleType, smu, search }) => {
    // TODO: Определить единый источник реестра ТС
    // Варианты:
    //   1. Таблица в mstroy (если есть)
    //   2. TIS API getMonitoringObjects кеш
    //   3. Собрать из shift_records + vehicle_records уникальные ТС
    //
    // Пока — заглушка, собирающая уникальные ТС из shift_records самосвалов

    const pool = getPg17();

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (search) {
        conditions.push(`(sr.reg_number ILIKE $${idx} OR sr.name_mo ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT DISTINCT sr.reg_number, sr.name_mo, sr.vehicle_id
         FROM dump_trucks.shift_records sr
         ${where}
         ORDER BY sr.reg_number`,
        params,
      );

      return {
        success: true,
        count: rows.length,
        data: rows,
        note: 'Это временная реализация. Полный реестр ТС с типом и СМУ нужно настроить.',
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
});
