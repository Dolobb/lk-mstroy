# Pipeline — AI Reports

## Поток данных

```
Пользователь (фронтенд)
  │ useChat({ transport: { api: '/api/reports/chat' } })
  │ sendMessage({ text: "Сводка КИП за неделю" })
  │
  ▼
Vite Proxy
  │ /api/reports/* → http://localhost:3006
  │
  ▼
Express (POST /api/reports/chat)
  │ handler.ts → streamText()
  │
  ▼
Claude Haiku 4.5 (Anthropic API)
  │ Читает system prompt + tool definitions
  │ Решает какие tools вызвать
  │ Возвращает tool_use blocks
  │
  ▼
Tool execution (серверная сторона)
  │ queryKipData → PG16 SQL → результат
  │ queryDumpTruckData → PG17 SQL → результат
  │ generateXlsx → ExcelJS → файл на диске
  │
  ▼
Claude Haiku (продолжение)
  │ Получает результаты tools
  │ Формирует текстовый ответ с ссылкой на файл
  │
  ▼
SSE Stream → фронтенд
  │ pipeUIMessageStreamToResponse
  │ Текст стримится по частям
  │
  ▼
Пользователь видит ответ + кнопку "Скачать отчёт"
  │ GET /api/reports/files/:id → XLSX
```

## Endpoint'ы

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/reports/chat` | SSE streaming чат |
| GET | `/api/reports/files/:id` | Скачивание XLSX |
| GET | `/api/reports/health` | Health check |

## Стриминг

Протокол: **UI Message Stream** (SSE) — стандарт Vercel AI SDK v6.

Фронтенд использует `useChat()` из `@ai-sdk/react` который автоматически:
- Отправляет messages array
- Парсит SSE события
- Обновляет состояние сообщений
- Обрабатывает tool-call events

## Prompt Caching

System prompt + tool definitions кешируются Anthropic API:
- Первый запрос: полная стоимость
- Повторные запросы (в течение 5 мин): 90% экономия
- Минимум для кеша: 4096 токенов (наш system prompt + 8 tools превышают)
