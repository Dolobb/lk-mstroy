# CLAUDE.md — ЛК Мстрой (Монорепо)

## Протокол работы с кодовой базой

**Прежде чем читать исходные файлы** — проверить документацию. Она написана специально чтобы не тратить время на исследование.

### Точки входа

| Что нужно | Куда смотреть |
|-----------|--------------|
| Сервисная карта, порты, БД | `NAVIGATION.md` → раздел «Сервисная карта» |
| «Хочу изменить X» — где файл? | `NAVIGATION.md` → раздел «Сценарии разработчика» (16 сценариев) |
| Схемы всех таблиц БД | `NAVIGATION.md` → раздел «Схема баз данных» |
| Ключевые алгоритмы (КИП, геозоны, смены) | `NAVIGATION.md` → раздел «Ключевые алгоритмы» |
| Поток данных по кнопке UI | `NAVIGATION.md` → раздел «Потоки данных» |
| Все `.env` переменные | `NAVIGATION.md` → раздел «Переменные окружения» |
| Pipeline конкретного сервиса | `<сервис>/docs/PIPELINE.md` |
| Компоненты фронтенда сервиса | `<сервис>/docs/FRONTEND.md` |
| Что реализовано, ограничения | `<сервис>/docs/HISTORY.md` |
| Запуск, конфиг, расширение | `<сервис>/docs/DEVGUIDE.md` |

### Правило

```
NAVIGATION.md → docs/*.md → исходный код
```

Не читать исходники пока docs не проверены и недостаточны.

---

## Обзор проекта

**ЛК Мстрой** — единый личный кабинет управления строительным транспортом. 6 сервисов в монорепо.

| Сервис | Папка | Порт | Стек |
|--------|-------|------|------|
| Единый фронтенд | `frontend/` | 5173 | React 18 + Vite + Tailwind v4 + shadcn/ui |
| КИП техники | `kip/` | 3001 | Express + PostgreSQL 16 (`kip_vehicles`) |
| Тягачи | `tyagachi/` | 8000 | Python / FastAPI + SQLite |
| Самосвалы | `dump-trucks/` | 3002 | Express + PostgreSQL 17 (`mstroy`) |
| Состояние ТС | `vehicle-status/` | 3004 | Express + PostgreSQL 17 (`mstroy`) |
| Гео-Администратор | `geo-admin/` | 3003 | Express + PostgreSQL 17 (`mstroy` / PostGIS) |

### Запуск всех сервисов

```bash
cd kip/ && npm run dev:server                          # :3001
cd tyagachi/ && python main.py --web --port 8000       # :8000
cd dump-trucks/server && npm run dev                   # :3002
cd geo-admin/server && npm run dev                     # :3003
cd vehicle-status/server && npm run dev                # :3004
cd frontend && npm run dev                             # :5173
```

---

## Критичные неочевидные факты

### TIS API (все сервисы используют одинаково)
- **POST с пустым телом**, все параметры в **query string**
- `POST {baseUrl}?token=...&format=json&command={cmd}&{params}`
- Команды: `getRequests`, `getRouteListsByDateOut`, `getMonitoringStats`
- `getMonitoringStats` даты: `DD.MM.YYYY HH:mm` (остальные: `DD.MM.YYYY`)
- Rate limit: **1 запрос / 30с на idMO**; 18 токенов round-robin
- Готовые клиенты: `tyagachi/src/api/client.py`, `kip/server/src/services/tisClient.ts`

### PostgreSQL
- **PG 16** (порт 5432): `kip_vehicles` → `/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles`
- **PG 17** (порт 5433): `mstroy` → `/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy`

### Vite proxy (`frontend/vite.config.ts`)
`/api/kip` → :3001 | `/api/tyagachi` → :8000 | `/api/dt` → :3002 | `/api/vs` → :3004

### Secrets
- `.env` в корнях подпроектов — не коммитить
- `vehicle-status/server/creds.json` — Google Service Account — **в .gitignore**

---

## Документация по подпроектам

| Подпроект | FRONTEND.md | PIPELINE.md | HISTORY.md | DEVGUIDE.md |
|-----------|------------|-------------|------------|-------------|
| КИП | `kip/docs/FRONTEND.md` | `kip/docs/PIPELINE.md` | `kip/docs/HISTORY.md` | `kip/docs/DEVGUIDE.md` |
| Тягачи | `tyagachi/docs/FRONTEND.md` | `tyagachi/docs/PIPELINE.md` | `tyagachi/docs/HISTORY.md` | `tyagachi/docs/DEVGUIDE.md` |
| Самосвалы | `dump-trucks/docs/FRONTEND.md` | `dump-trucks/docs/PIPELINE.md` | `dump-trucks/docs/HISTORY.md` | `dump-trucks/docs/DEVGUIDE.md` |
| Состояние ТС | `vehicle-status/docs/FRONTEND.md` | `vehicle-status/docs/PIPELINE.md` | `vehicle-status/docs/HISTORY.md` | `vehicle-status/docs/DEVGUIDE.md` |
| Гео-Администратор | `geo-admin/docs/FRONTEND.md` | `geo-admin/docs/PIPELINE.md` | `geo-admin/docs/HISTORY.md` | `geo-admin/docs/DEVGUIDE.md` |
| Единый фронтенд | `frontend/docs/FRONTEND.md` | `frontend/docs/PIPELINE.md` | `frontend/docs/HISTORY.md` | `frontend/docs/DEVGUIDE.md` |
