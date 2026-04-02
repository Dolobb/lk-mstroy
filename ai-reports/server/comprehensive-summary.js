const ExcelJS = require('exceljs');

async function analyze(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log('\n\n' + '='.repeat(120));
  console.log('COMPREHENSIVE TEMPLATE ANALYSIS - All 3 Sheets');
  console.log('='.repeat(120));

  // SHEET 1 - КИП
  const kip = workbook.getWorksheet("Отчёт КИП");
  console.log('\n\n### SHEET 1: "Отчёт КИП" ###');
  console.log(`Rows: ${kip.rowCount}, Cols: ${kip.columnCount}`);
  console.log('\nColumn Structure (C-N):');
  for (let c = 3; c <= 14; c++) {
    const letter = String.fromCharCode(64 + c);
    const r4 = kip.getCell(4, c).value ? String(kip.getCell(4, c).value) : '';
    const r5 = kip.getCell(5, c).value ? String(kip.getCell(5, c).value) : '';
    console.log(`  ${letter}: "${r4}" > "${r5}"`);
  }

  console.log('\nRow 1-2 Title Merge: C1:N2');
  console.log('  Content: "Выработка техники на АО Мостострой-11 в период с DD.MM.YYYY по DD.MM.YYYY"');
  console.log('  Style: Arial Narrow Bold sz11, no background');
  
  console.log('\nRow 4-5 Structure:');
  console.log('  C4:C5 merge = №');
  console.log('  D4:D5 merge = № п/п');
  console.log('  E4:E5 merge = Марка / гос.№');
  console.log('  F4:F5 merge = Объект строительства');
  console.log('  G4:J4 merge = "1 смена"');
  console.log('  K4:N4 merge = "2 смена"');
  console.log('\nRow 5 Sub-headers:');
  console.log('  G5 = КИП, % | H5 = Время нахождения на объекте | I5 = Время работы двигателя | J5 = Работа под нагрузкой%');
  console.log('  K5 = КИП, % | L5 = Время нахождения на объекте | M5 = Время работы двигателя | N5 = Работа под нагрузкой%');

  // SHEET 2 - Dump Trucks Summary
  const summary = workbook.getWorksheet("Отчёт (самосвал)");
  console.log('\n\n### SHEET 2: "Отчёт (самосвал)" - SUMMARY ###');
  console.log(`Rows: ${summary.rowCount}, Cols: ${summary.columnCount}`);
  console.log('\nTWO SEPARATE TABLES:');
  console.log('\nTABLE A (Rows 1-14): "Выработка по времени"');
  console.log('  Row 1: Title merge A1:F1 - "Выработка Самосвалов в период DD.MM.YY - DD.MM.YY"');
  console.log('  Style: Calibri Bold sz16');
  console.log('\n  Row 3-4 Headers:');
  console.log('    A3:A4 = Марка / гос.№');
  console.log('    B3:F3 merge (level 1)');
  console.log('    Row 4: B=Время работы двигателя | C=Время в движении | D=Время простоя | E=Выработка% от двиг. | F=Выработка% от движения');
  
  console.log('\nTABLE B (Rows 16-43): "Рейсы и стоянки"');
  console.log('  Row 16-18: THREE-LEVEL HEADERS');
  console.log('    Row 16: A16:A18 merge = Марка/гос.№ | B16:F16 merge = "Итого"');
  console.log('    Row 17: B17:B18 merge = Кол-во рейсов | C17:D17 merge = Средняя стоянка | E17:F17 merge = Среднее время в пути');
  console.log('    Row 18: C = Погрузка | D = Выгрузка | E = Погрузка | F = Выгрузка');

  // SHEET 3 - Daily detailed
  const daily = workbook.getWorksheet("Отчет по рейсам самосвалов");
  console.log('\n\n### SHEET 3: "Отчет по рейсам самосвалов" - DAILY BREAKDOWN ###');
  console.log(`Rows: ${daily.rowCount}, Cols: ${daily.columnCount}`);
  console.log(`Merged Cells: ${daily.model.merges.length}`);
  
  console.log('\nRow 1: DATE+SHIFT Header (merge A1:P1)');
  console.log('  Content: "21.03 — Cмена 1"');
  console.log('  Style: Gray background #D9D9D9, Calibri Bold sz12');
  
  console.log('\nRow 2: MAIN HEADERS (with 2-level grouping)');
  console.log('  A2: (empty)');
  console.log('  B2: ГосНомер | C2: Кол-во рейс | D2: Начало смены');
  console.log('  E2:G2 merge = Погрузка | H2:J2 merge = Выгрузка');
  console.log('  K2: Конец смены | L2: Средняя стоянка П | M2: Средняя стоянка В');
  console.log('  N2: Ср. путь Погр-Выгр | O2: Ср. путь Выгр-Погр | P2: Комментарий');
  
  console.log('\nRow 3: SUB-HEADERS');
  console.log('  B3: ГосНомер | C3: Кол-во рейс | D3: Начало смены');
  console.log('  E3: Въезд | F3: Выезд | G3: Стоянка (under Погрузка)');
  console.log('  H3: Въезд | I3: Выезд | J3: Стоянка (under Выгрузка)');
  console.log('  K3: Конец смены | L3-O3: same as row 2 | P3: Комментарий');

  console.log('\nVERTICAL MERGE STRUCTURE (Key feature):');
  console.log('  Columns A, C, D, K, L, M, N, O are VERTICALLY MERGED per vehicle per shift');
  console.log('  Columns E-J vary per TRIP (each row = one trip)');
  console.log('  Column B (ГосНомер) repeats for each trip');
  console.log('  Column P (Комментарий) varies per trip');
  
  console.log('\nCOLORING:');
  console.log('  Row 1: Background #D9D9D9 (gray)');
  console.log('  Row 2-3: Background #0070C0 (bright blue), Text white');
  console.log('  Data rows: No background (white), Text black');

  console.log('\nEXACT COLUMN ORDER A-P:');
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
  const headers = [
    '(empty)',
    'ГосНомер',
    'Кол-во рейс',
    'Начало смены',
    'Погрузка\nВъезд',
    'Погрузка\nВыезд',
    'Погрузка\nСтоянка',
    'Выгрузка\nВъезд',
    'Выгрузка\nВыезд',
    'Выгрузка\nСтоянка',
    'Конец смены',
    'Средняя\nстоянка П',
    'Средняя\nстоянка В',
    'Ср. путь\nПогр→Выгр',
    'Ср. путь\nВыгр→Погр',
    'Комментарий'
  ];
  
  for (let i = 0; i < cols.length; i++) {
    console.log(`  ${cols[i]} (${daily.getColumn(i+1).width.toFixed(1)}w): ${headers[i]}`);
  }

  console.log('\n\n⚠️  CRITICAL CLARIFICATION: "АГРЕГАТЫ" vs AVERAGES');
  console.log('Between "Конец смены" (K) and "Комментарий" (P), columns L-O are:');
  console.log('  L: Средняя стоянка П (Average loading dwell time across all trips)');
  console.log('  M: Средняя стоянка В (Average unloading dwell time across all trips)');
  console.log('  N: Ср. путь Погр-Выгр (Average travel time loading→unloading)');
  console.log('  O: Ср. путь Выгр-Погр (Average travel time unloading→loading)');
  console.log('\nThese are NOT "агрегаты" (aggregates) in the sense of technical devices.');
  console.log('They are AVERAGE VALUES calculated per vehicle per shift/date.');
}

analyze("/Users/max/Documents/Mstroy/lk-mstroy/Шаблоны для отчётов.xlsx").catch(console.error);
