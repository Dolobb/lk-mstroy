# Frontend — Frontend Reference

## Обзор

Единый фронтенд-оболочка для монорепо lk-mstroy. Объединяет пять разделов в одном SPA с общей навигацией и темизацией.

- Стек: React 18 + TypeScript + Vite 6 + Tailwind CSS v4 + shadcn/ui + lucide-react + React Router v7
- Порт: 5173 (vite dev server)
- Запуск: `cd frontend/ && npm run dev`

---

## Дерево файлов

```
frontend/src/
├── main.tsx                            — точка входа: BrowserRouter + ThemeProvider + App
├── App.tsx                             — роутер + layout (flex-col h-screen)
├── index.css                           — CSS-переменные темизации (light/dark), .glass-card, custom-scrollbar
├── components/
│   ├── TopNavBar.tsx                   — верхняя навигационная панель
│   ├── theme-provider.tsx              — обёртка над next-themes NextThemesProvider
│   ├── ui/                             — shadcn/ui компоненты (accordion, button, dialog, table и т.д.)
│   └── dashboard/
│       ├── dashboard.tsx               — компонент главной страницы (3 колонки)
│       ├── VehicleIcons.tsx            — SVG иконки ТС (DumpTruckIcon, SemiTruckIcon, HeavyMachineryIcon)
│       ├── vehicle-type-slider.tsx     — слайдер переключения типа ТС (Самосвалы/Тягачи/ДСТ)
│       ├── vehicle-overview.tsx        — обзор списка машин с таймлайном заявок
│       ├── reports-column.tsx          — колонка создания отчётов + история отчётов
│       ├── dst-monitoring.tsx          — заглушка мониторинга ДСТ (статичные данные, WIP)
│       └── toast.tsx                   — внутренний toast-компонент
└── features/
    ├── tyagachi/
    │   ├── TyagachiPage.tsx            — вложенный роутер /tyagachi/*
    │   ├── TyagachiDashboard.tsx       — дашборд тягачей (2 колонки)
    │   ├── TyagachiVehicleBlock.tsx    — SyncPanel + VehicleOverview для тягачей
    │   ├── TyagachiReportView.tsx      — просмотр отчёта: ПЛ-список | карта | факт-панель
    │   ├── api.ts                      — HTTP-клиент к /api/tyagachi
    │   ├── types.ts                    — TypeScript типы (TyagachiVehicle, TyagachiRequest и др.)
    │   ├── utils.ts                    — вспомогательные функции (parseRuDateTime, buildStackedSegments и др.)
    │   └── index.ts                    — экспорт TyagachiPage
    ├── samosvaly/
    │   ├── DumpTrucksPage.tsx          — полный React-компонент раздела самосвалов
    │   ├── api.ts                      — HTTP-клиент к /api/dt
    │   ├── types.ts                    — TypeScript типы (ShiftRecord, TripRecord, ZoneEvent и др.)
    │   ├── samosvaly.css               — портированные CSS-стили из samosvaly-v6.html
    │   └── index.ts                    — экспорт DumpTrucksPage
    └── vehicle-status/
        ├── VehicleStatusPage.tsx       — таблица состояния техники + кнопка синхронизации
        ├── api.ts                      — HTTP-клиент к /api/vs
        ├── types.ts                    — TypeScript типы (StatusRecord, SyncStatus)
        └── index.ts                    — экспорт VehicleStatusPage
```

---

## Компоненты

### main.tsx (`frontend/src/main.tsx:1`)

Точка входа. Оборачивает всё в `React.StrictMode` → `ThemeProvider` → `BrowserRouter` → `App`.

```tsx
<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
  <BrowserRouter>
    <App />
  </BrowserRouter>
</ThemeProvider>
```

Тема по умолчанию — `dark`. Переключение осуществляется через класс `dark` на `<html>`.

---

### App.tsx (`frontend/src/App.tsx:1`)

Root компонент. Содержит глобальный layout и таблицу роутов.

**Layout:** `flex flex-col h-screen overflow-hidden` с градиентным фоном через CSS-переменные.

**Роуты:**

| Путь | Компонент | Описание |
|------|-----------|---------|
| `/` | `<Dashboard />` | Главная страница (3 колонки) |
| `/kip` | `<KipPage />` | КИП техники — iframe на :3001 |
| `/tyagachi/*` | `<TyagachiPage />` | Тягачи с вложенным роутером |
| `/samosvaly` | `<DumpTrucksPage />` | Самосвалы |
| `/vehicle-status` | `<VehicleStatusPage />` | Состояние техники |
| `*` | `<Navigate to="/" />` | Редирект на главную |

**KipPage** (определён inline в App.tsx): рендерит `<iframe src="http://{hostname}:3001?theme={theme}">`. Тема передаётся query-параметром, чтобы kip/client мог применить ту же тему.

---

### TopNavBar (`frontend/src/components/TopNavBar.tsx:1`)

Верхняя навигационная панель. Высота 40px, стиль `glass-card`.

**Левая часть — основная навигация:**

| id | Путь | Метка | Иконка |
|----|------|-------|--------|
| home | `/` | ГЛАВНАЯ | `Home` (lucide) |
| kip | `/kip` | КИП ТЕХНИКИ | `Settings` (lucide) |
| tractors | `/tyagachi` | ТЯГАЧИ | `SemiTruckIcon` (кастомная SVG) |
| dump | `/samosvaly` | САМОСВАЛЫ | `DumpTruckIcon` (кастомная SVG) |

Активный элемент определяется через `useLocation()`. Для `/tyagachi` учитывает вложенные пути (`pathname.startsWith('/tyagachi/')`).

**Правая часть:**

- Ссылка `Состояние ТС` (иконка `Wrench`) → `/vehicle-status` (через `<Link>`)
- Ссылка `Гео` (иконка `Map`) → `http://{hostname}:3003/admin` в новой вкладке (внешняя ссылка на geo-admin)
- Кнопка Light/Dark — переключает тему через `useTheme()` из `next-themes`
- Логотип: «НПС / МОСТОСТРОЙ-11»

---

### Dashboard (`frontend/src/components/dashboard/dashboard.tsx:1`)

Главная страница. Сетка 3 колонки (`grid-cols-3`), каждая — `glass-card`.

| Колонка | Компонент | Содержимое |
|---------|-----------|-----------|
| 1 | `TyagachiVehicleBlock` | SyncPanel + список машин с таймлайном заявок |
| 2 | `ReportsColumn` | Форма создания отчёта + история отчётов |
| 3 | `DstMonitoring` | Статичная заглушка мониторинга ДСТ + WIP-overlay при hover |

Toast-контейнер (`fixed bottom-4 right-4`) для уведомлений.

---

### VehicleIcons (`frontend/src/components/dashboard/VehicleIcons.tsx:1`)

Кастомные SVG-иконки ТС. Все принимают `{ className?, strokeWidth? }`.

- `DumpTruckIcon` — самосвал (viewBox 64x40)
- `SemiTruckIcon` — тягач с прицепом (viewBox 80x40)
- `HeavyMachineryIcon` — дорожный каток (viewBox 64x40)

---

### VehicleTypeSlider (`frontend/src/components/dashboard/vehicle-type-slider.tsx:1`)

Слайдер переключения типа ТС. Используется в `ReportsColumn` (на Dashboard) и потенциально в других местах.

Типы: `'samosvaly' | 'tyagachi' | 'dst'`

Цвета: `samosvaly → #A78BFA`, `tyagachi → #2DD4BF`, `dst → #E11D48`

Иконки: DumpTruckIcon / SemiTruckIcon / Settings(lucide)

---

### VehicleOverview (`frontend/src/components/dashboard/vehicle-overview.tsx:1`)

Список машин с таймлайном заявок. Принимает `realVehicles` (данные из API) или `fallback` (статичные данные). Отображает прогресс-бары заявок с цветовой кодировкой `stable/in_progress`. Поддерживает expand — раскрытие машины для просмотра деталей. Используется в `TyagachiVehicleBlock` и на `Dashboard`.

---

### ReportsColumn (`frontend/src/components/dashboard/reports-column.tsx:1`)

Колонка создания отчётов. Показывает форму с периодом (ДД.ММ.ГГГГ), фильтрами маршрутов, кнопку «Создать отчёт» и список legacy-отчётов с кнопкой «Открыть».

При `vehicleType !== 'tyagachi'` показывает WIP-overlay поверх содержимого.

Поддерживает prop `hideTypeSlider` — скрывает `VehicleTypeSlider` (используется в TyagachiDashboard).

API вызовы: `/api/tyagachi/dashboard/summary`, `/api/tyagachi/reports`, `/api/tyagachi/route-addresses`, `/api/tyagachi/status`.

---

### DstMonitoring (`frontend/src/components/dashboard/dst-monitoring.tsx:1`)

Статичный компонент-заглушка для блока «Мониторинг ДСТ». Содержит хардкоженные данные (kipSummary, kipData). Показывает: карточки KPI, SVG-плейсхолдер карты с анимированными точками, таблицу КИП по датам. Реальных API-запросов не делает. На Dashboard покрыт WIP-overlay при hover.

---

### ThemeProvider (`frontend/src/components/theme-provider.tsx:1`)

Тонкая обёртка над `NextThemesProvider` из `next-themes`. Применяет тему через класс `dark` на `<html>`.

---

### TyagachiPage (`frontend/src/features/tyagachi/TyagachiPage.tsx:1`)

Контейнер с вложенным React Router `<Routes>`:

- `index` → `TyagachiDashboard`
- `requests/:requestNumber` → `TyagachiReportView`

---

### TyagachiDashboard (`frontend/src/features/tyagachi/TyagachiDashboard.tsx:1`)

Дашборд тягачей. Сетка 2 колонки на больших экранах (`lg:grid-cols-2`):

- Колонка 1: `TyagachiVehicleBlock` (SyncPanel + список машин)
- Колонка 2: `ReportsColumn` с `hideTypeSlider`

---

### TyagachiVehicleBlock (`frontend/src/features/tyagachi/TyagachiVehicleBlock.tsx:1`)

Объединяет `SyncPanel` и `VehicleOverview`. Управляет состоянием: период дней, версия синхронизации, список машин.

**SyncPanel** (определён в том же файле): кнопки периода (1д / 3д / 1н / 1м — с начала текущего месяца), кнопка «Синхронизировать», прогресс-бар с поллингом `/api/tyagachi/sync/status` каждые 2 секунды.

---

### TyagachiReportView (`frontend/src/features/tyagachi/TyagachiReportView.tsx:1`)

Просмотр данных по заявке. Трёхколоночный layout.

- **Левая панель** (288px): LeftPanel — информация о заявке, список ПЛ с возможностью expand, список машин (кликабельны только те, у которых есть трек)
- **Центр**: `MapContainer` (react-leaflet) — трек синим `Polyline`, стоянки красными `CircleMarker` с `Tooltip`
- **Правая панель** (288px): FactPanel — пробег, время движения/двигателя/холостой, топливо, стоянки

Фикс иконок leaflet в Vite: `delete (L.Icon.Default.prototype as any)._getIconUrl` + `L.Icon.Default.mergeOptions({...})`.

Тайл-сервер: OpenStreetMap (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`).

`FitBounds` — helper-компонент, вызывает `map.fitBounds()` при изменении трека.

Автовыбор первой машины с треком при загрузке данных.

---

### DumpTrucksPage (`frontend/src/features/samosvaly/DumpTrucksPage.tsx:1`)

Полный React-компонент раздела самосвалов (большой монолит, ~1200+ строк). Загружает данные по объектам, сменам, заявкам, ремонтам. Содержит собственную логику фильтрации, группировки по городам и отображения таймлайна смен. Использует собственный CSS-файл `samosvaly.css`.

---

### VehicleStatusPage (`frontend/src/features/vehicle-status/VehicleStatusPage.tsx:1`)

Страница «Состояние техники». Таблица с записями из Google Sheets (синхронизируется через vehicle-status/server).

**State:** `records`, `syncStatus`, `filterMode` (all / repairing), `filterCat`, `loading`, `syncing`.

**Категории** (соответствуют вкладкам Excel-файла): Стягачи, ДСТ МС11, Самосвалы, Автобусы/Бортовые МС11, АБС/АБН МС11, МС 11 Краны, Малая механизация МС11, Спецтехника МС11.

**Таблица** (8 колонок): Гос. №, Категория, Тех. состояние, Статус, Начало, Конец, Дней, Проверка.

**Синхронизация**: `POST /api/vs/vehicle-status/sync` → поллинг `/api/vs/vehicle-status/sync-status` каждые 2 секунды, таймаут 60 сек.

---

## CSS и темизация

Файл `index.css` определяет CSS-переменные для двух тем (`light` и `dark`).

Ключевые цвета:
- `--primary: #f97316` (оранжевый) — активные элементы навигации, кнопки
- `--secondary: #3b82f6` (синий) — треки на карте, акценты
- `--accent: #22c55e` (зелёный) — успех, завершённые заявки

Класс `.glass-card` — стеклянный эффект (backdrop-filter) для карточек.

---

## shadcn/ui

Используемые примитивы (из `frontend/src/components/ui/`):

accordion, alert-dialog, alert, avatar, badge, button, card, checkbox, collapsible, dialog, dropdown-menu, input, label, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, sonner, switch, table, tabs, textarea, toast, tooltip и другие.

Подключены через `@radix-ui/*` примитивы с кастомной стилизацией Tailwind.
