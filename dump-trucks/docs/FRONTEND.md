# Dump Trucks — Frontend Reference

## Обзор

- Стек: React 18 + TypeScript + Tailwind CSS v4 + `next-themes`
- Порт: через `frontend/` (`:5173`)
- Роут: `/samosvaly`
- Прокси Vite: `/api/dt` → `http://localhost:3002`

## Файловая структура

```
frontend/src/features/samosvaly/
├── DumpTrucksPage.tsx  — главная страница (единый компонент ~3100 строк)
├── api.ts              — функции запросов к /api/dt/*
├── types.ts            — TypeScript-интерфейсы
├── samosvaly.css       — все стили компонента (CSS-переменные + классы sv-*)
└── index.ts            — реэкспорт DumpTrucksPage
```

---

## Компоненты

### DumpTrucksPage

Корневой компонент страницы. Управляет глобальным состоянием и отрисовывает три таба.

**State:**

| Имя | Тип | Описание |
|-----|-----|----------|
| `activeTab` | `'orders' \| 'analytics' \| 'gantt'` | Активная вкладка |
| `expandedOrders` | `Set<number>` | Раскрытые карточки заявок (по номеру заявки) |
| `constructorOpen` | `boolean` | Панель конструктора таблицы (аналитика) |
| `groupByCargo` | `boolean` | Группировка заявок по типу груза |
| `groupByStatus` | `boolean` | Группировка заявок на Активные/Закрытые (default: ON) |
| `searchQuery` | `string` | Поиск по номеру заявки, госномеру, грузу |
| `orderMonth` | `string` | Выбранный месяц заявок (`YYYY-MM`), дефолт — текущий |
| `dateFrom` / `dateTo` | `string` | Период аналитики (YYYY-MM-DD) |
| `orderNorms` | `Map<number, number>` | Серверные нормы (request_number → trips_per_shift) |
| `localNormEdits` | `Map<number, number>` | Локальные правки норм (не сохранённые) |
| `normPopup` | объект или null | Popup редактирования нормы |
| `isAllTime` | `boolean` | Ганта: показывать все данные без ограничения месяцем |
| `currentUser` | `string \| null` | Имя профиля настроек (localStorage) |
| `userSettings` | `UserSettings` | Настройки конструктора |
| `analyticsFilters` | `AnalyticsFilters` | Фильтры вкладки Аналитика |

**Расчётные рейсы (нормы):**

- `defaultNorm(card)` = `Math.round(planTrips / countTs / max(durationDays-1, 1) / 2)` — где `durationDays` = разница dateFrom/dateTo (не +1)
- `effectiveNorm(orderNumber)` = `localNormEdits ?? orderNorms ?? defaultNorm` — каскадный приоритет
- Кнопка «Обновить расчётные рейсы» появляется при наличии `localNormEdits`, POST → `/api/dt/order-norms`

**Поиск:**

- В табах «Заявки» и «Ганта» есть поле поиска
- Фильтрация по: номер заявки, госномер ТС, название груза
- В «Заявки»: фильтрует OrderCard'ы
- В «Ганта»: фильтрует ТС (по номеру или по связанным заявкам)

**Визуально:**

- Sub-header: переключатель табов → поиск → месячная навигация / date range → фильтры → профиль
- Таб «Заявки»: toggles «По статусу» + «По грузу» + сортировки; OrderCardView по городам; WeeklySidebar справа
- Таб «Аналитика»: AnalyticsTab + TableConstructorPanel
- Таб «Ганта»: GlobalGanttTab с зумом и развёрткой по заявкам

---

### GanttTable

Таблица Ганта для одной заявки. Загружает данные через `fetchOrderGantt(orderNumber)`.

**Props:** `orderNumber`, `dateFromIso`, `dateToIso`, `ordersMap`, `theme`, `norm`

**Цветовая кодировка ячеек** (по норме заявки):

| Условие | Цвет | CSS class |
|---------|------|-----------|
| `trips === norm` | синий `#60A5FA` | без доп. класса |
| `trips > norm` | зелёный `#22c55e` | `.norm-over` |
| `trips === norm - 1` | жёлтый `#FBBF24` | `.norm-warn` |
| `trips <= norm - 2` | красный `#EF4444` | `.norm-under` |
| `norm === 0` | синий (без кодировки) | — |

**Скобки в столбцах** (даты):
- Оранжевые: `[факт/план]` — план = (кол-во ТС с рейсами в shift1 + shift2) × norm
- Фиолетовые: `s1|s2` — кол-во ТС с рейсами в 1-й | 2-й смене

**Скобки в строках** (ТС):
- Оранжевые: `[факт/план]` — план = кол-во смен с рейсами × norm
- Фиолетовые: `(N)` — кол-во смен с рейсами

**Авто-прокрутка:** при первой загрузке прокручивается так, чтобы сегодняшний день был крайним правым столбцом.

**Ячейки:**
- Число > 0 — кликабельно → popup `ShiftSubTable`
- `=N` — ТС работало по нескольким заявкам одновременно
- `!` — ТС на объекте, но 0 рейсов
- `—` — ТС в ПЛ, но не на объекте заявки
- `→←` — ТС работало по другой заявке на этом объекте

---

### GlobalGanttTab

Глобальная ганта — все ТС по всем объектам.

**Props:** `orderMonth`, `orders`, `isAllTime`, `effectiveNorm`, `searchQuery`

Группирует ТС по объектам. Каждое ТС можно раскрыть по заявкам (sub-rows). При раскрытии верхняя (сводная) строка подсвечивается полупрозрачным фоном.

**Цветовая кодировка:** аналогична GanttTable. Для основной строки (не раскрытой): если у всех заявок в ячейке одинаковая норма — кодировка по ней; если разные — синий (без кодировки). Sub-rows кодируются по норме своей заявки.

**Скобки:** аналогичны GanttTable, но planned для строк вычисляется как сумма max(norms) по каждой смене (ТС не может выполнить сумму норм разных заявок).

**Зум:** кнопки +/− меняют pageSize (8/12/16/24/31 дней). Контрол позиционирован абсолютно в правом верхнем углу (не прилипает при скролле).

---

### OrderCardView

Карточка заявки с прогресс-баром и раскрывающейся GanttTable.

**Props:** `card`, `expanded`, `onToggle`, `ordersMap`, `theme`, `norm`, `onNormClick`

Отображает:
- Номер заявки, маршрут (→ туда / ← обратно), route points с проверкой принадлежности к dt_boundary
- Бейдж статуса: `● работа` / `✓ закрыто`
- Метрики: рейсы, ТС, вес, объём (через `Fraction`)
- `tripsPerVehDay` — рейсов ТС/смена (серверная метрика AVG по сменам)
- **Purple box** — расчётные рейсы за смену (кликабельный, открывает popup с +/−)
- При `expanded=true`: GanttTable с нормой

---

### WeeklySidebar

Правая панель на вкладке «Заявки» — еженедельная сводка по объектам.

---

### ShiftSubTable

Детализация смены: таблица рейсов с временами въезда/выезда из зон.

---

### AnalyticsTab

Вкладка «Аналитика» — трёхуровневая таблица с группировкой ТС → заявка → день → смена.

---

## API-слой (`api.ts`)

Базовый URL: `/api/dt` (проксируется Vite на `http://localhost:3002`).

| Функция | Endpoint | Возвращает |
|---------|----------|------------|
| `fetchObjects()` | `GET /api/dt/objects` | `DtObject[]` |
| `fetchOrders(dateFrom, dateTo)` | `GET /api/dt/orders?dateFrom=...&dateTo=...` | `OrderSummary[]` |
| `fetchOrderGantt(number)` | `GET /api/dt/orders/:number/gantt` | `GanttResponse` |
| `fetchShiftRecords(params)` | `GET /api/dt/shift-records?...` | `ShiftRecord[]` |
| `fetchShiftDetail(shiftRecordId)` | `GET /api/dt/shift-detail?shiftRecordId=...` | `{ trips, zoneEvents }` |
| `fetchRepairs(objectName?)` | `GET /api/dt/repairs?objectName=...` | `Repair[]` |
| `fetchOrderNorms()` | `GET /api/dt/order-norms` | `{ request_number, trips_per_shift }[]` |
| `saveOrderNorms(norms)` | `POST /api/dt/order-norms` | void |

---

## Типы данных (`types.ts`)

### OrderSummary
Сырой ответ от `/api/dt/orders`. Включает `trips_per_veh_day` — серверная метрика рейсов ТС/смена.

### OrderCard
Обработанная версия `OrderSummary`. Ключевые поля:
- `dateFromIso` / `dateToIso` — из TIS route points
- `tripsPerVehDay` — рейсов ТС/смена (число)
- `pct`, `isDone`, `city`, `cargo`, `countTs`, `planTrips`

### GanttRecord / GanttPresence / GanttResponse
Данные для GanttTable: записи смен, presence (работа по другим заявкам), dateFrom/dateTo.

### ShiftRecord
Основная KPI-запись смены. Дополнительные агрегаты: avgLoadingDwellSec, avgUnloadingDwellSec, avgTravelToUnloadMin, avgReturnToLoadMin.

### Repair
Запись о ремонте/ТО: `type` (`repair` / `maintenance`).

---

## Цветовая кодировка

### КИП (`kipColor`)
| КИП % | Цвет |
|-------|------|
| >= 75 | Зелёный |
| >= 50 | Оранжевый |
| < 50 | Красный |

### Нормы рейсов (ячейки ганты)
| Условие | Цвет |
|---------|------|
| `trips > norm` | Зелёный `#22c55e` |
| `trips === norm` | Синий `#60A5FA` |
| `trips === norm - 1` | Жёлтый `#FBBF24` |
| `trips <= norm - 2` | Красный `#EF4444` |

---

## Особенности реализации

- Временная зона: `Asia/Yekaterinburg`
- «Самосвал» обрезается из названия ТС (`stripSamosvaly`)
- Город заявки = `object_names[0]`
- Даты заявок из TIS route points (DD.MM.YYYY → YYYY-MM-DD)
- `request_numbers` — `INTEGER[]`; один shift_record может ссылаться на несколько заявок
- Нормы персистируются в `dump_trucks.order_norms` (PG17)
- Поиск фильтрует по номеру заявки, госномеру, грузу (клиентская фильтрация)
- GanttTable авто-прокручивается к сегодняшнему дню при первой загрузке
