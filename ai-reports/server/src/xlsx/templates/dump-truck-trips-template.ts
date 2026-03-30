import ExcelJS from 'exceljs';
import type { DateShiftGroup } from '../../reports/queries/dump-trucks';
import {
  allThinBorders, headerFill, headerFont, centerAlign,
  DT_HEADER_BLUE, DT_DATE_GRAY,
} from '../styles';

// Which aggregate columns are included
const AGGREGATE_IDS = ['avg_loading_dwell', 'avg_unloading_dwell', 'avg_travel_load_unload', 'avg_travel_unload_load', 'comment'];

export async function buildDtTripsXlsx(
  data: DateShiftGroup[],
  columns: string[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Рейсы');

  // Determine which aggregate columns are selected
  const selectedAggregates = AGGREGATE_IDS.filter(id => columns.includes(id));

  // Column layout:
  // A=№, B=ГосНомер, C=Кол-во рейсов, D=Начало смены
  // E=Погрузка Въезд, F=Погрузка Выезд, G=Погрузка Стоянка
  // H=Выгрузка Въезд, I=Выгрузка Выезд, J=Выгрузка Стоянка
  // K=Конец смены
  // Then optional aggregates: L+
  const fixedCols = 11; // A-K
  const totalCols = fixedCols + selectedAggregates.length;

  // Column widths
  const widths = [6, 16, 11, 9, 9, 9, 9, 9, 9, 9, 9];
  for (const _ of selectedAggregates) widths.push(11);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  let rowIdx = 1;

  // Track merges to apply after writing all data
  const merges: [number, number, number, number][] = [];

  for (const group of data) {
    // ─── Date+Shift header row ────────────────────────────────────
    const dateLabel = formatDateShort(group.date);
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const dateCell = ws.getCell(rowIdx, 1);
    dateCell.value = `${dateLabel} — ${group.shiftLabel}`;
    dateCell.font = { name: 'Calibri', bold: true, size: 12 };
    dateCell.fill = headerFill(DT_DATE_GRAY);
    dateCell.font = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FF000000' } };
    dateCell.alignment = centerAlign;
    rowIdx++;

    // ─── Header row 1 (level 1) ─────────────────────────────────
    const h1Row = rowIdx;
    const hStyle = {
      font: headerFont('Calibri', 11),
      fill: headerFill(DT_HEADER_BLUE),
      alignment: centerAlign,
      border: allThinBorders,
    };

    // A: №, B: ГосНомер, C: Кол-во рейсов, D: Начало смены (merge with row below)
    const fixedHeaders = ['№', 'ГосНомер', 'Кол-во рейс.', 'Начало смены'];
    for (let i = 0; i < 4; i++) {
      ws.mergeCells(h1Row, i + 1, h1Row + 1, i + 1);
      const cell = ws.getCell(h1Row, i + 1);
      cell.value = fixedHeaders[i];
      Object.assign(cell, hStyle);
    }

    // E-G: "Погрузка" merged
    ws.mergeCells(h1Row, 5, h1Row, 7);
    const loadCell = ws.getCell(h1Row, 5);
    loadCell.value = 'Погрузка';
    Object.assign(loadCell, hStyle);

    // H-J: "Выгрузка" merged
    ws.mergeCells(h1Row, 8, h1Row, 10);
    const unloadCell = ws.getCell(h1Row, 8);
    unloadCell.value = 'Выгрузка';
    Object.assign(unloadCell, hStyle);

    // K: Конец смены (merge with row below)
    ws.mergeCells(h1Row, 11, h1Row + 1, 11);
    const endCell = ws.getCell(h1Row, 11);
    endCell.value = 'Конец смены';
    Object.assign(endCell, hStyle);

    // Aggregate headers (merge with row below)
    const aggLabels: Record<string, string> = {
      avg_loading_dwell: 'Ср. стоянка П',
      avg_unloading_dwell: 'Ср. стоянка В',
      avg_travel_load_unload: 'Ср. путь П→В',
      avg_travel_unload_load: 'Ср. путь В→П',
      comment: 'Комментарий',
    };
    for (let i = 0; i < selectedAggregates.length; i++) {
      const col = fixedCols + i + 1;
      ws.mergeCells(h1Row, col, h1Row + 1, col);
      const cell = ws.getCell(h1Row, col);
      cell.value = aggLabels[selectedAggregates[i]] || selectedAggregates[i];
      Object.assign(cell, hStyle);
    }

    rowIdx++;

    // ─── Header row 2 (sub-headers for Погрузка/Выгрузка) ───────
    const subHeaders = ['Въезд', 'Выезд', 'Стоянка'];
    for (let i = 0; i < 3; i++) {
      const loadSub = ws.getCell(rowIdx, 5 + i);
      loadSub.value = subHeaders[i];
      Object.assign(loadSub, hStyle);

      const unloadSub = ws.getCell(rowIdx, 8 + i);
      unloadSub.value = subHeaders[i];
      Object.assign(unloadSub, hStyle);
    }
    rowIdx++;

    // ─── Data rows per vehicle ──────────────────────────────────
    let vehicleNum = 0;

    for (const vehicle of group.vehicles) {
      vehicleNum++;
      const tripCount = vehicle.trips.length;
      const startRow = rowIdx;

      for (let ti = 0; ti < tripCount; ti++) {
        const trip = vehicle.trips[ti];
        const r = rowIdx;

        // Per-trip columns (E-J): always written
        ws.getCell(r, 5).value = trip.loading_enter;
        ws.getCell(r, 6).value = trip.loading_exit;
        ws.getCell(r, 7).value = trip.loading_dwell;
        ws.getCell(r, 8).value = trip.unloading_enter;
        ws.getCell(r, 9).value = trip.unloading_exit;
        ws.getCell(r, 10).value = trip.unloading_dwell;

        // Write reg_number on every row (not merged per template spec)
        ws.getCell(r, 2).value = vehicle.reg_number;

        // Style all cells in this row
        for (let c = 1; c <= totalCols; c++) {
          const cell = ws.getCell(r, c);
          cell.font = { name: 'Calibri', size: 11 };
          cell.alignment = centerAlign;
          cell.border = allThinBorders;
        }

        rowIdx++;
      }

      const endRow = rowIdx - 1;

      // Write vehicle-level data on first row
      ws.getCell(startRow, 1).value = vehicleNum;         // №
      ws.getCell(startRow, 3).value = vehicle.trips_count; // Кол-во рейсов
      ws.getCell(startRow, 4).value = vehicle.shift_start; // Начало смены
      ws.getCell(startRow, 11).value = vehicle.shift_end;  // Конец смены

      // Aggregate values on first row
      const aggValues: Record<string, string | number> = {
        avg_loading_dwell: vehicle.avg_loading_dwell > 0 ? formatMinutes(vehicle.avg_loading_dwell) : '',
        avg_unloading_dwell: vehicle.avg_unloading_dwell > 0 ? formatMinutes(vehicle.avg_unloading_dwell) : '',
        avg_travel_load_unload: vehicle.avg_travel_load_unload > 0 ? formatMinutes(vehicle.avg_travel_load_unload) : '',
        avg_travel_unload_load: vehicle.avg_travel_unload_load > 0 ? formatMinutes(vehicle.avg_travel_unload_load) : '',
        comment: '',
      };
      for (let i = 0; i < selectedAggregates.length; i++) {
        const col = fixedCols + i + 1;
        ws.getCell(startRow, col).value = aggValues[selectedAggregates[i]] ?? '';
      }

      // Vertical merges for vehicle block (only if >1 trip)
      if (tripCount > 1) {
        // Columns that get merged: A(1), C(3), D(4), K(11) + aggregate columns
        const mergeCols = [1, 3, 4, 11];
        for (let i = 0; i < selectedAggregates.length; i++) {
          mergeCols.push(fixedCols + i + 1);
        }
        for (const col of mergeCols) {
          merges.push([startRow, col, endRow, col]);
        }
      }
    }
  }

  // Apply all merges
  for (const [r1, c1, r2, c2] of merges) {
    try {
      ws.mergeCells(r1, c1, r2, c2);
    } catch {
      // Skip merge conflicts
    }
  }

  // Freeze below first data section headers (row 4 of first section)
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 0 }];

  return wb;
}

function formatDateShort(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}`;
}

function formatMinutes(minutes: number): string {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
