import ExcelJS from 'exceljs';
import type { DateShiftGroup, VehicleGroup } from '../../reports/queries/dump-trucks';
import {
  mediumBorder, doubleBorder, dottedBorder, thinBorder,
  headerFill, centerAlign,
  DT_HEADER_BLUE, DT_DATE_BLUE,
  DT_DATE_FONT, DT_HEADER_FONT, DT_DATA_FONT, DT_DWELL_FONT, DT_DWELL_ITALIC_FONT,
  DT_DATE_ROW_HEIGHT, DT_ROW_HEIGHT,
  dtEnterAlign, dtDwellAlign, dtExitAlign,
} from '../styles';

// Aggregate column IDs (after fixed + zone columns)
const AGGREGATE_IDS = ['avg_loading_dwell', 'avg_unloading_dwell', 'avg_travel_load_unload', 'avg_travel_unload_load', 'comment'];
// Zone column IDs
const ZONE_IDS = ['loading_zone', 'unloading_zone'];

// Object sub-header style
const DT_OBJECT_FILL = 'FFE2EFDA'; // light green
const DT_INCOMPLETE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 14, color: { argb: 'FF808080' } };

export async function buildDtTripsXlsx(
  data: DateShiftGroup[],
  columns: string[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Рейсы');

  const selectedZones = ZONE_IDS.filter(id => columns.includes(id));
  const selectedAggregates = AGGREGATE_IDS.filter(id => columns.includes(id));

  // Column layout:
  // A=№, B=Гос. номер, C=Кол-во рейсов, D=Начало смены
  // E=Въезд(П), F=Стоянка(П), G=Выезд(П)
  // H=Въезд(В), I=Стоянка(В), J=Выезд(В)
  // K=Конец смены
  // Then zone columns, then aggregates
  const fixedCols = 11; // A-K
  const zoneStartCol = fixedCols + 1; // L+
  const aggStartCol = zoneStartCol + selectedZones.length;
  const totalCols = fixedCols + selectedZones.length + selectedAggregates.length;

  // Column widths
  const widths = [6.14, 23.71, 12.29, 12.29, 9.71, 10.71, 10.43, 12.29, 10.71, 12.29, 12.29];
  for (const _ of selectedZones) widths.push(18);
  for (const _ of selectedAggregates) widths.push(12.29);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  let rowIdx = 1;
  const merges: [number, number, number, number][] = [];

  for (const group of data) {
    // ─── Date+Shift header row ────────────────────────────────────
    const dateLabel = formatDateShort(group.date);
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const dateCell = ws.getCell(rowIdx, 1);
    dateCell.value = `${dateLabel} — ${group.shiftLabel}`;
    dateCell.font = DT_DATE_FONT;
    dateCell.fill = headerFill(DT_DATE_BLUE);
    dateCell.alignment = centerAlign;
    for (let c = 1; c <= totalCols; c++) {
      ws.getCell(rowIdx, c).border = {
        top: mediumBorder,
        bottom: mediumBorder,
        left: c === 1 ? mediumBorder : undefined,
        right: c === totalCols ? mediumBorder : undefined,
      };
    }
    ws.getRow(rowIdx).height = DT_DATE_ROW_HEIGHT;
    rowIdx++;

    // ─── Column headers (row 1) ───────────────────────────────────
    const h1Row = rowIdx;
    const hStyle = {
      font: DT_HEADER_FONT,
      fill: headerFill(DT_HEADER_BLUE),
      alignment: centerAlign,
    };

    // A-D: merge with row below
    const fixedHeaders = ['№', 'Гос. номер', 'Кол-во рейсов', 'Начало смены'];
    for (let i = 0; i < 4; i++) {
      ws.mergeCells(h1Row, i + 1, h1Row + 1, i + 1);
      const cell = ws.getCell(h1Row, i + 1);
      cell.value = fixedHeaders[i];
      Object.assign(cell, hStyle);
    }

    // E-G: "Погрузка"
    ws.mergeCells(h1Row, 5, h1Row, 7);
    Object.assign(ws.getCell(h1Row, 5), hStyle);
    ws.getCell(h1Row, 5).value = 'Погрузка';

    // H-J: "Выгрузка"
    ws.mergeCells(h1Row, 8, h1Row, 10);
    Object.assign(ws.getCell(h1Row, 8), hStyle);
    ws.getCell(h1Row, 8).value = 'Выгрузка';

    // K: "Конец смены" merge with row below
    ws.mergeCells(h1Row, 11, h1Row + 1, 11);
    Object.assign(ws.getCell(h1Row, 11), hStyle);
    ws.getCell(h1Row, 11).value = 'Конец смены';

    // Zone headers (merge with row below)
    const zoneLabels: Record<string, string> = {
      loading_zone: 'Зона погрузки',
      unloading_zone: 'Зона выгрузки',
    };
    for (let i = 0; i < selectedZones.length; i++) {
      const col = zoneStartCol + i;
      ws.mergeCells(h1Row, col, h1Row + 1, col);
      const cell = ws.getCell(h1Row, col);
      cell.value = zoneLabels[selectedZones[i]] || selectedZones[i];
      Object.assign(cell, hStyle);
    }

    // Aggregate headers (merge with row below)
    const aggLabels: Record<string, string> = {
      avg_loading_dwell: 'Средняя стоянка П',
      avg_unloading_dwell: 'Средняя стоянка В',
      avg_travel_load_unload: 'Ср. путь П→В',
      avg_travel_unload_load: 'Ср. путь В→П',
      comment: 'Комментарий',
    };
    for (let i = 0; i < selectedAggregates.length; i++) {
      const col = aggStartCol + i;
      ws.mergeCells(h1Row, col, h1Row + 1, col);
      const cell = ws.getCell(h1Row, col);
      cell.value = aggLabels[selectedAggregates[i]] || selectedAggregates[i];
      Object.assign(cell, hStyle);
    }

    applyHeaderBorders(ws, h1Row, totalCols);
    ws.getRow(h1Row).height = DT_ROW_HEIGHT;
    ws.getRow(h1Row).outlineLevel = 1;
    rowIdx++;

    // ─── Column headers (row 2): sub-headers ──────────────────────
    const subHeaders = ['Въезд', 'Стоянка', 'Выезд'];
    for (let i = 0; i < 3; i++) {
      Object.assign(ws.getCell(rowIdx, 5 + i), hStyle);
      ws.getCell(rowIdx, 5 + i).value = subHeaders[i];
      Object.assign(ws.getCell(rowIdx, 8 + i), hStyle);
      ws.getCell(rowIdx, 8 + i).value = subHeaders[i];
    }
    applyHeaderBorders(ws, rowIdx, totalCols);
    ws.getRow(rowIdx).height = DT_ROW_HEIGHT;
    ws.getRow(rowIdx).outlineLevel = 1;
    rowIdx++;

    // ─── Flatten all vehicles across objects for numbering ────────
    const allVehicles: { vehicle: VehicleGroup; objectName: string }[] = [];
    const multipleObjects = group.objects.length > 1;
    for (const obj of group.objects) {
      for (const v of obj.vehicles) {
        allVehicles.push({ vehicle: v, objectName: obj.object_name });
      }
    }

    let vehicleNum = 0;
    let currentObject = '';

    for (let vi = 0; vi < allVehicles.length; vi++) {
      const { vehicle, objectName } = allVehicles[vi];
      const isFirstVehicle = vi === 0;
      const isLastVehicle = vi === allVehicles.length - 1;

      // ─── Object sub-header (if multiple objects) ──────────────
      if (multipleObjects && objectName !== currentObject) {
        currentObject = objectName;
        ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
        const objCell = ws.getCell(rowIdx, 1);
        objCell.value = objectName;
        objCell.font = { name: 'Calibri', size: 14, bold: true };
        objCell.fill = headerFill(DT_OBJECT_FILL);
        objCell.alignment = centerAlign;
        for (let c = 1; c <= totalCols; c++) {
          ws.getCell(rowIdx, c).border = {
            top: mediumBorder,
            bottom: thinBorder,
            left: c === 1 ? mediumBorder : undefined,
            right: c === totalCols ? mediumBorder : undefined,
          };
        }
        ws.getRow(rowIdx).height = DT_ROW_HEIGHT;
        ws.getRow(rowIdx).outlineLevel = 1;
        rowIdx++;
      }

      vehicleNum++;
      const tripCount = vehicle.trips.length;
      const startRow = rowIdx;

      for (let ti = 0; ti < tripCount; ti++) {
        const trip = vehicle.trips[ti];
        const r = rowIdx;
        const isFirstTrip = ti === 0;
        const isLastTrip = ti === tripCount - 1;
        const isIncomplete = trip.status !== 'complete';

        // Per-trip data: Въезд → Стоянка → Выезд
        ws.getCell(r, 5).value = trip.loading_enter;
        ws.getCell(r, 6).value = trip.loading_dwell;
        ws.getCell(r, 7).value = trip.loading_exit;
        ws.getCell(r, 8).value = trip.unloading_enter;
        ws.getCell(r, 9).value = trip.unloading_dwell;
        ws.getCell(r, 10).value = trip.unloading_exit;

        // Reg number on every row
        ws.getCell(r, 2).value = vehicle.reg_number;

        // Zone columns (per-trip)
        for (let zi = 0; zi < selectedZones.length; zi++) {
          const col = zoneStartCol + zi;
          const val = selectedZones[zi] === 'loading_zone'
            ? trip.loading_zone_name
            : trip.unloading_zone_name;
          ws.getCell(r, col).value = val;
        }

        // ─── Fonts ───────────────────────────────────────────────
        const dataFont = isIncomplete ? DT_INCOMPLETE_FONT : DT_DATA_FONT;
        const dwellFont = isIncomplete ? DT_INCOMPLETE_FONT : DT_DWELL_FONT;
        const dwellItalicFont = isIncomplete ? DT_INCOMPLETE_FONT : DT_DWELL_ITALIC_FONT;

        for (const c of [1, 2, 3, 4, 11]) ws.getCell(r, c).font = dataFont;
        ws.getCell(r, 5).font = dataFont;      // Въезд П
        ws.getCell(r, 6).font = dwellFont;     // Стоянка П (13pt)
        ws.getCell(r, 7).font = dataFont;      // Выезд П
        ws.getCell(r, 8).font = dataFont;      // Въезд В
        ws.getCell(r, 9).font = dwellItalicFont; // Стоянка В (13pt italic)
        ws.getCell(r, 10).font = dataFont;     // Выезд В
        // Zone + aggregate columns
        for (let c = fixedCols + 1; c <= totalCols; c++) {
          ws.getCell(r, c).font = dataFont;
        }

        // ─── Alignment ──────────────────────────────────────────
        for (let c = 1; c <= totalCols; c++) {
          const cell = ws.getCell(r, c);
          if (c === 5 || c === 8) cell.alignment = dtEnterAlign;
          else if (c === 6 || c === 9) cell.alignment = dtDwellAlign;
          else if (c === 7 || c === 10) cell.alignment = dtExitAlign;
          else cell.alignment = centerAlign;
        }

        // ─── Borders ────────────────────────────────────────────
        applyDataRowBorders(ws, r, totalCols, {
          isFirstTrip,
          isLastTrip,
          isFirstVehicle: isFirstVehicle && ti === 0,
          isLastVehicle: isLastVehicle && isLastTrip,
        });

        ws.getRow(r).height = DT_ROW_HEIGHT;
        ws.getRow(r).outlineLevel = isFirstTrip ? 1 : 2;

        rowIdx++;
      }

      const endRow = rowIdx - 1;

      // Vehicle-level data on first row
      ws.getCell(startRow, 1).value = vehicleNum;
      ws.getCell(startRow, 3).value = vehicle.trips_count;
      ws.getCell(startRow, 4).value = vehicle.shift_start;
      ws.getCell(startRow, 11).value = vehicle.shift_end;

      // Aggregate values on first row
      const aggValues: Record<string, string | number> = {
        avg_loading_dwell: vehicle.avg_loading_dwell > 0 ? formatMinutes(vehicle.avg_loading_dwell) : '',
        avg_unloading_dwell: vehicle.avg_unloading_dwell > 0 ? formatMinutes(vehicle.avg_unloading_dwell) : '',
        avg_travel_load_unload: vehicle.avg_travel_load_unload > 0 ? formatMinutes(vehicle.avg_travel_load_unload) : '',
        avg_travel_unload_load: vehicle.avg_travel_unload_load > 0 ? formatMinutes(vehicle.avg_travel_unload_load) : '',
        comment: '',
      };
      for (let i = 0; i < selectedAggregates.length; i++) {
        const col = aggStartCol + i;
        ws.getCell(startRow, col).value = aggValues[selectedAggregates[i]] ?? '';
      }

      // Vertical merges (only if >1 trip)
      if (tripCount > 1) {
        const mergeCols = [1, 3, 4, 11];
        for (let i = 0; i < selectedAggregates.length; i++) {
          mergeCols.push(aggStartCol + i);
        }
        for (const col of mergeCols) {
          merges.push([startRow, col, endRow, col]);
        }
      }
    }
  }

  // Apply all merges
  for (const [r1, c1, r2, c2] of merges) {
    try { ws.mergeCells(r1, c1, r2, c2); } catch { /* skip conflicts */ }
  }

  // Outline: summary rows above details
  ws.properties.outlineLevelRow = 2;
  ws.properties.outlineProperties = { summaryBelow: false };

  return wb;
}

// ─── Border helpers ─────────────────────────────────────────────────────────

function applyHeaderBorders(ws: ExcelJS.Worksheet, row: number, totalCols: number) {
  for (let c = 1; c <= totalCols; c++) {
    const cell = ws.getCell(row, c);
    cell.border = {
      top: mediumBorder,
      bottom: thinBorder,
      left: (c === 1 || c === 5 || c === 11) ? mediumBorder : thinBorder,
      right: (c === 2 || c === 7 || c === 10 || c === totalCols) ? mediumBorder : thinBorder,
    };
  }
}

interface DataRowBorderOpts {
  isFirstTrip: boolean;
  isLastTrip: boolean;
  isFirstVehicle: boolean;
  isLastVehicle: boolean;
}

function applyDataRowBorders(
  ws: ExcelJS.Worksheet,
  row: number,
  totalCols: number,
  opts: DataRowBorderOpts,
) {
  for (let c = 1; c <= totalCols; c++) {
    const cell = ws.getCell(row, c);

    let top: Partial<ExcelJS.Border> = thinBorder;
    let bottom: Partial<ExcelJS.Border> = thinBorder;
    let left: Partial<ExcelJS.Border> = thinBorder;
    let right: Partial<ExcelJS.Border> = thinBorder;

    // Outer left/right: medium
    if (c === 1) left = mediumBorder;
    if (c === totalCols) right = mediumBorder;

    // B right: medium
    if (c === 2) right = mediumBorder;

    // Погрузка (E-G): medium left E, medium right G
    if (c === 5) left = mediumBorder;
    if (c === 7) right = mediumBorder;

    // Выгрузка (H-J): medium right J
    if (c === 10) right = mediumBorder;

    // K left: medium
    if (c === 11) left = mediumBorder;

    // Dotted inside Погрузка
    if (c === 5) right = dottedBorder;
    if (c === 6) { left = dottedBorder; right = dottedBorder; }

    // Thin inside Выгрузка
    if (c === 8) right = thinBorder;
    if (c === 9) { left = thinBorder; right = thinBorder; }

    // Double between vehicles
    if (opts.isFirstTrip && !opts.isFirstVehicle) top = doubleBorder;
    if (opts.isLastTrip && !opts.isLastVehicle) bottom = doubleBorder;

    // Last vehicle: medium bottom on K+ columns
    if (opts.isLastTrip && opts.isLastVehicle && c >= 11) {
      bottom = mediumBorder;
    }

    cell.border = { top, bottom, left, right };
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDateShort(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}`;
}

function formatMinutes(minutes: number): string {
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
