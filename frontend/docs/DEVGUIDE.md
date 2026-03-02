# Frontend — Руководство разработчика

## Запуск

```bash
cd frontend/
npm install
npm run dev     # Vite dev server на :5173
npm run build   # Production build → dist/
npm run lint    # tsc --noEmit (проверка типов)
npm run preview # Предпросмотр production build
```

### Зависимости бэкенда

Для полноценной работы нужны запущенные сервисы:

| Сервис | Папка | Порт | Команда |
|--------|-------|------|---------|
| КИП техники | `kip/` | 3001 | `npm run dev:server` |
| Тягачи | `tyagachi/` | 8000 | `python main.py --web --port 8000` |
| Самосвалы | `dump-trucks/server/` | 3002 | `npm run dev` |
| Состояние ТС | `vehicle-status/server/` | 3004 | `npm run dev` |
| Гео-админ | `geo-admin/server/` | 3003 | `npm run dev` |

Разделы, для которых сервис не запущен, будут показывать ошибки загрузки данных. Навигация и темизация работают независимо от бэкенда.

---

## Переменные окружения

Файл `.env` для фронтенда не используется. Все адреса бэкендов проксируются через Vite (`vite.config.ts`).

При локальной разработке прокси смотрит на `localhost:PORT`. При деплое на VPS вместо Vite-прокси используется nginx reverse proxy.

---

## Как добавить новый раздел

1. Создать папку `frontend/src/features/новый-раздел/` с файлами:
   - `НовыйPage.tsx` — основной компонент страницы
   - `api.ts` — HTTP-клиент (паттерн: `const BASE = '/api/prefix'`, `get<T>(url)`)
   - `types.ts` — TypeScript интерфейсы для API-ответов
   - `index.ts` — `export { НовыйPage } from './НовыйPage'`

2. Добавить роут в `frontend/src/App.tsx`:
   ```tsx
   import { НовыйPage } from './features/новый-раздел';
   // ...
   <Route path="/новый" element={<НовыйPage />} />
   ```

3. Добавить пункт в `frontend/src/components/TopNavBar.tsx`:
   ```ts
   { id: 'novyi', path: '/новый', label: 'НАЗВАНИЕ', icon: ИконкаLucide },
   ```

4. Если нужен новый бэкенд — добавить proxy в `frontend/vite.config.ts`:
   ```ts
   '/api/novyi': {
     target: 'http://localhost:3005',
     changeOrigin: true,
   },
   ```

---

## Структура feature-модуля (паттерн)

```
features/название/
├── НазваниеPage.tsx   — страница (импортируется в App.tsx)
├── api.ts             — все fetch-запросы к бэкенду
├── types.ts           — TypeScript интерфейсы
└── index.ts           — публичный экспорт
```

Паттерн `api.ts`:
```ts
const BASE = '/api/prefix';

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export const fetchSomething = (): Promise<SomeType[]> =>
  get<{ data: SomeType[] }>(`${BASE}/something`).then(d => d.data);
```

---

## Tailwind CSS v4

Версия 4 используется через плагин `@tailwindcss/vite` (не через `tailwind.config.js`).

Подключение в `index.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";
```

Отличия v4 от v3:
- Нет `tailwind.config.js` — конфигурация через CSS
- Тёмная тема: `@custom-variant dark (&:is(.dark *))` (класс `dark` на родителе)
- Алиасы путей (`@` → `./src`) определены в `vite.config.ts` (`resolve.alias`)

CSS-переменные для Tailwind определены в `:root` и `.dark` в `index.css`. Пример использования: `bg-primary` использует `var(--primary)`.

---

## react-leaflet

Версия 4 (совместима с React 18). Используется в `TyagachiReportView`.

Фикс иконок в Vite (обязательно, иначе иконки маркеров не отображаются):
```ts
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});
```

Не забыть импортировать CSS: `import 'leaflet/dist/leaflet.css'`.

Тайл-сервер: OpenStreetMap. При деплое может потребоваться указать `attribution`.

`MapContainer` должен иметь явную высоту (через `style={{ height: '100%', width: '100%' }}` и высоту родительского контейнера).

Хелпер `FitBounds` для автоподстройки к треку:
```tsx
const FitBounds: React.FC<{ points: [number, number][] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
  }, [map, points]);
  return null;
};
```

---

## Паттерн синхронизации с поллингом

Используется в TyagachiVehicleBlock и VehicleStatusPage:

```ts
// 1. Запустить операцию
await triggerSync();

// 2. Поллинг каждые 2 сек
const poll = setInterval(async () => {
  const status = await fetchSyncStatus();
  if (status.lastSync !== prevLastSync) {
    clearInterval(poll);
    // завершено — обновить данные
    await loadData();
  }
}, 2000);

// 3. Таймаут безопасности (60 сек)
setTimeout(() => { clearInterval(poll); }, 60_000);

// 4. Очистка при unmount
useEffect(() => () => clearInterval(poll), []);
```

---

## Темизация в компонентах

Получить текущую тему:
```ts
import { useTheme } from 'next-themes';
const { theme, setTheme } = useTheme();
```

Переключить: `setTheme('dark')` / `setTheme('light')`.

Условный рендер по теме (в компонентах): через `theme === 'dark'` или через CSS-классы Tailwind с модификатором `dark:`.

---

## shadcn/ui

Компоненты находятся в `frontend/src/components/ui/`. Все установлены через `@radix-ui/*` примитивы.

Пример использования кнопки:
```tsx
import { Button } from '@/components/ui/button';
<Button variant="default" size="sm">Текст</Button>
```

Алиас `@` указывает на `frontend/src/` (настроен в `vite.config.ts`).

Утилита `cn` для объединения классов (`clsx` + `tailwind-merge`):
```ts
import { cn } from '@/lib/utils';
<div className={cn('base-class', condition && 'conditional-class')} />
```

---

## Работа с датами тягачей

Даты в API тягачей имеют формат `"DD.MM.YYYY HH:MM:SS"` (российский формат, не ISO).

Утилиты из `frontend/src/features/tyagachi/utils.ts`:

```ts
parseRuDateTime("25.01.2026 07:30:00")  // → Date object
fmtRuDT("25.01.2026 07:30:00")          // → "25.01 07:30"
fmtHours(2.5)                           // → "2ч 30м"
fmtIsoDateTime("2026-01-25T07:30:00Z")  // → локальная дата/время
fmtRequestStatus("SUCCESSFULLY_COMPLETED") // → "Завершена"
```

`buildStackedSegments(requests, viewStart, viewEnd)` — строит массив сегментов таймлайна для ПЛ. Используется в VehicleOverview для отображения прогресс-полос.

---

## Типичные проблемы

**Карта Leaflet не отображается (белый блок):**
- Проверить, что родительский контейнер имеет явную высоту
- Проверить импорт `import 'leaflet/dist/leaflet.css'`

**Иконки маркеров не отображаются:**
- Применить фикс `L.Icon.Default.mergeOptions` (см. выше)

**API-запрос возвращает HTML вместо JSON:**
- Vite-прокси не запущен или бэкенд недоступен
- Проверить, что сервис запущен на нужном порту

**Тема не применяется в iframe KIP:**
- `kip/client` должен читать `?theme=` из query-параметров и применять тему

**TypeScript ошибки при сборке:**
- `npm run lint` покажет ошибки типов
- `npm run build` запускает `tsc -b` перед Vite

**`window.location.hostname` возвращает пустую строку в тестах:**
- Это нормально в jest/vitest без DOM. В браузере всегда возвращает правильный hostname.
