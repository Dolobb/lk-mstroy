const ExcelJS = require('exceljs');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  for (const ws of workbook.worksheets) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SHEET: "${ws.name}"`);
    console.log(`${'='.repeat(80)}`);
    
    // Column headers
    console.log('\nCOLUMN HEADERS (A-P, Row 1-3):');
    
    // Row 1
    const row1 = [];
    for (let c = 1; c <= 16; c++) {
      const val = ws.getCell(1, c).value;
      row1.push(val ? String(val).substring(0, 20) : '');
    }
    console.log('Row 1: ' + row1.join(' | '));
    
    // Row 2  
    const row2 = [];
    for (let c = 1; c <= 16; c++) {
      const val = ws.getCell(2, c).value;
      row2.push(val ? String(val).substring(0, 20) : '');
    }
    console.log('Row 2: ' + row2.join(' | '));
    
    // Row 3
    const row3 = [];
    for (let c = 1; c <= 16; c++) {
      const val = ws.getCell(3, c).value;
      row3.push(val ? String(val).substring(0, 20) : '');
    }
    console.log('Row 3: ' + row3.join(' | '));

    // Show sample data row
    if (ws.rowCount > 3) {
      console.log('\nSAMPLE DATA ROW (Row 4):');
      for (let c = 1; c <= 16; c++) {
        const cell = ws.getCell(4, c);
        const letter = String.fromCharCode(64 + c);
        if (cell.value) {
          console.log(`  ${letter}4: ${String(cell.value).substring(0, 30)}`);
        }
      }
    }

    // Show first merge info
    const merges = ws.model.merges || [];
    console.log(`\nMERGED CELLS (first 20 of ${merges.length}):`);
    for (const m of merges.slice(0, 20)) {
      console.log(`  ${m}`);
    }
  }
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx").catch(console.error);
