# History — AI Reports

## 2026-03-24 — Инициализация проекта

### Создано
- Бэкенд скелет: Express :3006, конфиг, подключения к PG16/PG17/SQLite
- 8 tool definitions для Claude (КИП, самосвалы, рейсы, тягачи, гео, ремонты, реестр ТС, генерация XLSX)
- Chat handler: Vercel AI SDK v6, streamText + pipeUIMessageStreamToResponse
- System prompt с описанием всех данных и правилами
- Фронтенд чат-интерфейс: AiReportsPage, ChatMessage, ChatInput
- Интеграция в монорепо: vite proxy, admin авто-запуск, роут /reports, навигация
- Документация: CLAUDE.md, PIPELINE.md, FRONTEND.md, DEVGUIDE.md

### Текущий статус
- Сервер запускается и отвечает на health check
- Фронтенд компилируется без ошибок
- Tools содержат реальные SQL-запросы для PG17 (самосвалы, ремонты, гео)
- Tools для PG16 (КИП) и SQLite (тягачи) — нужна верификация схем таблиц
- **ANTHROPIC_API_KEY** — placeholder, нужен реальный ключ для работы

### Ограничения
- Реестр ТС (queryVehicleRegistry) — временная реализация, собирает из shift_records
- Тягачи (queryTyagachiData) — не верифицированы имена таблиц в archive.db
- КИП (queryKipData) — не верифицированы имена таблиц в kip_vehicles
- Фронтенд-вычисления (агрегаты, средние, плановые рейсы) — остаются на фронте, не перенесены в tools
- XLSX шаблоны — ещё не реализованы (Claude генерирует структуру динамически)
