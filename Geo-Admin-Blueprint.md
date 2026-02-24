# Geo-Admin Blueprint — Общий сервис геозон

> Отдельный модуль монорепо. Управляет объектами строительства и геозонами
> которые используются всеми другими модулями (КИП, самосвалы, будущие модули).
> Формат: псевдокод + пояснения на русском.

---

## 0. Место в монорепо и принцип работы

```
repo/
├── server/              # КИП — ЧИТАЕТ из схемы geo (не пишет)
├── dump-trucks/server/  # Самосвалы — ЧИТАЕТ из схемы geo (не пишет)
└── geo-admin/
    ├── server/          # Express :3003 — единственный кто ПИШЕТ в схему geo
    └── client/          # SPA: Leaflet + Leaflet.draw
```

**Принцип:** схема `geo` — единый источник истины для всей геопространственной информации
проекта. Читать из неё может любой модуль напрямую через общий PostgreSQL.
Писать — только через `geo-admin` API.

---

## 1. Схема базы данных (`geo`)

```sql
CREATE SCHEMA geo;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Строительные объекты
CREATE TABLE geo.objects (
  id          SERIAL PRIMARY KEY,
  uid         VARCHAR(50) UNIQUE NOT NULL,  -- slug: 'singapay', 'tobolsk_bridge'
  name        VARCHAR(200) NOT NULL,        -- 'Сингапай', 'Тобольск — мост'
  smu         VARCHAR(200),                 -- 'СМУ г. Тюмень'
  region      VARCHAR(200),                 -- 'Тюменская область'
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Геозоны — полигоны привязанные к объекту
CREATE TABLE geo.zones (
  id          SERIAL PRIMARY KEY,
  uid         VARCHAR(50) UNIQUE NOT NULL,  -- 'zone_<uuid4_short>'
  object_id   INTEGER NOT NULL REFERENCES geo.objects(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,        -- 'Карьер Сингапай', 'Выгрузка на мосту'
  geom        GEOMETRY(Polygon, 4326) NOT NULL,  -- WGS84, PostGIS
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Пространственный индекс — обязателен для ST_Contains
CREATE INDEX ON geo.zones USING GIST (geom);

-- Теги зон — многие-ко-многим
-- Позволяют одной зоне иметь роли в разных модулях одновременно
CREATE TABLE geo.zone_tags (
  zone_id     INTEGER NOT NULL REFERENCES geo.zones(id) ON DELETE CASCADE,
  tag         VARCHAR(30) NOT NULL,
  PRIMARY KEY (zone_id, tag)
);

-- Журнал миграций
CREATE TABLE geo._migrations (
  name        VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.1. Реестр тегов

| Тег | Модуль | Описание |
|-----|--------|----------|
| `dt_boundary` | Самосвалы | Граница объекта (машина "на объекте") |
| `dt_loading` | Самосвалы | Зона погрузки |
| `dt_unloading` | Самосвалы | Зона выгрузки |
| `dt_onsite` | Самосвалы | Зона "работа по месту" |
| `dst_zone` | КИП (ДСТ) | Рабочая зона техники |

**Правила тегирования:**
- Зона может иметь любое количество тегов
- Теги `dt_loading` и `dt_onsite` могут стоять на одной зоне одновременно
- Зоны ДСТ (`dst_zone`) как правило крупнее зон самосвалов и не используют dt_* теги
- Новые модули добавляют свои префиксы тегов не меняя схему

---

## 2. Структура файлов модуля

```
geo-admin/
├── server/
│   └── src/
│       ├── index.ts              # Express :3003, маршруты, запуск
│       ├── migrate.ts            # Миграции схемы geo
│       ├── config/
│       │   ├── database.ts       # Пул соединений (тот же PostgreSQL)
│       │   └── env.ts            # GEO_SERVER_PORT и др.
│       ├── repositories/
│       │   ├── objectRepo.ts     # CRUD для geo.objects
│       │   └── zoneRepo.ts       # CRUD для geo.zones + geo.zone_tags
│       ├── services/
│       │   └── migrationService.ts  # Импорт из geojson файлов (разовый)
│       └── utils/
│           ├── slugify.ts        # name → uid ('Сингапай' → 'singapay')
│           └── logger.ts         # Переиспользовать из КИП
└── client/
    └── src/
        ├── index.html            # Single page
        ├── main.ts               # Точка входа
        ├── map.ts                # Leaflet + Leaflet.draw инициализация
        ├── sidebar.ts            # Иерархия объектов/зон (левая панель)
        ├── api.ts                # HTTP-клиент к geo-admin API
        └── styles.css
```

---

## 3. API эндпоинты

### 3.1. Объекты

```pseudocode
GET /api/geo/objects
  // Все объекты с количеством зон по тегам
  SELECT
    o.*,
    COUNT(DISTINCT z.id) AS zone_count
  FROM geo.objects o
  LEFT JOIN geo.zones z ON z.object_id = o.id
  GROUP BY o.id
  ORDER BY o.name
  → [{ id, uid, name, smu, region, zone_count }]


GET /api/geo/objects/:uid
  // Один объект + все его зоны с тегами как GeoJSON FeatureCollection
  SELECT
    z.id, z.uid, z.name,
    ST_AsGeoJSON(z.geom)::jsonb AS geometry,
    array_agg(zt.tag) AS tags
  FROM geo.zones z
  JOIN geo.zone_tags zt ON zt.zone_id = z.id
  WHERE z.object_id = (SELECT id FROM geo.objects WHERE uid = $1)
  GROUP BY z.id
  → {
      object: { id, uid, name, smu, region },
      zones: GeoJSON FeatureCollection  // geometry + properties: { uid, name, tags[] }
    }


POST /api/geo/objects
  body: { name, smu?, region? }
  валидация: name обязательно, uid = slugify(name) + проверка уникальности
  INSERT INTO geo.objects (uid, name, smu, region)
  → { id, uid, name, smu, region }


PUT /api/geo/objects/:uid
  body: { name?, smu?, region? }
  UPDATE geo.objects SET ... WHERE uid = $1
  → { id, uid, name, smu, region }


DELETE /api/geo/objects/:uid
  // Каскадно удаляет все зоны объекта (ON DELETE CASCADE)
  DELETE FROM geo.objects WHERE uid = $1
  → { deleted: true, uid }
```

### 3.2. Зоны

```pseudocode
POST /api/geo/zones
  body: {
    objectUid: 'singapay',
    name: 'Карьер Сингапай',
    tags: ['dt_loading', 'dt_onsite'],
    geometry: {           // GeoJSON Polygon из Leaflet.draw
      type: 'Polygon',
      coordinates: [[[lon, lat], ...]]
    }
  }

  валидация:
    - objectUid существует в geo.objects
    - geometry валидный GeoJSON Polygon
    - tags — массив из разрешённых значений (см. реестр тегов)
    - если 'dt_boundary' в tags — у объекта уже нет другой dt_boundary зоны

  uid = 'zone_' + nanoid(8)  // короткий уникальный id

  BEGIN транзакция:
    INSERT INTO geo.zones (uid, object_id, name, geom)
    VALUES ($uid, $objectId, $name, ST_GeomFromGeoJSON($geometry))

    для каждого tag из tags:
      INSERT INTO geo.zone_tags (zone_id, tag) VALUES ($zoneId, $tag)
  COMMIT

  → { id, uid, name, tags, geometry }


PUT /api/geo/zones/:uid
  body: { name?, tags?, geometry? }
  // Можно обновить любое из полей

  BEGIN транзакция:
    если geometry: UPDATE geo.zones SET geom = ST_GeomFromGeoJSON($geometry)
    если name:     UPDATE geo.zones SET name = $name
    если tags:
      DELETE FROM geo.zone_tags WHERE zone_id = $zoneId
      INSERT INTO geo.zone_tags (zone_id, tag) VALUES ... (для каждого нового тега)
  COMMIT

  → { id, uid, name, tags, geometry }


DELETE /api/geo/zones/:uid
  // Каскадно удаляет теги (ON DELETE CASCADE)
  DELETE FROM geo.zones WHERE uid = $1
  → { deleted: true, uid }
```

### 3.3. Эндпоинты для чтения (используются другими модулями)

```pseudocode
// Используется самосвалами: загрузка зон объекта для пайплайна
GET /api/geo/zones/by-object/:objectUid?tags=dt_loading,dt_boundary
  // Опциональный фильтр по тегам
  SELECT
    z.uid, z.name,
    ST_AsGeoJSON(z.geom)::jsonb AS geometry,
    array_agg(zt.tag) AS tags
  FROM geo.zones z
  JOIN geo.objects o ON o.id = z.object_id
  JOIN geo.zone_tags zt ON zt.zone_id = z.id
  WHERE o.uid = $1
    AND (tags filter OR все зоны)
  GROUP BY z.id
  → GeoJSON FeatureCollection


// Используется КИП: все dst_zone зоны (замена geozones.geojson)
GET /api/geo/zones/by-tag/:tag
  SELECT z.uid, z.name, ST_AsGeoJSON(z.geom)::jsonb AS geometry, o.name AS object_name
  FROM geo.zones z
  JOIN geo.zone_tags zt ON zt.zone_id = z.id
  JOIN geo.objects o ON o.id = z.object_id
  WHERE zt.tag = $1
  → GeoJSON FeatureCollection


GET /api/geo/health
  → { status: 'ok', module: 'geo-admin' }
```

---

## 4. Логика buildZoneEvents с PostGIS

> Используется в модуле самосвалов. Описана здесь так как завязана на схему geo.

### 4.1. Основной SQL-запрос (один вызов на ТС × смена)

```sql
-- $1 — трек как массив JSONB: [{"lon": 58.14, "lat": 56.76, "time": "2026-04-01 08:00:00"}, ...]
-- $2 — object_id объекта

SELECT
  z.uid        AS zone_uid,
  z.name       AS zone_name,
  zt.tag       AS zone_tag,
  t.point_time,
  TRUE         AS is_inside
FROM geo.zones z
JOIN geo.zone_tags zt ON zt.zone_id = z.id AND zt.tag LIKE 'dt_%'
JOIN (
  SELECT
    (p->>'time')::TIMESTAMP              AS point_time,
    ST_SetSRID(
      ST_MakePoint(
        (p->>'lon')::FLOAT,
        (p->>'lat')::FLOAT
      ), 4326
    )                                    AS geom
  FROM unnest($1::JSONB[]) AS p
) t ON ST_Contains(z.geom, t.geom)
WHERE z.object_id = $2
ORDER BY t.point_time, z.uid;
```

Запрос возвращает только точки которые находятся **внутри** хоть одной зоны.
Точки вне всех зон в результат не попадают — они нам не нужны.

### 4.2. Построение событий entry/exit из результата запроса

```pseudocode
функция buildZoneEvents(track, objectId, db):
  // Шаг 1: один SQL-запрос к PostGIS
  insidePoints = db.query(SQL выше, [track, objectId])
  // [{ zoneUid, zoneName, zoneTag, pointTime }]

  // Шаг 2: группируем по зоне
  byZone = groupBy(insidePoints, p => p.zoneUid)

  events = []
  GAP_THRESHOLD_MIN = 5  // пауза более 5 мин = выход из зоны и новый вход

  для каждого [zoneUid, points] из byZone:
    zoneTag  = points[0].zoneTag
    zoneName = points[0].zoneName
    sorted   = points.sortBy(p => p.pointTime)

    entryTime = sorted[0].pointTime
    prevTime  = sorted[0].pointTime

    для каждой point из sorted начиная со второй:
      gapMin = diffMinutes(prevTime, point.pointTime)

      если gapMin > GAP_THRESHOLD_MIN:
        // Зафиксировать выход и вход
        events.push({ zoneUid, zoneName, zoneTag, eventType: 'exit',  time: prevTime  })
        events.push({ zoneUid, zoneName, zoneTag, eventType: 'entry', time: point.pointTime })
        entryTime = point.pointTime

      prevTime = point.pointTime

    // Закрыть последний визит
    events.push({ zoneUid, zoneName, zoneTag, eventType: 'entry', time: entryTime })
    events.push({ zoneUid, zoneName, zoneTag, eventType: 'exit',  time: prevTime  })

  вернуть events.sortBy(e => e.time)

// Примечание: пары entry/exit для каждой зоны не пересекаются —
// алгоритм гарантирует что за каждым entry следует exit той же зоны.
```

---

## 5. Миграция из geojson файлов (разовый скрипт)

> Запускается один раз для переноса существующих данных.
> После успешного выполнения файлы архивируются.

```pseudocode
функция migrateFromFiles():
  // Шаг 1: geozones.geojson → dst_zone зоны для КИП
  geojson = JSON.parse(fs.readFileSync('config/geozones.geojson'))

  features = geojson.features.filter(f =>
    f.properties.controlType === 1 &&
    f.properties.zoneName.startsWith("СМУ")
  )

  для каждого feature из features:
    // Извлечь название объекта из zoneName
    // 'СМУ г. Тюмень, Ремонт моста...' → объект 'СМУ г. Тюмень'
    [smuPart, objectPart] = feature.properties.zoneName.split(', ', 2)

    // Найти или создать объект
    object = findOrCreateObject({
      uid:    slugify(feature.properties.uid),
      name:   objectPart ?? feature.properties.zoneName,
      smu:    smuPart,
      region: feature.properties.region || null
    })

    // Создать зону
    zone = INSERT INTO geo.zones (
      uid:       feature.properties.uid,  // сохраняем оригинальный uid
      object_id: object.id,
      name:      feature.properties.zoneName,
      geom:      ST_GeomFromGeoJSON(feature.geometry)
    )

    // Тег для КИП
    INSERT INTO geo.zone_tags (zone_id, tag) VALUES (zone.id, 'dst_zone')

  logger.info(`Мигрировано ${features.length} зон КИП`)


  // Шаг 2: dump-trucks-config.json → объекты и dt_* теги
  dtConfig = JSON.parse(fs.readFileSync('config/dump-trucks-config.json'))

  для каждого obj из dtConfig.objects:
    object = findOrCreateObject({
      uid:    obj.uid,
      name:   obj.name,
      smu:    obj.smu,
      region: obj.region
    })

    // Добавить теги к уже существующим зонам по uid
    для каждого [zoneRole, uids] из obj.zones:
      tag = roleToTag(zoneRole)  // 'boundary'→'dt_boundary', 'loading'→'dt_loading' и т.д.
      для каждого zoneUid из uids:
        zone = SELECT id FROM geo.zones WHERE uid = $zoneUid
        если zone найдена:
          INSERT INTO geo.zone_tags (zone_id, tag)
          VALUES (zone.id, tag)
          ON CONFLICT DO NOTHING

  logger.info(`Мигрированы теги самосвалов`)


  // Шаг 3: архивировать исходные файлы
  fs.renameSync('config/geozones.geojson',        'config/archive/geozones.geojson.bak')
  fs.renameSync('config/dump-trucks-config.json', 'config/archive/dump-trucks-config.json.bak')
  logger.info('Исходные файлы архивированы. Миграция завершена.')
```

---

## 6. Admin UI — архитектура клиента

### 6.1. Стек

- **Leaflet** + **Leaflet.draw** — карта и рисование полигонов (OSM тайлы, работает без VPN)
- **Vanilla TypeScript** — без фреймворков, UI простой
- Хостится самим `geo-admin/server` как статика (`/admin`)

### 6.2. Структура страницы

```
┌─────────────────────────────────────────────────────────┐
│  Geo-Admin — Управление зонами                          │
├───────────────────┬─────────────────────────────────────┤
│  ОБЪЕКТЫ          │                                     │
│  ─────────────    │           КАРТА (Leaflet)           │
│  + Новый объект   │                                     │
│                   │   [полигоны всех зон на карте]      │
│  ▼ Сингапай       │                                     │
│    ○ boundary     │   При клике на полигон:             │
│    ● loading      │   ┌──────────────────┐              │
│    ● onsite       │   │ Карьер Сингапай  │              │
│    ○ unloading    │   │ Теги: dt_loading │              │
│                   │   │       dt_onsite  │              │
│  ▶ Тобольск мост  │   │ [Изменить]       │              │
│  ▶ НПС Тюмень     │   │ [Удалить]        │              │
│                   │   └──────────────────┘              │
│  ─────────────    │                                     │
│  [Нарисовать зону]│                                     │
└───────────────────┴─────────────────────────────────────┘
```

### 6.3. Флоу создания зоны

```pseudocode
// 1. Пользователь нажимает "Нарисовать зону"
activateLeafletDraw()  // включает режим рисования полигона

// 2. Пользователь рисует полигон на карте
on('draw:created', event):
  geometry = event.layer.toGeoJSON().geometry  // GeoJSON Polygon

  // 3. Показать форму в попапе
  showForm({
    fields: [
      { name: 'objectUid',  type: 'select',    label: 'Объект',    options: loadedObjects },
      { name: 'zoneName',   type: 'text',      label: 'Название зоны' },
      { name: 'tags',       type: 'checkboxes', label: 'Теги',
        options: [
          { value: 'dt_boundary',  label: 'Граница объекта (самосвалы)' },
          { value: 'dt_loading',   label: 'Зона погрузки (самосвалы)' },
          { value: 'dt_unloading', label: 'Зона выгрузки (самосвалы)' },
          { value: 'dt_onsite',    label: 'Работа по месту (самосвалы)' },
          { value: 'dst_zone',     label: 'Рабочая зона (КИП/ДСТ)' },
        ]
      }
    ]
  })

// 4. Пользователь заполняет форму и нажимает "Сохранить"
on('form:submit', data):
  response = POST /api/geo/zones {
    objectUid: data.objectUid,
    name:      data.zoneName,
    tags:      data.tags,
    geometry:  geometry
  }
  // 5. Добавить полигон на карту с нужным цветом
  addPolygonToMap(response, colorByTags(response.tags))
  // 6. Обновить левую панель
  refreshSidebar()
```

### 6.4. Цветовая схема полигонов

```pseudocode
функция colorByTags(tags):
  если tags.includes('dt_boundary'):  вернуть { color: '#888888', fillOpacity: 0.1 }
  если tags.includes('dt_loading'):   вернуть { color: '#2e7d32', fillOpacity: 0.3 }
  если tags.includes('dt_unloading'): вернуть { color: '#e65100', fillOpacity: 0.3 }
  если tags.includes('dt_onsite'):    вернуть { color: '#1565c0', fillOpacity: 0.25 }
  если tags.includes('dst_zone'):     вернуть { color: '#6a1b9a', fillOpacity: 0.2 }
  вернуть { color: '#555555', fillOpacity: 0.2 }  // неизвестный тег

// Если у зоны несколько тегов — приоритет по порядку выше
// boundary > loading > unloading > onsite > dst_zone
```

---

## 7. Переменные окружения

```
# Общие с остальными модулями (тот же PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=
DB_USER=postgres
DB_PASSWORD=

# Geo-admin сервер
GEO_SERVER_PORT=3003
```

---

## 8. Как КИП мигрирует на схему geo

**До миграции** (текущее состояние КИП):
```pseudocode
// geozoneAnalyzer.ts в КИП
geozones = loadGeoJSON('config/geozones.geojson')
filtered = geozones.filter(f => controlType===1 && zoneName.startsWith("СМУ"))
// Turf.js: booleanPointInPolygon для каждой точки трека
```

**После миграции:**
```pseudocode
// Загрузка зон при старте сервера КИП (один раз, кешируем в память)
функция loadDstZones():
  rows = db.query(`
    SELECT z.uid, z.name, ST_AsGeoJSON(z.geom)::jsonb AS geom
    FROM geo.zones z
    JOIN geo.zone_tags zt ON zt.zone_id = z.id
    WHERE zt.tag = 'dst_zone'
  `)
  // Конвертируем в формат который ожидает существующий geozoneAnalyzer.ts
  вернуть rows.map(r => ({
    properties: { uid: r.uid, zoneName: r.name },
    geometry:   r.geom
  }))

// geozoneAnalyzer.ts — логика не меняется, только источник данных
zones = loadDstZones()  // вместо loadGeoJSON(...)
```

Изменение минимальное — только источник загрузки зон. Вся логика анализа трека в КИП остаётся нетронутой.

---

## 9. Поток данных (итоговая схема)

```
geo-admin UI (Leaflet.draw)
  │
  POST /api/geo/zones или /objects
  │
  geo-admin/server (Express :3003)
  │
  WRITE → PostgreSQL: схема geo
            geo.objects
            geo.zones      (PostGIS GEOMETRY)
            geo.zone_tags
            │
            │  READ напрямую
            ├─────────────────────────→ server/ (КИП)
            │                            WHERE tag = 'dst_zone'
            │                            geozoneAnalyzer.ts (без изменений)
            │
            └─────────────────────────→ dump-trucks/server/ (Самосвалы)
                                         WHERE tag LIKE 'dt_%'
                                         buildZoneEvents (PostGIS ST_Contains)
```

---

*Документ актуален на 18.02.2026.*
*Следующий шаг: детализация репозиториев КИП после миграции на geo схему.*
