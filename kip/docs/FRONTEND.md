# KIP — Frontend Reference

## Обзор

- Стек: React 18 + Tailwind CSS v4 + Vite + Leaflet (react-leaflet)
- Порт: `kip/client` → :3000 (dev) или встроен в Express :3001 (build)
- Интеграция: встроен через `<iframe>` в `frontend/` (/kip роут)
- Особенность: скрывает TopNavBar при встраивании в iframe; стартует с вкладки `'dst'`
- CSS: utility-first Tailwind v4, глобальные glass-card компоненты, тема через CSS-переменные

## Дерево компонентов

```
kip/client/src/
├── App.tsx                          — root, layout, вкладки, state
├── main.tsx                         — точка входа React
├── index.css                        — глобальные стили, CSS-переменные темы
├── components/
│   ├── TopNavBar.tsx                — навигация (скрыта в iframe)
│   ├── FilterPanel.tsx              — фильтры + поиск ТС + средний КИП
│   ├── VehicleMap.tsx               — Leaflet карта с маркерами
│   ├── GeozoneLayer.tsx             — слой геозон на карте
│   ├── DetailPanel.tsx              — карточка выбранного ТС + заявки
│   ├── VehicleDetailTable.tsx       — таблица КИП по дням/сменам
│   ├── MultiSelectDropdown.tsx      — мульти-выбор (Филиал / Тип ТС / СМУ)
│   ├── dashboard/
│   │   └── dashboard.tsx           — страница "Главная" (Home)
│   ├── Filters/                     — вспомогательные компоненты фильтров
│   ├── Map/                         — вспомогательные компоненты карты
│   ├── Requests/                    — компоненты заявок
│   ├── VehicleDetail/               — детальные компоненты ТС
│   ├── theme-provider.tsx           — провайдер темы (light/dark)
│   └── ui/                         — shadcn/ui компоненты (Table, Dialog и т.д.)
├── services/
│   └── api.ts                       — HTTP клиент (fetchWeeklyVehicles, fetchVehicleDetails и др.)
├── hooks/
│   ├── use-mobile.ts                — хук определения мобильного экрана
│   └── use-toast.ts                 — хук всплывающих уведомлений
├── types/
│   └── vehicle.ts                   — TypeScript-типы (WeeklyVehicle, VehicleDetailRow, FilterState и др.)
├── utils/
│   └── kpi.ts                       — getKpiColor(), KPI_COLORS, capDisplay()
└── lib/
    └── utils.ts                     — cn() утилита (clsx + tailwind-merge)
```

## Компоненты

### App.tsx (`kip/client/src/App.tsx:1`)

**Назначение:** Root-компонент. Управляет глобальным состоянием, вкладками навигации, загрузкой данных.

**Вкладки (activeNav):**
- `'home'` — страница Главная, рендерит `<Dashboard />`
- `'dst'` — КИП/ДСТ, рендерит FilterPanel + VehicleMap + DetailPanel + VehicleDetailTable
- `'dump'` / `'tractors'` — заглушки "Раздел в разработке"

**Iframe-обнаружение** (`App.tsx:31`):
```tsx
const isEmbedded = window !== window.parent;
const [activeNav, setActiveNav] = useState(isEmbedded ? 'dst' : 'home');
```
При встраивании в iframe автоматически активируется вкладка `'dst'` и TopNavBar скрывается (`App.tsx:129–133`).

**State (App.tsx:33–42):**
| Переменная | Тип | Назначение |
|-----------|-----|-----------|
| `activeNav` | string | Текущая вкладка |
| `filters` | FilterState | Текущие фильтры (период, смена, ветви и т.д.) |
| `vehicles` | WeeklyVehicle[] | Список ТС для карты (агрегированные за период) |
| `loading` | boolean | Индикатор загрузки |
| `filterOptions` | FilterOptions | Варианты для дропдаунов (филиалы, типы, СМУ) |
| `selectedVehicleId` | string | null | Выбранное ТС |
| `vehicleDetails` | VehicleDetailRow[] | Детальные записи по дням/сменам |
| `vehicleRequests` | VehicleRequest[] | Заявки для выбранного ТС |

**Layout (`App.tsx:162–194`):**
```
┌────────────────────────────────────────────────────────────────┐
│ FilterPanel (полная ширина)                                    │
├─────────────────────────────────┬──────────────────────────────┤
│ VehicleMap (65%)                │ DetailPanel (60%)             │
│                                 ├──────────────────────────────┤
│                                 │ VehicleDetailTable (40%)      │
└─────────────────────────────────┴──────────────────────────────┘
```
Когда ТС не выбрано — карта занимает всю ширину.

**Загрузка данных:**
- При изменении `filters` или переключении на `'dst'` → `Promise.all([fetchWeeklyVehicles, fetchFilterOptions])`
- При изменении `selectedVehicleId` → `Promise.all([fetchVehicleDetails, fetchVehicleRequests])`
- Cascading фильтры: при смене `branches` → `departments` сбрасываются (`App.tsx:112`)

---

### FilterPanel (`kip/client/src/components/FilterPanel.tsx:1`)

**Назначение:** Панель фильтров + отображение среднего КИП + шкала диапазонов КИП.

**Фильтры:**

| Группа | Тип | Описание |
|--------|-----|---------|
| ПЕРИОД | Кнопки-пресеты | "Месяц" (-30 дней до сегодня) и "Неделя" (-7 дней) |
| ПЕРИОД ДНЕЙ | Date input | Произвольный диапазон `from`/`to` (YYYY-MM-DD) |
| ДЕНЬ/ВЕЧЕР | Toggle-кнопки | Смена: `morning` / `evening` / null (обе) |
| Филиал | MultiSelectDropdown | Фильтрация по `branch` из vehicle-registry |
| Тип ТС | MultiSelectDropdown (grouped) | Фильтрация по `type` из vehicle-registry |
| СМУ | MultiSelectDropdown | Фильтрация по `department_unit` из vehicle_records |
| Поиск ТС | Поле поиска (портал) | Живой поиск по госномеру в текущем наборе данных |

**KPI диапазоны (`FilterPanel.tsx:22–27`):**
```ts
const KPI_SCALE = [
  { label: '0-25%',   color: '#ef4444', value: '0-25'   },
  { label: '25-50%',  color: '#eab308', value: '25-50'  },
  { label: '50-75%',  color: '#3b82f6', value: '50-75'  },
  { label: '75-100%', color: '#22c55e', value: '75-100' },
];
```
Кнопки диапазонов — multi-toggle. Выбранные передаются в API как `kpiRange[]=...`.

**Средний КИП (`FilterPanel.tsx:184`):**
```ts
const kipColor = avgKip >= 75 ? '#22c55e' : avgKip >= 50 ? '#3b82f6' : avgKip >= 25 ? '#eab308' : '#ef4444';
```
Отображает среднее по полю `avg_utilization_ratio` всех загруженных ТС.

**Поиск ТС:** реализован через React Portal (`FilterPanel.tsx:312`) — выпадающий список появляется поверх остального контента без сдвига layout.

---

### VehicleMap (`kip/client/src/components/VehicleMap.tsx:1`)

**Назначение:** Leaflet карта с маркерами ТС, треком выбранного ТС, слоем геозон.

**Библиотеки:** react-leaflet v4, react-leaflet-cluster (MarkerClusterGroup)

**Центр по умолчанию (`VehicleMap.tsx:19`):**
```ts
const RUSSIA_CENTER: [number, number] = [58, 70];
const DEFAULT_ZOOM = 5;
```

**Маркеры — цвета по КИП (`VehicleMap.tsx:103–104`):**
```ts
const color = KPI_COLORS[getKpiColor(v.avg_utilization_ratio)];
```

Цвета берутся из `utils/kpi.ts`:
| Ключ | Цвет | Условие |
|------|------|---------|
| GREEN | `#00C853` | утилизация >= 75% |
| BLUE | `#0000FF` | утилизация >= 50% и < 75% |
| RED | `#FF0000` | утилизация < 50% |

**Вид маркера (`VehicleMap.tsx:22–39`):**
`L.divIcon` — "пилюля" (белый фон, цветная точка, госномер). Выбранный маркер выделяется синей рамкой.

**Клик на маркер (`VehicleMap.tsx:114–116`):**
Вызывает `onSelectVehicle(v.vehicle_id)` → App обновляет `selectedVehicleId` → открывается DetailPanel + VehicleDetailTable.

**Клик на карту (пустое место) (`VehicleMap.tsx:41–43`):**
Снимает выделение: `onSelectVehicle(null)`.

**Трек выбранного ТС (`VehicleMap.tsx:74–79`):**
Берётся из первой записи `selectedDetails`, у которой есть `track_simplified`. Рендерится как `<Polyline>` синего цвета (пунктир, `VehicleMap.tsx:133–143`).

**FlyTo при выборе ТС (`VehicleMap.tsx:54–65`):**
Если выбранное ТС имеет координаты → `map.flyTo([lat, lon], zoom=13, duration=1.2)`.

**GeozoneLayer (`kip/client/src/components/GeozoneLayer.tsx:1`):**
Загружает GeoJSON с `/api/geozones` и рендерит как полупрозрачные полигоны (оранжевая обводка, fillOpacity 0.08) с тултипом `zoneName`.

---

### DetailPanel (`kip/client/src/components/DetailPanel.tsx:1`)

**Назначение:** Карточка выбранного ТС справа от карты. Показывает информацию и связанные заявки.

**Поля:**
- Тип ТС, Марка, Гос. №
- Навигатор заявок: кнопки `<`/`>` для перебора нескольких заявок (`DetailPanel.tsx:36`)
- Для текущей заявки: Заявитель, Объект затрат, Вид работ

---

### VehicleDetailTable (`kip/client/src/components/VehicleDetailTable.tsx:1`)

**Назначение:** Сводная таблица КИП по дням и сменам для выбранного ТС.

**Pivot-логика (`VehicleDetailTable.tsx:63–111`):**
Группирует `VehicleDetailRow[]` по дате → по смене (morning/evening) → строки с колонками: дата, КИП смена1, Нагрузка смена1, КИП смена2, Нагрузка смена2.

**Цвета КИП (`VehicleDetailTable.tsx:33–41`):**
```ts
function getKipColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  const v = capDisplay(value);
  if (v < 25) return '#ef4444';   // RED
  if (v < 50) return '#eab308';   // YELLOW
  if (v < 75) return '#3b82f6';   // BLUE
  return '#22c55e';               // GREEN
}
```

**Цвета загрузки (нагрузка "Под нагр.") (`VehicleDetailTable.tsx:43–47`):**
```ts
function getLoadColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  const v = capDisplay(value);
  if (v < 50) return '#ef4444';   // RED
  return '#22c55e';               // GREEN
}
```

**Кнопка "Все параметры":** открывает Dialog (shadcn/ui) с детальной таблицей всех записей (Вр.зоны ч, Двиг. ч, Простой ч, Расход л, Норма л/ч, Факт л/ч, КИП %, Нагр. %).

**Минимум строк:** таблица всегда показывает не менее 7 строк (`MIN_ROWS = 7`, `VehicleDetailTable.tsx:60`).

> ⚠️ Внимание: Цветовые пороги таблицы (4 цвета: RED/YELLOW/BLUE/GREEN) отличаются от цветовых порогов карты (3 цвета: RED/BLUE/GREEN). Это не ошибка — намеренное разделение (разная детализация). Документировано подробнее в PIPELINE.md.

---

## Сервисный слой

### `kip/client/src/services/api.ts`

**Функции:**
| Функция | Endpoint | Описание |
|---------|---------|---------|
| `fetchWeeklyVehicles(filters)` | `GET /api/vehicles/weekly` | Агрегированные данные ТС для карты |
| `fetchVehicleDetails(id, from, to)` | `GET /api/vehicles/:id/details` | Детальные записи по дням/сменам |
| `fetchVehicleRequests(id, from, to)` | `GET /api/vehicles/:id/requests` | Заявки для ТС |
| `fetchFilterOptions(from, to, branches?, types?)` | `GET /api/filters` | Варианты для дропдаунов |

### `kip/client/src/utils/kpi.ts`

```ts
// Цвета маркеров карты (3 порога)
export function getKpiColor(value: number): KpiColor {
  if (value < 50) return 'RED';
  if (value < 75) return 'BLUE';
  return 'GREEN';
}

export const KPI_COLORS: Record<KpiColor, string> = {
  RED: '#FF0000',
  BLUE: '#0000FF',
  GREEN: '#00C853',
};

// Ограничение отображения: не более 100%
export function capDisplay(value: number): number {
  return Math.min(value, 100);
}
```

## Конфигурация сборки

- **Vite** (`kip/client/vite.config.ts`) — сборка в `dist/`, проксирует `/api/*` → `:3001` в dev-режиме
- **VITE_API_URL** — переменная окружения для базового URL API (по умолчанию пустая строка, что даёт относительные пути)
- **Express static serving** (`kip/server/src/index.ts:21`) — `client/dist` раздаётся напрямую с :3001
