# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Analytics Backend — сервис аналитики треков и геопозиций для ЛК Мстрой. Порт 3007. PG17 (`mstroy`, схема `analytics`) + read-only PG16 (`kip_vehicles`).

## Commands

```bash
cd analytics-backend/server
npm install
npm run migrate
npm run dev            # tsx watch на :3007
npm run lint           # tsc --noEmit
```

## Architecture

Express + TypeScript. Два PG pool (Windows: оба `max` на :5432):
- `getPool()` — `mstroy` (PG17)
- `getKipPool()` — `kip_vehicles` (PG16)

## Key Files

| Файл | Назначение |
|------|-----------|
| `src/index.ts` | Express app, entry point |
| `src/db.ts` | PG pools |
| `src/services/tisClient.ts` | TIS API клиент с PerTokenRateLimiter |
| `src/services/tisClientFactory.ts` | Singleton из .env |
| `src/services/trackSimplifier.ts` | ≤5мин/<50м пропуск, ignitionWork engineOn |
| `src/services/dwellExtractor.ts` | Кластеры 50м/>5мин→dwell, centroid, max 2h gap |
| `src/services/dtTrackReader.ts` | Читает треки самосвалов из dump_trucks.dt_tracks |
| `src/services/dstRegistry.ts` | Активные ТС из kip_vehicles (TTL 1ч) |
| `src/jobs/analyticsFetchJob.ts` | Pipeline: mapConcurrent(18) |
| `src/jobs/retentionJob.ts` | DELETE >7 дней (CASCADE) |
| `src/routes/tracks.ts` | GET /api/analytics/tracks — per-day EXISTS + склейка |
| `src/routes/admin.ts` | POST /api/analytics/admin/fetch + /status |
| `src/utils/trackParser.ts` | TisTrackPoint[] → ParsedTrackPoint[] |
| `src/utils/geo.ts` | haversine |
| `../admin/server.ts` | SERVICES entry + ANALYTICS_CRON_SCHEDULE + pg-boss worker |
| `../frontend/vite.config.ts` | Proxy `/api/analytics` → `:3007` |

## TIS API

- POST с пустым телом, все параметры в query string
- `getMonitoringStats` даты: `DD.MM.YYYY HH:mm`
- Rate limit: 1 req/30s **per (token, idMO)** pair
- `PerTokenRateLimiter` отслеживает `token|idMO` → lastCallTime
- 18 токенов round-robin, `mapConcurrent(18)` в pipeline

## Live vs DB routing

- `GET /api/analytics/tracks` → проверяет покрытие per-day через `EXISTS`
- Покрытые дни → из БД
- Непокрытые дни → live TIS → cache → мёрдж с DB
- Live-cache: DELETE старых точек перед вставкой новой версии

## Gotchas

- **NUMERIC → string**: PG возвращает NUMERIC как строку, оборачивать `Number()`
- **Shift NOT NULL**: 'full' (pipeline), 'live' (on-demand) — PG UNIQUE требует not-null
- **EngineOn**: ignitionWork (TIS) → speed>0 → neighbor check (2min window) → false
- **Dwell: avg centroid** (не midpoint), max 2h temporal gap
- **Retention**: стартовый вызов + cron в Сессии 4
- **Dump truck tracks**: читаем `dump_trucks.dt_tracks` — упрощённые треки сохраняются dump-trucks pipeline при каждом run, analytics-backend только читает
