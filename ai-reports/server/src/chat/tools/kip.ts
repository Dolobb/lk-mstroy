import { tool } from 'ai';
import { z } from 'zod';
import { getPg16 } from '../../db/pg16';

export const queryKipData = tool({
  description:
    'Получить данные КИП техники (коэффициент использования парка) за период. ' +
    'Возвращает: КИП%, загрузка%, расход топлива (факт и норма), моточасы, простои по сменам. ' +
    'Источник: PostgreSQL kip_vehicles.',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
    vehicleType: z.string().optional().describe('Тип ТС (бульдозер, экскаватор, кран и т.д.)'),
    smu: z.string().optional().describe('Фильтр по СМУ (подразделение)'),
  }),
  execute: async ({ dateFrom, dateTo, regNumbers, vehicleType, smu }) => {
    // TODO: Реализовать SQL-запрос к kip_vehicles
    // Таблица: vehicle_records
    // Поля: reg_number, report_date, shift, kip_pct, load_pct,
    //        fuel_rate_fact, fuel_rate_norm, engine_hours, idle_time,
    //        vehicle_type, smu
    const pool = getPg16();

    const conditions: string[] = ['report_date >= $1', 'report_date <= $2'];
    const params: unknown[] = [dateFrom, dateTo];
    let idx = 3;

    if (regNumbers?.length) {
      conditions.push(`reg_number = ANY($${idx})`);
      params.push(regNumbers);
      idx++;
    }
    if (vehicleType) {
      conditions.push(`vehicle_type = $${idx}`);
      params.push(vehicleType);
      idx++;
    }
    if (smu) {
      conditions.push(`smu = $${idx}`);
      params.push(smu);
      idx++;
    }

    try {
      const { rows } = await pool.query(
        `SELECT * FROM vehicle_records
         WHERE ${conditions.join(' AND ')}
         ORDER BY report_date, reg_number`,
        params,
      );
      return { success: true, count: rows.length, data: rows };
    } catch (err) {
      return { success: false, error: String(err), hint: 'Проверьте схему kip_vehicles — таблица vehicle_records может иметь другие имена полей' };
    }
  },
});
