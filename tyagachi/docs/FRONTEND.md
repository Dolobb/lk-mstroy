# Tyagachi — Frontend Reference

## Обзор

- Стек: React 18 + TypeScript + Tailwind CSS v4 + react-leaflet v4
- Порт: через frontend/ (:5173)
- Роут: `/tyagachi` — dashboard, `/tyagachi/requests/:requestNumber` — viewer
- Прокси: `/api/tyagachi` → http://localhost:8000

## Файловая структура

```
frontend/src/features/tyagachi/
├── TyagachiPage.tsx         — wrapper, роутинг внутри раздела
├── TyagachiDashboard.tsx    — 2-колонный layout: TyagachiVehicleBlock + ReportsColumn
├── TyagachiVehicleBlock.tsx — SyncPanel + VehicleOverview
├── TyagachiReportView.tsx   — 3-колонный viewer (ПЛ | карта | факт)
├── types.ts                 — TypeScript интерфейсы
├── api.ts                   — fetch функции
├── utils.ts                 — форматирование дат, статусов
└── index.ts                 — реэкспорт
```

## Роутинг

Роутинг настроен в `TyagachiPage.tsx` через React Router v6 `<Routes>`:

```tsx
// frontend/src/features/tyagachi/TyagachiPage.tsx:6
<Routes>
  <Route index element={<TyagachiDashboard />} />
  <Route path="requests/:requestNumber" element={<TyagachiReportView />} />
</Routes>
```

В `App.tsx` (или основном роутере) раздел подключён как `/tyagachi/*`.

## Компоненты

### TyagachiDashboard (frontend/src/features/tyagachi/TyagachiDashboard.tsx:1)

**Назначение:** главная страница раздела — 2-колонный layout.

**Визуально:**
- Левая колонка: `TyagachiVehicleBlock` — панель синхронизации + список машин
- Правая колонка: `ReportsColumn` — legacy-отчёты (созданные через старый pipeline)

**Зависимости:**
- `TyagachiVehicleBlock` — реализован в том же пакете
- `ReportsColumn` — из `components/dashboard/reports-column`, принимает `vehicleType="tyagachi"`

### TyagachiVehicleBlock (frontend/src/features/tyagachi/TyagachiVehicleBlock.tsx:161)

**Назначение:** объединяет SyncPanel и список машин с заявками.

**State:**
- `days` — выбранный период для отображения (1д, 3д, 1н, с начала месяца)
- `syncVersion` — инкрементируется при завершении синхронизации, тригеррит перезагрузку данных
- `fullVehicles` — список `TyagachiVehicle[]` с агрегированной статистикой

**SyncPanel (встроен в TyagachiVehicleBlock.tsx:31):**
- Кнопки периода: 1д / 3д / 1н / с начала месяца (вычисляется как `new Date().getDate()` дней)
- Кнопка «Синхронизировать» → `POST /api/tyagachi/sync` с `{period_days: N}`
- Polling каждые 2 секунды через `GET /api/tyagachi/sync/status`
- Прогресс-бар: на этапе мониторинга показывает `mon_current/mon_total · %`
- После завершения: отображает статистику — добавлено/обновлено/всего заявок

**VehicleOverview:**
- Список машин с номером госзнака, моделью, кол-вом стабильных/в работе заявок
- Раскрывается по клику → загружает заявки через `getVehicleRequests(vehicle.id, days)`
- Клик на заявку → навигация на `/tyagachi/requests/:requestNumber`

### TyagachiReportView (frontend/src/features/tyagachi/TyagachiReportView.tsx:303)

**Назначение:** детальный просмотр заявки — 3-колонный layout.

**Загрузка данных:**
```
useEffect → getRequestData(requestNumber) → GET /api/tyagachi/request/{N}/data
→ setData(RequestDataResponse)
```

**Автовыбор:** при загрузке автоматически выбирается первая машина у которой есть `mon_track`.

**Визуально — 3 колонки:**

1. **Левая (w-72):** `LeftPanel` — список ПЛ с вложенными машинами
   - Шапка: номер заявки, маршрут, груз
   - ПЛ раскрываются по клику, показывают список машин
   - Машины с треком: кликабельны → выбирают vehicle для карты и факт-панели
   - Машины без трека: disabled, opacity 60%

2. **Центр (flex-1):** `MapContainer` (react-leaflet v4)
   - Провайдер тайлов: OpenStreetMap
   - `TrackLayer` компонент: `Polyline` синий + `CircleMarker` красные для стоянок
   - `FitBounds` автоматически подгоняет вьюпорт под трек
   - Тултип на стоянке: адрес, время начала/конца, длительность в мин
   - Нижний левый угол: легенда (трек + стоянки)

3. **Правая (w-72):** `FactPanel` — данные выбранной машины
   - Госзнак, идентификатор ПЛ
   - 2×2 сетка: Пробег / В движении / Двигатель / Холостой
   - Топливо (заправки, уровень начало/конец)
   - Стоянки — первые 8, с адресом, временем, длительностью

**react-leaflet версия 4, фикс иконок:**
```tsx
// frontend/src/features/tyagachi/TyagachiReportView.tsx:17
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});
```

### Типы (frontend/src/features/tyagachi/types.ts)

**Dashboard-типы:**

| Тип | Назначение |
|-----|------------|
| `TyagachiVehicle` | Машина с агрегированной статистикой по заявкам |
| `PLRecordBrief` | Сокращённый ПЛ (id, статус, даты) |
| `TyagachiRequest` | Заявка с полями маршрута и stability_status |
| `DashboardSummary` | Сводка: кол-во машин, заявок, статусы, last_sync |
| `SyncStats` | Результат одного sync: added/updated/total |
| `SyncStatus` | Текущий статус фоновой синхронизации |
| `LegacyReport` | Legacy HTML-отчёт из старого pipeline |

**Report Viewer типы:**

| Тип | Назначение |
|-----|------------|
| `TrackPoint` | GPS-точка: lat, lon, time, speed |
| `Parking` | Стоянка: begin, end, address, duration_min, lat, lon |
| `FuelRecord` | Запись о топливе: charges, discharges, rate, begin/end |
| `VehicleMonitoring` | Машина с мониторингом (mon_* поля) |
| `PLEntry` | ПЛ с вложенными vehicles |
| `RequestHierarchy` | Иерархия заявки: данные + pl_list[] |
| `RequestDataResponse` | Ответ API: request_info + hierarchy (dict по номеру) |

**Ключевые поля `VehicleMonitoring`:**
```typescript
// frontend/src/features/tyagachi/types.ts:119
mon_distance: number | null;          // км
mon_moving_time_hours: number | null; // часы в движении
mon_engine_time_hours: number | null; // часы работы двигателя
mon_idling_time_hours: number | null; // часы холостого хода
mon_fuels: FuelRecord[] | null;
mon_parkings: Parking[] | null;
mon_track: TrackPoint[] | null;
mon_parkings_count: number | null;
mon_parkings_total_hours: number | null;
```

## API функции (frontend/src/features/tyagachi/api.ts)

| Функция | Метод | Endpoint |
|---------|-------|----------|
| `getDashboardSummary()` | GET | `/api/tyagachi/dashboard/summary` |
| `getVehicles(days?)` | GET | `/api/tyagachi/vehicles[?days=N]` |
| `getVehicleRequests(vehicleId, days?)` | GET | `/api/tyagachi/vehicles/{id}/requests` |
| `startSync(period_days)` | POST | `/api/tyagachi/sync` |
| `getSyncStatus()` | GET | `/api/tyagachi/sync/status` |
| `getRequestData(requestNumber)` | GET | `/api/tyagachi/request/{N}/data` |
| `getLegacyReports()` | GET | `/api/tyagachi/reports` |
| `getLegacyReportUrl(id)` | — | `/api/tyagachi/reports/{id}/v2` (строка) |
| `createReport(body)` | POST | `/api/tyagachi/reports` |

## Vite Proxy

```typescript
// frontend/vite.config.ts
'/api/tyagachi': { target: 'http://localhost:8000' }
```
