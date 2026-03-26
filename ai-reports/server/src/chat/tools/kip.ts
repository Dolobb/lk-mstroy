import { tool } from 'ai';
import { z } from 'zod';
import { getPg16 } from '../../db/pg16';

export const queryKipData = tool({
  description:
    'Получить данные КИП техники (коэффициент использования парка) за период. ' +
    'Возвращает: КИП% (utilization_ratio), загрузка% (load_efficiency_pct), ' +
    'расход топлива факт/норма, моточасы, простои, по сменам. ' +
    'Группировка по подразделениям (department_unit) и компаниям (company_name). ' +
    'Источник: PostgreSQL kip_vehicles, таблица vehicle_records.',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам (vehicle_id)'),
    vehicleModel: z.string().optional().describe('Фильтр по модели/типу ТС (напр. "бульдозер", "экскаватор") — поиск по vehicle_model'),
    departmentUnit: z.string().optional().describe('Фильтр по подразделению (department_unit, напр. "Мостоотряд-87")'),
    companyName: z.string().optional().describe('Фильтр по компании (company_name, напр. "Мостострой-11")'),
    shiftType: z.string().optional().describe('Фильтр по смене (shift_type)'),
  }),
  execute: async ({ dateFrom, dateTo, regNumbers, vehicleModel, departmentUnit, companyName, shiftType }) => {
    console.log('[queryKipData]', { dateFrom, dateTo, regNumbers, vehicleModel, departmentUnit, companyName, shiftType });
    const pool = getPg16();

    const conditions: string[] = ['report_date >= $1', 'report_date <= $2'];
    const params: unknown[] = [dateFrom, dateTo];
    let idx = 3;

    if (regNumbers?.length) {
      conditions.push(`vehicle_id = ANY($${idx})`);
      params.push(regNumbers);
      idx++;
    }
    if (vehicleModel) {
      conditions.push(`vehicle_model ILIKE $${idx}`);
      params.push(`%${vehicleModel}%`);
      idx++;
    }
    if (departmentUnit) {
      conditions.push(`department_unit ILIKE $${idx}`);
      params.push(`%${departmentUnit}%`);
      idx++;
    }
    if (companyName) {
      conditions.push(`company_name ILIKE $${idx}`);
      params.push(`%${companyName}%`);
      idx++;
    }
    if (shiftType) {
      conditions.push(`shift_type = $${idx}`);
      params.push(shiftType);
      idx++;
    }

    try {
      const { rows } = await pool.query(
        `SELECT
           report_date,
           shift_type,
           vehicle_id,
           vehicle_model,
           company_name,
           department_unit,
           total_stay_time,
           engine_on_time,
           idle_time,
           fuel_consumed_total,
           fuel_rate_fact,
           fuel_rate_norm,
           fuel_max_calc,
           fuel_variance,
           load_efficiency_pct,
           utilization_ratio,
           max_work_allowed
         FROM vehicle_records
         WHERE ${conditions.join(' AND ')}
         ORDER BY report_date, department_unit, vehicle_id`,
        params,
      );
      console.log('[queryKipData] result:', { success: true, count: rows.length });
      return { success: true, count: rows.length, data: rows };
    } catch (err) {
      console.error('[queryKipData] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
