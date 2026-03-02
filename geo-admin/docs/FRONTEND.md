# Geo Admin — Frontend Reference

## Обзор

- Стек: Vanilla TypeScript + Leaflet (НЕ React!)
- Порт: 3003 (Express раздаёт статику)
- URL: http://localhost:3003/admin
- Отдельный от основного `frontend/` (там React + Vite)
- Leaflet загружается с CDN (unpkg), TypeScript компилируется через `tsc`
- Нет сборщика (Webpack/Vite) — прямая компиляция TypeScript в ES2020 модули

## Файловая структура

```
geo-admin/client/src/
├── index.html        — HTML-оболочка, точка входа браузера
├── main.ts           — точка входа приложения, оркестратор
├── map.ts            — Leaflet карта, рендер объектов/зон
├── sidebar.ts        — боковая панель, список объектов, модальные формы
├── api.ts            — fetch-клиент к /api/geo/*
├── leaflet-draw.d.ts — TypeScript-объявления для leaflet-draw
└── styles.css        — все стили (не Tailwind, нативный CSS)

geo-admin/client/dist/
└── *.js              — скомпилированный TypeScript (вывод tsc)
```

Express раздаёт статику двумя путями:
- `client/dist/` — скомпилированные `.js` файлы (ES2020 modules)
- `client/src/` — `index.html` и `styles.css` (исходники)

## Сборка клиента

```bash
cd geo-admin/server/
npm run build:client   # tsc -p ../client/tsconfig.json
```

Настройки `client/tsconfig.json`:
- `target: ES2020`, `module: ES2020`
- `outDir: ./dist`, `rootDir: ./src`
- Строгий режим (`strict: true`)

## Модули

### index.html (`geo-admin/client/src/index.html`)

HTML-оболочка приложения. Подключает:
- `leaflet@1.9.4` с CDN (CSS + JS)
- `leaflet-draw@1.0.4` с CDN (CSS + JS)
- `styles.css` локально
- `<script type="module" src="main.js">` — скомпилированный бандл

Структура DOM:
- `.header` — заголовок «Гео-Объекты»
- `.layout` — flex-контейнер
  - `.sidebar` — боковая панель (300px), кнопки-фильтры «ДСТ» / «Самосвалы»
  - `#map` — контейнер Leaflet-карты (занимает оставшееся пространство)
- `#modal` + `#modal-content` — модальный оверлей для форм
- `#error-banner` — всплывающий баннер ошибок (исчезает через 5 сек)

### main.ts (`geo-admin/client/src/main.ts:1`)

Точка входа приложения. Оркестрирует взаимодействие `map`, `sidebar`, `api`.

Состояние модуля:
- `loadedObjects` — кэш списка объектов (`GeoObject[]`)
- `pendingGeometry` — временное хранилище геометрии нарисованного полигона (до сохранения)
- `currentFilter` — текущий фильтр зон (`'dst'` | `'dt'`), дефолт: `'dst'`
- `currentOpenObjectUid` — uid раскрытого объекта в сайдбаре

Основные функции:

**`init()`** — запускается при `DOMContentLoaded`:
1. Инициализирует карту (`mapModule.initMap()`)
2. Инициализирует сайдбар с колбэками
3. Загружает список объектов из API
4. Загружает зоны по текущему фильтру (`loadZones('dst')`)
5. Навешивает обработчики: переключатель фильтра, кнопка «Нарисовать зону», Escape, событие `draw:created`

**`loadZones(filter)`** — загружает зоны на карту:
- `'dst'` → загружает теги `['dst_zone', 'dt_boundary']`
- `'dt'` → загружает теги `['dt_loading', 'dt_unloading', 'dt_boundary']`
- Дедуплицирует зоны по uid (одна зона может иметь несколько тегов)
- Фильтрует список объектов в сайдбаре — показывает только те, у которых есть видимые зоны

**`handleDeleteZone(uid)`** — удаляет зону после подтверждения:
- Вызывает `api.deleteZone(uid)`
- Убирает полигон с карты `mapModule.removeZoneFromMap(uid)`

**`showEditZoneModal(uid, data)`** — открывает форму редактирования зоны:
- После сохранения перезагружает зоны на карте
- Обновляет список зон в сайдбаре для открытого объекта

Поток создания зоны:
1. Пользователь нажимает «Нарисовать зону» → `activateLeafletDraw()`
2. Пользователь рисует полигон на карте
3. Событие `draw:created` → геометрия сохраняется в `pendingGeometry`
4. Открывается форма `showNewZoneForm` → пользователь выбирает объект, название, теги
5. `api.createZone(...)` → зона добавляется на карту

### map.ts (`geo-admin/client/src/map.ts:1`)

Инкапсулирует Leaflet-карту. `L` объявлен как `any` (загружен с CDN).

Константы цветов по тегам:
| Тег | Цвет контура | Прозрачность заливки |
|-----|-------------|---------------------|
| `dt_boundary` | `#888888` (серый) | 0.10 |
| `dt_loading` | `#2e7d32` (зелёный) | 0.30 |
| `dt_unloading` | `#e65100` (оранжевый) | 0.30 |
| `dt_onsite` | `#1565c0` (синий) | 0.25 |
| `dst_zone` | `#6a1b9a` (фиолетовый) | 0.20 |

При наличии нескольких тегов используется приоритет: `dt_boundary > dt_loading > dt_unloading > dt_onsite > dst_zone`.

Внутреннее состояние модуля:
- `map` — экземпляр Leaflet-карты
- `drawnLayer` — `L.FeatureGroup` для временных нарисованных слоёв
- `activeDrawHandler` — текущий обработчик рисования (`L.Draw.Polygon` или `null`)
- `zoneLayerMap` — `Map<uid, LeafletPolygon>` для быстрого доступа к слоям

Основные функции:
- **`initMap()`** — создаёт карту с центром [57.15, 65.55] (Тюмень), zoom 11, тайлы OpenStreetMap
- **`activateLeafletDraw()`** — активирует инструмент рисования полигона (leaflet-draw); подсвечивает кнопку синей рамкой
- **`deactivateLeafletDraw()`** — отключает рисование, очищает `drawnLayer`, убирает подсветку кнопки
- **`addZoneToMap(feature, onClickDelete?)`** — добавляет GeoJSON Feature (Polygon) на карту; создаёт popup с кнопкой удаления; регистрирует глобальный `window.__geoAdminDeleteZone` для обработки клика из popup HTML
- **`addZoneFromModel(zone, onDelete?)`** — обёртка над `addZoneToMap`, принимает `GeoZone` из API
- **`removeZoneFromMap(uid)`** — убирает полигон с карты, удаляет из `zoneLayerMap`
- **`clearAllZones()`** — убирает все зоны с карты
- **`zoomToZone(uid)`** — `map.fitBounds()` на зону по uid
- **`zoomToFeature(feature)`** — `map.fitBounds()` на GeoJSON Feature
- **`colorByTags(tags)`** — возвращает `{color, fillOpacity}` по массиву тегов

### sidebar.ts (`geo-admin/client/src/sidebar.ts:1`)

Управляет левой панелью: список объектов, список зон, модальные окна.

Основные функции:

**`initSidebar(handlers)`** — инициализация, навешивает обработчик на кнопку «+ Объект»

**`renderObjectList(objects)`** — перерисовывает список объектов. Каждый элемент:
- Стрелка-аккордеон + название + бейдж с количеством зон
- Строка СМУ (если есть)
- Клик по заголовку: раскрывает/закрывает (accordion), вызывает `onObjectSelect(uid)`

**`showObjectZones(objectUid, zones, handlers)`** — рендерит список зон внутри объекта:
- Название зоны с цветными тег-бейджами
- Три кнопки: «Приблизить», «Редактировать», «Удалить»

**`showNewObjectForm(onSubmit)`** — модальная форма создания объекта (поля: Название, СМУ, Регион)

**`showNewZoneForm(objects, onSubmit)`** — модальная форма создания зоны (выбор объекта из списка, название, чекбоксы тегов)

**`showEditZoneForm(current, onSubmit)`** — модальная форма редактирования зоны (название + теги, предзаполненные текущими значениями)

**`hideModal()`** — скрывает модальный оверлей

**`showError(message)`** — показывает красный баннер внизу справа, исчезает через 5 секунд

Цвета тег-бейджей:
| Тег | Класс | Цвет |
|-----|-------|------|
| `dt_boundary` | `zone-tag-boundary` | серый |
| `dt_loading` | `zone-tag-loading` | зелёный |
| `dt_unloading` | `zone-tag-unloading` | оранжевый |
| `dt_onsite` | `zone-tag-onsite` | синий |
| `dst_zone` | `zone-tag-dst` | фиолетовый |

### api.ts (`geo-admin/client/src/api.ts:1`)

Fetch-клиент для API. Базовый путь: `/api/geo` (без хоста — относительный, работает на любом порту).

TypeScript-интерфейсы:
- `GeoObject` — `{ id, uid, name, smu, region, zone_count? }`
- `GeoZone` — `{ id, uid, object_id, name, tags, geometry: GeoJSON.Polygon }`
- `ObjectWithZones` — `{ object: GeoObject, zones: GeoJSON.FeatureCollection }`

Вызовы API:
| Функция | Метод | Путь |
|---------|-------|------|
| `getObjects()` | GET | `/api/geo/objects` |
| `getObject(uid)` | GET | `/api/geo/objects/:uid` |
| `createObject(data)` | POST | `/api/geo/objects` |
| `updateObject(uid, data)` | PUT | `/api/geo/objects/:uid` |
| `deleteObject(uid)` | DELETE | `/api/geo/objects/:uid` |
| `createZone(data)` | POST | `/api/geo/zones` |
| `updateZone(uid, data)` | PUT | `/api/geo/zones/:uid` |
| `deleteZone(uid)` | DELETE | `/api/geo/zones/:uid` |
| `getZonesByObject(uid, tags?)` | GET | `/api/geo/zones/by-object/:objectUid[?tags=...]` |
| `getZonesByTag(tag)` | GET | `/api/geo/zones/by-tag/:tag` |

Обработка ошибок: при `!res.ok` парсит JSON с полем `error`, бросает `Error`.

### styles.css (`geo-admin/client/src/styles.css`)

Нативный CSS без препроцессоров. Layout: `flex-direction: column; height: 100vh`.

Основные секции:
- `.header` — шапка (тёмно-синяя, `#0f172a`)
- `.layout` — горизонтальный flex: `.sidebar` (300px) + `#map` (flex: 1)
- `.filter-btn` / `.filter-btn.active` — переключатель ДСТ/Самосвалы
- `.object-item` / `.zone-item` — элементы списков (аккордеон)
- `.zone-tag-*` — цветные бейджи тегов
- `.btn-primary` (оранжевый `#f97316`) / `.btn-secondary` / `.btn-cancel`
- `.modal-overlay` / `.modal-box` — модальное окно (400px, тень)
- `#error-banner` — фиксированный красный баннер (bottom-right)

### leaflet-draw.d.ts

TypeScript-объявления для `leaflet-draw` (загружается с CDN как глобальный `L.Draw`). Содержит типы для `L.Draw.Polygon` и события `draw:created`.
