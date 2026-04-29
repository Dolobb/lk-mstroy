# Сводка изменений сессии — 2026-04-17

## 1. Coverage Dashboard (новый UI покрытия данных)

**Цель**: заменить «врущий» SELECT DISTINCT report_date на честный счётчик ТС с baseline-сравнением.

### Backend
- `admin/server.ts` — новый endpoint `GET /api/admin/coverage-dashboard?from=&to=`
  - Baseline = `MAX(COUNT DISTINCT vehicle_id)` за 7 дней (КИП и DT отдельно)
  - Per-day карточки: vehicleCount, rawCount, rawPct, tripCount, shiftCount, hasSegments
  - Health: green ≥85% / yellow 50–85% / red <50% / grey пусто
  - Summary: ghost count, pipeline 7д ok/fail, средние

### Frontend
- `frontend/src/features/admin/types.ts` — добавлены `CoverageDashboardResponse`, `DayCard`
- `frontend/src/features/admin/AdminPage.tsx` — компоненты:
  - `CoverageDashboard` — сетка карточек дней с цветовым кодированием
  - `DayCardPopover` — детали дня + контекстные действия (fetch/force/refresh/recalc + сегменты)
  - Алерты «N дн. без КИП», «Pipeline failed»
  - Batch: «Загрузить пропущенные» (порог 85%, идёт и по KIP, и по DT), «Пересчитать всё»
  - Авто-refresh 8с во время операции / 30с в idle
  - Прогресс-бары с возможностью отмены
  - Старый UI убран в collapsible «Расширенные инструменты»

---

## 2. Pipeline metrics

- `admin/server.ts` — pg-boss workers `kipFetchHandler` / `dtFetchHandler` после успешного прогона записывают `totalVehicles` / `successCount` в `pipeline_runs`:
  - KIP: `COUNT DISTINCT vehicle_id WHERE COALESCE(is_gap_filled,false)=false`
  - DT: `COUNT DISTINCT vehicle_id FROM dump_trucks.shift_records`

---

## 3. Cron deduplication

Чтобы при запуске admin-ом дочерних сервисов их собственные cron-ы не конкурировали с pg-boss-планировщиком admin'а:

- `kip/server/src/jobs/scheduler.ts` — early return при `process.env.CRON_DISABLED === 'true'`
- `dump-trucks/server/src/jobs/scheduler.ts` — то же
- `admin/server.ts` `startService()` — добавлен `CRON_DISABLED: 'true'` в env spawn'а

Стандалоновый запуск (без admin) продолжает работать как раньше.

---

## 4. UX-фиксы кнопок (по жалобам пользователя)

### «Не вижу прогресса»
- `CoverageDashboard` теперь принимает полные `fetchStatus`/`recalcStatus` (не только `active: boolean`)
- Inline-прогресс-бары + текущая дата + список ошибок + кнопка «Отмена»
- Колбэки `onFetch`/`onRecalc` сразу дёргают `loadFetchStatus()`/`loadRecalcStatus()` — UI обновляется без задержки

### «Кнопка ничего не делает» (Загрузить пропущенные)
Было: порог `<50%` (мимо жёлтых дней) + только KIP-fetch.
Стало:
- Порог `<85%` — захватываются и жёлтые, и красные
- Раздельные missingDates для KIP и DT, каждый со своим fetch
- KIP идёт с `force=true` (иначе сервер скипает по «обычному режиму»)
- `confirm()` со списком дат перед запуском

### «Перевыгрузил DT — счётчик не изменился»
- DayCardPopover ранее показывал «Пересчитать DT» при `vehicleCount > 0`. Recalc только перегоняет KPI по уже сохранённым данным — новых ТС из TIS не подтянет.
- Теперь при `dtCount/dtExpected < 85%` появляется «Перевыгрузить DT» (action: `refresh-dt` → `onFetch('dump-trucks', …, { refresh: true })`)
- При полном покрытии — только «Пересчитать DT»

### Молчаливые ответы сервера
- 409 от `/fetch/:service` или `/recalc/:service` → alert «уже выполняется»
- `{ missing: 0 }` (сервер пропустил все даты как «уже загружены») → alert с подсказкой использовать refresh/force
- Сегментные fetch'и (`fetch-kip-segments`, `fetch-dt-segments`) теперь тоже показывают alert успеха/ошибки/409

### Доступность кнопок popover
- В `DayCardPopover` добавлен prop `busy: boolean`
- При активной операции все KIP/DT-кнопки `disabled={busy}` + подсказка «Операция уже выполняется»

---

## 5. Bugfix роутинга `/fetch/cancel`

Express матчил `POST /api/admin/fetch/cancel` как `POST /api/admin/fetch/:service` с `service=cancel` и возвращал 400 «service должен быть kip или dump-trucks». Cancel не работал.

Исправлено: `/fetch/cancel` зарегистрирован **до** `/fetch/:service` (как уже было сделано для `/recalc/cancel`).

Файл: `admin/server.ts`.

---

## 6. Bugfix DT-пайплайна — отсутствующая миграция

**Симптом**: «13 апр фейл, 17 апр бесконечная загрузка». Логи DT:
```
[ERROR] [ShiftFetch] Failed to load geo zones: error: столбец z.min_duration_sec не существует
[Admin] Fetch complete { vehiclesProcessed: 0, ... }
```

**Причина**: миграция `geo-admin/server/migrations/003_zone_min_duration.sql` (добавляет `geo.zones.min_duration_sec`) не была применена на БД `mstroy`. Код в `dump-trucks/server/src/repositories/filterRepo.ts` уже ссылался на этот столбец → каждый прогон падал на загрузке геозон, возвращал 0 ТС, admin ждал записей в `shift_records` и срабатывал 20-минутный timeout (`Timeout waiting for DT data`).

**Исправление**: применил миграцию вручную через psql:
```sql
ALTER TABLE geo.zones ADD COLUMN IF NOT EXISTS min_duration_sec INTEGER NOT NULL DEFAULT 120;
```

После рестарта DT-сервиса прогон 13.04 / shift1 успешно отработал — 29 ТС, 101 рейс (вместо 3).

---

## 7. Прочее

- Удалён блок «Когда нужен перезапуск?» под покрытием (по запросу пользователя)
- Killed stuck dump-trucks process (PID 120984) который держал порт 3002
- Все правки в TypeScript собираются чисто (`tsc --noEmit`); pre-existing ошибки в `analytics/` и `samosvaly/` не трогал

---

## Изменённые файлы

| Файл | Назначение |
|------|-----------|
| `admin/server.ts` | endpoint coverage-dashboard, pipeline metrics, CRON_DISABLED env, fetch/cancel route fix |
| `frontend/src/features/admin/AdminPage.tsx` | CoverageDashboard, DayCardPopover, контекстные действия, фидбек на 409/missing=0 |
| `frontend/src/features/admin/types.ts` | новые типы CoverageDashboardResponse / DayCard |
| `kip/server/src/jobs/scheduler.ts` | CRON_DISABLED check |
| `dump-trucks/server/src/jobs/scheduler.ts` | CRON_DISABLED check |
| БД `mstroy` | миграция 003_zone_min_duration применена |
