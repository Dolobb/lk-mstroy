# Dump Trucks — Frontend Reference

## Обзор

- Стек: React 18 + TypeScript + Tailwind CSS v4 + `next-themes`
- Порт: через `frontend/` (`:5173`)
- Роут: `/samosvaly`
- Прокси Vite: `/api/dt` → `http://localhost:3002`

## Файловая структура

```
frontend/src/features/samosvaly/
├── DumpTrucksPage.tsx  — главная страница (единый компонент ~1230 строк)
├── api.ts              — функции запросов к /api/dt/*
├── types.ts            — TypeScript-интерфейсы
├── samosvaly.css       — все стили компонента (CSS-переменные + классы sv-*)
└── index.ts            — реэкспорт DumpTrucksPage
```

---

## Компоненты

### DumpTrucksPage (`DumpTrucksPage.tsx:1014`)

Корневой компонент страницы. Управляет глобальным состоянием и отрисовывает два таба.

**State:**

| Имя | Тип | Описание |
|-----|-----|----------|
| `activeTab` | `'orders' \| 'analytics'` | Активная вкладка |
| `reportOpen` | `boolean` | Открыта ли панель формирования отчёта (справа) |
| `expandedOrders` | `Set<number>` | Раскрытые карточки заявок (по номеру заявки) |
| `dateFrom` | `string` | Дата начала периода (YYYY-MM-DD), дефолт — 1-е число текущего месяца |
| `dateTo` | `string` | Дата конца периода (YYYY-MM-DD), дефолт — сегодня |
| `analyticsFilters` | `AnalyticsFilters` | Фильтры вкладки Аналитика |
| `objects` | `DtObject[]` | Список объектов из `/api/dt/objects` |
| `orders` | `OrderCard[]` | Список обработанных заявок из `/api/dt/orders` |
| `shiftRecords` | `ShiftRecord[]` | Данные смен из `/api/dt/shift-records` |
| `repairs` | `Repair[]` | Ремонты из `/api/dt/repairs` |
| `loadingOrders` | `boolean` | Флаг загрузки заявок |
| `loadingRecords` | `boolean` | Флаг загрузки смен |

**Визуально:**

- Sub-header с переключателем табов, датами, фильтрами аналитики
- Таб «Заявки»: список `OrderCardView`, сгруппированный по городам + `WeeklySidebar` справа
- Таб «Аналитика»: `AnalyticsTab` + опциональная панель `sv-an-right` (placeholder отчётов)

**Данные:**
- При монтировании: `fetchObjects()`, `fetchRepairs()`
- При изменении периода дат: `fetchOrders(dateFrom, dateTo)`, `fetchShiftRecords({ dateFrom, dateTo })`

---

### MiniDonut (`DumpTrucksPage.tsx:152`)

SVG-диаграмма «бублик» — показывает процент движения за смену.

**Props:** `mov: number` (процент движения), `size?: number` (размер, дефолт 70)

Визуально: зелёный сегмент = движение, красный = стоянка, в центре число процентов.

---

### GanttTable (`DumpTrucksPage.tsx:179`)

Таблица Ганта для заявки. Загружает данные при монтировании через `fetchOrderGantt(orderNumber)`.

**Props:** `orderNumber: number`

Строки = самосвалы, столбцы = даты × смены (1 / 2). Ячейка = количество рейсов за смену (заполнена если > 0).

---

### OrderCardView (`DumpTrucksPage.tsx:267`)

Карточка заявки с прогресс-баром и раскрывающейся таблицей Ганта.

**Props:** `card: OrderCard`, `expanded: boolean`, `onToggle: () => void`

Отображает:
- Номер заявки, маршрут `routeFrom → routeTo`
- Прогресс-полоса (actualTrips / planTrips), бейдж статуса (активная/готово)
- Метаданные: даты, расстояние, время маршрута, кол-во ТС, ПЛ, груз, тоннаж/объём
- При `expanded=true`: `GanttTable`

Стиль: `sv-order-done` (зелёный) если `isDone`, `sv-order-active` (оранжевый) иначе.

---

### WeeklySidebar (`DumpTrucksPage.tsx:345`)

Правая панель на вкладке «Заявки» — еженедельная сводка по объектам.

**Props:** `shiftRecords: ShiftRecord[]`, `repairs: Repair[]`, `initialDateFrom: string`

**State:** `weekOffset` (±недели от текущей), `collapsedObjs`, `expandedVeh`

Для каждого объекта отображает:
- KPI-мини: кол-во самосвалов, рейсов
- Ремонты на этой неделе (из `repairs` с фильтром по объекту и датам)
- `MiniDonut` для 1-й и 2-й смены (средний % движения)
- H-bar: КИП и рейсы
- Раскрываемый список «По машинам» с кол-вом рейсов на каждый ТС

Навигация неделями: кнопки `‹` / `›`.

---

### ShiftSubTable (`DumpTrucksPage.tsx:568`)

Детализация смены: таблица рейсов с временами въезда/выезда из зон погрузки и выгрузки.

**Props:** `shiftRecord: ShiftRecord`

При монтировании вызывает `fetchShiftDetail(shiftRecord.id)` → получает `trips` + `zoneEvents`.

Обогащает каждый рейс ближайшим событием зоны погрузки и выгрузки (поиск по времени, допуск 5 минут).

Отображает компактную таблицу:

| № | Погрузка: Въезд | Выезд | Стоянка | Выгрузка: Въезд | Выезд | Стоянка | Ср.П | Ср.В |
|---|---|---|---|---|---|---|---|---|

Первый рейс помечен `›|` (начало), последний `|‹` (конец смены). Средние стоянки `avgPSt`/`avgUSt` отображаются в центральной строке.

---

### AnalyticsTab (`DumpTrucksPage.tsx:733`)

Вкладка «Аналитика» — трёхуровневая таблица с группировкой ТС → заявка → день → смена.

**Props:** объекты, период, фильтры, флаги загрузки, данные `shiftRecords`, коллбеки.

Структура таблицы:

- **Уровень 0 (ТС):** гос. номер + модель, агрегаты (КИП, движение по сменам, рейсы, моточасы)
- **Уровень 1 (Заявка):** номер заявки + объект, агрегаты по заявке
- **Уровень 2 (День):** дата, агрегаты по дню
- **Уровень sub-row (раскрытый день):** `ShiftSubTable` для каждой смены

Фильтры (применяются на клиенте):
- `shift`: все / shift1 / shift2
- `objectUid`: фильтр по объекту (список из `objects`)
- `showOnsite`: показывать ли ТС типа `onsite` (по умолчанию скрыты, показываются только `delivery`)

Правая панель `sv-an-right`: placeholder — «Тут будут формироваться Excel-отчёты».

---

## API-слой (`api.ts`)

Базовый URL: `/api/dt` (проксируется Vite на `http://localhost:3002`).

| Функция | Endpoint | Возвращает |
|---------|----------|------------|
| `fetchObjects()` | `GET /api/dt/objects` | `DtObject[]` |
| `fetchOrders(dateFrom, dateTo)` | `GET /api/dt/orders?dateFrom=...&dateTo=...` | `OrderSummary[]` |
| `fetchOrderGantt(number)` | `GET /api/dt/orders/:number/gantt` | `GanttRecord[]` |
| `fetchShiftRecords(params)` | `GET /api/dt/shift-records?...` | `ShiftRecord[]` |
| `fetchShiftDetail(shiftRecordId)` | `GET /api/dt/shift-detail?shiftRecordId=...` | `{ trips, zoneEvents }` |
| `fetchRepairs(objectName?)` | `GET /api/dt/repairs?objectName=...` | `Repair[]` |

Все функции выбрасывают ошибку при HTTP-статусе != 2xx.

---

## Типы данных (`types.ts`)

### DtObject
```typescript
{ uid: string; name: string; smu: string | null; }
```
Строительный объект с dt_* зонами. `smu` — подразделение (СМУ-1 и т.п.).

### OrderSummary
Сырой ответ от `/api/dt/orders`. Содержит `rawJson` с вложенными данными TIS (cargo, route, points).

### OrderCard
Обработанная версия `OrderSummary` (функция `toOrderCard` в `DumpTrucksPage.tsx:98`).
Добавляет поля: `pct` (процент выполнения), `isDone`, `city` (из `object_names[0]`), `dateFrom/dateTo`.

### GanttRecord
Строка для таблицы Ганта: `id`, `reg_number`, `name_mo`, `report_date`, `shift_type`, `trips_count`.

### ShiftRecord
Основная KPI-запись смены. Поля числовые (уже конвертированы в `shiftRecordRepo.ts`).
Дополнительно содержит `avgLoadingDwellSec` и `avgUnloadingDwellSec` (среднее время в зонах погрузки/выгрузки, вычисляется через `LEFT JOIN LATERAL` в запросе).

### TripRecord
Рейс: `trip_number`, `loaded_at`, `unloaded_at`, `loading_zone`, `unloading_zone`, `duration_min`.

### ZoneEvent
Событие зоны: `zone_tag` (`dt_boundary` / `dt_loading` / `dt_unloading`), `entered_at`, `exited_at`, `duration_sec`.

### Repair
Запись о ремонте/ТО: `type` (`repair` / `maintenance`), `reg_number`, `date_from`, `date_to`, `reason`, `object_name`.

### WeeklyObjectStats
Вспомогательный интерфейс для агрегации статистики по объекту за неделю. Используется только во внутренних расчётах `WeeklySidebar`.

---

## Цветовая кодировка КИП

Функция `kipColor(v: number)` (`DumpTrucksPage.tsx:45`):

| КИП % | CSS-класс | Цвет |
|-------|-----------|------|
| >= 75 | `sv-v-g` | Зелёный |
| >= 50 | `sv-v-o` | Оранжевый/синий |
| < 50 | `sv-v-r` | Красный |

---

## Особенности реализации

- Временная зона отображения: `Asia/Yekaterinburg` (функции `fmtTime`, `fmtDate`)
- Слово «Самосвал» обрезается из названия ТС при отображении (`stripSamosvaly`)
- `IDLE_SHIFT_SEC = 11 * 3600` — расчётное рабочее время смены без обеда (для подсчёта стоянки в `aggRecs`)
- Определение «города» заявки: берётся `object_names[0]` из `OrderSummary` (упрощённо)
- Группировка заявок по ТС: первый номер из `requestNumbers[]` используется как ключ заявки
