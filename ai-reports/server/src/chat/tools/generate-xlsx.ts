import { tool } from 'ai';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config';
import {
  COLORS,
  STYLE_MAP,
  FMT,
  applyPrintSetup,
  fillRow,
  fillCell,
  applyBordersToAll,
  colLetter,
} from './xlsx-helpers';

const columnSchema = z.object({
  header: z.string().describe('Заголовок столбца'),
  key: z.string().describe('Ключ данных (имя поля)'),
  width: z.number().optional().describe('Ширина столбца'),
  format: z
    .enum(['text', 'percent', 'time_hhmm', 'decimal', 'integer'])
    .optional()
    .describe('Формат данных: text, percent (0.0%), time_hhmm ([h]:mm), decimal (0.00), integer (#,##0)'),
});

const columnGroupSchema = z.object({
  label: z.string().describe('Заголовок группы столбцов (напр. "1 смена")'),
  startKey: z.string().describe('Ключ первого столбца в группе'),
  endKey: z.string().describe('Ключ последнего столбца в группе'),
});

const rowStyleSchema = z.object({
  index: z.number().describe('0-based индекс строки в массиве rows[]'),
  style: z
    .enum(['group1', 'group2', 'group3', 'summary'])
    .describe('group1=тёмный синий, group2=средний синий, group3=светлый синий, summary=серый итог'),
  mergeColumns: z
    .string()
    .optional()
    .describe('Merge диапазон столбцов для этой строки: "A:E" — объединить A-E'),
});

const sheetSchema = z.object({
  name: z.string().describe('Название листа'),

  // --- Заголовок отчёта ---
  title: z
    .string()
    .optional()
    .describe('Заголовок отчёта — merged сверху листа, тёмный фон'),

  // --- Столбцы ---
  columns: z.array(columnSchema).describe('Столбцы'),

  // --- Группировка столбцов (2-level headers) ---
  columnGroups: z
    .array(columnGroupSchema)
    .optional()
    .describe('Группы столбцов для 2-level заголовков (напр. "1 смена" над несколькими колонками)'),

  // --- Данные ---
  rows: z.array(z.record(z.unknown())).describe('Массив строк данных'),

  // --- Стилизация строк ---
  rowStyles: z
    .array(rowStyleSchema)
    .optional()
    .describe('Стили для строк-группировок (тип ТС, подразделение, итог)'),

  // --- Merged cells ---
  mergedCells: z
    .array(z.string())
    .optional()
    .describe('Произвольные merge: ["A1:C1", "D2:F3"]'),

  // --- Печать ---
  orientation: z
    .enum(['landscape', 'portrait'])
    .optional()
    .default('portrait')
    .describe('Ориентация A4 при печати'),

  // --- Опции ---
  freezeRow: z
    .number()
    .optional()
    .default(1)
    .describe('Заморозить строки до этого номера (1 = заголовок)'),
  showAutoFilter: z.boolean().optional().default(true).describe('Авто-фильтр'),
});

// Маппинг format → Excel numFmt
const FORMAT_MAP: Record<string, string> = {
  percent: FMT.percent,
  time_hhmm: FMT.timeHM,
  decimal: FMT.decimal2,
  integer: FMT.integer,
};

export const generateXlsx = tool({
  description:
    'Сгенерировать Excel-файл (XLSX) с расширенным форматированием: ' +
    'title (merged заголовок), columnGroups (2-level headers), ' +
    'rowStyles (group1/group2/group3/summary стили строк), mergedCells, ' +
    'format столбцов (percent, time_hhmm, decimal, integer), ' +
    'ориентация печати A4. Для нестандартных отчётов — сравнения, аналитика, сводки.',
  inputSchema: z.object({
    title: z.string().describe('Название отчёта (будет в имени файла)'),
    sheets: z.array(sheetSchema).describe('Листы Excel'),
  }),
  execute: async ({ title, sheets }) => {
    console.log('[generateXlsx]', { title, sheetCount: sheets.length, totalRows: sheets.reduce((s, sh) => s + sh.rows.length, 0) });
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'НПС Мониторинг — AI Reports';
      workbook.created = new Date();

      for (const sheetDef of sheets) {
        const ws = workbook.addWorksheet(sheetDef.name);
        const colCount = sheetDef.columns.length;

        // Build key→colIndex map (1-based)
        const keyToCol = new Map<string, number>();
        sheetDef.columns.forEach((col, i) => keyToCol.set(col.key, i + 1));

        let dataStartRow = 1;

        // --- Title row ---
        if (sheetDef.title) {
          const titleRow = ws.getRow(1);
          titleRow.getCell(1).value = sheetDef.title;
          ws.mergeCells(`A1:${colLetter(colCount)}1`);
          fillRow(titleRow, COLORS.headerDark, COLORS.textWhite, true, 14);
          titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          titleRow.height = 36;
          dataStartRow = 2;
        }

        // --- Column groups (2-level headers) ---
        if (sheetDef.columnGroups?.length) {
          const groupRow = ws.getRow(dataStartRow);
          const subHeaderRow = ws.getRow(dataStartRow + 1);

          // Fill group headers
          for (const g of sheetDef.columnGroups) {
            const startCol = keyToCol.get(g.startKey);
            const endCol = keyToCol.get(g.endKey);
            if (startCol && endCol) {
              const startLetter = colLetter(startCol);
              const endLetter = colLetter(endCol);
              ws.mergeCells(`${startLetter}${dataStartRow}:${endLetter}${dataStartRow}`);
              const cell = groupRow.getCell(startCol);
              cell.value = g.label;
              fillCell(cell, COLORS.headerMedium, COLORS.textWhite, true, 11);
            }
          }

          // Non-grouped columns span 2 rows
          for (const [key, colIdx] of keyToCol) {
            const inGroup = sheetDef.columnGroups.some((g) => {
              const s = keyToCol.get(g.startKey) || 0;
              const e = keyToCol.get(g.endKey) || 0;
              return colIdx >= s && colIdx <= e;
            });
            if (!inGroup) {
              const letter = colLetter(colIdx);
              ws.mergeCells(`${letter}${dataStartRow}:${letter}${dataStartRow + 1}`);
              const col = sheetDef.columns.find((c) => c.key === key);
              groupRow.getCell(colIdx).value = col?.header || key;
              fillCell(groupRow.getCell(colIdx), COLORS.headerStd, COLORS.textWhite, true, 10);
            }
          }

          // Sub-headers (column names within groups)
          for (const g of sheetDef.columnGroups) {
            const startCol = keyToCol.get(g.startKey) || 0;
            const endCol = keyToCol.get(g.endKey) || 0;
            for (let c = startCol; c <= endCol; c++) {
              const col = sheetDef.columns[c - 1];
              subHeaderRow.getCell(c).value = col?.header || '';
              fillCell(subHeaderRow.getCell(c), COLORS.headerStd, COLORS.textWhite, true, 9);
            }
          }

          groupRow.height = 24;
          subHeaderRow.height = 24;
          dataStartRow += 2;

          // Freeze at 2-level header
          const freezeAt = dataStartRow;
          ws.views = [{ state: 'frozen', ySplit: freezeAt - 1 }];
        } else {
          // --- Single-level headers ---
          ws.columns = sheetDef.columns.map((col) => ({
            header: col.header,
            key: col.key,
            width: col.width || Math.max(col.header.length + 4, 12),
          }));

          const headerRow = ws.getRow(dataStartRow);
          fillRow(headerRow, COLORS.headerStd, COLORS.textWhite, true, 10);
          headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
          headerRow.height = 28;
          dataStartRow++;

          // Freeze
          const freezeAt = sheetDef.freezeRow ?? 1;
          ws.views = [{ state: 'frozen', ySplit: dataStartRow - 1 }];
        }

        // --- Set column widths (for 2-level mode too) ---
        if (sheetDef.columnGroups?.length) {
          sheetDef.columns.forEach((col, i) => {
            const wsCol = ws.getColumn(i + 1);
            wsCol.width = col.width || Math.max(col.header.length + 4, 12);
            wsCol.key = col.key;
          });
        }

        // --- Build rowStyle index map ---
        const rowStyleMap = new Map<number, z.infer<typeof rowStyleSchema>>();
        if (sheetDef.rowStyles) {
          for (const rs of sheetDef.rowStyles) {
            rowStyleMap.set(rs.index, rs);
          }
        }

        // --- Data rows ---
        for (let i = 0; i < sheetDef.rows.length; i++) {
          const rowData = sheetDef.rows[i];
          const excelRow = ws.getRow(dataStartRow + i);

          // Set cell values
          sheetDef.columns.forEach((col, colIdx) => {
            const val = rowData[col.key];
            if (val !== undefined && val !== null) {
              excelRow.getCell(colIdx + 1).value = val as ExcelJS.CellValue;
            }
          });

          excelRow.alignment = { vertical: 'middle' };

          // Apply format to cells
          sheetDef.columns.forEach((col, colIdx) => {
            if (col.format && col.format !== 'text') {
              const fmt = FORMAT_MAP[col.format];
              if (fmt) {
                excelRow.getCell(colIdx + 1).numFmt = fmt;
              }
            }
          });

          // Apply row style
          const rs = rowStyleMap.get(i);
          if (rs) {
            const style = STYLE_MAP[rs.style];
            if (style) {
              fillRow(excelRow, style.bg, style.font, style.bold);
            }
            // Merge columns for group rows
            if (rs.mergeColumns) {
              const [startLetter, endLetter] = rs.mergeColumns.split(':');
              const rowNum = dataStartRow + i;
              ws.mergeCells(`${startLetter}${rowNum}:${endLetter}${rowNum}`);
            }
          } else {
            // Alternate row colors
            if (i % 2 === 1) {
              excelRow.eachCell({ includeEmpty: true }, (cell) => {
                if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === undefined) {
                  cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: COLORS.bgAlt },
                  };
                }
              });
            }
          }
        }

        // --- Explicit merged cells ---
        if (sheetDef.mergedCells) {
          for (const range of sheetDef.mergedCells) {
            ws.mergeCells(range);
          }
        }

        // --- Auto-filter ---
        if (sheetDef.showAutoFilter !== false && sheetDef.rows.length > 0 && !sheetDef.columnGroups?.length) {
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: colCount },
          };
        }

        // --- Borders ---
        applyBordersToAll(ws);

        // --- Print setup ---
        applyPrintSetup(ws, sheetDef.orientation || 'portrait');
      }

      // --- Save ---
      const fileId = `${title.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(config.outputDir, `${fileId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);

      console.log('[generateXlsx] result:', { success: true, fileId, downloadUrl: `/api/reports/files/${fileId}` });
      return {
        success: true,
        fileId,
        downloadUrl: `/api/reports/files/${fileId}`,
        fileName: `${fileId}.xlsx`,
      };
    } catch (err) {
      console.error('[generateXlsx] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
