const ExcelJS = require('exceljs');
const path = require('path');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // Get sheet 3 (dump truck detailed - "Отчет по рейсам самосвалов")
  const ws = workbook.getWorksheet("Отчет по рейсам самосвалов");
  if (!ws) {
    console.log('Sheet not found. Available sheets:');
    for (const sheet of workbook.worksheets) {
      console.log(`  - "${sheet.name}"`);
    }
    return;
  }

  console.log(`SHEET: "${ws.name}" | Rows: ${ws.rowCount} | Cols: ${ws.columnCount}`);
  console.log('\n=== HEADER STRUCTURE (Rows 1-3) ===');

  // Show first 3 rows with full details
  for (let row = 1; row <= 3; row++) {
    console.log(`\nRow ${row}:`);
    for (let col = 1; col <= 16; col++) {
      const cell = ws.getCell(row, col);
      const letter = String.fromCharCode(64 + col);
      if (cell.value || cell.isMerged) {
        console.log(`  ${letter}${row}: "${cell.value}" [merge:${cell.isMerged ? 'YES' : 'NO'}]`);
      }
    }
  }

  console.log('\n\n=== MERGED CELLS ===');
  const merges = ws.model.merges || [];
  for (const m of merges.slice(0, 30)) {
    console.log(`  ${m}`);
  }
}

const filePath = "/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx";
analyze(filePath).catch(err => console.error(err));
