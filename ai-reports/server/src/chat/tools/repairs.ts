import { tool } from 'ai';
import { z } from 'zod';
import { getPg17 } from '../../db/pg17';

export const queryRepairs = tool({
  description:
    'Получить данные по ремонтам и ТО техники: тип ремонта, причина, даты, объект. ' +
    'Источник: PostgreSQL mstroy, таблица dump_trucks.repairs.',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
    objectName: z.string().optional().describe('Фильтр по объекту'),
  }),
  execute: async ({ dateFrom, dateTo, regNumbers, objectName }) => {
    const pool = getPg17();

    const conditions: string[] = [
      'r.date_from <= $2',
      'r.date_to >= $1',
    ];
    const params: unknown[] = [dateFrom, dateTo];
    let idx = 3;

    if (regNumbers?.length) {
      conditions.push(`r.reg_number = ANY($${idx})`);
      params.push(regNumbers);
      idx++;
    }
    if (objectName) {
      conditions.push(`r.object_name ILIKE $${idx}`);
      params.push(`%${objectName}%`);
      idx++;
    }

    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.reg_number, r.type, r.reason,
                r.date_from, r.date_to, r.object_name
         FROM dump_trucks.repairs r
         WHERE ${conditions.join(' AND ')}
         ORDER BY r.date_from`,
        params,
      );
      return { success: true, count: rows.length, data: rows };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
});
