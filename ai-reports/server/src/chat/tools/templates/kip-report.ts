import { tool } from 'ai';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../../config';
import { getPg16 } from '../../../db/pg16';
import {
  COLORS,
  FMT,
  applyPrintSetup,
  fillRow,
  fillCell,
  applyBorders,
  colLetter,
  hoursToHHMM,
  formatDateRu,
} from '../xlsx-helpers';

interface KipRow {
  report_date: string;
  shift_type: string;
  vehicle_id: string;
  vehicle_model: string;
  company_name: string;
  department_unit: string;
  utilization_ratio: number | null;
  load_efficiency_pct: number | null;
  total_stay_time: number | null;
  engine_on_time: number | null;
  idle_time: number | null;
  fuel_consumed_total: number | null;
  fuel_rate_fact: number | null;
  fuel_rate_norm: number | null;
  fuel_variance: number | null;
  max_work_allowed: number | null;
}

// Standard columns for KIP report
const STANDARD_COLS = ['kip', 'stay_time', 'engine_time', 'load_pct'] as const;
const OPTIONAL_COLS = ['fuel_consumed', 'fuel_norm', 'fuel_variance', 'idle_time', 'max_work'] as const;
type ColKey = typeof STANDARD_COLS[number] | typeof OPTIONAL_COLS[number];

const COL_DEFS: Record<ColKey, { header: string; width: number; format: string }> = {
  kip:           { header: 'КИП%',            width: 10, format: FMT.percent },
  stay_time:     { header: 'Вр. на объекте',  width: 14, format: FMT.timeHM },
  engine_time:   { header: 'Вр. двигателя',   width: 14, format: FMT.timeHM },
  load_pct:      { header: 'Нагрузка%',       width: 12, format: FMT.percent },
  fuel_consumed: { header: 'Расход топл.',     width: 14, format: FMT.decimal2 },
  fuel_norm:     { header: 'Норма топл.',      width: 14, format: FMT.decimal2 },
  fuel_variance: { header: 'Откл. топл.',      width: 14, format: FMT.decimal2 },
  idle_time:     { header: 'Простой',          width: 12, format: FMT.timeHM },
  max_work:      { header: 'Макс. выр.',       width: 12, format: FMT.timeHM },
};

function parseVehicleType(model: string): string {
  if (!model) return 'Прочие';
  const first = model.split(/\s+/)[0].toLowerCase();
  const typeMap: Record<string, string> = {
    'бульдозер': 'БУЛЬДОЗЕРЫ', 'bulldozer': 'БУЛЬДОЗЕРЫ',
    'экскаватор': 'ЭКСКАВАТОРЫ', 'excavator': 'ЭКСКАВАТОРЫ',
    'кран': 'КРАНЫ', 'crane': 'КРАНЫ',
    'погрузчик': 'ПОГРУЗЧИКИ', 'loader': 'ПОГРУЗЧИКИ',
    'самосвал': 'САМОСВАЛЫ', 'dump': 'САМОСВАЛЫ',
    'каток': 'КАТКИ', 'roller': 'КАТКИ',
    'грейдер': 'ГРЕЙДЕРЫ', 'grader': 'ГРЕЙДЕРЫ',
    'liebherr': 'БУЛЬДОЗЕРЫ', 'cat': 'БУЛЬДОЗЕРЫ',
    'komatsu': 'ЭКСКАВАТОРЫ', 'hitachi': 'ЭКСКАВАТОРЫ',
    'volvo': 'САМОСВАЛЫ',
  };
  return typeMap[first] || 'ПРОЧИЕ';
}

function getShiftValue(row: KipRow, col: ColKey): number | null {
  switch (col) {
    case 'kip': return row.utilization_ratio;
    case 'stay_time': return row.total_stay_time;
    case 'engine_time': return row.engine_on_time;
    case 'load_pct': return row.load_efficiency_pct;
    case 'fuel_consumed': return row.fuel_consumed_total;
    case 'fuel_norm': return row.fuel_rate_norm;
    case 'fuel_variance': return row.fuel_variance;
    case 'idle_time': return row.idle_time;
    case 'max_work': return row.max_work_allowed;
    default: return null;
  }
}

/** Convert hours (float) to Excel time fraction for [h]:mm format */
function hoursToTimeFraction(hours: number | null): number | null {
  if (hours === null || hours === undefined) return null;
  return hours / 24; // Excel time is fraction of day
}

export const generateKipReport = tool({
  description:
    'Сгенерировать стандартный отчёт КИП техники с группировкой по типу ТС → подразделение → техника. ' +
    '2-level headers (1 смена / 2 смена). Печать A4 landscape. ' +
    'Используй когда просят: "отчёт КИП", "использование парка", "выработка техники", "моточасы".',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    departmentUnit: z.string().optional().describe('Фильтр по подразделению'),
    vehicleModel: z.string().optional().describe('Фильтр по модели/типу ТС'),
    companyName: z.string().optional().describe('Фильтр по компании'),
    includeColumns: z
      .array(z.enum(['kip', 'stay_time', 'engine_time', 'load_pct', 'fuel_consumed', 'fuel_norm', 'fuel_variance', 'idle_time', 'max_work']))
      .optional()
      .describe('Столбцы для включения (по умолчанию: kip, stay_time, engine_time, load_pct)'),
  }),
  execute: async ({ dateFrom, dateTo, departmentUnit, vehicleModel, companyName, includeColumns }) => {
    console.log('[generateKipReport]', { dateFrom, dateTo, departmentUnit, vehicleModel, companyName, includeColumns });
    try {
      const pool = getPg16();

      // --- Query data ---
      const conditions: string[] = ['report_date >= $1', 'report_date <= $2'];
      const params: unknown[] = [dateFrom, dateTo];
      let idx = 3;

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

      const { rows } = await pool.query<KipRow>(
        `SELECT report_date, shift_type, vehicle_id, vehicle_model,
                company_name, department_unit,
                utilization_ratio, load_efficiency_pct,
                total_stay_time, engine_on_time, idle_time,
                fuel_consumed_total, fuel_rate_fact, fuel_rate_norm,
                fuel_variance, max_work_allowed
         FROM vehicle_records
         WHERE ${conditions.join(' AND ')}
         ORDER BY vehicle_model, department_unit, vehicle_id, report_date, shift_type`,
        params,
      );

      if (rows.length === 0) {
        return { success: true, message: 'Нет данных за указанный период', count: 0 };
      }

      // --- Determine columns ---
      const activeCols: ColKey[] = (includeColumns as ColKey[] | undefined) || [...STANDARD_COLS];

      // --- Group data: vehicleType → organization → department → vehicle → { shift1: avg, shift2: avg } ---
      type VehicleAgg = {
        model: string;
        company: string;
        department: string;
        shift1: Record<ColKey, { sum: number; count: number }>;
        shift2: Record<ColKey, { sum: number; count: number }>;
      };

      const grouped = new Map<string, Map<string, Map<string, Map<string, VehicleAgg>>>>();

      for (const row of rows) {
        const vType = parseVehicleType(row.vehicle_model);
        const org = row.company_name || 'Без организации';
        const dept = row.department_unit || 'Без подразделения';
        const vid = row.vehicle_id;
        const shift = row.shift_type === 'shift1' ? 'shift1' : 'shift2';

        if (!grouped.has(vType)) grouped.set(vType, new Map());
        const orgMap = grouped.get(vType)!;
        if (!orgMap.has(org)) orgMap.set(org, new Map());
        const deptMap = orgMap.get(org)!;
        if (!deptMap.has(dept)) deptMap.set(dept, new Map());
        const vMap = deptMap.get(dept)!;

        if (!vMap.has(vid)) {
          const emptyAgg = () => {
            const r: Record<string, { sum: number; count: number }> = {};
            for (const c of activeCols) r[c] = { sum: 0, count: 0 };
            return r as Record<ColKey, { sum: number; count: number }>;
          };
          vMap.set(vid, {
            model: row.vehicle_model,
            company: org,
            department: dept,
            shift1: emptyAgg(),
            shift2: emptyAgg(),
          });
        }

        const agg = vMap.get(vid)!;
        const s = shift === 'shift1' ? agg.shift1 : agg.shift2;
        for (const c of activeCols) {
          const val = getShiftValue(row, c);
          if (val !== null && val !== undefined) {
            s[c].sum += val;
            s[c].count++;
          }
        }
      }

      // --- Build workbook ---
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'НПС Мониторинг — AI Reports';
      workbook.created = new Date();

      const ws = workbook.addWorksheet('КИП');

      // Column layout: №, Марка/гос.№, Объект, [shift1 cols...], [shift2 cols...]
      const fixedColCount = 3; // №, Марка, Объект
      const shiftColCount = activeCols.length;
      const totalCols = fixedColCount + shiftColCount * 2;

      // Set column widths
      ws.getColumn(1).width = 5;   // №
      ws.getColumn(2).width = 30;  // Марка/гос.№
      ws.getColumn(3).width = 22;  // Объект

      for (let s = 0; s < 2; s++) {
        for (let c = 0; c < shiftColCount; c++) {
          const colIdx = fixedColCount + s * shiftColCount + c + 1;
          ws.getColumn(colIdx).width = COL_DEFS[activeCols[c]].width;
        }
      }

      // --- Row 1-2: Title (merged) ---
      const titleText = `Отчёт по использованию парка техники ${formatDateRu(dateFrom)} - ${formatDateRu(dateTo)}`;
      ws.mergeCells(`A1:${colLetter(totalCols)}2`);
      const titleCell = ws.getRow(1).getCell(1);
      titleCell.value = titleText;
      titleCell.font = { bold: true, size: 14, color: { argb: COLORS.textWhite } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerDark } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getRow(1).height = 20;
      ws.getRow(2).height = 20;

      // --- Row 3: Level-1 headers ---
      const row3 = ws.getRow(3);
      row3.height = 24;

      // Fixed columns span rows 3-4
      ws.mergeCells('A3:A4');
      ws.mergeCells('B3:B4');
      ws.mergeCells('C3:C4');
      fillCell(row3.getCell(1), COLORS.headerStd, COLORS.textWhite, true, 10);
      row3.getCell(1).value = '№';
      fillCell(row3.getCell(2), COLORS.headerStd, COLORS.textWhite, true, 10);
      row3.getCell(2).value = 'Марка / гос.№';
      fillCell(row3.getCell(3), COLORS.headerStd, COLORS.textWhite, true, 10);
      row3.getCell(3).value = 'Подразделение';

      // Shift 1 header (merged)
      const s1Start = fixedColCount + 1;
      const s1End = fixedColCount + shiftColCount;
      ws.mergeCells(`${colLetter(s1Start)}3:${colLetter(s1End)}3`);
      fillCell(row3.getCell(s1Start), COLORS.headerMedium, COLORS.textWhite, true, 11);
      row3.getCell(s1Start).value = '1 смена';

      // Shift 2 header (merged)
      const s2Start = fixedColCount + shiftColCount + 1;
      const s2End = fixedColCount + shiftColCount * 2;
      ws.mergeCells(`${colLetter(s2Start)}3:${colLetter(s2End)}3`);
      fillCell(row3.getCell(s2Start), COLORS.headerStd, COLORS.textWhite, true, 11);
      row3.getCell(s2Start).value = '2 смена';

      // --- Row 4: Level-2 headers (column names within shifts) ---
      const row4 = ws.getRow(4);
      row4.height = 24;
      // Fill fixed cells (already merged above)
      fillCell(row4.getCell(1), COLORS.headerStd, COLORS.textWhite, true, 9);
      fillCell(row4.getCell(2), COLORS.headerStd, COLORS.textWhite, true, 9);
      fillCell(row4.getCell(3), COLORS.headerStd, COLORS.textWhite, true, 9);

      for (let s = 0; s < 2; s++) {
        const bgColor = s === 0 ? COLORS.headerMedium : COLORS.headerStd;
        for (let c = 0; c < shiftColCount; c++) {
          const colIdx = fixedColCount + s * shiftColCount + c + 1;
          const cell = row4.getCell(colIdx);
          cell.value = COL_DEFS[activeCols[c]].header;
          fillCell(cell, bgColor, COLORS.textWhite, true, 9);
        }
      }

      // Freeze at row 4
      ws.views = [{ state: 'frozen', ySplit: 4 }];

      // --- Data rows ---
      let currentRow = 5;
      let vehicleNum = 0;

      for (const [vType, orgMap] of grouped) {
        // Vehicle type group row
        const typeRow = ws.getRow(currentRow);
        typeRow.getCell(1).value = vType;
        ws.mergeCells(`A${currentRow}:${colLetter(totalCols)}${currentRow}`);
        fillRow(typeRow, COLORS.groupDark, COLORS.textWhite, true, 11);
        typeRow.height = 22;
        currentRow++;

        for (const [org, deptMap] of orgMap) {
          // Organization group row
          const orgRow = ws.getRow(currentRow);
          orgRow.getCell(1).value = org;
          ws.mergeCells(`A${currentRow}:${colLetter(totalCols)}${currentRow}`);
          fillRow(orgRow, COLORS.groupLight, COLORS.textDark, true, 10);
          orgRow.height = 20;
          currentRow++;

        for (const [dept, vMap] of deptMap) {
          // Department group row
          const deptRow = ws.getRow(currentRow);
          deptRow.getCell(1).value = `  ${dept}`;
          ws.mergeCells(`A${currentRow}:${colLetter(totalCols)}${currentRow}`);
          fillCell(deptRow.getCell(1), COLORS.bgAlt, COLORS.textDark, true, 9);
          deptRow.height = 18;
          currentRow++;

          for (const [vid, agg] of vMap) {
            vehicleNum++;
            const dataRow = ws.getRow(currentRow);
            dataRow.getCell(1).value = vehicleNum;
            dataRow.getCell(2).value = `${agg.model} ${vid}`;
            dataRow.getCell(3).value = agg.department;

            // Shift data
            for (let s = 0; s < 2; s++) {
              const shiftAgg = s === 0 ? agg.shift1 : agg.shift2;
              const hasData = activeCols.some((c) => shiftAgg[c].count > 0);

              if (!hasData && s === 1) {
                // No shift2 data — merge and show text
                const mergeStart = fixedColCount + shiftColCount + 1;
                const mergeEnd = fixedColCount + shiftColCount * 2;
                ws.mergeCells(`${colLetter(mergeStart)}${currentRow}:${colLetter(mergeEnd)}${currentRow}`);
                const cell = dataRow.getCell(mergeStart);
                cell.value = 'Работа в 1 смену';
                cell.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                continue;
              }

              for (let c = 0; c < shiftColCount; c++) {
                const colIdx = fixedColCount + s * shiftColCount + c + 1;
                const col = activeCols[c];
                const cell = dataRow.getCell(colIdx);
                const avg = shiftAgg[col].count > 0
                  ? shiftAgg[col].sum / shiftAgg[col].count
                  : null;

                if (avg !== null) {
                  const def = COL_DEFS[col];
                  if (def.format === FMT.timeHM) {
                    cell.value = hoursToTimeFraction(avg);
                    cell.numFmt = FMT.timeHM;
                  } else if (def.format === FMT.percent) {
                    cell.value = avg;
                    cell.numFmt = FMT.percent;
                  } else {
                    cell.value = avg;
                    cell.numFmt = def.format;
                  }
                }
              }
            }

            dataRow.alignment = { vertical: 'middle' };
            // Alternate row colors
            if (vehicleNum % 2 === 0) {
              dataRow.eachCell({ includeEmpty: true }, (cell) => {
                if (!cell.fill || !(cell.fill as ExcelJS.FillPattern).fgColor?.argb) {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bgAlt } };
                }
              });
            }
            currentRow++;
          }
        }
        } // end orgMap
      }

      // --- Borders ---
      applyBorders(ws, 1, currentRow - 1, 1, totalCols);

      // --- Print ---
      applyPrintSetup(ws, 'landscape');

      // --- Save ---
      const fileId = `KIP_${formatDateRu(dateFrom)}-${formatDateRu(dateTo)}_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(config.outputDir, `${fileId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);

      console.log('[generateKipReport] result:', { success: true, fileId, count: rows.length, vehicles: vehicleNum });
      return {
        success: true,
        fileId,
        downloadUrl: `/api/reports/files/${fileId}`,
        fileName: `${fileId}.xlsx`,
        count: rows.length,
        vehicles: vehicleNum,
        period: `${formatDateRu(dateFrom)} - ${formatDateRu(dateTo)}`,
      };
    } catch (err) {
      console.error('[generateKipReport] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
