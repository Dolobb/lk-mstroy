# Geo Admin — Руководство

## Руководство пользователя

### Основной сценарий

1. Запустить сервер (см. раздел «Запуск» ниже)
2. Открыть http://localhost:3003/admin
3. В боковой панели слева выбрать фильтр: **ДСТ** (зоны КИП/ДСТ) или **Самосвалы** (зоны погрузки/выгрузки)
4. На карте отображаются геозоны, окрашенные по типу тега
5. В левой панели список объектов — клик раскрывает список зон объекта

### Просмотр зон объекта

1. Нажать на название объекта в сайдбаре — объект раскрывается (аккордеон)
2. Карта автоматически приближается к первой зоне с тегом `dt_boundary`, иначе к первой зоне объекта
3. В раскрытом объекте виден список зон с тегами
4. Кнопка «Приблизить» (лупа) — zoom к зоне на карте
5. Клик на полигон на карте — popup с названием, тегами и кнопкой «Удалить»

### Создание объекта

1. Нажать кнопку **«+ Объект»** в верхней части сайдбара
2. Заполнить форму:
   - **Название объекта** (обязательно) — например: «Карьер Сингапай»
   - **СМУ** (необязательно) — структурное подразделение: «СМУ г. Тюмень»
   - **Регион** (необязательно) — «Тюменская область»
3. Нажать «Создать»
4. Объект появится в списке сайдбара

### Создание зоны

1. Нажать кнопку **«Нарисовать зону»** — кнопка подсветится синей рамкой
2. Нарисовать полигон на карте (кликами добавлять точки, двойной клик — завершить)
3. Нажать `Escape` для отмены рисования
4. После завершения автоматически открывается форма:
   - **Объект** — выбрать из выпадающего списка
   - **Название зоны** (обязательно)
   - **Теги** — чекбоксы:
     - `dt_boundary` — Граница объекта (самосвалы)
     - `dt_loading` — Зона погрузки (самосвалы)
     - `dt_unloading` — Зона выгрузки (самосвалы)
     - `dt_onsite` — Работа по месту (самосвалы)
     - `dst_zone` — Рабочая зона (КИП/ДСТ)
5. Нажать «Сохранить» — зона появится на карте

### Редактирование зоны

1. Раскрыть объект в сайдбаре
2. Нажать кнопку «Редактировать» (карандаш) у нужной зоны
3. Изменить название и/или теги
4. Нажать «Сохранить»

Изменение геометрии зоны через UI не поддерживается — только через прямой API-запрос.

### Удаление зоны

- Из сайдбара: кнопка «Удалить» (корзина) у зоны в списке → подтверждение
- Из popup на карте: кнопка «Удалить» в popup → подтверждение (без confirm-диалога, удаляется сразу)

### Фильтры зон на карте

| Режим | Отображаемые теги |
|-------|-----------------|
| ДСТ (по умолчанию) | `dst_zone` + `dt_boundary` |
| Самосвалы | `dt_loading` + `dt_unloading` + `dt_boundary` |

При переключении фильтра карта очищается и перезагружается. Список объектов в сайдбаре также фильтруется — показываются только объекты, имеющие зоны с текущими тегами.

---

## Руководство разработчика

### Запуск

```bash
cd geo-admin/server/
npm install
npm run dev        # tsx watch src/index.ts — Express + авто-перезапуск на :3003
```

Клиент отдаётся статически с того же порта:
- `http://localhost:3003/admin` — UI
- `http://localhost:3003/api/geo/*` — API

### Сборка клиента (TypeScript → JS)

```bash
cd geo-admin/server/
npm run build:client   # tsc -p ../client/tsconfig.json → client/dist/*.js
```

Запускать после изменений в `client/src/*.ts`. В режиме `dev` сборка не происходит автоматически — нужно пересобирать вручную или настроить watch.

### Применение миграций БД

```bash
cd geo-admin/server/
npm run migrate        # tsx src/migrate.ts — применяет новые SQL-файлы из migrations/
```

Скрипт читает `server/migrations/*.sql` по алфавиту, пропускает уже применённые (по записям в `geo._migrations`).

### Импорт геозон из KIP

```bash
cd geo-admin/server/
npm run migrate-geo    # tsx src/services/migrationService.ts
```

Или через HTTP (идемпотентно):
```bash
curl -X POST http://localhost:3003/api/geo/admin/migrate-from-files
```

Источник: `kip/config/geozones.geojson` — фильтр `controlType === 1`.

### Продакшн-сборка

```bash
cd geo-admin/server/
npm run build          # tsc → dist/
npm start              # node dist/index.js
```

### Переменные окружения

Файл: `geo-admin/server/.env` (не коммитится)

| Переменная | Значение по умолчанию | Описание |
|-----------|----------------------|---------|
| `DB_HOST` | `localhost` | Хост PostgreSQL 17 |
| `DB_PORT` | `5433` | Порт PostgreSQL 17 (не 5432!) |
| `DB_NAME` | `mstroy` | Имя базы данных |
| `DB_USER` | `postgres` | Пользователь БД |
| `DB_PASSWORD` | `` (пусто) | Пароль БД |
| `GEO_SERVER_PORT` | `3003` | Порт Express-сервера |
| `NODE_ENV` | `development` | Окружение (влияет на DEBUG-логи) |

Важно: `DB_PORT` по умолчанию в `migrate.ts` — `5432`, а в `config/env.ts` — `5433`.
При запуске `npm run migrate` убедиться что в `.env` явно указан `DB_PORT=5433`.

### Важно: пути к .env

Разные файлы загружают `.env` из разных путей:

| Файл | Путь к .env |
|------|------------|
| `src/index.ts` (через `config/env.ts`) | `../../.env` (т.е. `geo-admin/server/.env`) |
| `src/migrate.ts` | `../.env` (т.е. `geo-admin/server/.env`) |
| `src/services/migrationService.ts` | `../../.env` (т.е. `geo-admin/server/.env`) |

Все три файла корректно указывают на `geo-admin/server/.env`.

### psql подключение

```bash
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy
```

Полезные запросы:

```sql
-- Статистика объектов и зон
SELECT COUNT(*) FROM geo.objects;
SELECT COUNT(*) FROM geo.zones;

-- Объекты с количеством зон
SELECT o.name, o.smu, COUNT(z.id) AS zones
FROM geo.objects o
LEFT JOIN geo.zones z ON z.object_id = o.id
GROUP BY o.id
ORDER BY zones DESC;

-- Зоны по тегу
SELECT z.name, o.name AS object_name
FROM geo.zones z
JOIN geo.zone_tags zt ON zt.zone_id = z.id
JOIN geo.objects o ON o.id = z.object_id
WHERE zt.tag = 'dst_zone';

-- Все теги и их количество
SELECT tag, COUNT(*) FROM geo.zone_tags GROUP BY tag ORDER BY count DESC;
```

### PostGIS запросы

```sql
-- Центроид зоны
SELECT uid, name, ST_AsGeoJSON(ST_Centroid(geom)) FROM geo.zones LIMIT 5;

-- Площадь зоны (кв. метры, через geography cast)
SELECT uid, name, ST_Area(geom::geography) AS area_m2
FROM geo.zones
ORDER BY area_m2 DESC
LIMIT 10;

-- Зоны, содержащие точку (долгота, широта)
SELECT z.uid, z.name
FROM geo.zones z
WHERE ST_Contains(z.geom, ST_SetSRID(ST_Point(68.9, 58.2), 4326));

-- Зоны в радиусе 5 км от точки
SELECT z.uid, z.name
FROM geo.zones z
WHERE ST_DWithin(
  z.geom::geography,
  ST_Point(68.9, 58.2)::geography,
  5000
);
```

### Как добавить новый тег зоны

1. В `geo-admin/server/src/repositories/zoneRepo.ts` добавить в `ALLOWED_TAGS`:
   ```typescript
   const ALLOWED_TAGS = new Set([
     'dt_boundary', 'dt_loading', 'dt_unloading', 'dt_onsite', 'dst_zone',
     'новый_тег',  // добавить здесь
   ]);
   ```

2. В `geo-admin/client/src/map.ts` добавить цвет в `TAG_COLORS` и приоритет в `TAG_PRIORITY`:
   ```typescript
   const TAG_COLORS: Record<string, ...> = {
     // ...
     'новый_тег': { color: '#xxxxxx', fillOpacity: 0.20 },
   };
   const TAG_PRIORITY = ['dt_boundary', ..., 'новый_тег'];
   ```

3. В `geo-admin/client/src/sidebar.ts` добавить класс бейджа в `TAG_BADGE_CLASS` и отображаемое название в массив `ALL_TAGS` в `showNewZoneForm` и `showEditZoneForm`:
   ```typescript
   const TAG_BADGE_CLASS: Record<string, string> = {
     // ...
     'новый_тег': 'zone-tag-new',
   };
   // В showNewZoneForm / showEditZoneForm:
   const ALL_TAGS = [
     // ...
     { value: 'новый_тег', label: 'Описание нового тега' },
   ];
   ```

4. В `geo-admin/client/src/styles.css` добавить стиль бейджа:
   ```css
   .zone-tag-new { background: #xxxxxx; color: #yyyyyy; }
   ```

5. Пересобрать клиент: `npm run build:client`

### Как добавить новый SQL-запрос / endpoint

1. Добавить функцию в соответствующий репозиторий (`objectRepo.ts` или `zoneRepo.ts`)
2. Добавить endpoint в `src/index.ts` с нужным методом и путём под `/api/geo/`
3. При необходимости добавить тип в `client/src/api.ts` и функцию-обёртку
4. Перезапустить сервер (`npm run dev` перезапустится автоматически через tsx watch)

### Структура пакета

```
geo-admin/
├── server/
│   ├── src/
│   │   ├── index.ts              — Express app, все routes
│   │   ├── migrate.ts            — CLI для SQL-миграций
│   │   ├── config/
│   │   │   ├── database.ts       — pg Pool (singleton)
│   │   │   └── env.ts            — getEnvConfig() из .env
│   │   ├── repositories/
│   │   │   ├── objectRepo.ts     — CRUD geo.objects
│   │   │   └── zoneRepo.ts       — CRUD geo.zones + zone_tags
│   │   ├── services/
│   │   │   └── migrationService.ts — импорт из geozones.geojson
│   │   └── utils/
│   │       ├── logger.ts         — console logger с timestamp
│   │       └── slugify.ts        — транслитерация + uniqueObjectUid
│   ├── migrations/
│   │   └── 001_geo_schema.sql    — создание схемы, таблиц, индексов
│   ├── dist/                     — скомпилированный JS (tsc)
│   ├── package.json
│   └── tsconfig.json
└── client/
    ├── src/
    │   ├── index.html            — HTML-оболочка
    │   ├── main.ts               — точка входа, оркестратор
    │   ├── map.ts                — Leaflet-карта
    │   ├── sidebar.ts            — боковая панель, формы
    │   ├── api.ts                — fetch к /api/geo/*
    │   ├── leaflet-draw.d.ts     — TypeScript-объявления leaflet-draw
    │   └── styles.css            — стили
    ├── dist/                     — скомпилированный JS (tsc)
    └── tsconfig.json
```

### Зависимости сервера

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| `express` | ^4.21.0 | HTTP-сервер |
| `cors` | ^2.8.5 | CORS headers |
| `pg` | ^8.13.0 | PostgreSQL клиент |
| `nanoid` | ^3.3.7 | Генерация uid для зон (`zone_${nanoid(8)}`) |
| `dotenv` | ^16.4.0 | Загрузка .env |
| `tsx` | ^4.19.0 | dev-запуск TypeScript без компиляции |
| `typescript` | ^5.4.0 | Компилятор |

### Зависимости клиента (CDN)

| Библиотека | Версия | URL |
|-----------|--------|-----|
| Leaflet | 1.9.4 | `https://unpkg.com/leaflet@1.9.4/dist/` |
| leaflet-draw | 1.0.4 | `https://unpkg.com/leaflet-draw@1.0.4/dist/` |
