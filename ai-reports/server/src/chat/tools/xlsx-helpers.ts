import type ExcelJS from 'exceljs';

// === ПАЛИТРА ===
export const COLORS = {
  headerDark:   'FF1E3A5F',   // тёмный navy — основные заголовки
  headerMedium: 'FF2563EB',   // средний — подзаголовки (смены, разделы)
  headerStd:    'FF3B82F6',   // UI синий — заголовки столбцов
  groupDark:    'FF1E40AF',   // тёмный — строки-группы уровень 1 (тип ТС)
  groupMedium:  'FF60A5FA',   // средний — группы уровень 2 (подразделение)
  groupLight:   'FFDBEAFE',   // светлый — подгруппы/итоги
  bgAlt:        'FFEFF6FF',   // почти белый — чередование строк
  white:        'FFFFFFFF',
  textDark:     'FF1E293B',
  textWhite:    'FFFFFFFF',
  borderColor:  'FFB0B0B0',   // серый для рамок
  summary:      'FFF1F5F9',   // серый фон итоговых строк
};

// === ПЕЧАТЬ A4 ===
export function applyPrintSetup(ws: ExcelJS.Worksheet, orientation: 'landscape' | 'portrait') {
  ws.pageSetup = {
    paperSize: 9,              // A4
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,            // авто по высоте
    margins: {
      left: 0.4, right: 0.3,
      top: 0.5, bottom: 0.5,
      header: 0.3, footer: 0.3,
    },
    horizontalCentered: true,
  };
  ws.headerFooter = {
    oddFooter: '&CСтр. &P из &N',
  };
}

// === СТИЛИ СТРОК ===
export function fillRow(
  row: ExcelJS.Row,
  argb: string,
  fontArgb: string = COLORS.textWhite,
  bold: boolean = true,
  fontSize: number = 10,
) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.font = { bold, color: { argb: fontArgb }, size: fontSize };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

export function fillCell(
  cell: ExcelJS.Cell,
  bgArgb: string,
  fontArgb: string = COLORS.textWhite,
  bold: boolean = true,
  fontSize: number = 10,
) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
  cell.font = { bold, color: { argb: fontArgb }, size: fontSize };
  cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
}

// === РАМКИ ===
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.borderColor } },
  left: { style: 'thin', color: { argb: COLORS.borderColor } },
  bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
  right: { style: 'thin', color: { argb: COLORS.borderColor } },
};

export function applyBorders(
  ws: ExcelJS.Worksheet,
  fromRow: number,
  toRow: number,
  fromCol: number,
  toCol: number,
) {
  for (let r = fromRow; r <= toRow; r++) {
    const row = ws.getRow(r);
    for (let c = fromCol; c <= toCol; c++) {
      row.getCell(c).border = THIN_BORDER;
    }
  }
}

export function applyBordersToAll(ws: ExcelJS.Worksheet) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = THIN_BORDER;
    });
  });
}

// === ФОРМАТЫ ===
export const FMT = {
  percent:  '0.0"%"',
  timeHM:   '[h]:mm',
  decimal2: '0.00',
  integer:  '#,##0',
  dateRu:   'DD.MM.YYYY',
};

// === STYLE MAP для rowStyles ===
export const STYLE_MAP: Record<string, { bg: string; font: string; bold: boolean }> = {
  group1:  { bg: COLORS.groupDark,   font: COLORS.textWhite, bold: true },
  group2:  { bg: COLORS.groupMedium, font: COLORS.textWhite, bold: true },
  group3:  { bg: COLORS.groupLight,  font: COLORS.textDark,  bold: true },
  summary: { bg: COLORS.summary,     font: COLORS.textDark,  bold: true },
};

// === УТИЛИТЫ ===
export function secToHHMM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

export function hoursToHHMM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

export function formatDateRu(dateStr: string): string {
  // YYYY-MM-DD → DD.MM.YYYY
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return dateStr;
}

/** Column letter (1-based): 1→A, 2→B, ... 27→AA */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
