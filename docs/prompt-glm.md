Ты подключён к масштабному рефакторингу admin-панели ЛК Мстрой.
 Твоя роль — реализация 3 задач из общего плана. Opus (Lead) работает параллельно
 над pg-boss интеграцией, фронтендом и auto-cascade.

 ОБЯЗАТЕЛЬНО ПРОЧИТАЙ ПЕРЕД НАЧАЛОМ:
 1. NAVIGATION.md — общая карта
 2. kip/docs/ADMIN-PANEL-BRIEF.md — полный брифинг по KIP+admin
 3. dump-trucks/docs/ADMIN_REFACTOR_BRIEF.md — брифинг по DT+admin
 4. admin/server.ts — текущая реализация admin
 5. kip/server/src/services/geozoneAnalyzer.ts — текущая загрузка зон
 6. dump-trucks/server/src/repositories/filterRepo.ts — пример чтения зон из DB

 ЗАДАЧА A: Pipeline Runs — БД + Repository
 Создай ветку: agent/glm/feat-pipeline-runs
 - Файл миграции: admin/migrations/001_pipeline_runs.sql
 - Repository: admin/src/repositories/pipelineRunRepo.ts
 - Таблица pipeline_runs в БД mstroy (схема public):
   run_id UUID PK DEFAULT gen_random_uuid(),
   pipeline_name VARCHAR(50) NOT NULL, -- 'kip_daily','dt_shift1','dt_shift2','dt_segments','kip_segments'
   trigger_type VARCHAR(20) NOT NULL,  -- 'cron','manual','cascade'
   target_date DATE NOT NULL,
   shift_type VARCHAR(10),
   status VARCHAR(20) DEFAULT 'running', -- running/completed/failed/partial
   started_at TIMESTAMPTZ DEFAULT now(),
   completed_at TIMESTAMPTZ,
   duration_ms INTEGER,
   total_vehicles INT DEFAULT 0,
   success_count INT DEFAULT 0,
   error_count INT DEFAULT 0,
   errors JSONB DEFAULT '[]',
   config_snapshot JSONB
 - Repository должен использовать Pool из admin/server.ts (mainPool)
 - Методы: createRun, completeRun, failRun, addError, getRunsByRange, getLastSuccess, getCronHealth
 - Обернуть cron в KIP scheduler.ts и DT scheduler.ts вызовами createRun/completeRun
   (для этого scheduler-ам нужен доступ к своему pool — передавать через параметр)

 ЗАДАЧА B: KIP Zone Migration
 Создай ветку: agent/glm/feat-kip-zones-from-db
 - Модифицируй kip/server/src/services/geozoneAnalyzer.ts
 - ВАЖНО: зоны уже импортированы в geo.zones с тегом 'dst_zone' (291 зона, 282 объекта)
 - SQL запрос (используй паттерн из dump-trucks/filterRepo.ts):
   SELECT z.uid, z.name, ST_AsGeoJSON(z.geom)::text AS geojson, z.min_duration_sec,
     o.name AS object_name, o.smu, o.timezone
   FROM geo.zones z
   JOIN geo.objects o ON o.id = z.object_id
   JOIN geo.zone_tags zt ON zt.zone_id = z.id
   WHERE zt.tag = 'dst_zone'
 - Сохрани ParsedZone интерфейс: { id, name, departmentUnit, feature }
 - Добавь invalidateCache() экспорт — Opus будет вызывать при zone change
 - KIP серверу нужен mainPool (mstroy DB) — добавь через .env MAIN_DB_URL
 - Endpoint GET /api/geozones должен вернуть тот же формат FeatureCollection

 ЗАДАЧА C: Enhanced Coverage Queries
 Создай ветку: agent/glm/feat-enhanced-coverage
 - В admin/server.ts:
   - Расширь getDumpTrucksDates() → getDtDetailedCoverage() с SQL выше
   - Исправь getKipRawDates(): добавь WHERE is_gap_filled = false в подсчёт vr_count
   - Новый endpoint GET /api/admin/data-coverage/detailed?from=&to=
 - Типы: создай admin/src/types.ts (DayDetailedCoverage, DtShiftCoverage)
 - НЕ ТРОГАЙ frontend — его делает Opus

 ПОРЯДОК: A → B → C (B и C могут параллельно после A)
 Каждую задачу — в отдельной ветке. Отчёт после каждой.

 Критерии приёмки работы GLM (Шаг 5)

 ┌────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Задача │                                                                                 Проверка                                                                                 │
 ├────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ A      │ psql -d mstroy -c "SELECT * FROM pipeline_runs LIMIT 1" — таблица существует; TypeScript компилируется без ошибок                                                        │
 ├────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ B      │ KIP стартует без geozones.geojson; curl localhost:3001/api/geozones возвращает FeatureCollection с ~291 зоной; invalidateCache() экспортирован                           │
 ├────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ C      │ curl "localhost:3005/api/admin/data-coverage/detailed?from=2026-04-01&to=2026-04-14" возвращает per-day + per-shift детализацию; gap-filled записи исключены из coverage │
 └────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
