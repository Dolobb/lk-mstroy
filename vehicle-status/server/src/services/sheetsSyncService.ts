import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { getEnvConfig } from '../config/env';
import { getPool } from '../config/database';
import {
  findOpenRepair,
  insertRepair,
  updateRepairProgress,
  closeRepair,
} from '../repositories/vehicleStatusRepo';

// ---------------------------------------------------------------------------
// Конфигурация вкладок
// ---------------------------------------------------------------------------
// sheetName  — точное имя вкладки в xlsx-файле.
//              ВАЖНО: Excel удаляет "/" из имён вкладок при сохранении,
//              поэтому "Автобусы/Бортовые МС11" → "АвтобусыБортовые МС11".
//              Чтобы узнать реальное имя: распарси wb.SheetNames из workbook.
//
// displayName — человекочитаемое название, которое пишется в поле category
//               таблицы status_history и отображается на фронтенде.
// ---------------------------------------------------------------------------
const SHEET_TABS: { sheetName: string; displayName: string }[] = [
  { sheetName: 'Стягачи',                 displayName: 'Стягачи'                },
  { sheetName: 'ДСТ  МС11 ',              displayName: 'ДСТ МС11'               },
  { sheetName: 'Самосвалы',               displayName: 'Самосвалы'              },
  { sheetName: 'АвтобусыБортовые МС11',   displayName: 'Автобусы/Бортовые МС11' },
  { sheetName: 'АБСАБН МС11',             displayName: 'АБС/АБН МС11'           },
  { sheetName: 'МС 11 Краны (новаяновая)',displayName: 'МС 11 Краны'            },
  { sheetName: 'Малая механизация МС11',  displayName: 'Малая механизация МС11' },
  { sheetName: 'Спецтехника МС11',        displayName: 'Спецтехника МС11'       },
];

// ---------------------------------------------------------------------------
// Определение статуса "в ремонте"
// ---------------------------------------------------------------------------
// NOT broken (вернёт false):  "исправен", "частично исправен", "требует ремонта"
// BROKEN     (вернёт true):   "неисправен", "ремонт", "авария", "не на ходу"
// DEFAULT:   false — неизвестный статус считается исправным
// ---------------------------------------------------------------------------
function isBroken(statusText: string): boolean {
  const st = statusText.trim().toLowerCase();
  if (['исправен', 'частично исправен', 'требует ремонта'].some(x => st.includes(x))) {
    return false;
  }
  if (['неисправен', 'ремонт', 'авария', 'не на ходу'].some(x => st.includes(x))) {
    return true;
  }
  return false;
}

function daysBetween(dateStart: string, today: string): number {
  const ms = new Date(today).getTime() - new Date(dateStart).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ---------------------------------------------------------------------------
// Скачивание xlsx через Google Drive API
// ---------------------------------------------------------------------------
// Файл хранится в Drive как нативный .xlsx, а НЕ как Google Sheets.
// Sheets API v4 возвращает ошибку 400 "failedPrecondition" для xlsx-файлов,
// поэтому используем Drive API (files.get + alt=media) — скачиваем бинарник.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Поиск строки заголовков внутри вкладки
// ---------------------------------------------------------------------------
// Вкладки начинаются с 1–2 строк-подзаголовков вида "Информация по тягачам на 27.02.26".
// Реальная строка с колонками "Гос. №" / "Тех. состояние" может быть на row 0–5.
// Сканируем первые 30 строк; сравнение регистронезависимо.
// ---------------------------------------------------------------------------
function findHeaderRow(rows: string[][]): { headerRowIdx: number; plateIdx: number; statusIdx: number } | null {
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const lower = rows[r].map(h => String(h).trim().toLowerCase());
    const plateIdx  = lower.findIndex(h => h === 'гос. №');
    const statusIdx = lower.findIndex(h => h.startsWith('тех.') && h.includes('состояние'));
    if (plateIdx !== -1 && statusIdx !== -1) {
      return { headerRowIdx: r, plateIdx, statusIdx };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------

export interface SyncResult {
  processed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Диагностика: анализ структуры xlsx без записи в БД
// ---------------------------------------------------------------------------
export interface TabDiagnostic {
  sheetName: string;
  displayName: string;
  found: boolean;
  totalRows: number;
  headerFound: boolean;
  headerRowIdx: number | null;
  headerColumns: string[];       // все заголовки найденной строки
  plateColIdx: number | null;
  statusColIdx: number | null;
  parsedRows: number;
  skippedEmpty: number;
  uniqueStatuses: string[];      // все уникальные значения статуса
  sampleRows: { plate: string; status: string; broken: boolean }[];
}

export interface DiagnosticResult {
  allSheetNames: string[];       // все вкладки в файле
  tabs: TabDiagnostic[];
  unmatchedSheets: string[];     // вкладки файла, не включённые в SHEET_TABS
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
        headerColumns: [],
        plateColIdx: null,
        statusColIdx: null,
        parsedRows: 0,
        skippedEmpty: 0,
        uniqueStatuses: [],
        sampleRows: [],
      });
      continue;
    }

    matchedSheets.add(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];

    const header = findHeaderRow(rows);
    const statuses = new Set<string>();
    const parsed: { plate: string; status: string; broken: boolean }[] = [];
    let skippedEmpty = 0;

    if (header) {
      const { headerRowIdx, plateIdx, statusIdx } = header;
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const plate = String(row[plateIdx] ?? '').trim().toUpperCase();
        const status = String(row[statusIdx] ?? '').trim();

        if (!plate || plate === '0' || plate === 'NAN' || plate === 'UNDEFINED') {
          skippedEmpty++;
          continue;
        }

        statuses.add(status || '(пусто)');
        parsed.push({ plate, status, broken: isBroken(status) });
      }
    }

    // Заголовки строки-шапки (для отладки)
    const headerColumns = header
      ? rows[header.headerRowIdx].map(h => String(h).trim()).filter(Boolean)
      : [];

    // Если заголовок не найден — покажем первые 5 строк для отладки
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
      headerColumns,
      plateColIdx: header?.plateIdx ?? null,
      statusColIdx: header?.statusIdx ?? null,
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
  const config  = getEnvConfig();
  // GOOGLE_CREDS_PATH задаётся относительно корня server/ (где лежит .env).
  // path.resolve с '../../' от __dirname (src/services/) даёт server/.
  const credsPath = path.resolve(__dirname, '../../', config.googleCredsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const today  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const errors: string[] = [];

  // Шаг 1: скачать файл один раз
  let xlsxBuffer: Buffer;
  try {
    xlsxBuffer = await downloadXlsx(config.googleSheetId, auth);
  } catch (err) {
    return { processed: 0, errors: [`Failed to download file: ${String(err)}`] };
  }

  const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });

  // Шаг 2: распарсить нужные вкладки
  interface VehicleRow {
    plate:       string;
    status:      string;
    broken:      boolean;
    displayName: string; // displayName из SHEET_TABS → поле category в БД
  }

  const vehicles: VehicleRow[] = [];

  for (const tab of SHEET_TABS) {
    // Ищем вкладку по sheetName, trim() с обеих сторон для надёжности
    const sheetName = workbook.SheetNames.find(n => n.trim() === tab.sheetName.trim());

    if (!sheetName) {
      errors.push(
        `Tab "${tab.sheetName}": not found. Available: ${workbook.SheetNames.join(', ')}`,
      );
      continue;
    }

    try {
      const sheet = workbook.Sheets[sheetName];
      const rows  = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });

      if (rows.length < 2) continue;

      const header = findHeaderRow(rows as string[][]);
      if (!header) {
        const preview = (rows[0] as string[]).filter(Boolean).join(', ');
        errors.push(`Tab "${tab.sheetName}": columns 'Гос. №' / 'Тех. состояние' not found. Row 0: ${preview}`);
        continue;
      }

      const { headerRowIdx, plateIdx, statusIdx } = header;

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row    = rows[i] as string[];
        const plate  = String(row[plateIdx]  ?? '').trim().toUpperCase();
        const status = String(row[statusIdx] ?? '').trim();

        // Пропускаем пустые строки и строки-разделители
        if (!plate || plate === '0' || plate === 'NAN' || plate === 'UNDEFINED') continue;

        vehicles.push({
          plate,
          status,
          broken:      isBroken(status),
          displayName: tab.displayName,
        });
      }
    } catch (err) {
      errors.push(`Tab "${tab.sheetName}": ${String(err)}`);
    }
  }

  // Шаг 3: upsert в БД
  // Алгоритм idempotent — безопасно запускать несколько раз в день:
  //   broken + нет открытой записи  → INSERT (date_start = today)
  //   broken + есть открытая запись → UPDATE days_in_repair + last_check_date
  //   исправен + есть открытая запись → закрыть (date_end = today)
  //   исправен + нет открытой записи → ничего
  const pool = getPool();

  for (const v of vehicles) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const open = await findOpenRepair(client, v.plate);

      if (v.broken) {
        if (!open) {
          await insertRepair(client, {
            plateNumber: v.plate,
            statusText:  v.status,
            today,
            category:    v.displayName,
          });
        } else {
          const days = daysBetween(open.dateStart, today);
          await updateRepairProgress(client, open.id, today, days, v.status);
        }
      } else if (open) {
        const days = daysBetween(open.dateStart, today);
        await closeRepair(client, open.id, today, days, v.status);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push(`Vehicle ${v.plate}: ${String(err)}`);
    } finally {
      client.release();
    }
  }

  return { processed: vehicles.length, errors };
}
