import ExcelJS from 'exceljs';
import type { DateShiftGroup, VehicleGroup, TripDetail } from '../../reports/queries/dump-trucks';
import {
  mediumBorder, doubleBorder, dottedBorder, thinBorder,
  headerFill, centerAlign,
  DT_HEADER_BLUE, DT_DATE_BLUE,
  DT_DATE_FONT, DT_HEADER_FONT, DT_DATA_FONT, DT_DWELL_FONT,
  DT_DATE_ROW_HEIGHT, DT_ROW_HEIGHT, DT_ZONE_FONT,
  dtEnterAlign, dtDwellAlign, dtExitAlign,
} from '../styles';

const DT_INCOMPLETE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 14, color: { argb: 'FF808080' } };
const DT_INCOMPLETE_DWELL_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 13, color: { argb: 'FF808080' } };

const DT_OBJECT_FILL = 'FFE2EFDA';

// Aggregate column IDs
const AGGREGATE_IDS = ['avg_loading_dwell', 'avg_unloading_dwell', 'avg_travel_load_unload', 'avg_travel_unload_load', 'comment'];
const ZONE_IDS = ['loading_zone', 'unloading_zone'];

// ─── Dynamic column layout ──────────────────────────────────────────────────

interface ColLayout {
  // Fixed positions
  numCol: number;       // №
  regCol: number;       // Гос. номер
  tripsCol: number;     // Кол-во рейсов
  shiftStartCol: number; // Начало смены (0 if excluded)

  // Погрузка block
  loadEnterCol: number;  // 0 if excluded
  loadDwellCol: number;
  loadExitCol: number;
  loadStartCol: number;  // first col of block
  loadEndCol: number;    // last col of block

  // Гружёный
  loadedTravelCol: number; // 0 if excluded

  // Выгрузка block
  unloadEnterCol: number;
  unloadDwellCol: number;
  unloadExitCol: number;
  unloadStartCol: number;
  unloadEndCol: number;

  // Порожний
  emptyTravelCol: number; // 0 if excluded

  shiftEndCol: number;   // 0 if excluded

  // Zone columns
  zoneCols: { id: string; col: number }[];

  // Aggregate columns
  aggCols: { id: string; col: number }[];

  totalCols: number;

  // Width map: col → width
  widths: Map<number, number>;
}

function buildLayout(columns: string[]): ColLayout {
  const has = (id: string) => columns.includes(id);
  let col = 1;

  const numCol = col++;
  const regCol = col++;
  const tripsCol = col++;
  const shiftStartCol = has('shift_start') ? col++ : 0;

  // Погрузка block
  const loadStartCol = col;
  const loadEnterCol = has('loading_enter') ? col++ : 0;
  const loadDwellCol = has('loading_dwell') ? col++ : 0;
  const loadExitCol = has('loading_exit') ? col++ : 0;
  const loadEndCol = col - 1;

  // Гружёный
  const loadedTravelCol = has('loaded_travel') ? col++ : 0;

  // Выгрузка block
  const unloadStartCol = col;
  const unloadEnterCol = has('unloading_enter') ? col++ : 0;
  const unloadDwellCol = has('unloading_dwell') ? col++ : 0;
  const unloadExitCol = has('unloading_exit') ? col++ : 0;
  const unloadEndCol = col - 1;

  // Порожний
  const emptyTravelCol = has('empty_travel') ? col++ : 0;

  const shiftEndCol = has('shift_end') ? col++ : 0;

  // Zone columns
  const zoneCols: { id: string; col: number }[] = [];
  for (const id of ZONE_IDS) {
    if (has(id)) { zoneCols.push({ id, col: col++ }); }
  }

  // Aggregate columns
  const aggCols: { id: string; col: number }[] = [];
  for (const id of AGGREGATE_IDS) {
    if (has(id)) { aggCols.push({ id, col: col++ }); }
  }

  const totalCols = col - 1;

  // Build widths
  const widths = new Map<number, number>();
  widths.set(numCol, 6.14);
  widths.set(regCol, 23.71);
  widths.set(tripsCol, 12.29);
  if (shiftStartCol) widths.set(shiftStartCol, 12.29);
  if (loadEnterCol) widths.set(loadEnterCol, 9.71);
  if (loadDwellCol) widths.set(loadDwellCol, 10.71);
  if (loadExitCol) widths.set(loadExitCol, 10.43);
  if (loadedTravelCol) widths.set(loadedTravelCol, 10);
  if (unloadEnterCol) widths.set(unloadEnterCol, 12.29);
  if (unloadDwellCol) widths.set(unloadDwellCol, 10.71);
  if (unloadExitCol) widths.set(unloadExitCol, 12.29);
  if (emptyTravelCol) widths.set(emptyTravelCol, 10);
  if (shiftEndCol) widths.set(shiftEndCol, 12.29);
  for (const z of zoneCols) widths.set(z.col, 18); // will be auto-resized
  for (const a of aggCols) widths.set(a.col, 12.29);

  return {
    numCol, regCol, tripsCol, shiftStartCol,
    loadEnterCol, loadDwellCol, loadExitCol, loadStartCol, loadEndCol,
    loadedTravelCol,
    unloadEnterCol, unloadDwellCol, unloadExitCol, unloadStartCol, unloadEndCol,
    emptyTravelCol,
    shiftEndCol,
    zoneCols, aggCols, totalCols, widths,
  };
}

// ─── Main build function ────────────────────────────────────────────────────

export async function buildDtTripsXlsx(
  data: DateShiftGroup[],
  columns: string[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Рейсы');
  const L = buildLayout(columns);

  // Set column widths
  for (const [col, w] of L.widths) {
    ws.getColumn(col).width = w;
  }

  let rowIdx = 1;
  const merges: [number, number, number, number][] = [];

  for (const group of data) {
    // ─── Date+Shift header row ──────────────────────────────────
    const dateLabel = formatDateShort(group.date);
    ws.mergeCells(rowIdx, 1, rowIdx, L.totalCols);
    const dateCell = ws.getCell(rowIdx, 1);
    dateCell.value = `${dateLabel} — ${group.shiftLabel}`;
    dateCell.font = DT_DATE_FONT;
    dateCell.fill = headerFill(DT_DATE_BLUE);
    dateCell.alignment = centerAlign;
    for (let c = 1; c <= L.totalCols; c++) {
      ws.getCell(rowIdx, c).border = {
        top: mediumBorder, bottom: mediumBorder,
        left: c === 1 ? mediumBorder : undefined,
        right: c === L.totalCols ? mediumBorder : undefined,
      };
    }
    ws.getRow(rowIdx).height = DT_DATE_ROW_HEIGHT;
    rowIdx++;

    // ─── Column headers ─────────────────────────────────────────
    const h1Row = rowIdx;
    const hStyle = { font: DT_HEADER_FONT, fill: headerFill(DT_HEADER_BLUE), alignment: centerAlign };

    // Helper: set header with 2-row merge
    const setHeader2Row = (col: number, label: string) => {
      if (!col) return;
      ws.mergeCells(h1Row, col, h1Row + 1, col);
      Object.assign(ws.getCell(h1Row, col), hStyle);
      ws.getCell(h1Row, col).value = label;
    };

    setHeader2Row(L.numCol, '№');
    setHeader2Row(L.regCol, 'Гос. номер');
    setHeader2Row(L.tripsCol, 'Кол-во рейсов');
    setHeader2Row(L.shiftStartCol, 'Начало смены');
    setHeader2Row(L.loadedTravelCol, 'Гружёный');
    setHeader2Row(L.emptyTravelCol, 'Порожний');
    setHeader2Row(L.shiftEndCol, 'Конец смены');

    // Погрузка merged header (if any loading cols exist)
    const loadCols = [L.loadEnterCol, L.loadDwellCol, L.loadExitCol].filter(c => c > 0);
    if (loadCols.length > 0) {
      if (loadCols.length > 1) ws.mergeCells(h1Row, loadCols[0], h1Row, loadCols[loadCols.length - 1]);
      Object.assign(ws.getCell(h1Row, loadCols[0]), hStyle);
      ws.getCell(h1Row, loadCols[0]).value = 'Погрузка';
    }

    // Выгрузка merged header
    const unloadCols = [L.unloadEnterCol, L.unloadDwellCol, L.unloadExitCol].filter(c => c > 0);
    if (unloadCols.length > 0) {
      if (unloadCols.length > 1) ws.mergeCells(h1Row, unloadCols[0], h1Row, unloadCols[unloadCols.length - 1]);
      Object.assign(ws.getCell(h1Row, unloadCols[0]), hStyle);
      ws.getCell(h1Row, unloadCols[0]).value = 'Выгрузка';
    }

    // Zone + aggregate headers
    const zoneLabels: Record<string, string> = { loading_zone: 'Зона погрузки', unloading_zone: 'Зона выгрузки' };
    for (const z of L.zoneCols) setHeader2Row(z.col, zoneLabels[z.id] || z.id);

    const aggLabels: Record<string, string> = {
      avg_loading_dwell: 'Средняя стоянка П', avg_unloading_dwell: 'Средняя стоянка В',
      avg_travel_load_unload: 'Ср. путь П→В', avg_travel_unload_load: 'Ср. путь В→П', comment: 'Комментарий',
    };
    for (const a of L.aggCols) setHeader2Row(a.col, aggLabels[a.id] || a.id);

    applyHeaderBorders(ws, h1Row, L);
    ws.getRow(h1Row).height = DT_ROW_HEIGHT;
    ws.getRow(h1Row).outlineLevel = 1;
    rowIdx++;

    // Sub-headers row
    const subMap = [
      { col: L.loadEnterCol, label: 'Въезд' },
      { col: L.loadDwellCol, label: 'Стоянка' },
      { col: L.loadExitCol, label: 'Выезд' },
      { col: L.unloadEnterCol, label: 'Въезд' },
      { col: L.unloadDwellCol, label: 'Стоянка' },
      { col: L.unloadExitCol, label: 'Выезд' },
    ];
    for (const { col, label } of subMap) {
      if (!col) continue;
      Object.assign(ws.getCell(rowIdx, col), hStyle);
      ws.getCell(rowIdx, col).value = label;
    }
    applyHeaderBorders(ws, rowIdx, L);
    ws.getRow(rowIdx).height = DT_ROW_HEIGHT;
    ws.getRow(rowIdx).outlineLevel = 1;
    rowIdx++;

    // ─── Data rows ──────────────────────────────────────────────
    const allVehicles: { vehicle: VehicleGroup; objectName: string }[] = [];
    const multipleObjects = group.objects.length > 1;
    for (const obj of group.objects) {
      for (const v of obj.vehicles) allVehicles.push({ vehicle: v, objectName: obj.object_name });
    }

    let vehicleNum = 0;
    let currentObject = '';

    for (let vi = 0; vi < allVehicles.length; vi++) {
      const { vehicle, objectName } = allVehicles[vi];
      const isFirstVehicle = vi === 0;
      const isLastVehicle = vi === allVehicles.length - 1;

      // Object sub-header
      if (multipleObjects && objectName !== currentObject) {
        currentObject = objectName;
        ws.mergeCells(rowIdx, 1, rowIdx, L.totalCols);
        const objCell = ws.getCell(rowIdx, 1);
        objCell.value = objectName;
        objCell.font = { name: 'Calibri', size: 14, bold: true };
        objCell.fill = headerFill(DT_OBJECT_FILL);
        objCell.alignment = centerAlign;
        for (let c = 1; c <= L.totalCols; c++) {
          ws.getCell(rowIdx, c).border = {
            top: mediumBorder, bottom: thinBorder,
            left: c === 1 ? mediumBorder : undefined,
            right: c === L.totalCols ? mediumBorder : undefined,
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

        // Write per-trip values
        writeTripData(ws, r, L, trip, vehicle, isIncomplete);

        // Reg number on every row
        ws.getCell(r, L.regCol).value = vehicle.reg_number;

        // Borders
        applyDataRowBorders(ws, r, L, {
          isFirstTrip, isLastTrip, isFirstVehicle: isFirstVehicle && ti === 0,
          isLastVehicle: isLastVehicle && isLastTrip,
        });

        ws.getRow(r).height = DT_ROW_HEIGHT;
        ws.getRow(r).outlineLevel = multipleObjects
          ? (isFirstTrip ? 2 : 3)
          : (isFirstTrip ? 1 : 2);
        rowIdx++;
      }

      const endRow = rowIdx - 1;

      // Vehicle-level data on first row
      ws.getCell(startRow, L.numCol).value = vehicleNum;
      ws.getCell(startRow, L.tripsCol).value = vehicle.trips_count;
      if (L.shiftStartCol) ws.getCell(startRow, L.shiftStartCol).value = vehicle.shift_start;
      if (L.shiftEndCol) ws.getCell(startRow, L.shiftEndCol).value = vehicle.shift_end;

      // Aggregate values
      const aggMap: Record<string, string | number> = {
        avg_loading_dwell: vehicle.avg_loading_dwell > 0 ? formatMinutes(vehicle.avg_loading_dwell) : '',
        avg_unloading_dwell: vehicle.avg_unloading_dwell > 0 ? formatMinutes(vehicle.avg_unloading_dwell) : '',
        avg_travel_load_unload: vehicle.avg_travel_load_unload > 0 ? formatMinutes(vehicle.avg_travel_load_unload) : '',
        avg_travel_unload_load: vehicle.avg_travel_unload_load > 0 ? formatMinutes(vehicle.avg_travel_unload_load) : '',
        comment: '',
      };
      for (const a of L.aggCols) {
        ws.getCell(startRow, a.col).value = aggMap[a.id] ?? '';
      }

      // Vertical merges
      if (tripCount > 1) {
        const mergeCols = [L.numCol, L.tripsCol, L.shiftStartCol, L.shiftEndCol, ...L.aggCols.map(a => a.col)].filter(c => c > 0);
        for (const col of mergeCols) merges.push([startRow, col, endRow, col]);
      }
    }
  }

  // Apply merges
  for (const [r1, c1, r2, c2] of merges) {
    try { ws.mergeCells(r1, c1, r2, c2); } catch { /* skip */ }
  }

  // Auto-size zone columns
  for (const z of L.zoneCols) {
    let maxLen = 10;
    for (let r = 1; r <= rowIdx; r++) {
      const val = ws.getCell(r, z.col).value;
      if (val) maxLen = Math.max(maxLen, String(val).length);
    }
    ws.getColumn(z.col).width = Math.min(maxLen * 1.2 + 2, 40);
  }

  const maxOutline = data.some(g => g.objects.length > 1) ? 3 : 2;
  ws.properties.outlineLevelRow = maxOutline;
  ws.properties.outlineProperties = { summaryBelow: false };

  return wb;
}

// ─── Write trip data into row ───────────────────────────────────────────────

function writeTripData(
  ws: ExcelJS.Worksheet, r: number, L: ColLayout,
  trip: TripDetail, vehicle: VehicleGroup, isIncomplete: boolean,
) {
  // Fonts for trip columns (E-J area): gray if incomplete
  const tripFont = isIncomplete ? DT_INCOMPLETE_FONT : DT_DATA_FONT;
  const tripDwellFont = isIncomplete ? DT_INCOMPLETE_DWELL_FONT : DT_DWELL_FONT;

  // Trip data
  const tripCells: { col: number; val: string; font: Partial<ExcelJS.Font>; align: Partial<ExcelJS.Alignment> }[] = [
    { col: L.loadEnterCol, val: trip.loading_enter, font: tripFont, align: dtEnterAlign },
    { col: L.loadDwellCol, val: trip.loading_dwell, font: tripDwellFont, align: dtDwellAlign },
    { col: L.loadExitCol, val: trip.loading_exit, font: tripFont, align: dtExitAlign },
    { col: L.loadedTravelCol, val: trip.loaded_travel, font: DT_DATA_FONT, align: centerAlign },
    { col: L.unloadEnterCol, val: trip.unloading_enter, font: tripFont, align: dtEnterAlign },
    { col: L.unloadDwellCol, val: trip.unloading_dwell, font: tripDwellFont, align: dtDwellAlign },
    { col: L.unloadExitCol, val: trip.unloading_exit, font: tripFont, align: dtExitAlign },
    { col: L.emptyTravelCol, val: trip.empty_travel, font: DT_DATA_FONT, align: centerAlign },
  ];

  for (const { col, val, font, align } of tripCells) {
    if (!col) continue;
    const cell = ws.getCell(r, col);
    cell.value = val;
    cell.font = font;
    cell.alignment = align;
  }

  // Non-trip columns: always normal font
  const fixedCells = [L.numCol, L.regCol, L.tripsCol, L.shiftStartCol, L.shiftEndCol];
  for (const col of fixedCells) {
    if (!col) continue;
    ws.getCell(r, col).font = DT_DATA_FONT;
    ws.getCell(r, col).alignment = centerAlign;
  }

  // Zone columns: smaller font
  const zoneMap: Record<string, string> = { loading_zone: trip.loading_zone_name, unloading_zone: trip.unloading_zone_name };
  for (const z of L.zoneCols) {
    const cell = ws.getCell(r, z.col);
    cell.value = zoneMap[z.id] || '';
    cell.font = DT_ZONE_FONT;
    cell.alignment = centerAlign;
  }

  // Aggregate columns: normal font
  for (const a of L.aggCols) {
    ws.getCell(r, a.col).font = DT_DATA_FONT;
    ws.getCell(r, a.col).alignment = centerAlign;
  }
}

// ─── Border helpers ─────────────────────────────────────────────────────────

function applyHeaderBorders(ws: ExcelJS.Worksheet, row: number, L: ColLayout) {
  for (let c = 1; c <= L.totalCols; c++) {
    ws.getCell(row, c).border = {
      top: mediumBorder, bottom: thinBorder,
      left: (c === 1 || c === L.loadStartCol || c === L.unloadStartCol || c === L.shiftEndCol) ? mediumBorder : thinBorder,
      right: (c === L.regCol || c === L.loadEndCol || c === L.unloadEndCol || c === L.totalCols) ? mediumBorder : thinBorder,
    };
  }
}

interface DataRowBorderOpts {
  isFirstTrip: boolean;
  isLastTrip: boolean;
  isFirstVehicle: boolean;
  isLastVehicle: boolean;
}

function applyDataRowBorders(ws: ExcelJS.Worksheet, row: number, L: ColLayout, opts: DataRowBorderOpts) {
  for (let c = 1; c <= L.totalCols; c++) {
    let top: Partial<ExcelJS.Border> = thinBorder;
    let bottom: Partial<ExcelJS.Border> = thinBorder;
    let left: Partial<ExcelJS.Border> = thinBorder;
    let right: Partial<ExcelJS.Border> = thinBorder;

    // Outer edges: medium
    if (c === 1) left = mediumBorder;
    if (c === L.totalCols) right = mediumBorder;

    // After Гос. номер: medium
    if (c === L.regCol) right = mediumBorder;

    // Погрузка block boundaries
    if (c === L.loadStartCol && L.loadEnterCol) left = mediumBorder;
    if (c === L.loadEndCol && L.loadExitCol) right = mediumBorder;

    // Выгрузка block boundaries
    if (c === L.unloadStartCol && L.unloadEnterCol) left = mediumBorder;
    if (c === L.unloadEndCol && L.unloadExitCol) right = mediumBorder;

    // Shift end left: medium
    if (c === L.shiftEndCol) left = mediumBorder;

    // Dotted inside Погрузка
    if (L.loadEnterCol && c === L.loadEnterCol && L.loadDwellCol) right = dottedBorder;
    if (L.loadDwellCol && c === L.loadDwellCol) {
      if (L.loadEnterCol) left = dottedBorder;
      if (L.loadExitCol) right = dottedBorder;
    }

    // Thin inside Выгрузка
    if (L.unloadEnterCol && c === L.unloadEnterCol && L.unloadDwellCol) right = thinBorder;
    if (L.unloadDwellCol && c === L.unloadDwellCol) {
      left = thinBorder;
      right = thinBorder;
    }

    // Double between vehicles
    if (opts.isFirstTrip && !opts.isFirstVehicle) top = doubleBorder;
    if (opts.isLastTrip && !opts.isLastVehicle) bottom = doubleBorder;

    // Last vehicle: medium bottom on shift_end+
    if (opts.isLastTrip && opts.isLastVehicle) {
      if (L.shiftEndCol && c >= L.shiftEndCol) bottom = mediumBorder;
    }

    ws.getCell(row, c).border = { top, bottom, left, right };
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDateShort(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}`;
}

/** Format minutes as h:mm (for aggregates) */
function formatMinutes(minutes: number): string {
  const totalMin = Math.round(minutes);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
