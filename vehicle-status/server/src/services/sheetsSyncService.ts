import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { getEnvConfig } from '../config/env';
import { getPool } from '../config/database';
import { deleteByCategory, insertVehicle, insertSnapshot } from '../repositories/vehicleStatusRepo';

const SHEET_TABS: { sheetName: string; displayName: string; columns?: ColumnMap }[] = [
  { sheetName: 'Сводная по МиМ',          displayName: 'Сводная по МиМ'            },
  { sheetName: 'Стягачи',                  displayName: 'Стягачи'                   },
  { sheetName: 'АБСАБН МС11',              displayName: 'АБС/АБН МС11'             },
  { sheetName: 'АвтобусыБортовые МС11',    displayName: 'Автобусы/Бортовые МС11'   },
  { sheetName: 'ДСТ  МС11 ',               displayName: 'ДСТ  МС11'                },
  { sheetName: 'МС 11 Краны (новаяновая)',  displayName: 'МС 11 Краны (новая/новая)' },
  { sheetName: 'Спецтехника МС11',         displayName: 'Спецтехника МС11'          },
  { sheetName: 'Малая механизация МС11',   displayName: 'Малая механизация МС11'    },
  { sheetName: 'Самосвалы МС11',           displayName: 'Самосвалы МС11'           },
  { sheetName: 'Диспозиция ОГТР и МС11',   displayName: 'Диспозиция ОГТР и МС11'   },
  { sheetName: 'ВЕЗДЕХОДЫ',                displayName: 'ВЕЗДЕХОДЫ'                },
];

interface ColumnMap {
  plate?: number;
  branch?: number;
  vehicleType?: number;
  brand?: number;
  constructionObject?: number;
  techStatus?: number;
  workType?: number;
}

interface HeaderResult {
  headerRowIdx: number;
  columns: ColumnMap;
}

const FIELD_DEFS: { key: keyof ColumnMap; required: boolean; match: (h: string) => boolean }[] = [
  { key: 'plate',              required: true,  match: h => h === 'гос. №' },
  { key: 'techStatus',         required: true,  match: h => h.startsWith('тех.') && h.includes('состояние') },
  { key: 'branch',             required: false, match: h => h.includes('филиал') || h === 'ф-ал' },
  { key: 'vehicleType',        required: false, match: h => ['тип тс','тип крана','наименование техники'].includes(h) },
  { key: 'brand',              required: false, match: h => ['марка','марка машины'].includes(h) },
  { key: 'constructionObject', required: false, match: h => h.startsWith('объект') },
  { key: 'workType',           required: false, match: h => (h.startsWith('вид') && h.includes('работ')) || h === 'выполянемая работа' },
];

const KNOWN_STATUSES = new Set([
  'исправен', 'неисправен', 'частично исправен', 'требует ремонта', 'требуется ремонт',
  'ремонт', 'в ремонте', 'авария', 'не на ходу', 'на списание', 'списание',
  'реализация', '(пусто)',
]);

function isValidTechStatus(s: string): boolean {
  if (!s) return true;
  const lower = s.trim().toLowerCase();
  if (KNOWN_STATUSES.has(lower)) return true;
  for (const k of KNOWN_STATUSES) {
    if (lower.includes(k)) return true;
  }
  return false;
}

function isBroken(statusText: string): boolean {
  const st = statusText.trim().toLowerCase();
  if (['исправен', 'частично исправен', 'требует ремонта'].some(x => st.includes(x))) return false;
  if (['неисправен', 'ремонт', 'авария', 'не на ходу', 'на списание', 'списание', 'реализация'].some(x => st.includes(x))) return true;
  return false;
}

function unmergeSheet(sheet: XLSX.WorkSheet): string[][] {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const merges = sheet['!merges'] || [];
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? String(cell.v ?? '') : '');
    }
    rows.push(row);
  }
  for (const m of merges) {
    const val = rows[m.s.r]?.[m.s.c] ?? '';
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        if (rows[r]) rows[r][c] = val;
      }
    }
  }
  return rows;
}

async function downloadXlsx(
  fileId: string,
  auth: InstanceType<typeof google.auth.JWT>,
): Promise<Buffer> {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(response.data as ArrayBuffer);
}

function findHeaderRow(rows: string[][]): HeaderResult | null {
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const lower = rows[r].map(h => String(h).trim().toLowerCase());
    const columns: ColumnMap = {};
    for (const def of FIELD_DEFS) {
      const idx = lower.findIndex(h => def.match(h));
      if (idx !== -1) columns[def.key] = idx;
    }
    if (columns.plate !== undefined && columns.techStatus !== undefined) {
      return { headerRowIdx: r, columns };
    }
  }
  return null;
}

interface ParsedVehicle {
  plateNumber: string;
  branch: string;
  vehicleType: string;
  brand: string;
  constructionObject: string;
  techStatus: string;
  workType: string;
  isBroken: boolean;
}

export interface SyncResult {
  processed: number;
  errors: string[];
}

export interface TabDiagnostic {
  sheetName: string;
  displayName: string;
  found: boolean;
  totalRows: number;
  headerFound: boolean;
  headerRowIdx: number | null;
  columns: ColumnMap;
  headerColumns: string[];
  parsedRows: number;
  skippedEmpty: number;
  uniqueStatuses: string[];
  sampleRows: { plate: string; status: string; broken: boolean }[];
}

export interface DiagnosticResult {
  allSheetNames: string[];
  tabs: TabDiagnostic[];
  unmatchedSheets: string[];
}

export async function runDiagnostic(): Promise<DiagnosticResult> {
  const config = getEnvConfig();
  const credsPath = path.resolve(__dirname, '../../', config.googleCredsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const xlsxBuffer = await downloadXlsx(config.googleSheetId, auth);
  const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });

  const allSheetNames = workbook.SheetNames;
  const matchedSheets = new Set<string>();
  const tabs: TabDiagnostic[] = [];

  for (const tab of SHEET_TABS) {
    const sheetName = allSheetNames.find(n => n.trim() === tab.sheetName.trim());

    if (!sheetName) {
      tabs.push({
        sheetName: tab.sheetName,
        displayName: tab.displayName,
        found: false,
        totalRows: 0,
        headerFound: false,
        headerRowIdx: null,
        columns: {},
        headerColumns: [],
        parsedRows: 0,
        skippedEmpty: 0,
        uniqueStatuses: [],
        sampleRows: [],
      });
      continue;
    }

    matchedSheets.add(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rows = unmergeSheet(sheet);

    const header = findHeaderRow(rows);
    const statuses = new Set<string>();
    const parsed: { plate: string; status: string; broken: boolean }[] = [];
    let skippedEmpty = 0;

    if (header) {
      const { headerRowIdx, columns } = header;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const plate = String(row[columns.plate!] ?? '').trim().toUpperCase();
        const status = columns.techStatus !== undefined ? String(row[columns.techStatus] ?? '').trim() : '';

        if (!plate || plate === '0' || plate === 'NAN' || plate === 'UNDEFINED') {
          skippedEmpty++;
          continue;
        }

        statuses.add(status || '(пусто)');
        parsed.push({ plate, status, broken: isBroken(status) });
      }
    }

    const headerColumns = header
      ? rows[header.headerRowIdx].map(h => String(h).trim()).filter(Boolean)
      : [];

    const sampleRows = header
      ? parsed.slice(0, 5)
      : rows.slice(0, 5).map(r => ({
          plate: String(r[0] ?? '').trim(),
          status: String(r[1] ?? '').trim(),
          broken: false,
        }));

    tabs.push({
      sheetName: tab.sheetName,
      displayName: tab.displayName,
      found: true,
      totalRows: rows.length,
      headerFound: !!header,
      headerRowIdx: header?.headerRowIdx ?? null,
      columns: header?.columns ?? {},
      headerColumns,
      parsedRows: parsed.length,
      skippedEmpty,
      uniqueStatuses: [...statuses].sort(),
      sampleRows,
    });
  }

  const unmatchedSheets = allSheetNames.filter(n => !matchedSheets.has(n));

  return { allSheetNames, tabs, unmatchedSheets };
}

export async function runSync(): Promise<SyncResult> {
  const config = getEnvConfig();
  const credsPath = path.resolve(__dirname, '../../', config.googleCredsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  let xlsxBuffer: Buffer;
  try {
    xlsxBuffer = await downloadXlsx(config.googleSheetId, auth);
  } catch (err) {
    return { processed: 0, errors: [`Failed to download file: ${String(err)}`] };
  }

  const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });

  const categoryData = new Map<string, ParsedVehicle[]>();

  for (const tab of SHEET_TABS) {
    const sheetName = workbook.SheetNames.find(n => n.trim() === tab.sheetName.trim());

    if (!sheetName) {
      errors.push(`Tab "${tab.sheetName}": not found. Available: ${workbook.SheetNames.join(', ')}`);
      continue;
    }

    try {
      const sheet = workbook.Sheets[sheetName];
      const rows = unmergeSheet(sheet);

      if (rows.length < 2) continue;

      const header = findHeaderRow(rows);
      if (!header) {
        const preview = (rows[0] as string[]).filter(Boolean).join(', ');
        errors.push(`Tab "${tab.sheetName}": columns not found. Row 0: ${preview}`);
        continue;
      }

      const { headerRowIdx } = header;
      const autoColumns = header.columns;
      const columns = tab.columns ?? autoColumns;
      const vehicles: ParsedVehicle[] = [];
      const seen = new Set<string>();

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i] as string[];
        const plate = String(row[columns.plate!] ?? '').trim().toUpperCase();

        if (!plate || plate === '0' || plate === 'NAN' || plate === 'UNDEFINED') continue;
        if (!/\d/.test(plate)) continue;
        if (seen.has(plate)) continue;
        seen.add(plate);

        let techStatus = '';
        if (columns.techStatus !== undefined) {
          for (let c = columns.techStatus; c <= columns.techStatus + 2 && c < row.length; c++) {
            const v = String(row[c] ?? '').trim();
            if (v && isValidTechStatus(v)) { techStatus = v; break; }
            if (v && !isValidTechStatus(v)) continue;
          }
        }

        let branch = '';
        if (columns.branch !== undefined) {
          const rawBranch = String(row[columns.branch] ?? '').trim();
          if (rawBranch && !isValidTechStatus(rawBranch)) {
            branch = rawBranch;
          } else if (columns.branch + 1 < row.length) {
            const next = String(row[columns.branch + 1] ?? '').trim();
            if (next && !isValidTechStatus(next)) branch = next;
          }
        }
        const vehicleType = columns.vehicleType !== undefined
          ? String(row[columns.vehicleType] ?? '').trim() : '';
        const brand = columns.brand !== undefined
          ? String(row[columns.brand] ?? '').trim() : '';
        const constructionObject = columns.constructionObject !== undefined
          ? String(row[columns.constructionObject] ?? '').trim() : '';
        const workType = columns.workType !== undefined
          ? String(row[columns.workType] ?? '').trim() : '';

        vehicles.push({
          plateNumber: plate,
          branch,
          vehicleType,
          brand,
          constructionObject,
          techStatus,
          workType,
          isBroken: isBroken(techStatus),
        });
      }

      categoryData.set(tab.displayName, vehicles);
    } catch (err) {
      errors.push(`Tab "${tab.sheetName}": ${String(err)}`);
    }
  }

  const pool = getPool();
  let processed = 0;

  for (const [category, vehicles] of categoryData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteByCategory(client, category);
      for (const v of vehicles) {
        await insertVehicle(client, { ...v, category, today });
        await insertSnapshot(client, { ...v, category, snapshotDate: today });
      }
      await client.query('COMMIT');
      processed += vehicles.length;
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push(`Category "${category}": ${String(err)}`);
    } finally {
      client.release();
    }
  }

  return { processed, errors };
}

export async function debugRawRows(sheetName: string, plateFilter: string): Promise<any> {
  const config = getEnvConfig();
  const credsPath = path.resolve(__dirname, '../../', config.googleCredsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as { client_email: string; private_key: string };
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const xlsxBuffer = await downloadXlsx(config.googleSheetId, auth);
  const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });

  const sn = workbook.SheetNames.find(n => n.trim() === sheetName.trim());
  if (!sn) return { error: `Sheet "${sheetName}" not found` };

  const sheet = workbook.Sheets[sn];
  const rows = unmergeSheet(sheet);
  const header = findHeaderRow(rows);
  if (!header) return { error: 'Header not found' };

  const { headerRowIdx, columns } = header;
  const headerRow = rows[headerRowIdx].map((h: string) => String(h).trim());

  const result: any = { sheetName: sn, headerRowIdx, columns, headerRow };

  if (plateFilter) {
    const matching: any[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const plate = String(row[columns.plate!] ?? '').trim().toUpperCase();
      if (plate.includes(plateFilter.toUpperCase())) {
        matching.push({ rowIdx: i, raw: row.slice(0, Math.max(headerRow.length, 12)) });
      }
    }
    result.matching = matching;
  } else {
    const sample: any[] = [];
    for (let i = headerRowIdx + 1; i < Math.min(headerRowIdx + 5, rows.length); i++) {
      sample.push({ rowIdx: i, raw: rows[i].slice(0, Math.max(headerRow.length, 12)) });
    }
    result.sample = sample;
  }

  result.merges = (sheet['!merges'] || []).slice(0, 30).map((m: XLSX.Range) => ({
    range: XLSX.utils.encode_range(m),
    val: rows[m.s.r]?.[m.s.c] ?? '',
  }));

  return result;
}
