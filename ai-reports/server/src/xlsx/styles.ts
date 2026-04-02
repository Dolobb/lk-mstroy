import type { Border, Fill, Font, Alignment } from 'exceljs';

// ─── Border styles ─────────────────────────────────────────────────────────

export const thinBorder: Partial<Border> = { style: 'thin' };
export const mediumBorder: Partial<Border> = { style: 'medium' };
export const doubleBorder: Partial<Border> = { style: 'double' };
export const dottedBorder: Partial<Border> = { style: 'dotted' };

export const allThinBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};

// ─── Shared helpers ────────────────────────────────────────────────────────

export function headerFill(argb: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

export function headerFont(name: string, size: number, bold = true, color = 'FFFFFFFF'): Partial<Font> {
  return { name, size, bold, color: { argb: color } };
}

export const centerAlign: Partial<Alignment> = {
  horizontal: 'center',
  vertical: 'middle',
  wrapText: true,
};

// ─── KIP specific colors ────────────────────────────────────────────────────

export const KIP_DARK_BLUE = 'FF203764';
export const KIP_MED_BLUE = 'FF2F5496';
export const KIP_LIGHT_BLUE = 'FFD6E4F0'; // theme:4 tint:0.8 approx
export const KIP_GROUP_BLUE = 'FF4472C4';  // theme:4 tint:-0.25 approx

// ─── DT trips specific ─────────────────────────────────────────────────────

export const DT_HEADER_BLUE = 'FF0070C0';
export const DT_DATE_BLUE = 'FFA3DBFF';

// DT fonts
export const DT_DATE_FONT: Partial<Font> = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF000000' } };
export const DT_HEADER_FONT: Partial<Font> = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
export const DT_DATA_FONT: Partial<Font> = { name: 'Calibri', size: 14 };
export const DT_DWELL_FONT: Partial<Font> = { name: 'Calibri', size: 13 };
export const DT_ZONE_FONT: Partial<Font> = { name: 'Calibri', size: 12 };

// DT row heights
export const DT_DATE_ROW_HEIGHT = 33.75;
export const DT_ROW_HEIGHT = 21;

// DT alignments
export const dtEnterAlign: Partial<Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };
export const dtDwellAlign: Partial<Alignment> = { horizontal: 'center', wrapText: true };
export const dtExitAlign: Partial<Alignment> = { horizontal: 'right', vertical: 'middle', wrapText: true };
