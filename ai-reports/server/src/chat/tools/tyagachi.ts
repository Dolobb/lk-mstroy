import { tool } from 'ai';
import { z } from 'zod';
import { getSqlite } from '../../db/sqlite';

/** Convert sql.js exec() result to array of objects */
function toObjects(result: any[]): Record<string, unknown>[] {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row: any[]) =>
    Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]])),
  );
}

export const queryTyagachiData = tool({
  description:
    'Получить данные по тягачам: заявки (tracked_requests), путевые листы (pl_records), ТС (vehicles). ' +
    'Заявки содержат: номер, статус, маршрут, даты, стабильность. ' +
    'Путевые листы: привязка к ТС, даты выезда/возврата, статус. ' +
    'Источник: SQLite archive.db.',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    regNumber: z.string().optional().describe('Госномер ТС (ts_reg_number)'),
    requestNumber: z.number().optional().describe('Номер заявки (request_number)'),
    stabilityStatus: z.enum(['stable', 'in_progress']).optional().describe('Статус стабильности заявки'),
  }),
  execute: async ({ dateFrom, dateTo, regNumber, requestNumber, stabilityStatus }) => {
    try {
      const db = await getSqlite();

      // Заявки — фильтр по дате маршрута
      const reqConditions: string[] = [];
      const reqParams: unknown[] = [];

      // route_start_date хранится как строка "DD.MM.YYYY" или "YYYY-MM-DD"
      // Для надёжности фильтруем по last_synced_at или first_synced_at
      reqConditions.push(`first_synced_at >= ?`);
      reqParams.push(dateFrom);
      reqConditions.push(`first_synced_at <= ?`);
      reqParams.push(dateTo + ' 23:59:59');

      if (requestNumber) {
        reqConditions.push(`request_number = ?`);
        reqParams.push(requestNumber);
      }
      if (stabilityStatus) {
        reqConditions.push(`stability_status = ?`);
        reqParams.push(stabilityStatus);
      }

      const requests = toObjects(db.exec(
        `SELECT request_number, request_status, stability_status,
                route_start_address, route_end_address,
                route_start_date, route_end_date, route_distance,
                object_expend_code, object_expend_name, order_name_cargo,
                first_synced_at, last_synced_at
         FROM tracked_requests
         WHERE ${reqConditions.join(' AND ')}
         ORDER BY request_number`,
        reqParams as any[],
      ));

      // Путевые листы — фильтр по дате выезда
      // pl_date_out хранится как "DD.MM.YYYY HH:mm"
      const plConditions: string[] = [`pl_date_out_plan >= ?`, `pl_date_out_plan <= ?`];
      const plParams: unknown[] = [dateFrom, dateTo + ' 23:59:59'];

      if (regNumber) {
        plConditions.push(`v.ts_reg_number LIKE ?`);
        plParams.push(`%${regNumber}%`);
      }
      if (requestNumber) {
        plConditions.push(`p.request_number = ?`);
        plParams.push(requestNumber);
      }

      const routeLists = toObjects(db.exec(
        `SELECT p.pl_id, p.request_number, p.pl_ts_number,
                p.pl_date_out, p.pl_date_out_plan, p.pl_date_in_plan,
                p.pl_status, p.pl_close_list, p.has_monitoring,
                v.ts_reg_number, v.ts_name_mo, v.ts_id_mo
         FROM pl_records p
         JOIN vehicles v ON p.vehicle_id = v.id
         WHERE ${plConditions.join(' AND ')}
         ORDER BY p.pl_date_out_plan`,
        plParams as any[],
      ));

      // Сводка
      const stableCount = requests.filter((r: any) => r.stability_status === 'stable').length;
      const inProgressCount = requests.filter((r: any) => r.stability_status === 'in_progress').length;

      return {
        success: true,
        summary: {
          totalRequests: requests.length,
          stableRequests: stableCount,
          inProgressRequests: inProgressCount,
          totalRouteLists: routeLists.length,
        },
        requests: { count: requests.length, data: requests },
        routeLists: { count: routeLists.length, data: routeLists },
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
});
