const ExcelJS = require('exceljs');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // Get all sheets
  for (const sheetName of ["Отчёт КИП", "Отчёт (самосвал)", "Отчет по рейсам самосвалов"]) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) continue;

    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`SHEET: "${ws.name}"`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Rows: ${ws.rowCount}, Cols: ${ws.columnCount}\n`);

    // For dump truck daily sheet - show complete column structure
    if (sheetName === "Отчет по рейсам самосвалов") {
      console.log('COMPLETE COLUMN STRUCTURE:');
      console.log('Column | Row 2 (main headers) | Row 3 (sub-headers)');
      console.log('-'.repeat(80));
      
      for (let c = 1; c <= 16; c++) {
        const letter = String.fromCharCode(64 + c);
        const val2 = ws.getCell(2, c).value || '';
        const val3 = ws.getCell(3, c).value || '';
        console.log(`  ${letter}   | ${String(val2).padEnd(30)} | ${String(val3).padEnd(30)}`);
      }

      console.log('\nCOLOR ANALYSIS (first 10 rows):');
      for (let row = 1; row <= 10; row++) {
        const cells = [];
        for (let col = 1; col <= 16; col++) {
          const cell = ws.getCell(row, col);
          const letter = String.fromCharCode(64 + col);
          let color = '';
          if (cell.fill && cell.fill.fgColor) {
            const fg = cell.fill.fgColor;
            if (fg.argb) {
              color = fg.argb;
            } else if (fg.theme !== undefined) {
              color = `theme:${fg.theme},tint:${fg.tint || 0}`;
            }
          }
          if (color) {
            cells.push(`${letter}=${color}`);
          }
        }
        if (cells.length > 0) {
          console.log(`Row ${row}: ${cells.join(' | ')}`);
        }
      }
    }
  }
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx").catch(console.error);
