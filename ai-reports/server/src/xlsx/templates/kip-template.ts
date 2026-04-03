import ExcelJS from 'exceljs';
import type { KipRow } from '../../reports/queries/kip';
import {
  allThinBorders, headerFill, headerFont, centerAlign,
  KIP_DARK_BLUE, KIP_MED_BLUE, KIP_LIGHT_BLUE, KIP_GROUP_BLUE,
} from '../styles';

// ─── Constants ─────────────────────────────────────────────────────

// DB field → column label
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

// Which metrics are percentages (averaged on aggregation)
const PCT_METRICS = new Set(['utilization_ratio', 'load_efficiency_pct', 'fuel_variance']);
// Which metrics are percentage-colored
const PERCENT_COLOR_IDS = new Set(['utilization_ratio', 'load_efficiency_pct']);
const LOAD_IDS = new Set(['load_efficiency_pct']);

// ─── Fonts (all +3pt from original) ───────────────────────────────

const TITLE_SIZE = 14;  // was 11
const HDR_SIZE = 10;    // was 7
const DATA_SIZE = 10;   // was 7
const DATA_ROW_H = 32;  // was 22.5
const SUB_HDR_H = 49;   // was 34

// ─── Color helper ──────────────────────────────────────────────────

function getPercentColor(transformed: number, metricId: string): string | undefined {
  if (transformed === 0 && LOAD_IDS.has(metricId)) return undefined;
  if (transformed <= 0.49) return 'FFFF0000';
  if (transformed >= 0.7) return 'FF00B050';
  return 'FF2F5496';
}

// ─── Options interface ─────────────────────────────────────────────

export interface KipBuildOptions {
  splitByDays?: boolean;
  splitByShifts?: boolean;
}

// ─── Prepared row for rendering ────────────────────────────────────

interface PreparedRow {
  model: string;
  regNumber: string;
  site: string;
  companyName: string;
  colB: string | number;    // seq number, date, or date+shift
  shift1: Record<string, number>;
  shift2: Record<string, number>;  // empty in singleShift mode
}

// ─── Main build function ───────────────────────────────────────────

export async function buildKipXlsx(
  data: KipRow[],
  columns: string[],
  dateFrom: string,
  dateTo: string,
  options?: KipBuildOptions,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КИП');

  const byDays = options?.splitByDays ?? false;
  const byShifts = byDays && (options?.splitByShifts ?? false);
  const singleShiftMode = byShifts; // one metric set per row

  const metricCols = columns.filter(c => c in METRIC_LABELS);

  // Fixed columns: A=№, B=№п/п or Date, C=Марка/гос.№, D=Объект строительства
  const fixedCount = 4;
  const shiftSets = singleShiftMode ? 1 : 2;
  const metricsPerShift = metricCols.length;
  const totalCols = fixedCount + metricsPerShift * shiftSets;

  // Column widths (scaled +43%)
  ws.getColumn(1).width = 7;    // №
  ws.getColumn(2).width = 10;   // №п/п / date
  ws.getColumn(3).width = 46;   // Марка/гос.№
  ws.getColumn(4).width = 31;   // Объект строительства
  for (let i = 0; i < metricsPerShift * shiftSets; i++) {
    ws.getColumn(fixedCount + 1 + i).width = 14;
  }

  // ─── Prepare data ─────────────────────────────────────────────
  const { groups, colBHeader } = prepareData(data, metricCols, byDays, byShifts);

  // ─── Row 1-2: Title ───────────────────────────────────────────
  const fmtFrom = formatDate(dateFrom);
  const fmtTo = formatDate(dateTo);
  ws.mergeCells(1, 1, 2, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Выработка техники на АО Мостострой-11 в период с ${fmtFrom} по ${fmtTo}`;
  titleCell.font = { name: 'Arial Narrow', bold: true, size: TITLE_SIZE };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ─── Row 4: Level 1 headers ───────────────────────────────────
  const hRow = 4;
  const hStyle = {
    font: headerFont('Arial Narrow', HDR_SIZE),
    fill: headerFill(KIP_DARK_BLUE),
    alignment: centerAlign,
    border: allThinBorders,
  };

  const fixedHeaders = ['№', colBHeader, 'Марка / гос.№', 'Объект строительства'];
  for (let i = 0; i < fixedCount; i++) {
    ws.mergeCells(hRow, i + 1, hRow + 1, i + 1);
    const cell = ws.getCell(hRow, i + 1);
    cell.value = fixedHeaders[i];
    Object.assign(cell, hStyle);
  }

  if (singleShiftMode) {
    // Single merged header for metrics
    if (metricsPerShift > 0) {
      const start = fixedCount + 1;
      const end = fixedCount + metricsPerShift;
      ws.mergeCells(hRow, start, hRow, end);
      const cell = ws.getCell(hRow, start);
      cell.value = 'Метрики';
      Object.assign(cell, { ...hStyle, fill: headerFill(KIP_MED_BLUE) });
    }
  } else {
    // "1 смена" header
    if (metricsPerShift > 0) {
      const s1Start = fixedCount + 1;
      const s1End = fixedCount + metricsPerShift;
      ws.mergeCells(hRow, s1Start, hRow, s1End);
      const s1Cell = ws.getCell(hRow, s1Start);
      s1Cell.value = '1 смена';
      Object.assign(s1Cell, { ...hStyle, fill: headerFill(KIP_MED_BLUE) });
    }
    // "2 смена" header
    if (metricsPerShift > 0) {
      const s2Start = fixedCount + metricsPerShift + 1;
      const s2End = fixedCount + metricsPerShift * 2;
      ws.mergeCells(hRow, s2Start, hRow, s2End);
      const s2Cell = ws.getCell(hRow, s2Start);
      s2Cell.value = '2 смена';
      Object.assign(s2Cell, hStyle);
    }
  }

  // ─── Row 5: Sub-headers (metric names) ────────────────────────
  const subRow = hRow + 1;
  if (singleShiftMode) {
    for (let i = 0; i < metricsPerShift; i++) {
      const col = fixedCount + i + 1;
      const cell = ws.getCell(subRow, col);
      cell.value = METRIC_LABELS[metricCols[i]] || metricCols[i];
      cell.font = headerFont('Arial Narrow', HDR_SIZE);
      cell.fill = headerFill(KIP_MED_BLUE);
      cell.alignment = centerAlign;
      cell.border = allThinBorders;
    }
  } else {
    for (let s = 0; s < 2; s++) {
      const offset = fixedCount + s * metricsPerShift;
      const fillColor = s === 0 ? KIP_MED_BLUE : KIP_DARK_BLUE;
      for (let i = 0; i < metricsPerShift; i++) {
        const col = offset + i + 1;
        const cell = ws.getCell(subRow, col);
        cell.value = METRIC_LABELS[metricCols[i]] || metricCols[i];
        cell.font = headerFont('Arial Narrow', HDR_SIZE);
        cell.fill = headerFill(fillColor);
        cell.alignment = centerAlign;
        cell.border = allThinBorders;
      }
    }
  }
  ws.getRow(subRow).height = SUB_HDR_H;

  // ─── Data rows ────────────────────────────────────────────────
  let rowIdx = 6;
  let globalNum = 0;

  for (const [model, rows] of groups) {
    // Type group header
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const typeCell = ws.getCell(rowIdx, 1);
    typeCell.value = `Тип: ${model}`;
    typeCell.font = headerFont('Arial Narrow', HDR_SIZE);
    typeCell.fill = headerFill(KIP_GROUP_BLUE);
    typeCell.alignment = centerAlign;
    typeCell.border = allThinBorders;
    rowIdx++;

    // Sub-group by organization
    const orgGroups = new Map<string, PreparedRow[]>();
    for (const pr of rows) {
      const org = pr.companyName || 'Без организации';
      if (!orgGroups.has(org)) orgGroups.set(org, []);
      orgGroups.get(org)!.push(pr);
    }

    for (const [orgName, orgRows] of orgGroups) {
      // Organization sub-header
      ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
      const orgCell = ws.getCell(rowIdx, 1);
      orgCell.value = orgName;
      orgCell.font = { name: 'Arial Narrow', bold: true, size: HDR_SIZE, color: { argb: 'FF000000' } };
      orgCell.fill = headerFill(KIP_LIGHT_BLUE);
      orgCell.alignment = centerAlign;
      orgCell.border = allThinBorders;
      rowIdx++;

    for (const pr of orgRows) {
      globalNum++;
      const row = ws.getRow(rowIdx);
      row.height = DATA_ROW_H;

      // Column A: global number
      ws.getCell(rowIdx, 1).value = globalNum;

      // Column B: seq number, date, or date+shift
      ws.getCell(rowIdx, 2).value = pr.colB;

      // Column C: rich text — model | **regNumber**
      ws.getCell(rowIdx, 3).value = buildVehicleRichText(pr.model, pr.regNumber);

      // Column D: site
      ws.getCell(rowIdx, 4).value = pr.site;

      // Metrics
      if (singleShiftMode) {
        writeMetricCells(ws, rowIdx, fixedCount, metricCols, pr.shift1);
      } else {
        writeMetricCells(ws, rowIdx, fixedCount, metricCols, pr.shift1);
        writeMetricCells(ws, rowIdx, fixedCount + metricsPerShift, metricCols, pr.shift2);
      }

      // Base style for all cells
      for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(rowIdx, c);
        if (!cell.font || !cell.font.color) {
          cell.font = { name: 'Arial Narrow', size: DATA_SIZE };
        }
        cell.alignment = centerAlign;
        cell.border = allThinBorders;
      }
      // Left-align text columns
      ws.getCell(rowIdx, 3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getCell(rowIdx, 4).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

      rowIdx++;
    }
    } // end orgGroups
  }

  // Freeze panes below headers
  ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 0 }];

  return wb;
}

// ─── Data preparation ──────────────────────────────────────────────

function prepareData(
  data: KipRow[],
  metricCols: string[],
  byDays: boolean,
  byShifts: boolean,
): { groups: Map<string, PreparedRow[]>; colBHeader: string } {
  // Determine column B header
  let colBHeader: string;
  if (byShifts) colBHeader = 'Дата / Смена';
  else if (byDays) colBHeader = 'Дата';
  else colBHeader = '№ п/п';

  if (byShifts) {
    return { groups: prepareSplitByShifts(data, metricCols), colBHeader };
  }
  if (byDays) {
    return { groups: prepareSplitByDays(data, metricCols), colBHeader };
  }
  return { groups: prepareAggregated(data, metricCols), colBHeader };
}

// Mode 1: Aggregated — one row per vehicle
function prepareAggregated(data: KipRow[], metricCols: string[]): Map<string, PreparedRow[]> {
  // Group: model → vid → { mornings: KipRow[], evenings: KipRow[] }
  const tree = new Map<string, Map<string, { model: string; site: string; companyName: string; mornings: KipRow[]; evenings: KipRow[] }>>();

  for (const row of data) {
    const model = row.vehicle_model || 'Прочие';
    const vid = row.vehicle_id;
    if (!tree.has(model)) tree.set(model, new Map());
    const vMap = tree.get(model)!;
    if (!vMap.has(vid)) {
      vMap.set(vid, { model, site: row.department_unit, companyName: row.company_name || '', mornings: [], evenings: [] });
    }
    const bucket = vMap.get(vid)!;
    // Keep latest site name
    if (row.department_unit) bucket.site = row.department_unit;
    if (row.company_name) bucket.companyName = row.company_name;
    if (row.shift_type === 'morning') bucket.mornings.push(row);
    else bucket.evenings.push(row);
  }

  const groups = new Map<string, PreparedRow[]>();
  let localNum = 0;

  for (const [model, vMap] of tree) {
    const rows: PreparedRow[] = [];
    for (const [vid, bucket] of vMap) {
      localNum++;
      rows.push({
        model: bucket.model,
        regNumber: vid,
        site: bucket.site,
        companyName: bucket.companyName,
        colB: localNum,
        shift1: aggregateMetrics(bucket.mornings, metricCols),
        shift2: aggregateMetrics(bucket.evenings, metricCols),
      });
    }
    groups.set(model, rows);
  }

  return groups;
}

// Mode 2: Split by days — one row per vehicle per date
function prepareSplitByDays(data: KipRow[], metricCols: string[]): Map<string, PreparedRow[]> {
  const tree = new Map<string, Map<string, Map<string, { morning?: KipRow; evening?: KipRow }>>>();

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

  const groups = new Map<string, PreparedRow[]>();

  for (const [model, vMap] of tree) {
    const rows: PreparedRow[] = [];
    for (const [vid, dateMap] of vMap) {
      for (const [date, entry] of dateMap) {
        const src = entry.morning || entry.evening!;
        rows.push({
          model: src.vehicle_model || model,
          regNumber: vid,
          site: src.department_unit || '',
          companyName: src.company_name || '',
          colB: formatDateShort(date),
          shift1: rowToMetrics(entry.morning, metricCols),
          shift2: rowToMetrics(entry.evening, metricCols),
        });
      }
    }
    groups.set(model, rows);
  }

  return groups;
}

// Mode 3: Split by days + shifts — one row per vehicle per date per shift
function prepareSplitByShifts(data: KipRow[], metricCols: string[]): Map<string, PreparedRow[]> {
  const tree = new Map<string, Map<string, { model: string; entries: { date: string; shift: string; row: KipRow }[] }>>();

  for (const row of data) {
    const model = row.vehicle_model || 'Прочие';
    const vid = row.vehicle_id;
    if (!tree.has(model)) tree.set(model, new Map());
    const vMap = tree.get(model)!;
    if (!vMap.has(vid)) vMap.set(vid, { model, entries: [] });
    vMap.get(vid)!.entries.push({
      date: row.report_date,
      shift: row.shift_type === 'morning' ? '1см' : '2см',
      row,
    });
  }

  const groups = new Map<string, PreparedRow[]>();

  for (const [model, vMap] of tree) {
    const rows: PreparedRow[] = [];
    for (const [vid, bucket] of vMap) {
      for (const e of bucket.entries) {
        rows.push({
          model: e.row.vehicle_model || model,
          regNumber: vid,
          site: e.row.department_unit || '',
          companyName: e.row.company_name || '',
          colB: `${formatDateShort(e.date)} ${e.shift}`,
          shift1: rowToMetrics(e.row, metricCols),
          shift2: {},
        });
      }
    }
    groups.set(model, rows);
  }

  return groups;
}

// ─── Aggregation helpers ───────────────────────────────────────────

function aggregateMetrics(rows: KipRow[], metricCols: string[]): Record<string, number> {
  if (rows.length === 0) return {};
  const result: Record<string, number> = {};

  for (const id of metricCols) {
    const values = rows.map(r => (r as any)[id] as number).filter(v => typeof v === 'number');
    if (values.length === 0) { result[id] = 0; continue; }

    if (PCT_METRICS.has(id)) {
      // Average for percentages
      const nonZero = values.filter(v => v > 0);
      result[id] = nonZero.length > 0
        ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length
        : 0;
    } else {
      // Sum for hours/fuel
      result[id] = values.reduce((a, b) => a + b, 0);
    }
  }

  return result;
}

function rowToMetrics(row: KipRow | undefined, metricCols: string[]): Record<string, number> {
  if (!row) return {};
  const result: Record<string, number> = {};
  for (const id of metricCols) {
    result[id] = (row as any)[id] ?? 0;
  }
  return result;
}

// ─── Write metric cells ───────────────────────────────────────────

function writeMetricCells(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  colOffset: number,
  metricCols: string[],
  metrics: Record<string, number>,
) {
  for (let i = 0; i < metricCols.length; i++) {
    const col = colOffset + i + 1;
    const metricId = metricCols[i];
    const cell = ws.getCell(rowIdx, col);
    const fmt = METRIC_FORMAT[metricId];
    const raw = metrics[metricId];

    if (raw === undefined || (typeof raw === 'number' && Object.keys(metrics).length === 0)) {
      cell.value = '';
      continue;
    }

    const transformed = fmt ? fmt.transform(raw) : raw;
    cell.value = transformed;
    if (fmt) cell.numFmt = fmt.numFmt;

    // Color for percentage columns
    if (PERCENT_COLOR_IDS.has(metricId)) {
      const color = getPercentColor(transformed, metricId);
      cell.font = color
        ? { name: 'Arial Narrow', size: DATA_SIZE, bold: true, color: { argb: color } }
        : { name: 'Arial Narrow', size: DATA_SIZE, bold: true };
    }
  }
}

// ─── Rich text: model | **regNumber** ──────────────────────────────

function buildVehicleRichText(model: string, regNumber: string): ExcelJS.CellRichTextValue {
  if (!model) {
    return {
      richText: [
        { text: regNumber, font: { name: 'Arial Narrow', size: DATA_SIZE, bold: true } },
      ],
    };
  }
  return {
    richText: [
      { text: `${model} | `, font: { name: 'Arial Narrow', size: DATA_SIZE } },
      { text: regNumber, font: { name: 'Arial Narrow', size: DATA_SIZE, bold: true } },
    ],
  };
}

// ─── Formatters ────────────────────────────────────────────────────

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function formatDateShort(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}.${m}`;
}
