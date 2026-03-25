# CLAUDE.md — AI Reports (ai-reports/)

## Команды

```bash
cd ai-reports/server/
npm run dev     # tsx watch :3006
npm run build   # tsc
```

## Архитектура

Сервис AI-генерации отчётов. Пользователь описывает текстом → Claude Haiku вызывает tools → данные из БД → ExcelJS → XLSX.

```
POST /api/reports/chat   — SSE streaming (Vercel AI SDK v6)
GET  /api/reports/files/:id — скачивание XLSX
GET  /api/reports/health  — health check
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `server/src/index.ts` | Express сервер :3006 |
| `server/src/chat/handler.ts` | streamText + pipeUIMessageStreamToResponse |
| `server/src/chat/system-prompt.ts` | System prompt для Claude |
| `server/src/chat/tools/*.ts` | Tool definitions (8 tools) |
| `server/src/db/` | Подключения к PG16, PG17, SQLite |
| `server/src/xlsx/` | ExcelJS обёртки и шаблоны |
| `server/.env` | ANTHROPIC_API_KEY, DB connections |

## Tools (функции для Claude)

| Tool | Источник | Что возвращает |
|------|----------|---------------|
| `queryKipData` | PG16 `kip_vehicles` | КИП%, загрузка%, расход, моточасы |
| `queryDumpTruckData` | PG17 `dump_trucks.shift_records` | Смены: рейсы, КИП, движение, dwell |
| `queryDumpTruckTrips` | PG17 `dump_trucks.trips` | Детализация рейсов + зоны |
| `queryTyagachiData` | SQLite `archive.db` | Заявки, ПЛ, маршруты |
| `queryGeoData` | PG17 `geo.*` | Объекты, зоны |
| `queryRepairs` | PG17 `dump_trucks.repairs` | Ремонты, ТО |
| `queryVehicleRegistry` | PG17 | Реестр ТС |
| `generateXlsx` | ExcelJS | Генерация XLSX файла |

## Стек

- **AI:** Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic`) + Claude Haiku 4.5
- **XLSX:** ExcelJS
- **Streaming:** SSE через `pipeUIMessageStreamToResponse`
- **Frontend:** `useChat` из `@ai-sdk/react` + shadcn/ui

## Добавить новый tool

1. Создать файл в `server/src/chat/tools/`
2. Экспортировать из `tools/index.ts`
3. Добавить в `handler.ts` → объект `tools`
4. Описать в system-prompt.ts (что за данные, формат)

## ⚠️ Gotchas

- **ANTHROPIC_API_KEY** в `.env` — без него chat endpoint вернёт 500
- **PG17 user = `max`** (не `postgres`)
- **AI SDK v6:** `inputSchema` (не `parameters`), `stopWhen: stepCountIs(N)` (не `maxSteps`)
- **NUMERIC из PostgreSQL → string в JS** — оборачивать `Number()`
- **tsc OOM:** `npx tsc --noEmit` падает из-за тяжёлых типов AI SDK v6. Это нормально — tsx/runtime работает. Для проверки типов: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` или проверяйте через IDE

## Документация

- `docs/PIPELINE.md` — поток данных
- `docs/FRONTEND.md` — чат-компоненты
- `docs/HISTORY.md` — что реализовано
- `docs/DEVGUIDE.md` — расширение, добавление tools
