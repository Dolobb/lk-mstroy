# CLAUDE.md — Гео-Администратор (geo-admin/)

## Команды

```bash
cd geo-admin/server/
npm run dev           # Express :3003 (API + статика client/)
npm run migrate       # миграции схемы geo
npm run migrate-geo   # импорт из kip/config/geozones.geojson (уже выполнен: 291 зон, 282 объекта)

# UI
open http://localhost:3003/admin

# PostgreSQL
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy -c "SELECT name, smu FROM geo.objects LIMIT 10;"
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `server/src/index.ts` | Express routes: объекты, зоны, теги |
| `server/src/repositories/objectRepo.ts` | CRUD объектов (PostGIS) |
| `server/src/repositories/zoneRepo.ts` | CRUD зон + теги |
| `server/src/config/db.ts` | Pool PG17 |
| `client/src/map.ts` | Leaflet карта, рисование полигонов |
| `client/src/sidebar.ts` | Аккордеон объектов, формы |
| `client/src/api.ts` | fetch-обёртки для REST API |

## ⚠️ Gotchas

**Пути к `.env`**: файл `.env` лежит в `geo-admin/server/.env`. Из подпапок пути:
- из `src/` → `'../.env'`
- из `src/config/` → `'../../.env'`
- из `src/services/` → `'../../.env'`

**PostGIS**: `geom` хранится в EPSG:4326 (WGS84). В SQL использовать `ST_AsGeoJSON()` для чтения, `ST_GeomFromGeoJSON()` для записи.

**`geo.objects` поле `smu`**: (не `smu_name`!). Важно при JOIN с dump-trucks.

**Редактирование геометрии**: через UI нельзя — только через прямой API PUT с новым GeoJSON. Для смены координат полигона нужен прямой SQL или DELETE + создать заново.

**DB_USER=max**: не `postgres`!

## База данных

PG17 `:5433`, база `mstroy`, схема `geo`:
- `objects` — строительные объекты (`uid`, `name`, `smu`, `address`, `geom`)
- `zones` — геозоны (`uid`, `object_uid`, `name`, `geom`)
- `zone_tags` — теги зон (`zone_uid`, `tag`)

Теги зон: `dt_boundary`, `dt_loading`, `dt_unloading`, `dt_onsite` (самосвалы), `dst_zone` (КИП/ДСТ)

## Переменные окружения

```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=mstroy
DB_USER=max
```

## Документация

- `docs/PIPELINE.md` — API endpoints, схема geo, PostGIS запросы
- `docs/FRONTEND.md` — карта Leaflet, sidebar, рисование
- `docs/HISTORY.md` — что реализовано
- `docs/DEVGUIDE.md` — запуск, миграции, добавление зон
