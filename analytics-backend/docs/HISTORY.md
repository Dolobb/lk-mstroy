# Analytics Backend — History

## v0.7.1 — Positions period invariant (2026-06-09)

- **GET /api/analytics/positions?from=&at=**: `from` добавлен как optional query-параметр; если не передан, используется backward-compatible lookback `at - 7 days`.
- `analytics.track_points`: последняя позиция выбирается только внутри `[from, at]`.
- `dump_trucks.dt_tracks`: JSONB-точки разворачиваются через `jsonb_array_elements ... WITH ORDINALITY`, фильтруются по `point.ts BETWEEN from AND at`, затем выбирается `DISTINCT ON (vehicle_id) ... ORDER BY ts DESC`.
- KIP fallback ограничен `vehicle_records.report_date` внутри выбранного периода.
- Frontend передаёт `dateFrom` в `usePositions(from, at, shouldPoll)`, а `at` считается как `min(now, dateTo)`.

## v0.7.0 — Сессия 9 (2026-05-15)

**Рендер трека ТС на карте (frontend-only — backend `/tracks` контракт не менялся):**

- **`useTrack` hook** (TanStack Query, isRecent-aware staleTime 30s/5min) в `frontend/src/features/analytics/hooks/useTrack.ts`
- **`TrackLayer` компонент** в `frontend/src/features/analytics/components/TrackLayer.tsx`:
  - Градиент по скорости — split на `<Polyline>` per-segment, цвет blue→green→red interpolate (0→30→60 км/ч)
  - Стрелки направления — каждые ~150м, SVG DivIcon с `transform:rotate(heading)`. Не рисуются на dwell-точках
  - Dwell-маркеры (P-icon) — цвет по длительности (≤30мин серый, ≤2ч жёлтый, >2ч красный), CSS fade-in stagger
  - Tooltip на сегменте трека (hover sticky): скорость + время
  - Hover на dwell → tooltip; click → freeze (`<Tooltip permanent>`); повторный click → unfreeze; click пустого места карты → unfreeze + deselect
  - `fitBounds` на трек при смене `vehicleId` (не на refetch)
- **State management**: `selectedVehicleId` в `AnalyticsPage` (lifted state) — пробрасывается в `AnalyticsMapView`
- **Cross-view trigger**: click на госномер в таблице или на карточку → `setSelectedVehicleId` + автопереключение на map view
- **Highlight выбранного pin'а**: `createAnalyticsPin(row, isSelected)` + CSS `.apin.selected` (drop-shadow + border 2px)
- **Без новых npm-зависимостей** (AGENTS forbid без approval): manual gradient через split-polyline, manual arrows через DivIcon
- **Dwell-маркеры без кластеризации**: типично 5-20 точек на трек, отдельная `MarkerClusterGroup` избыточна

## v0.6.0 — Сессия 8 (2026-05-15)

**Группы «Вне объектов» и фильтрация больших объектов:**

- **GET /api/analytics/groups?from=&to=** — группировка по `visited_objects` из `analytics.track_sessions`:
  - `objects`: массив `{objectUid, vehicleIds}` — ТС, посещавшие объект за период
  - `outside`: массив vehicleIds — ТС без visited_objects за весь период (`bool_and(cardinality(visited_objects) = 0)`)
- **GET /api/analytics/objects** — только «большие объекты» (имеющие зоны с тегами `dt_zone` И `dt_boundary` в `geo.zone_tags`). JOIN `geo.objects` + `geo.zones` + `geo.zone_tags`.
- **Frontend**: `useGroups` + `useBigObjects` hooks (TanStack Query, `staleTime: 60s` / `5m`).
- **KPI strip**: фильтрация объектных карточек только по big objects + синтетическая карточка «Вне объектов». Карточка неинтерактивна (drill-down не реализован). Фильтрация big objects не применяется пока данные загружаются (избегает пустого strip на холодном старте).

**Known limitations:**
- `outside` считается только по ТС с данными в `analytics.track_sessions`. ТС без треков (нет pipeline-записей за период) не попадает ни в `outside`, ни в `objects` — это by design, т.к. visited_objects строится из наличия трека.
- `groupsData.objects` (массивы vehicleIds по объектам) загружаются но пока не используются в UI — заложено для future drill-down.

## v0.5.0 — Сессия 7 (2026-05-15)

**Endpoint `/positions` — все ТС на карте:**

- **GET /api/analytics/positions?at=ISO** — три source с приоритетом:
  1. `analytics.track_points` (pipeline/live-cache) — `DISTINCT ON (vehicle_id) ... ORDER BY ts DESC`
  2. `dump_trucks.dt_tracks` — **SQL-side last point** через `track_simplified->-1->>'ts'` и т.д., без полного JS-итерации массива. Решает jsonb-трафик из v0.3.1.
  3. `kip_vehicles.vehicle_records` — fallback (последняя daily-запись с lat/lng)
- **Контракт**: `regNumber` (= vehicle_id), `lat/lng/ts`, `motionStatus/speed/heading/engineOn`, `source`. Без `vehicleId` (дублировал regNumber).
- **TZ bugfix**: KIP fallback использует `+05:00` (Asia/Yekaterinburg) вместо bare `T23:59:59`.
- **Fragile error matching**: `err.code === '42P01'` (undefined_table) вместо substring-match на русскоязычное сообщение PG.
- **TanStack Query**: `usePositions(at, shouldPoll)` — `staleTime: 30s`, `placeholderData: keepPreviousData`, polling только для recent periods.
- **Frontend merge**: `AnalyticsMapView` получает `positions?: PositionPoint[]`, мержит с `UnifiedVehicleRow` по `regNumber` без мутации `row.latitude/longitude`.

## v0.4.1 — Фиксы Сессии 4 (2026-05-14)

- **Cron**: `30 4 * * *` (04:30 UTC) — через час после KIP cron 03:30 UTC, без пересечения токенов
- **STALE_THRESHOLDS_MIN**: `analytics_daily: 25` добавлен (был fallback 60)
- **getAnalyticsDates**: возвращает `{ dates, partial }` с медианным threshold >=50% (как dump-trucks)
- **data-coverage response**: добавлен `analyticsPartial` по аналогии с `dtPartial`
- **SERVICES.id**: `'analytics-backend'` -> `'analytics'` (как в плане)
- **jobs Map cleanup**: TTL 1 час на job-записи в analytics-backend admin.ts
- **Worker polling**: проверка deadline после цикла, throw на таймаут 20 мин
- **known queues**: `'analytics-cron'` добавлен (schedule queue, не только worker)
- **Frontend coverage**: frontend/src/features/admin/ пока не показывает analytics колонку — отложено до фронтенд-сессий

## v0.4.0 — Сессия 4 (2026-05-14)

**Регистрация в admin + авто-запуск + cron:**

- **SERVICES**: id='analytics' в `admin/server.ts`, admin UI видит/стартует/останавливает
- **Vite proxy**: `/api/analytics` -> `http://localhost:3007` в `frontend/vite.config.ts`
- **Cron**: `ANALYTICS_CRON_SCHEDULE = '30 4 * * *'` (04:30 UTC ~ 09:30 Yekat, через час после KIP)
- **pg-boss worker**: `fetch-analytics-date` handler — POST `/api/analytics/admin/fetch`, polling по jobId до completion с timeout check
- **Coverage**: `getAnalyticsDates()` с per-day vehicle counts + 14d median threshold, `ajaxPartial` в `/api/admin/data-coverage`
- **Reconcile**: `analytics_daily: 25` в `STALE_THRESHOLDS_MIN`, `fetch-analytics-date` + `analytics-cron` в known queues

## v0.3.1 — Фиксы Сессии 3 (2026-05-14)

- **INSERT idempotency**: DELETE по (vehicle_id, date) перед каждым INSERT в dt_tracks
- **FK safe**: `ON DELETE SET NULL` вместо CASCADE (трек переживает удаление одного shift_record при multi-object)
- **UNIQUE (vehicle_id, date)**: не более одной строки dt_tracks на ТС/день
- **Case-insensitive dt_tracks lookup**: `UPPER(dt.vehicle_id) = UPPER($1)`
- **Graceful missing table**: `relation does not exist` -> INFO вместо WARN спама
- **SYNC comment**: `trackProcessor.ts` <- маркер синхронизации с analytics-backend simplifier/dwell
- **Smoke-test pending**: ручной прогон pipeline dump-trucks после миграции 011 не выполнен

**Known limitations** (не блокируют):
- **jsonb трафик при узком period**: dtTrackReader грузит всё jsonb-поле за день, JS-фильтр. Оптимизация в Сессии 7 (last-point endpoint)
- **date vs jsonb ts дрифт**: `dt_tracks.date` != `track_simplified[i].ts` — при pipeline в другом TZ возможен mismatch +/-1 день. Минорно

## v0.3.0 — Сессия 3 (2026-05-14)

**Треки самосвалов — интеграция с `dump_trucks`:**
- `dtTrackReader.ts` — читает упрощённые треки из `dump_trucks.dt_tracks` (JSONB)
- `GET /api/analytics/tracks` — подмешивает треки самосвалов через `mergePoints()`
- В dump-trucks: миграция `011_dt_tracks.sql`, `trackProcessor.ts` (simplifier+dwell), fire-and-forget в `shiftFetchJob.ts`
- Без удвоения TIS-нагрузки — трек из того же `getMonitoringStats` вызова
- Сохранение трека в `shiftFetchJob.ts` (не в `tripBuilder.ts` как в плане) — tripBuilder pure, оркестрация в job

## v0.2.1 — Фиксы Сессии 2 (2026-05-14)

**Критичное исправлено:**
- **Live/DB routing**: per-day `EXISTS` check + склейка недостающих дней из TIS. Если БД покрывает 3 из 5 дней — догружаем оставшиеся 2 live и мёрджим.
- **Live-cache garbage**: `DELETE FROM track_points WHERE session_id = $1` перед каждой вставкой. Старые точки предыдущих выгрузок не накапливаются.
- **Pipeline concurrency**: `mapConcurrent()` с limit=18 — параллельный fetch через все токены. Типовой сценарий <=15 сек.
- **PerTokenRateLimiter**: rate limit теперь per (token, idMO), а не per idMO. 18 токенов x 18 параллельных запросов к одному idMO — без сериализации.

**Серьёзное исправлено:**
- **fetchFromDb индекс**: добавлен фильтр `s.date >= $2::date AND s.date <= $3::date` — planner может prune сессии по дате.
- **Dwell centroid**: среднее арифметическое lat/lng всех точек кластера (вместо midpoint первой точки).
- **Dwell temporal gap**: `DWELL_MAX_GAP_S = 7200` — кластер разрывается если между соседними точками >2ч.
- **engineOn heuristic**: `ignitionWork` из TIS -> если доступен, используем; иначе `speed > 0`; иначе проверка соседей в окне 2 мин.
- **dstRegistry JOIN**: подтверждён `reg_number` (комментарии в vehicleRecordRepo.ts:86).
- **dstRegistry TTL**: кэш 1 час, `clearDstCache()` вызывается при старте pipeline.

**Минорное исправлено:**
- **Дубликат parseTrackPoints**: вынесен в `utils/trackParser.ts`.
- **Admin job status**: `POST /api/analytics/admin/fetch` возвращает `{ status: 'accepted', jobId }`, `GET /api/analytics/admin/fetch/status?jobId=` опрашивает.
- **UTC границы**: из `T00:00:00Z` -> `T00:00:00+05:00` (Asia/Yekaterinburg).
- **Retention**: cron будет в Сессии 4 (пока только стартовый вызов).

## v0.2.0 — Сессия 2 (2026-05-14)

**Реализовано:**
- Реестр ДСТ: `dstRegistry.ts`
- TrackSimplifier + DwellExtractor
- Pipeline `analyticsFetchJob.ts`
- Endpoint `GET /api/analytics/tracks`
- Endpoint `POST /api/analytics/admin/fetch`
- Retention job
- TIS client factory

## v0.1.1 — Фиксы Сессии 1 (2026-05-14)
## v0.1.0 — Сессия 1 (2026-05-14)
