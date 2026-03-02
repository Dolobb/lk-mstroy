> Устарел — актуальная документация в `vehicle-status/docs/`

---

# vehicle-status — Состояние техники

Микросервис читает Excel-файл "Диспозиция техники" из Google Drive,
извлекает статус каждой машины и строит историю ремонтов в PostgreSQL.

---

## Структура

```
vehicle-status/
└── server/
    ├── creds.json              ← Google service account (в .gitignore, не коммитить)
    ├── .env                    ← конфигурация
    ├── package.json
    ├── tsconfig.json
    ├── migrations/
    │   └── 001_vehicle_status.sql
    └── src/
        ├── index.ts            ← Express :3004, HTTP endpoints
        ├── migrate.ts          ← CLI: npm run migrate
        ├── config/
        │   ├── env.ts          ← переменные окружения (синглтон)
        │   └── database.ts     ← PostgreSQL pool (синглтон)
        ├── services/
        │   └── sheetsSyncService.ts  ← вся логика: скачать → распарсить → upsert
        └── repositories/
            └── vehicleStatusRepo.ts  ← SQL-запросы к vehicle_status.status_history
```

---

## Как запустить

```bash
cd vehicle-status/server
npm install
npm run migrate   # создать схему vehicle_status + таблицу status_history
npm run dev       # сервер на :3004
```

---

## Переменные окружения (.env)

| Переменная          | Значение по умолчанию | Описание |
|---------------------|-----------------------|----------|
| `GOOGLE_CREDS_PATH` | —                     | Путь к creds.json **относительно корня server/**. Обычно просто `creds.json` |
| `GOOGLE_SHEET_ID`   | —                     | ID файла в Google Drive (из URL: `/d/{ID}/edit`) |
| `DB_HOST`           | localhost             | |
| `DB_PORT`           | 5433                  | PostgreSQL 17 (не 5432!) |
| `DB_NAME`           | mstroy                | |
| `DB_USER`           | max                   | |
| `DB_PASSWORD`       | —                     | |
| `VS_SERVER_PORT`    | 3004                  | |

---

## Google Drive API — почему не Sheets API

Файл хранится в Google Drive в формате **нативного Excel (.xlsx)**, а не как
Google Sheets. Sheets API v4 возвращает ошибку `400 failedPrecondition` при
попытке обратиться к xlsx-файлу — он не поддерживает этот тип документа.

**Решение:** Drive API (`files.get` + `alt=media`) скачивает сырой бинарный
xlsx одним запросом. Затем SheetJS (`xlsx` пакет) парсит его в памяти.

**Scope:** `https://www.googleapis.com/auth/drive.readonly`

**Аутентификация:** Service Account JWT из `creds.json`. Файл в Drive должен
быть расшарен на email сервисного аккаунта (поле `client_email` в creds.json)
с правами "Читатель".

---

## Структура Excel-файла

Файл содержит ~35 вкладок. Нас интересуют 8 — по типам техники.

### Имена вкладок (важная особенность)

Excel при сохранении **удаляет символ `/`** из имён вкладок. Поэтому реальное
имя в файле отличается от отображаемого названия:

| Реальное имя в файле         | Отображаемое название (category в БД) |
|------------------------------|---------------------------------------|
| `Стягачи`                    | Стягачи                               |
| `ДСТ  МС11 `                 | ДСТ МС11                              |
| `Самосвалы`                  | Самосвалы                             |
| `АвтобусыБортовые МС11`      | Автобусы/Бортовые МС11                |
| `АБСАБН МС11`                | АБС/АБН МС11                          |
| `МС 11 Краны (новаяновая)`   | МС 11 Краны                           |
| `Малая механизация МС11`     | Малая механизация МС11                |
| `Спецтехника МС11`           | Спецтехника МС11                      |

Оба имени хранятся в `SHEET_TABS` в `sheetsSyncService.ts`:
```typescript
{ sheetName: 'АвтобусыБортовые МС11', displayName: 'Автобусы/Бортовые МС11' }
```

Если структура файла изменится (переименуют вкладку) — обновить `sheetName`.
Как найти реальное имя: запустить sync, в ошибке будет `Available: ...`.

### Строка заголовков

Каждая вкладка начинается с 1–3 строк подзаголовка вида:
```
Информация по тягачам АО «Мостострой-11» на 27.02.26
```
Реальная строка с колонками `Гос. №` / `Тех. состояние` может быть на row 1–5.
Код сканирует первые 30 строк; сравнение регистронезависимо (учитывает
варианты `Тех. Состояние` и `Тех. состояние`).

---

## Логика isBroken

```
NOT broken → false:  содержит "исправен" | "частично исправен" | "требует ремонта"
BROKEN     → true:   содержит "неисправен" | "ремонт" | "авария" | "не на ходу"
DEFAULT    → false   (неизвестный/пустой статус = исправен)
```

Обратите внимание: **"требует ремонта" = исправен** (машина работает, просто
нужно плановое ТО). Ремонт фиксируется только при полной неисправности.

---

## Схема БД: `vehicle_status.status_history`

```sql
id              SERIAL PRIMARY KEY
plate_number    TEXT NOT NULL          -- Гос. номер, всегда UPPER
status_text     TEXT                   -- Последнее тех. состояние из таблицы
is_repairing    BOOLEAN DEFAULT FALSE  -- true = ремонт ещё не закрыт
date_start      DATE NOT NULL          -- Дата первой фиксации поломки
date_end        DATE                   -- NULL пока в ремонте
days_in_repair  INTEGER DEFAULT 0      -- date_end (или today) − date_start
category        TEXT                   -- displayName вкладки (тип техники)
last_check_date DATE                   -- Дата последнего успешного sync
```

Индексы: `plate_number`, `is_repairing`, `last_check_date`.

Одна машина может иметь **несколько строк** — каждый отдельный период ремонта
это новая запись. Открытый ремонт = `date_end IS NULL`.

---

## Алгоритм sync (idempotent)

Запускается через `POST /api/vs/vehicle-status/sync`.
Безопасно запускать несколько раз в день — дубликатов не создаёт.

```
Для каждой машины из xlsx:

  broken=true  + нет открытой записи  →  INSERT (date_start = today)
  broken=true  + есть открытая запись →  UPDATE days_in_repair, last_check_date
  broken=false + есть открытая запись →  UPDATE date_end=today, is_repairing=false
  broken=false + нет открытой записи  →  (пропустить, машина исправна)
```

**Важно про историю:** история появляется только начиная с первого запуска
сервиса. Google Drive хранит всего 3 ревизии файла за всё время (март 2024,
июнь 2024, сегодня) — ретроспективный импорт невозможен.

---

## HTTP API

```
GET  /api/vs/health
     → { status: 'ok', service: 'vehicle-status', time: '...' }

GET  /api/vs/vehicle-status
     ?isRepairing=true          фильтр: только в ремонте
     &category=ДСТ%20МС11       фильтр: по типу техники
     → { data: StatusRecord[], total: N }

POST /api/vs/vehicle-status/sync
     → { status: 'started' }    (запуск асинхронный, не ждёт завершения)

GET  /api/vs/vehicle-status/sync-status
     → { lastSync: ISO|null, lastResult: { processed, errors }, inProgress: bool }
```

`lastSync` и `lastResult` хранятся **в памяти процесса** и сбрасываются при
перезапуске. Для MVP этого достаточно.

---

## Как добавить новую вкладку

1. Запустить sync — в ошибке будет список всех вкладок файла (`Available: ...`)
2. Найти нужную, скопировать точное имя (с пробелами и без слешей)
3. Добавить в `SHEET_TABS` в `sheetsSyncService.ts`:
   ```typescript
   { sheetName: 'ИмяВФайле', displayName: 'Читаемое название' }
   ```
4. Добавить `displayName` в массив `CATEGORIES` в `VehicleStatusPage.tsx`
   (для фильтра на фронтенде)
5. Убедиться, что в вкладке есть колонки `Гос. №` и `Тех. состояние`

---

## Известные ограничения

- **Нет автосинхронизации** — нужно нажать кнопку в UI или POST вручную.
  Для production добавить `node-cron` в `index.ts` (запуск каждый день в 09:00).
- **Нет ретроспективы** — Drive хранит 3 ревизии, восстановить прошлое нельзя.
- **Состояние sync в памяти** — `lastSync`/`lastResult` сбрасываются при рестарте.
- **Файл скачивается целиком** при каждом sync (~несколько МБ).
  Для больших файлов это норма, кешировать не нужно.
