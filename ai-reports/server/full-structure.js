const ExcelJS = require('exceljs');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // Focus on the 3 sheets
  const sheets = ["Отчёт КИП", "Отчёт (самосвал)", "Отчет по рейсам самосвалов"];
  
  for (const sheetName of sheets) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) continue;

    console.log(`\n\n${'#'.repeat(80)}`);
    console.log(`# SHEET: "${sheetName}"`);
    console.log(`#`.padEnd(80) + '#');
    console.log(`# Rows: ${ws.rowCount}, Cols: ${ws.columnCount}`);
    console.log(`${'#'.repeat(80)}\n`);

    // Column widths
    console.log('COLUMN WIDTHS:');
    for (let c = 1; c <= ws.columnCount; c++) {
      const col = ws.getColumn(c);
      const letter = String.fromCharCode(64 + c);
      if (col.width) {
        console.log(`  ${letter}: ${col.width.toFixed(1)}`);
      }
    }

    // Show structure headers (first 5 rows or header section)
    const headerRows = sheetName.includes("КИП") ? 5 : 3;
    console.log(`\nHEADER STRUCTURE (rows 1-${headerRows}):`);
    
    for (let row = 1; row <= headerRows; row++) {
      const cells = [];
      for (let col = 1; col <= ws.columnCount; col++) {
        const cell = ws.getCell(row, col);
        const val = cell.value ? String(cell.value).substring(0, 15) : '';
        cells.push(val.padEnd(15));
      }
      console.log(`Row ${row}: ${cells.join(' | ')}`);
    }

    // Merged cells count and sample
    const merges = ws.model.merges || [];
    console.log(`\nMERGED CELLS: ${merges.length} total`);
    if (merges.length > 0) {
      console.log('First 10 merges:');
      for (const m of merges.slice(0, 10)) {
        console.log(`  ${m}`);
      }
    }

    // Sample data row styling
    if (ws.rowCount > headerRows + 1) {
      const dataRow = headerRows + 2;
      console.log(`\nSTYLE INFO (Row ${dataRow} - first data row):`);
      for (let c = 1; c <= Math.min(6, ws.columnCount); c++) {
        const cell = ws.getCell(dataRow, c);
        const letter = String.fromCharCode(64 + c);
        const font = cell.font || {};
        const fill = cell.fill || {};
        const align = cell.alignment || {};
        
        console.log(`  ${letter}${dataRow}:`);
        console.log(`    Value: ${String(cell.value).substring(0, 20)}`);
        if (fill.fgColor) {
          console.log(`    BgColor: ${fill.fgColor.argb || `theme:${fill.fgColor.theme}`}`);
        }
        if (font.name) console.log(`    Font: ${font.name} ${font.size || ''}${font.bold ? ' Bold' : ''}`);
        if (align.horizontal) console.log(`    Align: ${align.horizontal}/${align.vertical || 'default'}`);
      }
    }
  }
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx").catch(console.error);
