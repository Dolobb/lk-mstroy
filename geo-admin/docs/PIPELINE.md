# Geo Admin — Pipeline Reference

## Схема: PostGIS → API → Leaflet карта

```
kip/config/geozones.geojson
        |
        | npm run migrate-geo
        v
geo.objects + geo.zones + geo.zone_tags   (PostgreSQL 17, БД mstroy, порт 5433)
        |
        | HTTP GET /api/geo/zones/by-tag/:tag
        v
Express API (objectRepo.ts / zoneRepo.ts)
        |
        | GeoJSON FeatureCollection
        v
api.ts (fetch-клиент)
        |
        v
main.ts (оркестратор)
       /        \
      v          v
sidebar.ts     map.ts
(список)      (Leaflet полигоны)
```

---

## 1. База данных (PostgreSQL 17, порт 5433, БД mstroy, схема geo)

### Таблица `geo.objects`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | SERIAL PRIMARY KEY | Внутренний ID |
| `uid` | VARCHAR(50) UNIQUE NOT NULL | Slug-идентификатор (транслитерация из имени) |
| `name` | VARCHAR(200) NOT NULL | Название объекта строительства |
| `smu` | VARCHAR(200) | СМУ (структурное подразделение, напр. «СМУ г. Тюмень») |
| `region` | VARCHAR(200) | Регион (напр. «Тюменская область») |
| `created_at` | TIMESTAMP | Дата создания |
| `updated_at` | TIMESTAMP | Дата последнего обновления |

Пример uid: `karier-singapay` (слаг из «Карьер Сингапай»).

Если слаг занят → добавляется суффикс: `karier-singapay-2`, `karier-singapay-3`.

### Таблица `geo.zones`

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | SERIAL PRIMARY KEY | Внутренний ID |
| `uid` | VARCHAR(50) UNIQUE NOT NULL | Уникальный идентификатор зоны |
| `object_id` | INTEGER NOT NULL | FK → `geo.objects(id)` ON DELETE CASCADE |
| `name` | VARCHAR(200) NOT NULL | Название зоны |
| `geom` | GEOMETRY(Polygon, 4326) NOT NULL | Геометрия (WGS84, PostGIS) |
| `created_at` | TIMESTAMP | Дата создания |
| `updated_at` | TIMESTAMP | Дата последнего обновления |

Индекс `zones_geom_idx` — GIST-индекс по полю `geom` (пространственные запросы).

При удалении объекта — каскадно удаляются все его зоны.

### Таблица `geo.zone_tags`

| Поле | Тип | Описание |
|------|-----|---------|
| `zone_id` | INTEGER NOT NULL | FK → `geo.zones(id)` ON DELETE CASCADE |
| `tag` | VARCHAR(30) NOT NULL | Строковый тег |
| PRIMARY KEY | (zone_id, tag) | Уникальная пара |

Допустимые теги (валидируются в `zoneRepo.validateTags`):
| Тег | Назначение |
|-----|-----------|
| `dt_boundary` | Граница объекта (подсистема самосвалов) |
| `dt_loading` | Зона погрузки (подсистема самосвалов) |
| `dt_unloading` | Зона выгрузки (подсистема самосвалов) |
| `dt_onsite` | Работа по месту (подсистема самосвалов) |
| `dst_zone` | Рабочая зона (КИП/ДСТ) |

### Таблица `geo._migrations`

| Поле | Тип | Описание |
|------|-----|---------|
| `name` | VARCHAR(255) PRIMARY KEY | Имя файла миграции |
| `applied_at` | TIMESTAMP | Дата применения |

### Миграции

Единственная миграция: `001_geo_schema.sql` — создаёт схему `geo`, расширение PostGIS, все 4 таблицы и GIST-индекс.

---

## 2. API Endpoints (`geo-admin/server/src/index.ts`)

Все endpoints начинаются с `/api/geo`.

### Health

```
GET /api/geo/health
Response: { status: 'ok', module: 'geo-admin' }
```

### Objects

```
GET /api/geo/objects
Response: GeoObjectWithCount[]
  [ { id, uid, name, smu, region, created_at, updated_at, zone_count: number } ]
```

```
GET /api/geo/objects/:uid
Response: ObjectWithZones
  {
    object: GeoObject,
    zones: GeoJSON.FeatureCollection  // features с properties: { uid, name, tags }
  }
404 если объект не найден
```

```
POST /api/geo/objects
Body: { name: string (required), smu?: string, region?: string }
Response 201: GeoObject
400 если name отсутствует или не строка
```

```
PUT /api/geo/objects/:uid
Body: { name?: string, smu?: string|null, region?: string|null }
Response: GeoObject
404 если не найден
```

```
DELETE /api/geo/objects/:uid
Response: { deleted: true, uid: string }
404 если не найден
Каскадно удаляет все зоны объекта (ON DELETE CASCADE)
```

### Zones — запросы

```
GET /api/geo/zones/by-object/:objectUid[?tags=tag1,tag2]
Response: GeoJSON.FeatureCollection
  features: [ { type: 'Feature', properties: { uid, name, tags }, geometry: Polygon } ]
Фильтр по тегам: ?tags=dt_loading,dt_unloading (опциональный)
```

```
GET /api/geo/zones/by-tag/:tag
Response: GeoJSON.FeatureCollection
  features: [ { type: 'Feature', properties: { uid, name, object_name, object_uid, tags }, geometry: Polygon } ]
```

### Zones — CRUD

```
POST /api/geo/zones
Body: { objectUid: string, name: string, tags: string[], geometry: GeoJSON.Polygon }
Response 201: GeoZone
400 если objectUid/name/tags/geometry отсутствуют или tags содержат неизвестный тег
400 если objectUid не найден в geo.objects
Транзакция: INSERT zones + INSERT zone_tags
```

```
PUT /api/geo/zones/:uid
Body: { name?: string, tags?: string[], geometry?: GeoJSON.Polygon }
Response: GeoZone
404 если не найден
400 если tags содержат неизвестный тег
Транзакция: UPDATE zones + DELETE zone_tags + INSERT zone_tags
```

```
DELETE /api/geo/zones/:uid
Response: { deleted: true, uid: string }
404 если не найден
```

### Admin

```
POST /api/geo/admin/migrate-from-files
Response: { zones_imported: number, objects_created: number, skipped: number }
Запускает импорт из kip/config/geozones.geojson
Идемпотентный (ON CONFLICT DO NOTHING)
```

---

## 3. Репозитории

### objectRepo.ts (`geo-admin/server/src/repositories/objectRepo.ts`)

**`getAllObjects()`** — `SELECT ... LEFT JOIN zones ... GROUP BY ... ORDER BY name`.
Возвращает массив с `zone_count` (количество уникальных зон на объект).

**`getObjectByUid(uid)`** — два запроса:
1. Получает объект по uid
2. Получает все зоны объекта с тегами (`array_agg(zt.tag)`)
Возвращает `ObjectWithZones` с GeoJSON FeatureCollection (геометрия через `ST_AsGeoJSON`).

**`createObject(data)`** — генерирует uid через `uniqueObjectUid()` (slug + дедупликация),
делает `INSERT RETURNING`.

**`updateObject(uid, data)`** — динамический `UPDATE` (только переданные поля),
всегда обновляет `updated_at = NOW()`.

**`deleteObject(uid)`** — `DELETE WHERE uid = $1`, возвращает `rowCount > 0`.

### zoneRepo.ts (`geo-admin/server/src/repositories/zoneRepo.ts`)

**`validateTags(tags)`** — проверяет теги против `ALLOWED_TAGS`, возвращает строку ошибки или `null`.

**`getZonesByObject(objectUid, filterTags?)`** — JOIN objects + zones + zone_tags,
опциональный `AND zt.tag = ANY($2::text[])`. Возвращает GeoJSON FeatureCollection.

**`getZonesByTag(tag)`** — JOIN через zone_tags, возвращает зоны с полями `object_name`, `object_uid` в properties.

**`createZone(data)`** — транзакция:
1. Resolve object_id по objectUid
2. Генерирует uid: `zone_${nanoid(8)}`
3. `INSERT INTO zones ... ST_GeomFromGeoJSON($4)`
4. `INSERT INTO zone_tags` для каждого тега
Rollback при ошибке.

**`updateZone(uid, data)`** — транзакция:
1. Resolve zone_id по uid
2. Если есть name/geometry — динамический UPDATE с `updated_at = NOW()`
3. Если есть tags — `DELETE zone_tags WHERE zone_id` + INSERT новых
4. Финальный `getZoneByUid(uid)` для возврата актуальных данных.

**`deleteZone(uid)`** — `DELETE WHERE uid = $1`.

---

## 4. Привязка к UI

| Действие пользователя | API call | Обработчик |
|-----------------------|----------|-----------|
| Загрузка страницы | `GET /api/geo/objects` | `main.ts → sidebar.renderObjectList` |
| Загрузка страницы | `GET /api/geo/zones/by-tag/dst_zone` + `by-tag/dt_boundary` | `main.ts → map.addZoneToMap` |
| Переключение на «Самосвалы» | `GET /api/geo/zones/by-tag/dt_loading` + `dt_unloading` + `dt_boundary` | `main.ts → map.clearAllZones + addZoneToMap` |
| Клик на объект в сайдбаре | `GET /api/geo/objects/:uid` | `sidebar.showObjectZones` + `map.zoomToFeature` |
| Кнопка «+ Объект» | Форма → `POST /api/geo/objects` | `sidebar.renderObjectList` |
| Рисование + форма зоны | `POST /api/geo/zones` | `map.addZoneFromModel` |
| Кнопка «Удалить» у зоны | `DELETE /api/geo/zones/:uid` | `map.removeZoneFromMap` |
| Кнопка «Редактировать» у зоны | `PUT /api/geo/zones/:uid` | `map.clearAllZones + loadZones` |
| Кнопка «Приблизить» у зоны | — | `map.zoomToZone(uid)` |

---

## 5. Импорт геозон

### Команда

```bash
cd geo-admin/server/
npm run migrate-geo
# или через API:
# POST /api/geo/admin/migrate-from-files
```

### Источник

Файл: `kip/config/geozones.geojson`
Путь в migrationService: `../../../../kip/config/geozones.geojson` (относительно `dist/services/`)

### Фильтр

Импортируются только зоны с `controlType === 1`.

### Алгоритм разбора имён

Имя зоны в geozones.geojson имеет формат: `«СМУ, Название объекта»`

Пример: `«СМУ г. Тюмень, Карьер Сингапай»`
- `smu = 'СМУ г. Тюмень'` (до первой запятой+пробел)
- `objectName = 'Карьер Сингапай'` (после запятой+пробел)

Если запятой нет — `smu = null`, `objectName = zoneName`.

uid объекта = `slugify(objectName).slice(0, 50)`.

### Идемпотентность

`INSERT INTO geo.zones ... ON CONFLICT (uid) DO NOTHING` — повторный запуск не создаёт дубликатов.

`findOrCreateObject` — ищет объект по uid перед созданием.

### Результат выполнения (выполнен 2026-02-18)

- 291 зон импортировано
- 282 объекта создано
- Все зоны получили тег `dst_zone` (для КИП/ДСТ фильтра)
