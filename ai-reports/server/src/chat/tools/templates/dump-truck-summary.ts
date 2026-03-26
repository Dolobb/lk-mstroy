import { tool } from 'ai';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../../config';
import { getPg17 } from '../../../db/pg17';
import {
  COLORS,
  FMT,
  applyPrintSetup,
  fillRow,
  fillCell,
  applyBorders,
  colLetter,
  secToHHMM,
  formatDateRu,
} from '../xlsx-helpers';

interface ShiftRow {
  id: number;
  vehicle_id: number;
  reg_number: string;
  name_mo: string;
  report_date: string;
  shift_type: string;
  object_name: string;
  kip_pct: number | null;
  movement_pct: number | null;
  engine_time_sec: number | null;
  moving_time_sec: number | null;
  distance_km: number | null;
  onsite_min: number | null;
  trips_count: number | null;
  work_type: string | null;
  avg_loading_dwell_sec: number | null;
  avg_unloading_dwell_sec: number | null;
}

function secToTimeFraction(sec: number | null): number | null {
  if (sec === null || sec === undefined) return null;
  return sec / 86400; // seconds → fraction of day for Excel [h]:mm
}

/** Extract carrier (перевозчик) from name_mo: "Volvo FM 6x4 (ООО Перевозчик)" → "ООО Перевозчик" */
function extractCarrier(nameMo: string): string {
  const match = nameMo.match(/\(([^)]+)\)/);
  return match ? match[1] : 'Без перевозчика';
}

export const generateDumpTruckSummary = tool({
  description:
    'Сгенерировать сводный отчёт по самосвалам: Таблица A — по времени (двигатель, движение, простой, выработка), ' +
    'Таблица B — по рейсам (кол-во рейсов, стоянки, пути). ' +
    'Группировка: перевозчик → ТС → даты. Печать A4 landscape. ' +
    'Используй когда просят: "отчёт самосвалы", "сводка по самосвалам", "выработка самосвалов".',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    objectName: z.string().optional().describe('Фильтр по объекту'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
    includeTripTable: z.boolean().optional().default(true).describe('Включить таблицу рейсов (по умолчанию да)'),
  }),
  execute: async ({ dateFrom, dateTo, objectName, regNumbers, includeTripTable }) => {
    console.log('[generateDumpTruckSummary]', { dateFrom, dateTo, objectName, regNumbers, includeTripTable });
    try {
      const pool = getPg17();

      const conditions: string[] = ['sr.report_date >= $1', 'sr.report_date <= $2'];
      const params: unknown[] = [dateFrom, dateTo];
      let idx = 3;

      if (objectName) {
        conditions.push(`sr.object_name ILIKE $${idx}`);
        params.push(`%${objectName}%`);
        idx++;
      }
      if (regNumbers?.length) {
        conditions.push(`sr.reg_number = ANY($${idx})`);
        params.push(regNumbers);
        idx++;
      }

      const { rows } = await pool.query<ShiftRow>(
        `SELECT
           sr.id, sr.vehicle_id, sr.reg_number, sr.name_mo,
           sr.report_date, sr.shift_type, sr.object_name,
           sr.kip_pct, sr.movement_pct,
           sr.engine_time_sec, sr.moving_time_sec,
           sr.distance_km, sr.onsite_min,
           sr.trips_count, sr.work_type,
           COALESCE(avg_load.avg_loading_sec, 0) AS avg_loading_dwell_sec,
           COALESCE(avg_unload.avg_unloading_sec, 0) AS avg_unloading_dwell_sec
         FROM dump_trucks.shift_records sr
         LEFT JOIN LATERAL (
           SELECT AVG(ze.duration_sec) AS avg_loading_sec
           FROM dump_trucks.zone_events ze
           WHERE ze.vehicle_id = sr.vehicle_id
             AND ze.report_date = sr.report_date
             AND ze.shift_type = sr.shift_type
             AND ze.object_uid = sr.object_uid
             AND ze.zone_tag = 'dt_loading'
         ) avg_load ON true
         LEFT JOIN LATERAL (
           SELECT AVG(ze.duration_sec) AS avg_unloading_sec
           FROM dump_trucks.zone_events ze
           WHERE ze.vehicle_id = sr.vehicle_id
             AND ze.report_date = sr.report_date
             AND ze.shift_type = sr.shift_type
             AND ze.object_uid = sr.object_uid
             AND ze.zone_tag = 'dt_unloading'
         ) avg_unload ON true
         WHERE ${conditions.join(' AND ')}
         ORDER BY sr.reg_number, sr.report_date, sr.shift_type`,
        params,
      );

      if (rows.length === 0) {
        return { success: true, message: 'Нет данных за указанный период', count: 0 };
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'НПС Мониторинг — AI Reports';
      workbook.created = new Date();

      // ================================================================
      // TABLE A: По времени
      // ================================================================
      const wsTime = workbook.addWorksheet('По времени');
      const timeColCount = 7;

      // Widths
      wsTime.getColumn(1).width = 5;
      wsTime.getColumn(2).width = 30;
      wsTime.getColumn(3).width = 14;
      wsTime.getColumn(4).width = 14;
      wsTime.getColumn(5).width = 14;
      wsTime.getColumn(6).width = 14;
      wsTime.getColumn(7).width = 14;

      // Title
      wsTime.mergeCells(`A1:${colLetter(timeColCount)}1`);
      const titleCell = wsTime.getRow(1).getCell(1);
      titleCell.value = `Самосвалы — по времени: ${formatDateRu(dateFrom)} - ${formatDateRu(dateTo)}`;
      titleCell.font = { bold: true, size: 14, color: { argb: COLORS.textWhite } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerDark } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      wsTime.getRow(1).height = 32;

      // Headers
      const timeHeaders = ['№', 'Марка / гос.№', 'Вр. двигателя', 'Вр. движения', 'Простой', 'Выр.% двиг.', 'Выр.% движ.'];
      const hRow = wsTime.getRow(2);
      timeHeaders.forEach((h, i) => {
        hRow.getCell(i + 1).value = h;
        fillCell(hRow.getCell(i + 1), COLORS.headerStd, COLORS.textWhite, true, 10);
      });
      hRow.height = 24;
      wsTime.views = [{ state: 'frozen', ySplit: 2 }];

      // Group by carrier → vehicle → dates
      const carrierMap = new Map<string, Map<string, ShiftRow[]>>();
      for (const row of rows) {
        const carrier = extractCarrier(row.name_mo);
        if (!carrierMap.has(carrier)) carrierMap.set(carrier, new Map());
        const vMap = carrierMap.get(carrier)!;
        const key = row.reg_number;
        if (!vMap.has(key)) vMap.set(key, []);
        vMap.get(key)!.push(row);
      }

      let currentRow = 3;
      let num = 0;

      for (const [carrier, vMap] of carrierMap) {
        // Carrier group
        const cRow = wsTime.getRow(currentRow);
        cRow.getCell(1).value = carrier;
        wsTime.mergeCells(`A${currentRow}:${colLetter(timeColCount)}${currentRow}`);
        fillRow(cRow, COLORS.groupDark, COLORS.textWhite, true, 11);
        cRow.height = 22;
        currentRow++;

        for (const [regNum, vRows] of vMap) {
          // Vehicle sub-header with averages
          const avgEngine = vRows.reduce((s, r) => s + (r.engine_time_sec || 0), 0) / vRows.length;
          const avgMoving = vRows.reduce((s, r) => s + (r.moving_time_sec || 0), 0) / vRows.length;
          const avgIdle = avgEngine - avgMoving;
          const avgKip = vRows.reduce((s, r) => s + (r.kip_pct || 0), 0) / vRows.length;
          const avgMov = vRows.reduce((s, r) => s + (r.movement_pct || 0), 0) / vRows.length;

          const subRow = wsTime.getRow(currentRow);
          subRow.getCell(1).value = '';
          subRow.getCell(2).value = `${vRows[0].name_mo} (${regNum})`;
          subRow.getCell(3).value = secToTimeFraction(avgEngine);
          subRow.getCell(3).numFmt = FMT.timeHM;
          subRow.getCell(4).value = secToTimeFraction(avgMoving);
          subRow.getCell(4).numFmt = FMT.timeHM;
          subRow.getCell(5).value = secToTimeFraction(Math.max(0, avgIdle));
          subRow.getCell(5).numFmt = FMT.timeHM;
          subRow.getCell(6).value = avgKip;
          subRow.getCell(6).numFmt = FMT.percent;
          subRow.getCell(7).value = avgMov;
          subRow.getCell(7).numFmt = FMT.percent;
          fillRow(subRow, COLORS.groupLight, COLORS.textDark, true, 10);
          subRow.height = 20;
          currentRow++;

          // Date rows
          for (const r of vRows) {
            num++;
            const dRow = wsTime.getRow(currentRow);
            const idle = (r.engine_time_sec || 0) - (r.moving_time_sec || 0);
            dRow.getCell(1).value = num;
            dRow.getCell(2).value = `${formatDateRu(r.report_date)} ${r.shift_type === 'shift1' ? 'см.1' : 'см.2'}`;
            dRow.getCell(3).value = secToTimeFraction(r.engine_time_sec);
            dRow.getCell(3).numFmt = FMT.timeHM;
            dRow.getCell(4).value = secToTimeFraction(r.moving_time_sec);
            dRow.getCell(4).numFmt = FMT.timeHM;
            dRow.getCell(5).value = secToTimeFraction(Math.max(0, idle));
            dRow.getCell(5).numFmt = FMT.timeHM;
            dRow.getCell(6).value = r.kip_pct;
            dRow.getCell(6).numFmt = FMT.percent;
            dRow.getCell(7).value = r.movement_pct;
            dRow.getCell(7).numFmt = FMT.percent;

            if (num % 2 === 0) {
              dRow.eachCell({ includeEmpty: true }, (cell) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bgAlt } };
              });
            }
            currentRow++;
          }
        }
      }

      applyBorders(wsTime, 1, currentRow - 1, 1, timeColCount);
      applyPrintSetup(wsTime, 'landscape');

      // ================================================================
      // TABLE B: По рейсам
      // ================================================================
      if (includeTripTable !== false) {
        const wsTrips = workbook.addWorksheet('По рейсам');
        const tripColCount = 7;

        wsTrips.getColumn(1).width = 5;
        wsTrips.getColumn(2).width = 30;
        wsTrips.getColumn(3).width = 14;
        wsTrips.getColumn(4).width = 16;
        wsTrips.getColumn(5).width = 16;
        wsTrips.getColumn(6).width = 16;
        wsTrips.getColumn(7).width = 16;

        // Title
        wsTrips.mergeCells(`A1:${colLetter(tripColCount)}1`);
        const tTitle = wsTrips.getRow(1).getCell(1);
        tTitle.value = `Самосвалы — по рейсам: ${formatDateRu(dateFrom)} - ${formatDateRu(dateTo)}`;
        tTitle.font = { bold: true, size: 14, color: { argb: COLORS.textWhite } };
        tTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerDark } };
        tTitle.alignment = { horizontal: 'center', vertical: 'middle' };
        wsTrips.getRow(1).height = 32;

        // Headers
        const tripHeaders = ['№', 'Марка / гос.№', 'Рейсов', 'Ср. стоянка погр.', 'Ср. стоянка выгр.', 'Ср. путь П→В', 'Ср. путь В→П'];
        const thRow = wsTrips.getRow(2);
        tripHeaders.forEach((h, i) => {
          thRow.getCell(i + 1).value = h;
          fillCell(thRow.getCell(i + 1), COLORS.headerStd, COLORS.textWhite, true, 10);
        });
        thRow.height = 24;
        wsTrips.views = [{ state: 'frozen', ySplit: 2 }];

        // Group by object → vehicle → dates
        const objMap = new Map<string, Map<string, ShiftRow[]>>();
        for (const row of rows) {
          const obj = row.object_name || 'Без объекта';
          if (!objMap.has(obj)) objMap.set(obj, new Map());
          const vm = objMap.get(obj)!;
          if (!vm.has(row.reg_number)) vm.set(row.reg_number, []);
          vm.get(row.reg_number)!.push(row);
        }

        let tRow = 3;
        let tNum = 0;

        for (const [obj, vMap] of objMap) {
          // Object group
          const oRow = wsTrips.getRow(tRow);
          oRow.getCell(1).value = obj;
          wsTrips.mergeCells(`A${tRow}:${colLetter(tripColCount)}${tRow}`);
          fillRow(oRow, COLORS.groupDark, COLORS.textWhite, true, 11);
          oRow.height = 22;
          tRow++;

          for (const [regNum, vRows] of vMap) {
            // Vehicle subtotal
            const totalTrips = vRows.reduce((s, r) => s + (r.trips_count || 0), 0);
            const avgLoadDwell = vRows.reduce((s, r) => s + (r.avg_loading_dwell_sec || 0), 0) / vRows.length;
            const avgUnloadDwell = vRows.reduce((s, r) => s + (r.avg_unloading_dwell_sec || 0), 0) / vRows.length;

            const sRow = wsTrips.getRow(tRow);
            sRow.getCell(1).value = '';
            sRow.getCell(2).value = `${vRows[0].name_mo} (${regNum})`;
            sRow.getCell(3).value = totalTrips;
            sRow.getCell(4).value = secToTimeFraction(avgLoadDwell);
            sRow.getCell(4).numFmt = FMT.timeHM;
            sRow.getCell(5).value = secToTimeFraction(avgUnloadDwell);
            sRow.getCell(5).numFmt = FMT.timeHM;
            sRow.getCell(6).value = '';
            sRow.getCell(7).value = '';
            fillRow(sRow, COLORS.groupLight, COLORS.textDark, true, 10);
            sRow.height = 20;
            tRow++;

            // Date rows
            for (const r of vRows) {
              tNum++;
              const dRow = wsTrips.getRow(tRow);
              dRow.getCell(1).value = tNum;
              dRow.getCell(2).value = `${formatDateRu(r.report_date)} ${r.shift_type === 'shift1' ? 'см.1' : 'см.2'}`;
              dRow.getCell(3).value = r.trips_count || 0;
              dRow.getCell(4).value = secToTimeFraction(r.avg_loading_dwell_sec);
              dRow.getCell(4).numFmt = FMT.timeHM;
              dRow.getCell(5).value = secToTimeFraction(r.avg_unloading_dwell_sec);
              dRow.getCell(5).numFmt = FMT.timeHM;
              dRow.getCell(6).value = '';
              dRow.getCell(7).value = '';

              if (tNum % 2 === 0) {
                dRow.eachCell({ includeEmpty: true }, (cell) => {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bgAlt } };
                });
              }
              tRow++;
            }
          }
        }

        applyBorders(wsTrips, 1, tRow - 1, 1, tripColCount);
        applyPrintSetup(wsTrips, 'landscape');
      }

      // --- Save ---
      const fileId = `DT_Summary_${formatDateRu(dateFrom)}-${formatDateRu(dateTo)}_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(config.outputDir, `${fileId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);

      console.log('[generateDumpTruckSummary] result:', { success: true, fileId, count: rows.length });
      return {
        success: true,
        fileId,
        downloadUrl: `/api/reports/files/${fileId}`,
        fileName: `${fileId}.xlsx`,
        count: rows.length,
        period: `${formatDateRu(dateFrom)} - ${formatDateRu(dateTo)}`,
      };
    } catch (err) {
      console.error('[generateDumpTruckSummary] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
