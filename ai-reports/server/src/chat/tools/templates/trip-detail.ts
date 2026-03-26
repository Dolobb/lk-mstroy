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
  formatDateRu,
} from '../xlsx-helpers';

interface ShiftRecord {
  id: number;
  vehicle_id: number;
  reg_number: string;
  name_mo: string;
  report_date: string;
  shift_type: string;
  object_name: string;
  trips_count: number;
}

interface TripRow {
  shift_record_id: number;
  trip_number: number;
  loaded_at: string | null;
  unloaded_at: string | null;
  loading_zone: string | null;
  unloading_zone: string | null;
  duration_min: number | null;
  distance_km: number | null;
  travel_to_unload_min: number | null;
  return_to_load_min: number | null;
}

function timeStr(isoOrTs: string | null): string {
  if (!isoOrTs) return '';
  try {
    const d = new Date(isoOrTs);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return String(isoOrTs);
  }
}

function minToTimeFraction(min: number | null): number | null {
  if (min === null || min === undefined) return null;
  return min / 1440; // minutes → fraction of day for [h]:mm format
}

/**
 * Build one worksheet for a specific date+shift combination.
 */
function buildSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  dateLabel: string,
  shiftLabel: string,
  shiftRecords: ShiftRecord[],
  tripsBySr: Map<number, TripRow[]>,
) {
  const ws = workbook.addWorksheet(sheetName);
  const totalCols = 15;
  const widths = [5, 16, 8, 12, 10, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // --- Row 1: Date + Shift title ---
  ws.mergeCells(`A1:${colLetter(totalCols)}1`);
  const titleCell = ws.getRow(1).getCell(1);
  titleCell.value = `${dateLabel} ${shiftLabel}`;
  titleCell.font = { bold: true, size: 12, color: { argb: COLORS.textDark } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // --- Row 2: Level-1 headers ---
  const row2 = ws.getRow(2);
  row2.height = 22;

  const spanCols = [
    { col: 1, label: '№' },
    { col: 2, label: 'ГосНомер' },
    { col: 3, label: 'Рейсы' },
    { col: 4, label: 'Начало смены' },
    { col: 11, label: 'Конец смены' },
  ];
  for (const sc of spanCols) {
    ws.mergeCells(`${colLetter(sc.col)}2:${colLetter(sc.col)}3`);
    row2.getCell(sc.col).value = sc.label;
    fillCell(row2.getCell(sc.col), COLORS.headerStd, COLORS.textWhite, true, 9);
  }

  ws.mergeCells('E2:G2');
  row2.getCell(5).value = 'Погрузка';
  fillCell(row2.getCell(5), COLORS.headerMedium, COLORS.textWhite, true, 10);

  ws.mergeCells('H2:J2');
  row2.getCell(8).value = 'Выгрузка';
  fillCell(row2.getCell(8), COLORS.headerStd, COLORS.textWhite, true, 10);

  ws.mergeCells('L2:O2');
  row2.getCell(12).value = 'Средние показатели';
  fillCell(row2.getCell(12), COLORS.headerMedium, COLORS.textWhite, true, 10);

  // --- Row 3: Level-2 headers ---
  const row3 = ws.getRow(3);
  row3.height = 22;

  const subHeaders: { col: number; label: string; bg: string }[] = [
    { col: 5, label: 'Въезд', bg: COLORS.headerMedium },
    { col: 6, label: 'Выезд', bg: COLORS.headerMedium },
    { col: 7, label: 'Стоянка', bg: COLORS.headerMedium },
    { col: 8, label: 'Въезд', bg: COLORS.headerStd },
    { col: 9, label: 'Выезд', bg: COLORS.headerStd },
    { col: 10, label: 'Стоянка', bg: COLORS.headerStd },
    { col: 12, label: 'Путь П→В', bg: COLORS.headerMedium },
    { col: 13, label: 'Путь В→П', bg: COLORS.headerMedium },
    { col: 14, label: 'Стоянка погр.', bg: COLORS.headerMedium },
    { col: 15, label: 'Стоянка выгр.', bg: COLORS.headerMedium },
  ];
  for (const sh of subHeaders) {
    row3.getCell(sh.col).value = sh.label;
    fillCell(row3.getCell(sh.col), sh.bg, COLORS.textWhite, true, 9);
  }
  for (const sc of spanCols) {
    fillCell(row3.getCell(sc.col), COLORS.headerStd, COLORS.textWhite, true, 9);
  }

  ws.views = [{ state: 'frozen', ySplit: 3 }];

  // --- Data rows ---
  let currentRow = 4;
  let vehicleIdx = 0;
  let sheetTrips = 0;

  for (const sr of shiftRecords) {
    vehicleIdx++;
    const srTrips = tripsBySr.get(sr.id) || [];
    const tripCount = srTrips.length || sr.trips_count || 0;
    const rowSpan = Math.max(tripCount, 1);
    sheetTrips += srTrips.length;

    const startRow = currentRow;
    const endRow = startRow + rowSpan - 1;

    // Vertical merge for: №, Рейсы, Начало смены, Конец смены, Средние
    const mergeCols = [1, 3, 4, 11, 12, 13, 14, 15];
    for (const mc of mergeCols) {
      if (rowSpan > 1) {
        ws.mergeCells(`${colLetter(mc)}${startRow}:${colLetter(mc)}${endRow}`);
      }
    }

    const firstRow = ws.getRow(startRow);
    firstRow.getCell(1).value = vehicleIdx;
    firstRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    firstRow.getCell(3).value = tripCount;
    firstRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };

    if (srTrips.length > 0) {
      const firstTrip = srTrips[0];
      const lastTrip = srTrips[srTrips.length - 1];
      firstRow.getCell(4).value = timeStr(firstTrip.loaded_at);
      firstRow.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      firstRow.getCell(11).value = timeStr(lastTrip.unloaded_at);
      firstRow.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };

      const avgTravelToUnload = srTrips.reduce((s, t) => s + (t.travel_to_unload_min || 0), 0) / srTrips.length;
      const avgReturnToLoad = srTrips.reduce((s, t) => s + (t.return_to_load_min || 0), 0) / srTrips.length;

      firstRow.getCell(12).value = minToTimeFraction(avgTravelToUnload);
      firstRow.getCell(12).numFmt = FMT.timeHM;
      firstRow.getCell(12).alignment = { horizontal: 'center', vertical: 'middle' };
      firstRow.getCell(13).value = minToTimeFraction(avgReturnToLoad);
      firstRow.getCell(13).numFmt = FMT.timeHM;
      firstRow.getCell(13).alignment = { horizontal: 'center', vertical: 'middle' };
      firstRow.getCell(14).value = '';
      firstRow.getCell(15).value = '';
    }

    // Trip detail rows
    for (let t = 0; t < rowSpan; t++) {
      const tripRow = ws.getRow(startRow + t);
      tripRow.getCell(2).value = sr.reg_number;
      tripRow.getCell(2).alignment = { vertical: 'middle' };

      if (t < srTrips.length) {
        const trip = srTrips[t];
        tripRow.getCell(5).value = timeStr(trip.loaded_at);
        tripRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
        tripRow.getCell(6).value = trip.loading_zone || '';
        tripRow.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
        tripRow.getCell(7).value = trip.duration_min !== null ? `${Math.round(trip.duration_min)} мин` : '';
        tripRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };

        tripRow.getCell(8).value = timeStr(trip.unloaded_at);
        tripRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
        tripRow.getCell(9).value = trip.unloading_zone || '';
        tripRow.getCell(9).alignment = { horizontal: 'center', vertical: 'middle' };
        tripRow.getCell(10).value = '';
        tripRow.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
      }

      if (vehicleIdx % 2 === 0) {
        tripRow.eachCell({ includeEmpty: true }, (cell) => {
          if (!cell.fill || !(cell.fill as ExcelJS.FillPattern).fgColor?.argb) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bgAlt } };
          }
        });
      }
    }

    currentRow = endRow + 1;

    // Average row (СРЕД) for this vehicle
    const avgRow = ws.getRow(currentRow);
    avgRow.getCell(1).value = '';
    avgRow.getCell(2).value = 'СРЕД';
    fillRow(avgRow, COLORS.groupLight, COLORS.textDark, true, 9);

    if (srTrips.length > 0) {
      const avgDuration = srTrips.reduce((s, t) => s + (t.duration_min || 0), 0) / srTrips.length;
      avgRow.getCell(7).value = `${Math.round(avgDuration)} мин`;
      avgRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };
    }

    avgRow.height = 18;
    currentRow++;
  }

  applyBorders(ws, 1, currentRow - 1, 1, totalCols);
  applyPrintSetup(ws, 'landscape');

  return sheetTrips;
}

export const generateTripDetail = tool({
  description:
    'Сгенерировать детальный отчёт по рейсам самосвалов. Поддерживает диапазон дат — каждая дата+смена на отдельном листе. ' +
    'Вертикальный merge по ТС, 2-level headers (Погрузка / Выгрузка / Средние). ' +
    'Используй когда просят: "детальный отчёт по рейсам", "рейсы самосвалов", "погрузка-выгрузка".',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    dateTo: z.string().describe('Конец периода, формат YYYY-MM-DD'),
    shiftType: z.enum(['shift1', 'shift2', 'both']).optional().default('both')
      .describe('Тип смены: shift1, shift2 или both (по умолчанию both)'),
    objectName: z.string().optional().describe('Фильтр по объекту'),
    regNumbers: z.array(z.string()).optional().describe('Фильтр по госномерам'),
  }),
  execute: async ({ dateFrom, dateTo, shiftType, objectName, regNumbers }) => {
    console.log('[generateTripDetail]', { dateFrom, dateTo, shiftType, objectName, regNumbers });
    try {
      const pool = getPg17();

      // Build date list
      const dates: string[] = [];
      const cur = new Date(dateFrom);
      const end = new Date(dateTo);
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }

      const shifts = shiftType === 'both' ? ['shift1', 'shift2'] : [shiftType];

      // --- Get ALL shift records for the whole range in one query ---
      const srConditions: string[] = ['sr.report_date >= $1', 'sr.report_date <= $2'];
      const srParams: unknown[] = [dateFrom, dateTo];
      let idx = 3;

      if (shiftType !== 'both') {
        srConditions.push(`sr.shift_type = $${idx}`);
        srParams.push(shiftType);
        idx++;
      }
      if (objectName) {
        srConditions.push(`sr.object_name ILIKE $${idx}`);
        srParams.push(`%${objectName}%`);
        idx++;
      }
      if (regNumbers?.length) {
        srConditions.push(`sr.reg_number = ANY($${idx})`);
        srParams.push(regNumbers);
        idx++;
      }

      const { rows: allShiftRecords } = await pool.query<ShiftRecord>(
        `SELECT sr.id, sr.vehicle_id, sr.reg_number, sr.name_mo,
                sr.report_date, sr.shift_type, sr.object_name, sr.trips_count
         FROM dump_trucks.shift_records sr
         WHERE ${srConditions.join(' AND ')}
         ORDER BY sr.report_date, sr.shift_type, sr.reg_number`,
        srParams,
      );

      if (allShiftRecords.length === 0) {
        return { success: true, message: 'Нет данных за указанный период', count: 0 };
      }

      const allSrIds = allShiftRecords.map((sr) => sr.id);

      // --- Get ALL trips at once ---
      const { rows: allTrips } = await pool.query<TripRow>(
        `SELECT shift_record_id, trip_number, loaded_at, unloaded_at,
                loading_zone, unloading_zone, duration_min, distance_km,
                travel_to_unload_min, return_to_load_min
         FROM dump_trucks.trips
         WHERE shift_record_id = ANY($1)
         ORDER BY shift_record_id, trip_number`,
        [allSrIds],
      );

      // Group trips by shift_record_id
      const tripsBySr = new Map<number, TripRow[]>();
      for (const t of allTrips) {
        if (!tripsBySr.has(t.shift_record_id)) tripsBySr.set(t.shift_record_id, []);
        tripsBySr.get(t.shift_record_id)!.push(t);
      }

      // Group shift records by date+shift
      const srByDateShift = new Map<string, ShiftRecord[]>();
      for (const sr of allShiftRecords) {
        const key = `${sr.report_date}_${sr.shift_type}`;
        if (!srByDateShift.has(key)) srByDateShift.set(key, []);
        srByDateShift.get(key)!.push(sr);
      }

      // --- Build workbook with one sheet per date+shift ---
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'НПС Мониторинг — AI Reports';
      workbook.created = new Date();

      let totalTrips = 0;
      let totalSheets = 0;

      for (const date of dates) {
        for (const shift of shifts) {
          const key = `${date}_${shift}`;
          const shiftRecords = srByDateShift.get(key);
          if (!shiftRecords || shiftRecords.length === 0) continue;

          totalSheets++;
          const shiftLabel = shift === 'shift1' ? 'Смена 1' : 'Смена 2';
          const dateLabel = formatDateRu(date);
          const sheetName = `${dateLabel} ${shiftLabel}`.slice(0, 31);

          totalTrips += buildSheet(workbook, sheetName, dateLabel, shiftLabel, shiftRecords, tripsBySr);
        }
      }

      if (totalSheets === 0) {
        return { success: true, message: 'Нет данных с рейсами за указанный период', count: 0 };
      }

      // --- Save ---
      const periodLabel = dateFrom === dateTo
        ? formatDateRu(dateFrom)
        : `${formatDateRu(dateFrom)}-${formatDateRu(dateTo)}`;
      const fileId = `DT_Trips_${periodLabel}_${crypto.randomBytes(4).toString('hex')}`;
      const filePath = path.join(config.outputDir, `${fileId}.xlsx`);
      await workbook.xlsx.writeFile(filePath);

      console.log('[generateTripDetail] result:', { success: true, fileId, trips: totalTrips, sheets: totalSheets });
      return {
        success: true,
        fileId,
        downloadUrl: `/api/reports/files/${fileId}`,
        fileName: `${fileId}.xlsx`,
        count: totalTrips,
        vehicles: allShiftRecords.length,
        sheets: totalSheets,
        period: periodLabel,
      };
    } catch (err) {
      console.error('[generateTripDetail] error:', err);
      return { success: false, error: String(err) };
    }
  },
});
