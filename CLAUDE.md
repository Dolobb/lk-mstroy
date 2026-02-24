# CLAUDE.md — ЛК Мстрой (Монорепо)

## Обзор проекта

**ЛК Мстрой** — единый личный кабинет для управления строительным транспортом. Объединяет несколько подсистем в одном интерфейсе с вкладками.

## Структура монорепо

```
lk-mstroy/
├── CLAUDE.md              # Этот файл
├── kip/                   # КИП техники — мониторинг KPI транспорта
│   ├── client/            # React 18 + Tailwind v4 + Vite + Leaflet
│   ├── server/            # Express + PostgreSQL
│   └── config/            # vehicle-registry, geozones, shifts и т.д.
├── tyagachi/              # Тягачи (бывш. TransportAnalytics) — аналитика тягачей
│   ├── src/               # Python: API client, parsers, HTML generator, web server
│   ├── config.yaml        # Конфигурация API/путей
│   └── main.py            # CLI точка входа
├── samosvaly/             # Самосвалы — аналитика самосвалов (в разработке)
│   └── src/
└── frontend/              # Единый фронтенд-оболочка (React + Vite + Tailwind + shadcn)
    └── src/
        ├── app/           # Layout, роутинг, вкладки
        └── features/      # dashboard, tyagachi, kip, samosvaly
```

## Вкладки интерфейса

| # | Название | Источник | Статус |
|---|----------|----------|--------|
| 1 | Главная (дашборд) | Новый + блоки из tyagachi | В разработке |
| 2 | Тягачи | tyagachi/ (переписать фронт) | Планируется |
| 3 | КИП техники | kip/ (перенос после доработки UI) | MVP готов |
| 4 | Самосвалы | samosvaly/ | В разработке |

## Подсистема: КИП техники (`kip/`)

Мониторинг KPI строительной техники. Получает ПЛ, заявки и GPS из TIS Online API, считает КИП (загрузка, утилизация), показывает на карте + таблице.

### Стек
- **Бэкенд**: Express + PostgreSQL 16 (БД `kip_vehicles`)
- **Фронтенд**: React 18 + Tailwind CSS v4 + Vite + Leaflet
- **Single-port serving**: Express раздаёт API + React build на :3001

### Команды
```bash
cd kip/
npm run dev:server        # Express на :3001
npm run dev:client        # Vite dev на :3000
npm run build --workspace=client
```

### TIS API (критично!)
- **POST** с пустым телом, все параметры в **query string**
- URL: `POST {baseUrl}?token=...&format=json&command={cmd}&{params}`
- Команды: `getRequests`, `getRouteListsByDateOut`, `getMonitoringStats`
- `getMonitoringStats` даты: `DD.MM.YYYY HH:mm`
- 18 токенов round-robin, rate limit 1 req/30s per idMO

### Ключевые конфиги
- `config/vehicle-registry.json` — ~170 ТС (regNumber, type, branch, fuelNorm)
- `config/geozones.geojson` — геозоны (controlType === 1)
- `config/vehicle-types.json` — фильтр ТС для pipeline

### КИП Pipeline
1. Fetch ПЛ (7 дней) + заявки (2 месяца) из TIS API
2. Фильтр ТС по keywords → split на смены (утро 07:30–19:30, вечер 19:30–07:30)
3. Fetch мониторинг → анализ геозон → расчёт KPI → upsert в vehicle_records

### KPI цвета
RED <50%, BLUE 50–75%, GREEN >=75%

### PostgreSQL
```bash
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles
```

## Подсистема: Тягачи (`tyagachi/`)

Аналитика тягачей — сопоставление заявок и путевых листов, загрузка мониторинга ГЛОНАСС, генерация отчётов.

### Стек
- **Python 3.10+**, FastAPI + Uvicorn, SQLAlchemy + SQLite
- **HTML-генератор** (V2): трёхколоночный layout с картой Leaflet

### Команды
```bash
cd tyagachi/
python main.py --web --port 8000       # Web-сервер
python main.py --fetch --from DD.MM.YYYY --to DD.MM.YYYY  # CLI
```

### Ключевые модули
- `src/api/client.py` — TIS API клиент (те же endpoints что КИП)
- `src/parsers/` — request_parser, pl_parser, monitoring_parser
- `src/output/html_generator_v2.py` — основной HTML-генератор (~4600 строк)
- `src/web/server.py` — FastAPI endpoints (dashboard + reports)
- `src/web/models.py` — SQLite модели (Vehicle, TrackedRequest, PLRecord, SyncLog)

### Pipeline тягачей
1. Fetch ПЛ + заявки → парсинг → матчинг (request_number ↔ extracted_request_number)
2. Fetch мониторинг → генерация HTML отчёта V2
3. Dashboard: синхронизация → upsert Vehicle/TrackedRequest/PLRecord

### Стабильность заявок
- `SUCCESSFULLY_COMPLETED` → stable (не обновляется при sync)
- Остальные → in_progress (обновляются каждый sync)

## Единый фронтенд (`frontend/`)

React + Vite + Tailwind CSS v4 + shadcn/ui. Единая оболочка с табами/роутингом.

### Стек
- React 18 + TypeScript
- Vite (сборка)
- Tailwind CSS v4
- shadcn/ui (компоненты)
- lucide-react (иконки)

## Деплой (планируется)

- **VPS reg.ru**: Ubuntu 22.04, 2 vCPU / 4 GB RAM / 40 GB SSD
- nginx reverse proxy: `/` → frontend, `/api/kip/*` → Node:3001, `/api/transport/*` → FastAPI
- Всё через SSH, без панели управления

## Окружение

- `.env` в корнях подпроектов (не коммитятся)
- КИП: DB_NAME, TIS_API_TOKENS, TIS_API_URL
- Тягачи: config.yaml (токены API)
