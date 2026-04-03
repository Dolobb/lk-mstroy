import ExcelJS from 'exceljs';
import type { KipRow } from '../../reports/queries/kip';
import {
  allThinBorders, headerFill, headerFont, centerAlign,
  KIP_DARK_BLUE, KIP_MED_BLUE, KIP_LIGHT_BLUE, KIP_GROUP_BLUE,
} from '../styles';

// DB field → column label for headers
const METRIC_LABELS: Record<string, string> = {
  utilization_ratio: 'КИП, %',
  total_stay_time: 'Вр. на объекте',
  engine_on_time: 'Время работы двиг.',
  load_efficiency_pct: 'Нагрузка, %',
  idle_time: 'Простой, ч',
  fuel_consumed_total: 'Расход, л',
  fuel_rate_fact: 'Расх. факт, л/ч',
  fuel_rate_norm: 'Расх. норма, л/ч',
  fuel_variance: 'Коэфф. расхода',
};

// Format & transform for each metric
const METRIC_FORMAT: Record<string, { numFmt: string; transform: (v: number) => number }> = {
  utilization_ratio:   { numFmt: '0%',          transform: v => v / 100 },
  load_efficiency_pct: { numFmt: '0%',          transform: v => v / 100 },
  total_stay_time:     { numFmt: '[h]:mm:ss;@', transform: v => v / 24 },
  engine_on_time:      { numFmt: '[h]:mm:ss;@', transform: v => v / 24 },
  idle_time:           { numFmt: '[h]:mm:ss;@', transform: v => v / 24 },
  fuel_consumed_total: { numFmt: '0.00',        transform: v => v },
  fuel_rate_fact:      { numFmt: '0.00',        transform: v => v },
  fuel_rate_norm:      { numFmt: '0.00',        transform: v => v },
  fuel_variance:       { numFmt: '0.00',        transform: v => v },
};

// Percent-color IDs
const PERCENT_IDS = new Set(['utilization_ratio', 'load_efficiency_pct']);
const LOAD_IDS = new Set(['load_efficiency_pct']);

function getPercentColor(transformed: number, metricId: string): string | undefined {
  if (transformed === 0 && LOAD_IDS.has(metricId)) return undefined; // standard text for 0% load
  if (transformed <= 0.49) return 'FFFF0000';  // red
  if (transformed >= 0.7) return 'FF00B050';   // green
  return 'FF2F5496';                            // dark blue (49-70%)
}

export async function buildKipXlsx(
  data: KipRow[],
  columns: string[],
  dateFrom: string,
  dateTo: string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КИП');

  // Determine which metric columns are selected
  const metricCols = columns.filter(c => c in METRIC_LABELS);

  // Fixed columns: A=№, B=№п/п, C=Марка/гос.№, D=Объект строительства
  const fixedCount = 4;
  const metricsPerShift = metricCols.length;
  const totalCols = fixedCount + metricsPerShift * 2;

  // Column widths
  ws.getColumn(1).width = 5;   // №
  ws.getColumn(2).width = 5;   // №п/п
  ws.getColumn(3).width = 32;  // Марка/гос.№ (wider for model + reg)
  ws.getColumn(4).width = 22;  // Объект строительства
  for (let i = 0; i < metricsPerShift * 2; i++) {
    ws.getColumn(fixedCount + 1 + i).width = 10;
  }

  // ─── Row 1-2: Title ───────────────────────────────────────────────
  const fmtFrom = formatDate(dateFrom);
  const fmtTo = formatDate(dateTo);
  ws.mergeCells(1, 1, 2, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Выработка техники на АО Мостострой-11 в период с ${fmtFrom} по ${fmtTo}`;
  titleCell.font = { name: 'Arial Narrow', bold: true, size: 11 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ─── Row 3: empty ─────────────────────────────────────────────────
  // ─── Row 4: Level 1 headers ───────────────────────────────────────
  const hRow = 4;
  const hStyle = { font: headerFont('Arial Narrow', 7), fill: headerFill(KIP_DARK_BLUE), alignment: centerAlign, border: allThinBorders };

  // Fixed headers (merge 4-5)
  const fixedHeaders = ['№', '№ п/п', 'Марка / гос.№', 'Объект строительства'];
  for (let i = 0; i < fixedCount; i++) {
    ws.mergeCells(hRow, i + 1, hRow + 1, i + 1);
    const cell = ws.getCell(hRow, i + 1);
    cell.value = fixedHeaders[i];
    Object.assign(cell, hStyle);
  }

  // "1 смена" merged header
  if (metricsPerShift > 0) {
    const s1Start = fixedCount + 1;
    const s1End = fixedCount + metricsPerShift;
    ws.mergeCells(hRow, s1Start, hRow, s1End);
    const s1Cell = ws.getCell(hRow, s1Start);
    s1Cell.value = '1 смена';
    Object.assign(s1Cell, { font: headerFont('Arial Narrow', 7), fill: headerFill(KIP_MED_BLUE), alignment: centerAlign, border: allThinBorders });
  }

  // "2 смена" merged header
  if (metricsPerShift > 0) {
    const s2Start = fixedCount + metricsPerShift + 1;
    const s2End = fixedCount + metricsPerShift * 2;
    ws.mergeCells(hRow, s2Start, hRow, s2End);
    const s2Cell = ws.getCell(hRow, s2Start);
    s2Cell.value = '2 смена';
    Object.assign(s2Cell, hStyle);
  }

  // ─── Row 5: Level 2 headers (metric names) ────────────────────────
  const subRow = hRow + 1;
  for (let s = 0; s < 2; s++) {
    const offset = fixedCount + s * metricsPerShift;
    const fillColor = s === 0 ? KIP_MED_BLUE : KIP_DARK_BLUE;
    for (let i = 0; i < metricsPerShift; i++) {
      const col = offset + i + 1;
      const cell = ws.getCell(subRow, col);
      cell.value = METRIC_LABELS[metricCols[i]] || metricCols[i];
      cell.font = headerFont('Arial Narrow', 7);
      cell.fill = headerFill(fillColor);
      cell.alignment = centerAlign;
      cell.border = allThinBorders;
    }
  }
  ws.getRow(subRow).height = 34;

  // ─── Data rows: group by vehicle_model ────────────────────────────

  // Pivot: model → vehicle_id → date → { morning, evening }
  interface VehicleDateEntry { morning?: KipRow; evening?: KipRow }
  const tree = new Map<string, Map<string, Map<string, VehicleDateEntry>>>();

  for (const row of data) {
    const model = row.vehicle_model || 'Прочие';
    const vid = row.vehicle_id;
    const date = row.report_date;

    if (!tree.has(model)) tree.set(model, new Map());
    const vMap = tree.get(model)!;
    if (!vMap.has(vid)) vMap.set(vid, new Map());
    const dateMap = vMap.get(vid)!;
    if (!dateMap.has(date)) dateMap.set(date, {});
    const entry = dateMap.get(date)!;
    if (row.shift_type === 'morning') entry.morning = row;
    else entry.evening = row;
  }

  let rowIdx = 6; // start after headers
  let globalNum = 0;

  for (const [model, vMap] of tree) {
    // Type group header
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const typeCell = ws.getCell(rowIdx, 1);
    typeCell.value = `Тип: ${model}`;
    typeCell.font = headerFont('Arial Narrow', 7);
    typeCell.fill = headerFill(KIP_GROUP_BLUE);
    typeCell.alignment = centerAlign;
    typeCell.border = allThinBorders;
    rowIdx++;

    // Organization placeholder sub-header
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const orgCell = ws.getCell(rowIdx, 1);
    orgCell.value = 'Организация [плейсхолдер]';
    orgCell.font = { name: 'Arial Narrow', bold: true, size: 7, color: { argb: 'FF000000' } };
    orgCell.fill = headerFill(KIP_LIGHT_BLUE);
    orgCell.alignment = centerAlign;
    orgCell.border = allThinBorders;
    rowIdx++;

    let localNum = 0;
    for (const [vid, dateMap] of vMap) {
      for (const [, entry] of dateMap) {
        globalNum++;
        localNum++;
        const row = ws.getRow(rowIdx);
        row.height = 22.5;

        ws.getCell(rowIdx, 1).value = globalNum;
        ws.getCell(rowIdx, 2).value = localNum;

        // Column C: model + гос.№
        const vModel = entry.morning?.vehicle_model || entry.evening?.vehicle_model || '';
        ws.getCell(rowIdx, 3).value = vModel ? `${vModel} гос.№ ${vid}` : vid;

        // Column D: department_unit (construction site)
        ws.getCell(rowIdx, 4).value = entry.morning?.department_unit || entry.evening?.department_unit || '';

        // Shift 1 metrics
        writeMetrics(ws, rowIdx, fixedCount, metricCols, entry.morning);
        // Shift 2 metrics
        writeMetrics(ws, rowIdx, fixedCount + metricsPerShift, metricCols, entry.evening);

        // Style all data cells
        for (let c = 1; c <= totalCols; c++) {
          const cell = ws.getCell(rowIdx, c);
          if (!cell.font || !cell.font.color) {
            cell.font = { name: 'Arial Narrow', size: 7 };
          }
          cell.alignment = centerAlign;
          cell.border = allThinBorders;
        }
        // Left-align text columns C, D
        ws.getCell(rowIdx, 3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        ws.getCell(rowIdx, 4).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

        rowIdx++;
      }
    }
  }

  // Freeze panes below headers
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 0 }];

  return wb;
}

// ─── Write metrics for one shift ───────────────────────────────────

function writeMetrics(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  colOffset: number,
  metricCols: string[],
  shiftData?: KipRow,
) {
  for (let i = 0; i < metricCols.length; i++) {
    const col = colOffset + i + 1;
    const metricId = metricCols[i];
    const cell = ws.getCell(rowIdx, col);
    const fmt = METRIC_FORMAT[metricId];

    if (!shiftData) {
      cell.value = '';
      continue;
    }

    const raw = (shiftData as any)[metricId];
    if (typeof raw !== 'number' || raw === 0) {
      // For time columns: 0 hours → write 0 as Excel time
      if (fmt && fmt.numFmt.includes('[h]') && typeof raw === 'number') {
        cell.value = 0;
        cell.numFmt = fmt.numFmt;
      } else if (typeof raw === 'number' && raw === 0) {
        cell.value = 0;
        if (fmt) cell.numFmt = fmt.numFmt;
      } else {
        cell.value = '';
      }
      // Color for zero percentage
      if (PERCENT_IDS.has(metricId) && typeof raw === 'number') {
        const color = getPercentColor(0, metricId);
        if (color) {
          cell.font = { name: 'Arial Narrow', size: 7, bold: true, color: { argb: color } };
        }
      }
      continue;
    }

    const transformed = fmt ? fmt.transform(raw) : raw;
    cell.value = transformed;
    if (fmt) cell.numFmt = fmt.numFmt;

    // Color for percentage columns
    if (PERCENT_IDS.has(metricId)) {
      const color = getPercentColor(transformed, metricId);
      cell.font = color
        ? { name: 'Arial Narrow', size: 7, bold: true, color: { argb: color } }
        : { name: 'Arial Narrow', size: 7, bold: true };
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}
