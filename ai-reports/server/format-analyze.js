const ExcelJS = require('exceljs');

function borderStr(b) {
  if (!b) return '-';
  const parts = [];
  for (const side of ['top', 'bottom', 'left', 'right']) {
    if (b[side] && b[side].style) {
      const color = b[side].color ? (b[side].color.argb || `theme:${b[side].color.theme}`) : '';
      parts.push(`${side}:${b[side].style}${color ? '(' + color + ')' : ''}`);
    }
  }
  return parts.join(', ') || '-';
}

function fontStr(f) {
  if (!f) return '-';
  const parts = [];
  if (f.name) parts.push(f.name);
  if (f.size) parts.push(`${f.size}pt`);
  if (f.bold) parts.push('bold');
  if (f.italic) parts.push('italic');
  if (f.color) {
    if (f.color.argb) parts.push(`color:${f.color.argb}`);
    else if (f.color.theme !== undefined) parts.push(`theme:${f.color.theme},tint:${f.color.tint || 0}`);
  }
  return parts.join(' ') || '-';
}

function fillStr(f) {
  if (!f || f.type !== 'pattern') return '-';
  const fg = f.fgColor;
  if (!fg) return '-';
  if (fg.argb) return fg.argb;
  if (fg.theme !== undefined) return `theme:${fg.theme},tint:${fg.tint || 0}`;
  return '-';
}

function alignStr(a) {
  if (!a) return '-';
  const parts = [];
  if (a.horizontal) parts.push(`h:${a.horizontal}`);
  if (a.vertical) parts.push(`v:${a.vertical}`);
  if (a.wrapText) parts.push('wrap');
  return parts.join(' ') || '-';
}

async function analyze(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  for (const ws of wb.worksheets) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`SHEET: "${ws.name}" — ${ws.rowCount} rows × ${ws.columnCount} cols`);
    console.log(`${'='.repeat(100)}`);

    // Column widths
    console.log('\nCOLUMN WIDTHS:');
    for (let c = 1; c <= ws.columnCount; c++) {
      const col = ws.getColumn(c);
      const letter = c <= 26 ? String.fromCharCode(64 + c) : 'A' + String.fromCharCode(64 + c - 26);
      console.log(`  ${letter}: width=${col.width || 'default'}`);
    }

    // Merges
    const merges = ws.model.merges || [];
    console.log(`\nMERGES (${merges.length} total):`);
    for (const m of merges.slice(0, 30)) {
      console.log(`  ${m}`);
    }

    // Analyze all rows with content
    console.log('\nROW-BY-ROW ANALYSIS:');
    const maxRow = Math.min(ws.rowCount, 40); // first 40 rows

    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const hasCells = row.cellCount > 0;
      if (!hasCells) continue;

      console.log(`\n--- Row ${r} (height: ${row.height || 'default'}, outlineLevel: ${row.outlineLevel || 0}) ---`);

      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
        const cell = ws.getCell(r, c);
        const letter = c <= 26 ? String.fromCharCode(64 + c) : 'A' + String.fromCharCode(64 + c - 26);

        // Skip truly empty cells
        if (!cell.value && !cell.style.font && !cell.style.border && !cell.style.fill) continue;

        const val = cell.value != null ? String(cell.value).substring(0, 40) : '(empty)';
        console.log(`  ${letter}${r}: "${val}"`);
        console.log(`    font: ${fontStr(cell.style.font)}`);
        console.log(`    fill: ${fillStr(cell.style.fill)}`);
        console.log(`    align: ${alignStr(cell.style.alignment)}`);
        console.log(`    border: ${borderStr(cell.style.border)}`);
      }
    }
  }
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/измененияя в формате.xlsx").catch(console.error);
