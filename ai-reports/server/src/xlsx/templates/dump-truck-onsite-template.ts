import ExcelJS from 'exceljs';
import type { OnsiteDateShiftGroup, OnsiteVehicle, OnsiteSegment } from '../../reports/queries/dump-trucks-onsite';
import {
  mediumBorder, thinBorder, headerFill, centerAlign,
  DT_HEADER_BLUE, DT_DATE_BLUE,
  DT_DATE_FONT, DT_HEADER_FONT, DT_DATA_FONT,
  DT_DATE_ROW_HEIGHT, DT_ROW_HEIGHT,
} from '../styles';

// ─── Constants ──────────────────────────────────────────────────────────────

const SEGMENT_COUNT = 24;        // 30-min windows over a 12h shift
const CHART_HEIGHT = 10;         // chart rows; each row = 10% utilization band
const CHART_ROW_HEIGHT = 9;      // px height per chart row (compact bars)

const COLOR_MOVING = 'FF60A5FA';   // blue — movement
const COLOR_STATIONARY = 'FFA78BFA'; // purple — engine on, on-site
const COLOR_GRID = 'FFE7E9EE';     // faint chart background grid
const DT_OBJECT_FILL = 'FFE2EFDA';

const GRID_BORDER: Partial<ExcelJS.Border> = { style: 'hair', color: { argb: COLOR_GRID } };
const DT_AXIS_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 9, color: { argb: 'FF808080' } };

// Toggleable meta columns (besides № and Гос. номер which are fixed)
const META_COLUMNS: { id: string; label: string; width: number }[] = [
  { id: 'engine_hours',  label: 'Время двиг.',  width: 11 },
  { id: 'fuel_consumed', label: 'Расход, л',    width: 10 },
  { id: 'kip_pct',       label: 'КИП, %',       width: 8 },
  { id: 'movement_pct',  label: 'Движение, %',  width: 10 },
  { id: 'onsite_time',   label: 'На объекте',   width: 11 },
  { id: 'distance_km',   label: 'Пробег, км',   width: 10 },
  { id: 'shift_start',   label: 'Начало',       width: 9 },
  { id: 'shift_end',     label: 'Конец',        width: 9 },
];

// ─── Layout ─────────────────────────────────────────────────────────────────

interface OnsiteLayout {
  numCol: number;
  regCol: number;
  metaCols: { id: string; label: string; col: number }[];
  hasChart: boolean;
  yAxisCol: number;     // 0 if no chart
  chartStartCol: number; // first segment column (0 if no chart)
  chartEndCol: number;
  totalCols: number;
  widths: Map<number, number>;
}

function buildLayout(columns: string[]): OnsiteLayout {
  const has = (id: string) => columns.includes(id);
  const widths = new Map<number, number>();
  let col = 1;

  const numCol = col++;
  const regCol = col++;
  widths.set(numCol, 5);
  widths.set(regCol, 22);

  const metaCols: { id: string; label: string; col: number }[] = [];
  for (const m of META_COLUMNS) {
    if (has(m.id)) {
      metaCols.push({ id: m.id, label: m.label, col });
      widths.set(col, m.width);
      col++;
    }
  }

  const hasChart = columns.includes('activity_chart');
  let yAxisCol = 0, chartStartCol = 0, chartEndCol = 0;
  if (hasChart) {
    yAxisCol = col++;
    widths.set(yAxisCol, 5);
    chartStartCol = col;
    for (let i = 0; i < SEGMENT_COUNT; i++) { widths.set(col, 2.6); col++; }
    chartEndCol = col - 1;
  }

  return { numCol, regCol, metaCols, hasChart, yAxisCol, chartStartCol, chartEndCol, totalCols: col - 1, widths };
}

// ─── Main build ───────────────────────────────────────────────────────────

export async function buildDtOnsiteXlsx(
  data: OnsiteDateShiftGroup[],
  columns: string[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('По месту');
  const L = buildLayout(columns);

  for (const [col, w] of L.widths) ws.getColumn(col).width = w;

  let rowIdx = 1;
  const merges: [number, number, number, number][] = [];

  for (const group of data) {
    // Date + shift header
    ws.mergeCells(rowIdx, 1, rowIdx, L.totalCols);
    const dateCell = ws.getCell(rowIdx, 1);
    dateCell.value = `${formatDateShort(group.date)} — ${group.shiftLabel}`;
    dateCell.font = DT_DATE_FONT;
    dateCell.fill = headerFill(DT_DATE_BLUE);
    dateCell.alignment = centerAlign;
    boxRow(ws, rowIdx, L.totalCols);
    ws.getRow(rowIdx).height = DT_DATE_ROW_HEIGHT;
    rowIdx++;

    // Representative segment time labels for this group's X-axis
    const timeLabels = representativeTimeLabels(group, group.shiftType);

    // Header rows (2): meta merged across both; chart title on row1, time axis on row2
    const h1 = rowIdx;
    const h2 = rowIdx + 1;
    const hStyle = { font: DT_HEADER_FONT, fill: headerFill(DT_HEADER_BLUE), alignment: centerAlign };

    const set2RowHeader = (col: number, label: string) => {
      if (!col) return;
      ws.mergeCells(h1, col, h2, col);
      Object.assign(ws.getCell(h1, col), hStyle);
      ws.getCell(h1, col).value = label;
    };
    set2RowHeader(L.numCol, '№');
    set2RowHeader(L.regCol, 'Гос. номер');
    for (const m of L.metaCols) set2RowHeader(m.col, m.label);

    if (L.hasChart) {
      set2RowHeader(L.yAxisCol, '%');
      // Chart title across segment columns (row 1)
      ws.mergeCells(h1, L.chartStartCol, h1, L.chartEndCol);
      const titleCell = ws.getCell(h1, L.chartStartCol);
      titleCell.value = 'Активность двигателя по 30-мин окнам  (высота = % загрузки,  синий — движение,  фиолетовый — на месте)';
      Object.assign(titleCell, hStyle);
      titleCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
      // Time axis labels (row 2): every 4th segment. Leave others value-less so the
      // label text can overflow into adjacent (empty) cells instead of being clipped.
      for (let i = 0; i < SEGMENT_COUNT; i++) {
        const cell = ws.getCell(h2, L.chartStartCol + i);
        Object.assign(cell, hStyle);
        if (i % 4 === 0) cell.value = timeLabels[i];
        cell.font = { ...DT_HEADER_FONT, size: 8 };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    }
    applyHeaderBorders(ws, h1, L);
    applyHeaderBorders(ws, h2, L);
    ws.getRow(h1).height = DT_ROW_HEIGHT;
    ws.getRow(h2).height = 14;
    rowIdx += 2;

    // Flatten vehicles, track object boundaries
    const allVehicles: { vehicle: OnsiteVehicle; objectName: string }[] = [];
    const multipleObjects = group.objects.length > 1;
    for (const obj of group.objects) {
      for (const v of obj.vehicles) allVehicles.push({ vehicle: v, objectName: obj.object_name });
    }

    let vehicleNum = 0;
    let currentObject = '';

    for (const { vehicle, objectName } of allVehicles) {
      // Object sub-header
      if (multipleObjects && objectName !== currentObject) {
        currentObject = objectName;
        ws.mergeCells(rowIdx, 1, rowIdx, L.totalCols);
        const objCell = ws.getCell(rowIdx, 1);
        objCell.value = objectName;
        objCell.font = { name: 'Calibri', size: 14, bold: true };
        objCell.fill = headerFill(DT_OBJECT_FILL);
        objCell.alignment = centerAlign;
        boxRow(ws, rowIdx, L.totalCols, thinBorder);
        ws.getRow(rowIdx).height = DT_ROW_HEIGHT;
        rowIdx++;
      }

      vehicleNum++;
      const startRow = rowIdx;
      const endRow = startRow + (L.hasChart ? CHART_HEIGHT : 1) - 1;

      // Meta values on first row of block
      writeMeta(ws, startRow, L, vehicleNum, vehicle);

      // Chart
      if (L.hasChart) {
        drawChart(ws, startRow, L, vehicle.segments);
        for (let r = startRow; r <= endRow; r++) ws.getRow(r).height = CHART_ROW_HEIGHT;
        // Merge meta columns vertically across the chart block
        const mergeCols = [L.numCol, L.regCol, ...L.metaCols.map(m => m.col)];
        for (const c of mergeCols) merges.push([startRow, c, endRow, c]);
      } else {
        ws.getRow(startRow).height = DT_ROW_HEIGHT;
      }

      // Outer box around the whole vehicle block
      boxBlock(ws, startRow, endRow, L);
      rowIdx = endRow + 1;
    }
  }

  for (const [r1, c1, r2, c2] of merges) {
    try { ws.mergeCells(r1, c1, r2, c2); } catch { /* skip overlaps */ }
  }

  ws.views = [{ state: 'frozen', xSplit: L.regCol, ySplit: 0 }];
  return wb;
}

// ─── Meta cells ─────────────────────────────────────────────────────────────

function writeMeta(ws: ExcelJS.Worksheet, row: number, L: OnsiteLayout, num: number, v: OnsiteVehicle) {
  const set = (col: number, val: string | number) => {
    if (!col) return;
    const cell = ws.getCell(row, col);
    cell.value = val;
    cell.font = DT_DATA_FONT;
    cell.alignment = centerAlign;
  };
  set(L.numCol, num);
  set(L.regCol, v.reg_number);
  for (const m of L.metaCols) {
    set(m.col, metaValue(m.id, v));
  }
}

function metaValue(id: string, v: OnsiteVehicle): string | number {
  switch (id) {
    case 'engine_hours':  return formatHM(v.engine_time_sec);
    case 'fuel_consumed': return v.fuel_consumed > 0 ? v.fuel_consumed : '';
    case 'kip_pct':       return v.kip_pct > 0 ? Math.round(v.kip_pct) : '';
    case 'movement_pct':  return v.movement_pct > 0 ? Math.round(v.movement_pct) : '';
    case 'onsite_time':   return v.onsite_min > 0 ? formatHM(v.onsite_min * 60) : '';
    case 'distance_km':   return v.distance_km > 0 ? Math.round(v.distance_km * 10) / 10 : '';
    case 'shift_start':   return v.shift_start;
    case 'shift_end':     return v.shift_end;
    default:              return '';
  }
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function drawChart(ws: ExcelJS.Worksheet, startRow: number, L: OnsiteLayout, segments: OnsiteSegment[]) {
  const band = 100 / CHART_HEIGHT; // 10%
  const segByIndex = new Map<number, OnsiteSegment>();
  for (const s of segments) segByIndex.set(s.index, s);

  // Y-axis labels (top=100, mid=50, bottom=0)
  const yLabels: Record<number, string> = { 0: '100', 5: '50', [CHART_HEIGHT - 1]: '0' };
  for (let r = 0; r < CHART_HEIGHT; r++) {
    const cell = ws.getCell(startRow + r, L.yAxisCol);
    cell.value = yLabels[r] ?? '';
    cell.font = DT_AXIS_FONT;
    cell.alignment = { horizontal: 'right', vertical: r === 0 ? 'top' : r === CHART_HEIGHT - 1 ? 'bottom' : 'middle' };
  }

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const seg = segByIndex.get(i);
    const engine = seg?.engineUtilPct ?? 0;
    const moving = seg?.movingUtilPct ?? 0;
    const col = L.chartStartCol + i;

    for (let r = 0; r < CHART_HEIGHT; r++) {
      const bottomOffset = CHART_HEIGHT - 1 - r; // 0 = bottom band
      const bandMid = bottomOffset * band + band / 2;
      const cell = ws.getCell(startRow + r, col);
      let color: string | null = null;
      if (bandMid <= moving) color = COLOR_MOVING;
      else if (bandMid <= engine) color = COLOR_STATIONARY;
      if (color) cell.fill = headerFill(color);
      cell.border = { top: GRID_BORDER, bottom: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER };
    }
  }
}

// ─── Borders ──────────────────────────────────────────────────────────────

function boxRow(ws: ExcelJS.Worksheet, row: number, totalCols: number, edge: Partial<ExcelJS.Border> = mediumBorder) {
  for (let c = 1; c <= totalCols; c++) {
    ws.getCell(row, c).border = {
      top: edge, bottom: edge,
      left: c === 1 ? edge : undefined,
      right: c === totalCols ? edge : undefined,
    };
  }
}

function boxBlock(ws: ExcelJS.Worksheet, startRow: number, endRow: number, L: OnsiteLayout) {
  // Left/right medium edges + medium under the last block row, preserving inner grid.
  for (let r = startRow; r <= endRow; r++) {
    const left = ws.getCell(r, 1);
    left.border = { ...left.border, left: mediumBorder };
    const right = ws.getCell(r, L.totalCols);
    right.border = { ...right.border, right: mediumBorder };
    // Medium divider after Гос.номер (separates meta from chart-ish region)
    const reg = ws.getCell(r, L.regCol);
    reg.border = { ...reg.border, right: mediumBorder };
  }
  for (let c = 1; c <= L.totalCols; c++) {
    const top = ws.getCell(startRow, c);
    top.border = { ...top.border, top: mediumBorder };
    const bottom = ws.getCell(endRow, c);
    bottom.border = { ...bottom.border, bottom: mediumBorder };
  }
}

function applyHeaderBorders(ws: ExcelJS.Worksheet, row: number, L: OnsiteLayout) {
  for (let c = 1; c <= L.totalCols; c++) {
    ws.getCell(row, c).border = {
      top: mediumBorder, bottom: thinBorder,
      left: (c === 1 || c === L.chartStartCol) ? mediumBorder : thinBorder,
      right: (c === L.regCol || c === L.totalCols || c === L.chartEndCol) ? mediumBorder : thinBorder,
    };
  }
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatDateShort(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}`;
}

/** seconds → h:mm */
function formatHM(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Build 24 X-axis time labels: prefer real segment times, fall back to nominal shift start. */
function representativeTimeLabels(group: OnsiteDateShiftGroup, shiftType: string): string[] {
  for (const obj of group.objects) {
    for (const v of obj.vehicles) {
      if (v.segments.length > 0) {
        const labels = new Array<string>(SEGMENT_COUNT).fill('');
        for (const s of v.segments) if (s.index < SEGMENT_COUNT) labels[s.index] = s.timeLabel;
        if (labels.some(Boolean)) return fillNominalGaps(labels, shiftType);
      }
    }
  }
  return nominalLabels(shiftType);
}

function nominalLabels(shiftType: string): string[] {
  const base = shiftType === 'shift1' ? 7 * 60 + 30 : 19 * 60 + 30;
  return Array.from({ length: SEGMENT_COUNT }, (_, i) => formatClock((base + i * 30) % 1440));
}

function fillNominalGaps(labels: string[], shiftType: string): string[] {
  const nominal = nominalLabels(shiftType);
  return labels.map((l, i) => l || nominal[i]);
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
