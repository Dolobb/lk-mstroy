const ExcelJS = require('exceljs');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log('\n' + '='.repeat(100));
  console.log('DUMP TRUCK DETAILED STRUCTURE ANALYSIS');
  console.log('='.repeat(100));

  // Sheet 3 - Daily breakdown
  const ws = workbook.getWorksheet("Отчет по рейсам самосвалов");
  
  console.log(`\n📊 SHEET: "${ws.name}"`);
  console.log(`   Rows: ${ws.rowCount}, Cols: ${ws.columnCount}\n`);

  console.log('COMPLETE COLUMN LAYOUT (A-P):');
  console.log('-'.repeat(100));
  
  // Show all columns with their headers
  const letters = [];
  for (let c = 1; c <= 16; c++) {
    letters.push(String.fromCharCode(64 + c));
  }
  
  console.log('\nColumn Header (Row 2 - Main):');
  for (let c = 1; c <= 16; c++) {
    const cell = ws.getCell(2, c);
    const letter = String.fromCharCode(64 + c);
    const val = cell.value ? String(cell.value) : '';
    console.log(`  ${letter}: "${val}"`);
  }

  console.log('\nColumn Header (Row 3 - Sub):');
  for (let c = 1; c <= 16; c++) {
    const cell = ws.getCell(3, c);
    const letter = String.fromCharCode(64 + c);
    const val = cell.value ? String(cell.value) : '';
    console.log(`  ${letter}: "${val}"`);
  }

  console.log('\n' + '-'.repeat(100));
  console.log('🔍 BETWEEN "КОНЕЦ СМЕНЫ" (K) AND "КОММЕНТАРИЙ" (P):');
  console.log('-'.repeat(100));
  
  console.log('\nColumns L, M, N, O (between K and P):');
  for (let c = 12; c <= 15; c++) {
    const letter = String.fromCharCode(64 + c);
    const row2 = ws.getCell(2, c).value ? String(ws.getCell(2, c).value) : '';
    const row3 = ws.getCell(3, c).value ? String(ws.getCell(3, c).value) : '';
    console.log(`  ${letter}: Row2="${row2}" | Row3="${row3}"`);
  }

  console.log('\n⚠️  THESE ARE NOT "агрегаты" - they are averages:');
  console.log('  L: Средняя стоянка П (Average loading dwell time)');
  console.log('  M: Средняя стоянка В (Average unloading dwell time)');  
  console.log('  N: Ср. путь Погр-Выгр (Average travel loading→unloading)');
  console.log('  O: Ср. путь Выгр-Погр (Average travel unloading→loading)');

  // Check if there's data to see merged patterns
  console.log('\n' + '-'.repeat(100));
  console.log('SAMPLE DATA STRUCTURE (showing vertical merges):');
  console.log('-'.repeat(100));
  
  // Find first few data rows to show the merge pattern
  for (let row = 4; row <= 12; row++) {
    const aVal = ws.getCell(row, 1).value;
    const bVal = ws.getCell(row, 2).value;
    const cVal = ws.getCell(row, 3).value;
    const pVal = ws.getCell(row, 16).value;
    
    const aMerge = ws.getCell(row, 1).isMerged;
    const bMerge = ws.getCell(row, 2).isMerged;
    const cMerge = ws.getCell(row, 3).isMerged;
    
    if (aVal || bVal) {
      console.log(`Row ${row}: A=${aVal ? '✓' : ' '} B=${bVal ? '✓' : ' '} C=${cVal ? '✓' : ' '} ... P=${pVal ? '✓' : ' '}`);
      console.log(`         (A-merged:${aMerge} B-merged:${bMerge} C-merged:${cMerge})`);
    }
  }

  // Get merge info
  console.log('\n' + '-'.repeat(100));
  console.log(`VERTICAL MERGES (${ws.model.merges.length} total):`);
  console.log('-'.repeat(100));
  
  // Show merges that involve columns K-P range (columns 11-16)
  const merges = ws.model.merges || [];
  const relevantMerges = merges.filter(m => {
    const match = m.match(/([A-P])(\d+):([A-P])(\d+)/);
    if (!match) return false;
    const col1 = match[1].charCodeAt(0) - 64;
    const col2 = match[3].charCodeAt(0) - 64;
    return (col1 >= 11 || col2 >= 11); // Involves K-P columns
  });
  
  console.log(`\nMerges in K-P range (${relevantMerges.length}):`);
  for (const m of relevantMerges.slice(0, 30)) {
    console.log(`  ${m}`);
  }
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx").catch(console.error);
