# Vehicle Status — Frontend Reference

## Обзор

- Стек: React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui + lucide-react
- Порт: 5173 (через единый `frontend/`)
- Роут: `/vehicle-status`
- Прокси: `/api/vs` → `http://localhost:3004` (настроен в `frontend/vite.config.ts`)
- Навигация: кнопка «Состояние ТС» (иконка Wrench) в правой части TopNavBar

## Файловая структура

```
frontend/src/features/vehicle-status/
├── VehicleStatusPage.tsx   — главная страница (единственный компонент)
├── api.ts                  — fetch-функции к /api/vs
├── types.ts                — TypeScript-типы (StatusRecord, SyncStatus)
└── index.ts                — реэкспорт (export { VehicleStatusPage })
```

## TypeScript-типы (frontend/src/features/vehicle-status/types.ts)

### StatusRecord

Одна запись о периоде ремонта транспортного средства.

```typescript
interface StatusRecord {
  id:            number;
  plateNumber:   string;        // Гос. номер (всегда UPPER)
  statusText:    string | null; // Текст тех. состояния из Excel
  isRepairing:   boolean;       // true = открытый ремонт
  dateStart:     string;        // YYYY-MM-DD, дата начала ремонта
  dateEnd:       string | null; // YYYY-MM-DD, дата закрытия или null
  daysInRepair:  number;        // количество дней (считается на сервере)
  category:      string | null; // displayName вкладки (тип техники)
  lastCheckDate: string | null; // YYYY-MM-DD, дата последней синхронизации
}
```

### SyncStatus

Состояние последней синхронизации (хранится в памяти сервера).

```typescript
interface SyncStatus {
  lastSync:   string | null; // ISO datetime последнего sync или null
  lastResult: { processed: number; errors: string[] } | null;
  inProgress: boolean;
}
```

## API-функции (frontend/src/features/vehicle-status/api.ts)

Базовый префикс: `/api/vs`

| Функция | Метод + URL | Описание |
|---------|-------------|---------|
| `fetchVehicleStatus(filters?)` | `GET /api/vs/vehicle-status?isRepairing=...&category=...` | Список записей с опциональными фильтрами |
| `triggerSync()` | `POST /api/vs/vehicle-status/sync` | Запуск синхронизации (асинхронный) |
| `fetchSyncStatus()` | `GET /api/vs/vehicle-status/sync-status` | Состояние последнего/текущего sync |

Все функции бросают `Error` при HTTP-ошибке.

## Компонент VehicleStatusPage (frontend/src/features/vehicle-status/VehicleStatusPage.tsx)

### Назначение

Единственная страница функции. Отображает таблицу истории ремонтов, позволяет фильтровать по статусу и категории, запускает синхронизацию с Google Drive.

### State

| Переменная | Тип | Назначение |
|-----------|-----|-----------|
| `records` | `StatusRecord[]` | Список записей из API |
| `syncStatus` | `SyncStatus` | Состояние последней синхронизации |
| `filterMode` | `'all' \| 'repairing'` | Фильтр по статусу (все / только в ремонте) |
| `filterCat` | `string` | Фильтр по категории техники (пустая строка = все) |
| `loading` | `boolean` | Идёт ли загрузка таблицы |
| `syncing` | `boolean` | Идёт ли синхронизация |
| `error` | `string \| null` | Сообщение об ошибке fetch или sync |
| `prevLastSync` (ref) | `string \| null` | Запомненное значение lastSync до нажатия кнопки |
| `pollRef` (ref) | `interval \| null` | Ссылка на polling-интервал |

### Визуально

Макет: `flex-col`, занимает всю высоту. Три секции:

1. **Шапка** — заголовок «Состояние техники», время последней синхронизации, кнопка «Синхронизировать» (со спиннером во время работы).
2. **Фильтры** — переключатель «Все / В ремонте», выпадающий список категорий, кнопка «Сбросить» (появляется если активен фильтр), счётчик записей.
3. **Таблица** — скроллируемый блок со sticky-заголовком. Колонки: Гос. №, Категория, Тех. состояние, Статус, Начало, Конец, Дней, Проверка.

### Визуальные состояния строк таблицы

- Строки с `isRepairing=true` имеют фон `bg-destructive/5` (красноватый).
- Бейдж «Статус»: красный (`bg-destructive/15 text-destructive`) при ремонте, зелёный при исправности.
- Колонка «Дней»: значение красным шрифтом (`text-destructive`) при активном ремонте.

### Интерактивность

**Загрузка данных** (`load()`): вызывается при монтировании и при изменении `filterMode` / `filterCat`. Запрашивает `fetchVehicleStatus()` с текущими фильтрами.

**Синхронизация** (`handleSync()`):
1. Запоминает текущий `lastSync` в `prevLastSync.current`.
2. Вызывает `triggerSync()` (POST, ответ сразу `{ status: 'started' }`).
3. Запускает polling каждые 2 секунды: `fetchSyncStatus()` до тех пор, пока `lastSync` не изменится.
4. После смены `lastSync` — останавливает polling, перезагружает таблицу.
5. Safety timeout: через 60 секунд polling принудительно останавливается.
6. Cleanup: при размонтировании компонента (`useEffect` cleanup) polling останавливается.

**Блок ошибок синхронизации**: отображает до 3 ошибок из `syncStatus.lastResult.errors`, остальные схлопывает в «…ещё N ошибок».

### Список категорий (константа CATEGORIES)

Массив `CATEGORIES` должен совпадать с `displayName` в `SHEET_TABS` на сервере:

```typescript
const CATEGORIES = [
  'Стягачи',
  'ДСТ МС11',
  'Самосвалы',
  'Автобусы/Бортовые МС11',
  'АБС/АБН МС11',
  'МС 11 Краны',
  'Малая механизация МС11',
  'Спецтехника МС11',
];
```

### Форматирование дат

- `formatDate(iso)` — преобразует `YYYY-MM-DD` → `DD.MM.YYYY`; при `null` возвращает `—`.
- `formatDateTime(iso)` — преобразует ISO datetime → `DD.MM.YYYY HH:mm` (используется для отображения времени последней синхронизации).

## Связь с сервером

```
VehicleStatusPage
    ↓ fetchVehicleStatus()
    api.ts → GET /api/vs/vehicle-status
    vite proxy → http://localhost:3004/api/vs/vehicle-status
    Express → vehicleStatusRepo.queryAll()
    PostgreSQL: vehicle_status.status_history
```
