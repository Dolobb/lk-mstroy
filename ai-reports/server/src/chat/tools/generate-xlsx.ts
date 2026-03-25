import { tool } from 'ai';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config';

const columnSchema = z.object({
  header: z.string().describe('Заголовок столбца'),
  key: z.string().describe('Ключ данных (имя поля)'),
  width: z.number().optional().describe('Ширина столбца'),
});

const sheetSchema = z.object({
  name: z.string().describe('Название листа'),
  columns: z.array(columnSchema).describe('Столбцы'),
  rows: z.array(z.record(z.unknown())).describe('Массив строк данных'),
  freezeHeader: z.boolean().optional().describe('Заморозить заголовок'),
});

export const generateXlsx = tool({
  description:
    'Сгенерировать Excel-файл (XLSX) с заданными листами, столбцами и данными. ' +
    'Возвращает ссылку для скачивания. Файл будет оформлен: заголовки жирным, ' +
    'рамки, авто-ширина, замороженная шапка.',
  inputSchema: z.object({
    title: z.string().describe('Название отчёта (будет в имени файла)'),
    sheets: z.array(sheetSchema).describe('Листы Excel'),
  }),
  execute: async ({ title, sheets }) => {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'НПС Мониторинг — AI Reports';
      workbook.created = new Date();

      for (const sheetDef of sheets) {
        const ws = workbook.addWorksheet(sheetDef.name);

        // Столбцы
        ws.columns = sheetDef.columns.map((col) => ({
          header: col.header,
          key: col.key,
          width: col.width || Math.max(col.header.length + 4, 12),
        }));

        // Стилизация заголовков
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, size: 11 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' },
        };
        headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 28;

        // Данные
        for (const rowData of sheetDef.rows) {
          const row = ws.addRow(rowData);
          row.alignment = { vertical: 'middle' };
        }

        // Рамки для всех ячеек
        const border: Partial<ExcelJS.Borders> = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        ws.eachRow((row) => {
          row.eachCell((cell) => {
            cell.border = border;
          });
        });

        // Авто-фильтр
        if (sheetDef.rows.length > 0) {
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: sheetDef.columns.length },
          };
        }

        // Заморозка шапки
        if (sheetDef.freezeHeader !== false) {
          ws.views = [{ state: 'frozen', ySplit: 1 }];
        }
      }

      // Сохранение
      const fileId = `${title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(config.outputDir, `${fileId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);

      return {
        success: true,
        fileId,
        downloadUrl: `/api/reports/files/${fileId}`,
        fileName: `${fileId}.xlsx`,
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
});
