import { tool } from 'ai';
import { z } from 'zod';
import { getSqlite } from '../../db/sqlite';

export const queryTyagachiData = tool({
  description:
    'Получить данные по тягачам: заявки, путевые листы (ПЛ), пробег, маршруты, стоянки. ' +
    'Источник: SQLite archive.db (тягачи).',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
    requestNumber: z.string().optional().describe('Номер заявки'),
  }),
  execute: async ({ dateFrom, dateTo, regNumbers, requestNumber }) => {
    // TODO: Уточнить точные имена таблиц и полей в archive.db
    // Ожидаемые таблицы: tracked_requests, pl_records, monitoring
    try {
      const db = await getSqlite();

      // Заявки
      let reqQuery = `SELECT * FROM tracked_requests WHERE date_out >= ? AND date_out <= ?`;
      const reqParams: unknown[] = [dateFrom, dateTo];

      if (requestNumber) {
        reqQuery += ` AND number = ?`;
        reqParams.push(requestNumber);
      }

      const requests = db.exec(reqQuery, reqParams as any);

      // Путевые листы
      let plQuery = `SELECT * FROM pl_records WHERE date_out >= ? AND date_out <= ?`;
      const plParams: unknown[] = [dateFrom, dateTo];

      if (regNumbers?.length) {
        plQuery += ` AND reg_number IN (${regNumbers.map(() => '?').join(',')})`;
        plParams.push(...regNumbers);
      }

      const pls = db.exec(plQuery, plParams as any);

      // Конвертируем результат sql.js в массив объектов
      const toObjects = (result: any[]) => {
        if (!result.length) return [];
        const { columns, values } = result[0];
        return values.map((row: any[]) =>
          Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]])),
        );
      };

      return {
        success: true,
        requests: { count: toObjects(requests).length, data: toObjects(requests) },
        routeLists: { count: toObjects(pls).length, data: toObjects(pls) },
      };
    } catch (err) {
      return { success: false, error: String(err), hint: 'Проверьте схему archive.db' };
    }
  },
});
