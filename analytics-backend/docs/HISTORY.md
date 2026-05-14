# Analytics Backend — History

## v0.2.1 — Фиксы Сессии 2 (2026-05-14)

**Критичное исправлено:**
- **Live/DB routing**: per-day `EXISTS` check + склейка недостающих дней из TIS. Если БД покрывает 3 из 5 дней — догружаем оставшиеся 2 live и мёрджим.
- **Live-cache garbage**: `DELETE FROM track_points WHERE session_id = $1` перед каждой вставкой. Старые точки предыдущих выгрузок не накапливаются.
- **Pipeline concurrency**: `mapConcurrent()` с limit=18 — параллельный fetch через все токены. Типовой сценарий ≤15 сек.
- **PerTokenRateLimiter**: rate limit теперь per (token, idMO), а не per idMO. 18 токенов × 18 параллельных запросов к одному idMO — без сериализации.

**Серьёзное исправлено:**
- **fetchFromDb индекс**: добавлен фильтр `s.date >= $2::date AND s.date <= $3::date` — planner может prune сессии по дате.
- **Dwell centroid**: среднее арифметическое lat/lng всех точек кластера (вместо midpoint первой точки).
- **Dwell temporal gap**: `DWELL_MAX_GAP_S = 7200` — кластер разрывается если между соседними точками >2ч.
- **engineOn heuristic**: `ignitionWork` из TIS → если доступен, используем; иначе `speed > 0`; иначе проверка соседей в окне 2 мин.
- **dstRegistry JOIN**: подтверждён `reg_number` (комментарии в vehicleRecordRepo.ts:86).
- **dstRegistry TTL**: кэш 1 час, `clearDstCache()` вызывается при старте pipeline.

**Минорное исправлено:**
- **Дубликат parseTrackPoints**: вынесен в `utils/trackParser.ts`.
- **Admin job status**: `POST /api/analytics/admin/fetch` возвращает `{ status: 'accepted', jobId }`, `GET /api/analytics/admin/fetch/status?jobId=` опрашивает.
- **UTC границы**: из `T00:00:00Z` → `T00:00:00+05:00` (Asia/Yekaterinburg).
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
