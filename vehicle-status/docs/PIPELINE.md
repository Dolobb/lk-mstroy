# Vehicle Status — Pipeline Reference

## Схема: Google Drive → SheetsSyncService → PostgreSQL → API → UI

```
Google Drive (.xlsx)
    ↓ Drive API files.get (alt=media)
    ↓ Service Account JWT (creds.json)
SheetsSyncService (sheetsSyncService.ts)
    ↓ SheetJS — парсинг в памяти
    ↓ поиск 8 вкладок по sheetName
    ↓ findHeaderRow() — поиск строки «Гос. №» / «Тех. состояние»
    ↓ isBroken() — определение статуса
    ↓ транзакционный upsert
PostgreSQL (vehicle_status.status_history)
    ↓ vehicleStatusRepo.queryAll()
Express API (:3004)
    ↓ GET /api/vs/vehicle-status
    ↓ Vite proxy /api/vs → :3004
React UI (VehicleStatusPage)
```

---

## 1. Источник данных

- Файл в Google Drive: нативный `.xlsx` (НЕ Google Sheets)
- Метод доступа: **Drive API** `files.get` + `alt=media` — скачивает бинарный файл целиком
- Причина не использовать Sheets API: он возвращает `400 failedPrecondition` для `.xlsx`-файлов
- Авторизация: Service Account JWT
- Scope: `https://www.googleapis.com/auth/drive.readonly`
- Файл `creds.json`: `vehicle-status/server/creds.json` (в `.gitignore`, не коммитить)
- Переменная окружения: `GOOGLE_CREDS_PATH=creds.json` (путь относительно `server/`)
- ID файла: `GOOGLE_SHEET_ID` — берётся из URL файла в Drive: `/d/{ID}/edit`
- Требование к Drive: файл должен быть расшарен на `client_email` из `creds.json` с правами «Читатель»

---

## 2. Вкладки Excel

Файл содержит ~35 вкладок, сервис читает 8. Конфигурация в константе `SHEET_TABS` в
`vehicle-status/server/src/services/sheetsSyncService.ts`.

Важная особенность: Excel при сохранении **удаляет символ `/`** из имён вкладок.
Поэтому `sheetName` (реальное имя в файле) отличается от `displayName` (читаемое название).

| sheetName (в файле)              | displayName (в БД и UI)       |
|----------------------------------|-------------------------------|
| `Стягачи`                        | Стягачи                       |
| `ДСТ  МС11 ` (два пробела, пробел в конце) | ДСТ МС11              |
| `Самосвалы`                      | Самосвалы                     |
| `АвтобусыБортовые МС11`          | Автобусы/Бортовые МС11        |
| `АБСАБН МС11`                    | АБС/АБН МС11                  |
| `МС 11 Краны (новаяновая)`       | МС 11 Краны                   |
| `Малая механизация МС11`         | Малая механизация МС11        |
| `Спецтехника МС11`               | Спецтехника МС11              |

Поиск вкладки выполняется с `trim()` с обеих сторон: `n.trim() === tab.sheetName.trim()`.

---

## 3. Синхронизация (sheetsSyncService.ts → runSync())

Функция `runSync()` выполняется в три шага:

### Шаг 1: Скачивание файла

```typescript
async function downloadXlsx(fileId, auth): Promise<Buffer>
```

- Создаёт Drive API клиент с JWT-авторизацией
- `drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })`
- Возвращает `Buffer`; при ошибке `runSync` немедленно возвращает `{ processed: 0, errors: [...] }`

### Шаг 2: Парсинг вкладок

`XLSX.read(buffer, { type: 'buffer' })` — SheetJS читает workbook в памяти.

Для каждой из 8 вкладок:
1. Поиск вкладки по `sheetName` (с trim).
2. `sheet_to_json(..., { header: 1, defval: '' })` — массив массивов строк.
3. `findHeaderRow(rows)` — сканирует первые 30 строк, ищет колонки `гос. №` и `тех.*состояние` (регистронезависимо).
4. Итерация строк начиная с `headerRowIdx + 1`.
5. Пропуск пустых строк: `plate` пустой, `'0'`, `'NAN'`, `'UNDEFINED'`.
6. `plate` приводится к UPPER, `isBroken(status)` определяет статус.

### isBroken(statusText): boolean

```
false (не сломан): строка содержит «исправен», «частично исправен» или «требует ремонта»
true  (сломан):    строка содержит «неисправен», «ремонт», «авария» или «не на ходу»
false (default):   неизвестный/пустой статус = считается исправным
```

Важно: «требует ремонта» = исправен (плановое ТО, машина работает).

### Шаг 3: Upsert в БД (idempotent)

Для каждого ТС — транзакция (`BEGIN` / `COMMIT` / `ROLLBACK`):

```
broken=true  + нет открытой записи  →  INSERT (date_start = today)
broken=true  + есть открытая запись →  UPDATE days_in_repair, last_check_date, status_text
broken=false + есть открытая запись →  UPDATE date_end=today, is_repairing=false, days_in_repair
broken=false + нет открытой записи  →  (пропустить — машина исправна, нечего записывать)
```

«Открытая запись» = строка с `date_end IS NULL` для данного `plate_number`.

`daysBetween(dateStart, today)` = `Math.floor((today - dateStart) / 86_400_000)`.

### Результат

`runSync()` возвращает `SyncResult`:

```typescript
interface SyncResult {
  processed: number; // количество обработанных строк ТС
  errors:    string[]; // нефатальные ошибки (не прервали sync)
}
```

---

## 4. База данных

- Схема: `vehicle_status` в БД `mstroy` (PostgreSQL 17, порт 5433)
- Пользователь: `max`
- Таблица: `vehicle_status.status_history`
- Миграция: `vehicle-status/server/migrations/001_vehicle_status.sql`

### Схема таблицы status_history

```sql
id              SERIAL PRIMARY KEY
plate_number    TEXT NOT NULL          -- Гос. номер, всегда UPPER
status_text     TEXT                   -- Текст тех. состояния из Excel
is_repairing    BOOLEAN DEFAULT FALSE  -- true = ремонт ещё не закрыт
date_start      DATE NOT NULL          -- Дата первой фиксации поломки
date_end        DATE                   -- NULL пока в ремонте
days_in_repair  INTEGER DEFAULT 0      -- Кол-во дней ремонта (date_end или today − date_start)
category        TEXT                   -- displayName вкладки (тип техники)
last_check_date DATE                   -- Дата последнего успешного sync
```

### Индексы

| Имя индекса | Колонка |
|------------|---------|
| `idx_vsh_plate` | `plate_number` |
| `idx_vsh_repair` | `is_repairing` |
| `idx_vsh_date` | `last_check_date` |

### Семантика данных

- Одна машина может иметь **несколько строк** — каждый период ремонта = отдельная запись.
- Открытый ремонт = `date_end IS NULL`.
- История появляется только начиная с первого запуска сервиса (Drive хранит 3 ревизии,
  ретроспективный импорт невозможен).
- Тип `DATE` возвращается из pg как строка `YYYY-MM-DD` (переопределён через `pg.types.setTypeParser(1082, ...)`).

---

## 5. HTTP API (vehicle-status/server/src/index.ts)

| Метод | URL | Параметры | Ответ |
|-------|-----|-----------|-------|
| `GET` | `/api/vs/health` | — | `{ status: 'ok', service: 'vehicle-status', time: ISO }` |
| `GET` | `/api/vs/vehicle-status` | `?isRepairing=true\|false`, `?category=...` | `{ data: StatusRecord[], total: N }` |
| `POST` | `/api/vs/vehicle-status/sync` | — | `{ status: 'started' }` (асинхронно) |
| `GET` | `/api/vs/vehicle-status/sync-status` | — | `{ lastSync: ISO\|null, lastResult: SyncResult\|null, inProgress: bool }` |

Sync state (`lastSync`, `lastResult`, `syncInProgress`) хранится **в памяти процесса** и сбрасывается при рестарте.

Сортировка в `queryAll`: `is_repairing DESC, last_check_date DESC NULLS LAST, plate_number`.

---

## 6. Привязка полей: БД → API → UI

| Поле БД (`status_history`) | Поле API (`StatusRecord`) | Колонка таблицы в UI |
|----------------------------|--------------------------|----------------------|
| `plate_number` | `plateNumber` | Гос. № |
| `category` | `category` | Категория |
| `status_text` | `statusText` | Тех. состояние |
| `is_repairing` | `isRepairing` | Статус (бейдж «В ремонте» / «Исправен») |
| `date_start` | `dateStart` | Начало |
| `date_end` | `dateEnd` | Конец |
| `days_in_repair` | `daysInRepair` | Дней |
| `last_check_date` | `lastCheckDate` | Проверка |
