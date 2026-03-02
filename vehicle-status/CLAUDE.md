# CLAUDE.md — Состояние ТС (vehicle-status/)

## Команды

```bash
cd vehicle-status/server/
npm run dev           # Express :3004

# Ручная синхронизация
curl -X POST "http://localhost:3004/api/vs/sync"

# PostgreSQL
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy -c "SELECT plate_number, status_text, is_repairing FROM vehicle_status.status_history LIMIT 10;"
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `server/src/services/sheetsSyncService.ts` | **ГЛАВНЫЙ**: Drive API → SheetJS → upsert. Содержит `SHEET_TABS`, `isBroken()`, `findHeaderRow()` |
| `server/src/repositories/vehicleStatusRepo.ts` | SQL upsert в `vehicle_status.status_history` |
| `server/src/index.ts` | Express routes: `/api/vs/sync`, `/api/vs/vehicle-status` |
| `server/creds.json` | Google Service Account — **в .gitignore, не коммитить** |

## ⚠️ Gotchas

**Drive API, НЕ Sheets API**: файл в Drive — нативный `.xlsx`. Sheets API возвращает `400 failedPrecondition` для `.xlsx`. Используется `drive.files.get` + `alt=media`.

**`creds.json`**: Service Account ключ в `vehicle-status/server/creds.json`. **Никогда не коммитить.** Файл должен быть расшарен на `client_email` из creds.json.

**`isBroken()` логика**: `"требует ремонта"` → `false` (машина работает, плановое ТО). `"неисправен"`, `"ремонт"`, `"авария"` → `true`. Пустой/неизвестный → `false` по умолчанию.

**Excel удаляет `/` из имён вкладок**: `sheetName` в `SHEET_TABS` должен быть без слешей. `displayName` может содержать слеши.

**`findHeaderRow()`**: ищет строку «Гос. №» / «Тех. состояние» в первых 30 строках с `trim()`. Если колонки смещены или переименованы — данные не распознаются.

**DB_USER=max**: не `postgres`! Указывать явно в `.env`.

## База данных

PG17 `:5433`, база `mstroy`, схема `vehicle_status`, таблица `status_history`:
- `plate_number` — UPPER (нормализуется при upsert)
- `is_repairing` — вычисляется через `isBroken()`
- `category` — берётся из `displayName` вкладки

## Переменные окружения

```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=mstroy
DB_USER=max
GOOGLE_CREDS_PATH=creds.json      # относительно server/
GOOGLE_FILE_ID=<id из URL Drive>
```

## Фронтенд

`frontend/src/features/vehicle-status/VehicleStatusPage.tsx`
Роут: `/vehicle-status` | Vite proxy: `/api/vs` → `:3004`

## Документация

- `docs/PIPELINE.md` — полный flow Drive → БД, `isBroken()`, SHEET_TABS
- `docs/FRONTEND.md` — компоненты, фильтры, таблица
- `docs/HISTORY.md` — что реализовано, ограничения
- `docs/DEVGUIDE.md` — endpoints, добавление вкладок, отладка
