/** Простой CSV stringify (без внешних библиотек) */
function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function stringify(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escapeCell(r[h])).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n'); // BOM для Excel
}
