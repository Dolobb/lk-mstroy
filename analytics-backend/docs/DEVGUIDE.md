# Analytics Backend — Dev Guide

## Запуск

```bash
cd analytics-backend/server
npm install
npm run migrate    # Применить миграции БД
npm run dev        # tsx watch на :3007
```

## Требования

- Node.js 18+
- PostgreSQL 17 (Windows: порт 5432, БД `mstroy`, пользователь `max`)
- Доступ к PostgreSQL 16 (БД `kip_vehicles`, read-only)
- TIS API токены в `.env`

## Конфигурация

Скопировать `.env.example` → `.env` и заполнить:
- `TIS_API_URL` — URL TIS API
- `TIS_API_TOKENS` — токены через запятую (18 токенов)
- Пароли БД (`DB_PASSWORD`, `KIP_DB_PASSWORD`)

## Структура

```
analytics-backend/server/
├── package.json
├── tsconfig.json
├── .env.example
├── migrations/
│   ├── run-migrations.ts
│   ├── 001_schema_analytics.sql
│   ├── 002_track_sessions.sql
│   └── 003_track_points.sql
├── src/
│   ├── index.ts              — Express app, entry point
│   ├── db.ts                 — PG pools (mstroy + kip_vehicles)
│   ├── services/
│   │   ├── tisClient.ts      — TIS API клиент
│   │   ├── tokenPool.ts      — Round-robin пул токенов
│   │   ├── rateLimiter.ts     — Per-vehicle rate limiter
│   │   ├── jobController.ts   — Abort/cancel helpers
│   │   └── kipReader.ts      — KIP БД read-only клиент
│   ├── types/
│   │   └── tis-api.ts        — TIS API типы
│   └── utils/
│       ├── logger.ts         — Структурированный логгер
│       └── dateFormat.ts     — Форматирование дат
└── dist/                     — Скомпилированный output
```

## Добавление новых эндпоинтов

1. Создать роутер/хендлер в `src/routes/` (создать директорию)
2. Подключить в `src/index.ts`
3. Обновить `PIPELINE.md`

## Добавление миграций

1. Создать SQL-файл с номером (напр. `004_new_table.sql`)
2. Добавить в массив `MIGRATIONS` в `run-migrations.ts`
3. Запустить `npm run migrate`

## Линтинг

```bash
npm run lint        # tsc --noEmit
```
