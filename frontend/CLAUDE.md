# CLAUDE.md — Единый фронтенд (frontend/)

## Команды

```bash
cd frontend/
npm run dev     # Vite dev :5173
npm run build   # production build
npm run lint    # tsc --noEmit
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `src/App.tsx` | Роуты: `<Route path=...>` для каждой вкладки |
| `src/components/TopNavBar.tsx` | Навигация верхней панели |
| `vite.config.ts` | Proxy-правила на бэкенды |
| `src/features/` | Все разделы: dashboard, tyagachi, samosvaly, vehicle-status |

## Vite Proxy

```
/api/kip       → http://localhost:3001/api
/api/tyagachi  → http://localhost:8000/api
/api/dt        → http://localhost:3002
/api/vs        → http://localhost:3004
```

## Добавить новый раздел

1. `src/App.tsx` — добавить `<Route path="/new-section" element={<NewPage />} />`
2. `src/components/TopNavBar.tsx` — добавить пункт навигации (Link + useLocation)
3. `vite.config.ts` — добавить proxy если новый бэкенд
4. Создать `src/features/new-section/`:
   - `types.ts` — TypeScript типы
   - `api.ts` — fetch-функции (использовать `/api/...` — проксируется Vite)
   - `NewSectionPage.tsx` — основной компонент
   - `index.ts` — реэкспорт

## ⚠️ Gotchas

**TopNavBar**: использует `Link` из react-router-dom + `useLocation()` для активного состояния. Нет props — всё внутри компонента.

**KIP через iframe**: `/kip` рендерит `<iframe src="http://{hostname}:3001">`. kip/client скрывает свой TopNavBar при `window.self !== window.top`.

**Tailwind v4**: синтаксис отличается от v3 — нет `tailwind.config.js`, всё через CSS-переменные и `@theme` в `src/index.css`.

**next-themes**: тема (dark/light) передаётся через `useTheme()`. KIP-iframe получает тему через query param: `?theme=${theme}`.

## Роуты

| Путь | Компонент | Файл |
|------|-----------|------|
| `/` | Dashboard | `src/features/dashboard/` |
| `/kip` | iframe → :3001 | `src/App.tsx` (KipPage inline) |
| `/tyagachi/*` | TyagachiPage | `src/features/tyagachi/TyagachiPage.tsx` |
| `/samosvaly` | DumpTrucksPage | `src/features/samosvaly/DumpTrucksPage.tsx` |
| `/vehicle-status` | VehicleStatusPage | `src/features/vehicle-status/VehicleStatusPage.tsx` |

## Документация

- `docs/FRONTEND.md` — компоненты, Tailwind v4 особенности, shadcn/ui
- `docs/PIPELINE.md` — Vite proxy, роутинг, data flow
- `docs/DEVGUIDE.md` — запуск, сборка, добавление разделов
