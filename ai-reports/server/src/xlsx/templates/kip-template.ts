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

  // We'll have: №, №п/п, Марка/гос.№, СМУ, then metrics for shift1, metrics for shift2
  // Fixed columns: A=№, B=№п/п, C=Марка/гос.№, D=СМУ
  const fixedCount = 4;
  const metricsPerShift = metricCols.length;
  const totalCols = fixedCount + metricsPerShift * 2;

  // Column widths
  ws.getColumn(1).width = 5;  // №
  ws.getColumn(2).width = 5;  // №п/п
  ws.getColumn(3).width = 18; // Марка/гос.№
  ws.getColumn(4).width = 22; // СМУ
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
  const fixedHeaders = ['№', '№ п/п', 'Марка / гос.№', 'СМУ'];
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

  // ─── Data rows: group by vehicle_model → department_unit ──────────

  // Pivot data: for each vehicle+date, we need shift1 and shift2 side by side
  // Group: model → dept → vehicle_id → date → { morning: KipRow, evening: KipRow }
  interface VehicleDateEntry { morning?: KipRow; evening?: KipRow }
  const tree = new Map<string, Map<string, Map<string, Map<string, VehicleDateEntry>>>>();

  for (const row of data) {
    const model = row.vehicle_model || 'Прочие';
    const dept = row.department_unit || 'Без СМУ';
    const vid = row.vehicle_id;
    const date = row.report_date;

    if (!tree.has(model)) tree.set(model, new Map());
    const deptMap = tree.get(model)!;
    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const vMap = deptMap.get(dept)!;
    if (!vMap.has(vid)) vMap.set(vid, new Map());
    const dateMap = vMap.get(vid)!;
    if (!dateMap.has(date)) dateMap.set(date, {});
    const entry = dateMap.get(date)!;
    if (row.shift_type === 'morning') entry.morning = row;
    else entry.evening = row;
  }

  let rowIdx = 6; // start after headers
  let globalNum = 0;

  for (const [model, deptMap] of tree) {
    // Type group header
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const typeCell = ws.getCell(rowIdx, 1);
    typeCell.value = `Тип: ${model}`;
    typeCell.font = headerFont('Arial Narrow', 7);
    typeCell.fill = headerFill(KIP_GROUP_BLUE);
    typeCell.alignment = centerAlign;
    typeCell.border = allThinBorders;
    rowIdx++;

    for (const [dept, vMap] of deptMap) {
      // Department subgroup header
      ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
      const deptCell = ws.getCell(rowIdx, 1);
      deptCell.value = dept;
      deptCell.font = { name: 'Arial Narrow', bold: true, size: 7 };
      deptCell.fill = headerFill(KIP_LIGHT_BLUE);
      deptCell.alignment = centerAlign;
      deptCell.border = allThinBorders;
      // Dark text on light background
      deptCell.font = { name: 'Arial Narrow', bold: true, size: 7, color: { argb: 'FF000000' } };
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
          ws.getCell(rowIdx, 3).value = vid;
          ws.getCell(rowIdx, 4).value = entry.morning?.department_unit || entry.evening?.department_unit || '';

          // Shift 1 metrics
          for (let i = 0; i < metricsPerShift; i++) {
            const col = fixedCount + i + 1;
            const val = entry.morning ? (entry.morning as any)[metricCols[i]] : '';
            ws.getCell(rowIdx, col).value = typeof val === 'number' ? Math.round(val * 100) / 100 : val;
          }

          // Shift 2 metrics
          for (let i = 0; i < metricsPerShift; i++) {
            const col = fixedCount + metricsPerShift + i + 1;
            const val = entry.evening ? (entry.evening as any)[metricCols[i]] : '';
            ws.getCell(rowIdx, col).value = typeof val === 'number' ? Math.round(val * 100) / 100 : val;
          }

          // Style all data cells
          for (let c = 1; c <= totalCols; c++) {
            const cell = ws.getCell(rowIdx, c);
            cell.font = { name: 'Arial Narrow', size: 7 };
            cell.alignment = centerAlign;
            cell.border = allThinBorders;
          }
          // Bold for КИП and Нагрузка columns
          const kipIdx = metricCols.indexOf('utilization_ratio');
          const loadIdx = metricCols.indexOf('load_efficiency_pct');
          for (const mi of [kipIdx, loadIdx]) {
            if (mi >= 0) {
              ws.getCell(rowIdx, fixedCount + mi + 1).font = { name: 'Arial Narrow', size: 7, bold: true };
              ws.getCell(rowIdx, fixedCount + metricsPerShift + mi + 1).font = { name: 'Arial Narrow', size: 7, bold: true };
            }
          }

          rowIdx++;
        }
      }
    }
  }

  // Freeze panes below headers
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 0 }];

  return wb;
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}
