import type { Border, Fill, Font, Alignment } from 'exceljs';

export const thinBorder: Partial<Border> = { style: 'thin' };

export const allThinBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};

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

// ─── DT trips specific colors ───────────────────────────────────────────────

export const DT_HEADER_BLUE = 'FF0070C0';
export const DT_DATE_GRAY = 'FFD9D9D9';
