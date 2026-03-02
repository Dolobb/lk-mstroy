# CLAUDE.md — Самосвалы (dump-trucks/)

## Команды

```bash
cd dump-trucks/server/
npm run dev                                                    # Express :3002
npm run migrate                                                # миграции БД

# Ручной trigger pipeline
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=YYYY-MM-DD&shift=shift1"

# PostgreSQL
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy -c "SELECT * FROM dump_trucks.shift_records LIMIT 5;"
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `server/src/jobs/shiftFetchJob.ts` | Cron pipeline: fetch → parse → analyze → upsert |
| `server/src/services/zoneAnalyzer.ts` | Turf.js: трек-точки → ZoneEvent[] + ObjectDetector |
| `server/src/services/tripBuilder.ts` | ZoneEvent[] → пары loading/unloading → Trip[] |
| `server/src/services/kpiCalculator.ts` | Формула КПИ смены |
| `server/src/services/tisClient.ts` | TIS API клиент |
| `server/src/index.ts` | Express routes |

## ⚠️ Gotchas

**`geo.objects` поле**: `smu` — не `smu_name`! Частая ошибка при JOIN-запросах к geo-схеме.

**TripBuilder ограничение**: алгоритм считает, что каждая зона выгрузки посещается **один раз за смену**. При повторном визите в ту же зону выгрузки второй рейс может потеряться.

**ObjectDetector**: объект определяется по max количеству трек-точек в `dt_boundary`. На границе двух объектов может выбрать неверный.

**Зоны в БД**: не в `kip/config/geozones.geojson`, а в PostgreSQL 17 схема `geo.zones` + `geo.zone_tags`. Теги самосвалов: `dt_boundary`, `dt_loading`, `dt_unloading`, `dt_onsite`.

**Тестовый режим**: `DT_TEST_ID_MOS=781,15,1581` в `.env` — pipeline обрабатывает только эти idMO.

**Shifts**: `shift1` = 07:30–19:30, `shift2` = 19:30–07:30 (следующего дня).

## База данных

PG17 `:5433`, база `mstroy`, схема `dump_trucks`:
- `shift_records` — KPI смены (PK: `report_date + shift_type + id_mo`)
- `trips` — рейсы (FK → shift_records)
- `zone_events` — факты нахождения в геозонах (FK → shift_records)
- `requests` — заявки TIS
- `repairs` — ремонты (заполняется вручную)

## Фронтенд

React-компонент в едином фронтенде: `frontend/src/features/samosvaly/DumpTrucksPage.tsx`
Vite proxy: `/api/dt` → `:3002`

## Документация

- `docs/PIPELINE.md` — pipeline, алгоритм TripBuilder, формула КПИ
- `docs/FRONTEND.md` — компоненты UI, типы данных
- `docs/HISTORY.md` — что реализовано, ограничения
- `docs/DEVGUIDE.md` — endpoints, конфиг .env, запуск
