# Отчёт по задачам A, B, C — GLM

## ЗАДАЧА A: Pipeline Runs — ветка `agent/glm/feat-pipeline-runs`
**Коммит:** `f9f8362`

| Компонент | Файл | Статус |
|-----------|------|--------|
| Миграция | `admin/migrations/001_pipeline_runs.sql` | Создана (таблица уже в БД) |
| Repository | `admin/src/repositories/pipelineRunRepo.ts` | 7 методов, использует mainPool |
| API: start | `POST /api/admin/pipeline-runs/start → { runId }` | Добавлен |
| API: complete | `POST /api/admin/pipeline-runs/:id/complete → { ok }` | Добавлен |
| API: fail | `POST /api/admin/pipeline-runs/:id/fail → { ok }` | Добавлен |
| API: errors | `POST /api/admin/pipeline-runs/:id/errors → { ok }` | Добавлен |
| API: last-success | `GET /api/admin/pipeline-runs/last-success` | Добавлен |
| API: list | `GET /api/admin/pipeline-runs` | Был от Opus |
| API: health | `GET /api/admin/pipeline-health` | Был от Opus |
| tsconfig | `admin/tsconfig.json` → `src/**/*.ts` | Обновлён |

**Критерий приёмки:** `psql -d mstroy -c "SELECT * FROM pipeline_runs LIMIT 1"` — таблица существует, `tsc --noEmit` = OK ✅

---

## ЗАДАЧА B: KIP Zone Migration — ветка `agent/glm/feat-kip-zones-from-db`
**Коммит:** `356510c`

| Компонент | Файл | Статус |
|-----------|------|--------|
| getMainPool() | `kip/server/src/config/database.ts` | MAIN_DB_* env vars, fallbacks |
| loadZonesFromDb() | `geozoneAnalyzer.ts` | SQL: geo.zones + geo.objects + geo.zone_tags |
| **Исправлен SQL JOIN** | `o.id = z.object_id`, `zt.zone_id = z.id` | Было неправильно у Opus |
| invalidateCache() | `geozoneAnalyzer.ts` | Экспортирован |
| preloadZones() | `geozoneAnalyzer.ts` | Вызывается при старте сервера |
| getFilteredGeozonesGeoJsonAsync() | `geozoneAnalyzer.ts` | Для /api/geozones |
| POST /api/admin/invalidate-zones | `index.ts` | Для admin cascade |

**Критерий приёмки:** SQL `SELECT COUNT(*) FROM geo.zones...WHERE tag='dst_zone'` = 291 зон, `tsc --noEmit` = OK ✅

**Важный фикс:** Opus использовал `o.uid = z.object_uid` и `zt.zone_uid = z.uid` — это неверно. Схема БД: `z.object_id` (FK → `o.id`), `zt.zone_id` (FK → `z.id`). Исправлено на корректные JOIN-ы.

---

## ЗАДАЧА C: Enhanced Coverage — ветка `agent/glm/feat-enhanced-coverage`
**Коммит:** `46bc201`

| Компонент | Файл | Статус |
|-----------|------|--------|
| Типы | `admin/src/types.ts` | DayDetailedCoverage, DtShiftCoverage, PipelineHealthCard |
| data-coverage/detailed | `admin/server.ts` | Был от Opus, проверен |
| is_gap_filled fix | `admin/server.ts:462,1607` | Был от Opus, проверен |
| DB Viewer preset | `admin/server.ts` | Добавлен pipeline_runs |

**Критерий приёмки:** `curl "localhost:3005/api/admin/data-coverage/detailed?from=2026-04-01&to=2026-04-14"` — endpoint существует, `tsc --noEmit` = OK ✅
