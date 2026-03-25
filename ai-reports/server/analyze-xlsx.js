const ExcelJS = require('exceljs');
const path = require('path');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log(`=== WORKBOOK: ${path.basename(filePath)} ===`);
  console.log(`Sheets: ${workbook.worksheets.length}`);
  console.log();

  for (const ws of workbook.worksheets) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SHEET: "${ws.name}" | Rows: ${ws.rowCount} | Cols: ${ws.columnCount}`);
    console.log(`${'='.repeat(80)}`);

    // Merged cells
    const merges = ws.model.merges || [];
    if (merges.length > 0) {
      console.log(`\nMERGED CELLS (${merges.length}):`);
      for (const m of merges) {
        console.log(`  ${m}`);
      }
    }

    // Column widths
    console.log(`\nCOLUMN WIDTHS:`);
    for (let c = 1; c <= ws.columnCount; c++) {
      const col = ws.getColumn(c);
      if (col.width) {
        console.log(`  Col ${c} (${String.fromCharCode(64+c)}): width=${col.width.toFixed(1)}`);
      }
    }

    // Row by row analysis
    console.log(`\nROW DATA:`);
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const val = cell.value;
        const displayVal = val === null || val === undefined ? '' : 
                          typeof val === 'object' && val.formula ? `=FORMULA(${val.formula})` :
                          typeof val === 'object' && val.richText ? val.richText.map(r => r.text).join('') :
                          String(val);
        
        let styleInfo = '';
        
        // Fill color
        if (cell.fill && cell.fill.fgColor) {
          const fg = cell.fill.fgColor;
          const color = fg.argb || fg.theme !== undefined ? `theme:${fg.theme},tint:${fg.tint || 0}` : 'unknown';
          styleInfo += ` [bg:${fg.argb || color}]`;
        }
        
        // Font
        if (cell.font) {
          const f = cell.font;
          let fontStr = '';
          if (f.bold) fontStr += 'B';
          if (f.italic) fontStr += 'I';
          if (f.size) fontStr += ` sz${f.size}`;
          if (f.color && f.color.argb) fontStr += ` c:${f.color.argb}`;
          if (f.color && f.color.theme !== undefined) fontStr += ` theme:${f.color.theme}`;
          if (f.name) fontStr += ` ${f.name}`;
          if (fontStr) styleInfo += ` [font:${fontStr.trim()}]`;
        }

        // Alignment
        if (cell.alignment) {
          const a = cell.alignment;
          let alStr = '';
          if (a.horizontal) alStr += a.horizontal;
          if (a.vertical) alStr += '/' + a.vertical;
          if (a.wrapText) alStr += '/wrap';
          if (alStr) styleInfo += ` [align:${alStr}]`;
        }

        // Border
        if (cell.border) {
          const sides = Object.keys(cell.border).filter(k => cell.border[k] && cell.border[k].style);
          if (sides.length > 0) {
            const styles = [...new Set(sides.map(s => cell.border[s].style))];
            styleInfo += ` [border:${styles.join(',')}]`;
          }
        }

        cells.push(`${String.fromCharCode(64+colNum)}:${displayVal}${styleInfo}`);
      });
      
      const rowHeight = row.height;
      const heightStr = rowHeight ? ` (h:${rowHeight})` : '';
      console.log(`  Row ${rowNum}${heightStr}: ${cells.join(' | ')}`);
    });

    // Frozen panes
    if (ws.views && ws.views.length > 0) {
      console.log(`\nFROZEN PANES:`, JSON.stringify(ws.views));
    }

    // Auto-filter
    if (ws.autoFilter) {
      console.log(`\nAUTO-FILTER:`, JSON.stringify(ws.autoFilter));
    }
  }
}

const filePath = path.resolve(process.argv[2]);
analyze(filePath).catch(err => console.error(err));
