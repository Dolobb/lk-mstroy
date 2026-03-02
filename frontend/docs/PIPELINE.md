# Frontend — Pipeline Reference

## Схема: Vite Proxy → Бэкенд сервисы → React компоненты

```
Browser :5173
    │
    ├── /api/kip/*   ──(rewrite /api/kip → /api)──► Node/Express :3001  (kip/)
    ├── /api/tyagachi/* ──(rewrite /api/tyagachi → /api)──► FastAPI :8000  (tyagachi/)
    ├── /api/dt/*    ──────────────────────────────► Node/Express :3002  (dump-trucks/server/)
    └── /api/vs/*    ──────────────────────────────► Node/Express :3004  (vehicle-status/server/)
```

---

## 1. Vite Proxy конфигурация (`vite.config.ts`)

Файл: `frontend/vite.config.ts`

```ts
proxy: {
  '/api/vs': {
    target: 'http://localhost:3004',
    changeOrigin: true,
    // путь не перезаписывается: /api/vs/... → :3004/api/vs/...
  },
  '/api/dt': {
    target: 'http://localhost:3002',
    changeOrigin: true,
    // путь не перезаписывается: /api/dt/... → :3002/api/dt/...
  },
  '/api/kip': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/kip/, '/api'),
    // /api/kip/vehicles → :3001/api/vehicles
  },
  '/api/tyagachi': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/tyagachi/, '/api'),
    // /api/tyagachi/vehicles → :8000/api/vehicles
  },
}
```

| Префикс фронтенда | Сервис | Порт | Rewrite |
|-------------------|--------|------|---------|
| `/api/vs` | vehicle-status (Node/Express) | 3004 | нет |
| `/api/dt` | dump-trucks (Node/Express) | 3002 | нет |
| `/api/kip` | kip (Node/Express) | 3001 | `/api/kip` → `/api` |
| `/api/tyagachi` | tyagachi (FastAPI/Python) | 8000 | `/api/tyagachi` → `/api` |

Замечание: KIP iframe (`http://${hostname}:3001`) обращается к серверу напрямую (не через прокси), т.к. это отдельная вкладка браузера.

---

## 2. Роутинг (`App.tsx`)

| Путь | Компонент | Описание |
|------|-----------|---------|
| `/` | `Dashboard` | Главная страница — 3 колонки |
| `/kip` | `KipPage` | iframe на `http://{hostname}:3001?theme={theme}` |
| `/tyagachi/*` | `TyagachiPage` | Тягачи — вложенный роутер |
| `/tyagachi` (index) | `TyagachiDashboard` | Список машин + синхронизация + отчёты |
| `/tyagachi/requests/:requestNumber` | `TyagachiReportView` | Просмотр заявки |
| `/samosvaly` | `DumpTrucksPage` | Самосвалы |
| `/vehicle-status` | `VehicleStatusPage` | Состояние техники |
| `*` | `<Navigate to="/" />` | Редирект на главную |

---

## 3. API-вызовы по разделам

### Тягачи (`/api/tyagachi → :8000/api`)

Файл: `frontend/src/features/tyagachi/api.ts`

| Метод | Путь фронтенда | Цель на бэкенде | Назначение |
|-------|----------------|-----------------|-----------|
| GET | `/api/tyagachi/dashboard/summary` | `/api/dashboard/summary` | Сводка (кол-во машин, заявок) |
| GET | `/api/tyagachi/vehicles?days=N` | `/api/vehicles?days=N` | Список тягачей |
| GET | `/api/tyagachi/vehicles/:id/requests?days=N` | `/api/vehicles/:id/requests?days=N` | Заявки машины |
| POST | `/api/tyagachi/sync` | `/api/sync` | Запуск синхронизации |
| GET | `/api/tyagachi/sync/status` | `/api/sync/status` | Статус синхронизации |
| GET | `/api/tyagachi/request/:number/data` | `/api/request/:number/data` | Данные заявки (иерархия: ПЛ + мониторинг) |
| GET | `/api/tyagachi/reports` | `/api/reports` | Список legacy-отчётов |
| POST | `/api/tyagachi/reports` | `/api/reports` | Создать новый отчёт |
| GET | `/api/tyagachi/reports/:id/v2` | `/api/reports/:id/v2` | Открыть HTML-отчёт V2 |
| GET | `/api/tyagachi/status` | `/api/status` | Статус генерации отчёта |
| GET | `/api/tyagachi/route-addresses` | `/api/route-addresses` | Уникальные адреса маршрутов |

### Самосвалы (`/api/dt → :3002/api/dt`)

Файл: `frontend/src/features/samosvaly/api.ts`

| Метод | Путь фронтенда | Назначение |
|-------|----------------|-----------|
| GET | `/api/dt/objects` | Список объектов (города/площадки) |
| GET | `/api/dt/orders?dateFrom=...&dateTo=...` | Сводка заявок за период |
| GET | `/api/dt/orders/:number/gantt` | Данные для диаграммы Ганта по заявке |
| GET | `/api/dt/shift-records?dateFrom=...&dateTo=...&objectUid=...&shiftType=...` | Записи смен |
| GET | `/api/dt/shift-detail?shiftRecordId=N` | Детали смены (рейсы + зоны) |
| GET | `/api/dt/repairs?objectName=...` | Ремонты и ТО |

### Состояние ТС (`/api/vs → :3004/api/vs`)

Файл: `frontend/src/features/vehicle-status/api.ts`

| Метод | Путь фронтенда | Назначение |
|-------|----------------|-----------|
| GET | `/api/vs/vehicle-status?isRepairing=...&category=...` | Список записей состояния техники |
| POST | `/api/vs/vehicle-status/sync` | Запуск синхронизации из Google Drive |
| GET | `/api/vs/vehicle-status/sync-status` | Статус последней синхронизации |

### КИП техники

Раздел `/kip` — iframe, React-компонентов нет. Весь API kip/client обращается к `:3001` напрямую, минуя Vite-прокси.

Исключение: `ReportsColumn` на главной странице (`frontend/src/components/dashboard/reports-column.tsx`) делает прямые fetch-запросы к `/api/tyagachi/...` (не к KIP).

---

## 4. Особенности каждого раздела

### Главная (`/`)

3-колоночный дашборд. Первая колонка (`TyagachiVehicleBlock`) использует те же API тягачей что и `/tyagachi`. Третья колонка (`DstMonitoring`) не делает API-запросов — только статичные данные.

### КИП техники (`/kip`)

Встроен через `<iframe src="http://{hostname}:3001?theme={theme}">`. Тема (`light`/`dark`) передаётся query-параметром, чтобы kip/client мог её применить. `hostname` берётся из `window.location.hostname`, а не хардкодится как `localhost` — это важно для доступа с других машин в сети.

### Тягачи (`/tyagachi/*`)

React Router вложенный роутинг: `TyagachiPage` содержит свои `<Routes>`.

- Основной маршрут `/tyagachi` → `TyagachiDashboard` (index route)
- Детальный маршрут `/tyagachi/requests/:requestNumber` → `TyagachiReportView`

`TyagachiReportView` использует `react-leaflet v4` для карты. Трек рисуется как синий `Polyline`, стоянки — красные `CircleMarker`. При загрузке автоматически выбирается первая машина с треком, карта подстраивается под bounds трека (`FitBounds` helper).

Синхронизация тягачей: POST `/api/tyagachi/sync` + polling GET `/api/tyagachi/sync/status` каждые 2 секунды. Прогресс отображается в двух режимах: неопределённый (pulse-анимация) и точный (X/N · NN%) при фазе мониторинга.

### Самосвалы (`/samosvaly`)

Полностью React-компонент (`DumpTrucksPage`). Собственные CSS-стили в `samosvaly.css` (портированы из HTML-версии). Группировка ТС по городам (объектам). Два типа смен: `shift1` (утро) и `shift2` (вечер).

### Состояние ТС (`/vehicle-status`)

Данные синхронизируются из Google Drive (.xlsx файл) через `vehicle-status/server`. Синхронизация инициируется вручную кнопкой. После нажатия polling каждые 2 сек до изменения `lastSync`, таймаут 60 сек. Записи в ремонте подсвечиваются красным фоном (`bg-destructive/5`).

---

## 5. Темизация

Провайдер: `next-themes` с `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`.

Тема применяется как CSS-класс `dark` на `<html>`. CSS-переменные определены в `index.css` для `:root` (light) и `.dark` (dark).

Переключение: кнопка в правой части `TopNavBar` — `Sun`/`Moon` иконка, `setTheme(theme === 'dark' ? 'light' : 'dark')`.

KIP iframe получает текущую тему через query-параметр `?theme=light|dark`.
