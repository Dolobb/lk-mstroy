# DevGuide — AI Reports

## Запуск

```bash
# Из корня монорепо (авто-запуск через admin)
npm run dev

# Или отдельно
cd ai-reports/server && npm run dev
```

Сервер: http://localhost:3006
Health: http://localhost:3006/api/reports/health

## Конфигурация (.env)

```env
ANTHROPIC_API_KEY=sk-ant-...    # Обязательно
PG16_HOST=localhost              # КИП БД
PG16_PORT=5432
PG16_DATABASE=kip_vehicles
PG17_HOST=localhost              # Самосвалы/Гео/Ремонт БД
PG17_PORT=5433
PG17_DATABASE=mstroy
PG17_USER=max
SQLITE_PATH=../../tyagachi/archive.db
PORT=3006
```

## Добавить новый tool (источник данных)

### 1. Создать файл tool

```typescript
// server/src/chat/tools/my-tool.ts
import { tool } from 'ai';
import { z } from 'zod';

export const myTool = tool({
  description: 'Описание для Claude — что возвращает, из какой БД',
  inputSchema: z.object({
    dateFrom: z.string().describe('Начало периода, формат YYYY-MM-DD'),
    // ... параметры
  }),
  execute: async ({ dateFrom }) => {
    // SQL-запрос или другая логика
    return { success: true, data: [] };
  },
});
```

### 2. Зарегистрировать

```typescript
// server/src/chat/tools/index.ts
export { myTool } from './my-tool';

// server/src/chat/handler.ts — добавить в tools: {}
tools: {
  // ... существующие
  myTool,
},
```

### 3. Описать в system prompt

```typescript
// server/src/chat/system-prompt.ts
// Добавить раздел с описанием данных
```

### 4. Обновить CLAUDE.md

Добавить tool в таблицу tools.

## Добавить XLSX-шаблон

```typescript
// server/src/xlsx/templates/my-template.ts
import ExcelJS from 'exceljs';

export async function buildMyReport(data: any[], workbook: ExcelJS.Workbook) {
  const ws = workbook.addWorksheet('Отчёт');
  // ... ExcelJS API
}
```

Claude может вызвать `generateXlsx` с произвольной структурой, или можно добавить отдельный tool для конкретного шаблона.

## Сменить модель

В `handler.ts`:
```typescript
model: anthropic('claude-haiku-4-5-20251001'),  // текущая
model: anthropic('claude-sonnet-4-5-20250514'),  // дороже, умнее
```

## Стек

| Компонент | Пакет | Версия |
|-----------|-------|--------|
| AI Framework | `ai` | v6 |
| Anthropic Provider | `@ai-sdk/anthropic` | v3 |
| XLSX | `exceljs` | v4 |
| Express | `express` | v4 |
| PostgreSQL | `pg` | v8 |
| SQLite | `sql.js` | v1 |
| TypeScript | `typescript` | v5 |
| Dev runner | `tsx` | v4 |
