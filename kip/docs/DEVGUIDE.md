# KIP — Руководство

## 👤 Руководство пользователя

### Основной сценарий

1. Открыть ЛК Мстрой → вкладка **КИП техники** (или напрямую http://localhost:3001)
2. Задать период и смену через **FilterPanel** (левая верхняя часть)
3. Выбрать фильтры: **Филиал / Тип ТС / Подразделение** (каскадные multi-select)
4. На карте (Leaflet) — маркеры окрашены по КИП: 🟢 ≥75% / 🔵 50–75% / 🔴 <50%
5. Кликнуть на маркер → DetailPanel справа: карточка ТС + детальная таблица + заявки
6. Фильтр диапазонов КИП (4 кнопки справа вверху) — скрывает лишние маркеры

### Что показывает интерфейс

| Элемент | Данные |
|---------|--------|
| Карта (Leaflet) | Маркеры ТС + треки + геозоны |
| Средний КИП (сверху справа) | Агрегированное значение по выборке |
| DetailPanel | KPI по дням/сменам, пробег, топливо, заявки |
| Таблица цвета | GREEN ≥75%, BLUE 50–75%, YELLOW 25–50%, RED <25% |

### Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| Нет данных за дату | DailyFetchJob не запускался или API недоступен | Ручной trigger: `POST /api/admin/fetch?date=YYYY-MM-DD` |
| КИП = 100% при нулевом треке | Fallback: нет GPS → `utilization = engineOnTime/engineOnTime` | Это ожидаемое поведение (⚠️, см. PIPELINE.md) |
| Маркеры не отображаются | Пустая БД или не совпадают фильтры | Проверить наличие данных в `vehicle_records` |
| Express не стартует | PG не запущен или неверный `.env` | Запустить PostgreSQL 16, проверить DB_NAME |

---

## 🛠 Руководство разработчика

### Запуск

```bash
cd kip/

# Вариант 1: раздельно (разработка)
npm run dev:server   # Express на :3001 (API + статика)
npm run dev:client   # Vite dev на :3000 (hot-reload)

# Вариант 2: Docker
npm run dev          # docker-compose: db + server + client

# Сборка клиента (для продакшн-режима через Express :3001)
npm run build --workspace=client

# Проверка типов
npm run lint         # tsc --noEmit для обоих workspace
```

### Переменные окружения

Скопировать `.env.example` → `.env`, заполнить:

| Переменная | Пример | Описание |
|-----------|--------|---------|
| `TIS_API_URL` | `https://tt.tis-online.com/tt/api/v3` | Base URL TIS API |
| `TIS_API_TOKENS` | `token1,token2,...,token18` | 18 токенов через запятую |
| `DB_NAME` | `kip_vehicles` | Имя БД PostgreSQL |
| `DB_HOST` | `localhost` | Хост (по умолчанию localhost) |
| `DB_PORT` | `5432` | Порт PostgreSQL 16 |
| `DB_USER` | `postgres` | Пользователь БД |
| `DB_PASSWORD` | — | Пароль |
| `TZ` | `Asia/Yekaterinburg` | Часовой пояс (cron + смены) |

### PostgreSQL

```bash
# Подключение
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles

# Миграция
npm run migrate --workspace=server

# Ручной trigger pipeline
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-02-10"
```

### Конфигурация ТС

- `kip/config/vehicle-registry.json` — добавить ТС: `{regNumber, type, branch, fuelNorm}`
- `kip/config/vehicle-types.json` — ключевые слова для фильтрации ТС в pipeline
- `kip/config/geozones.geojson` — полигоны рабочих зон (экспорт из fleetradar)
- `kip/config/shifts.json` — границы смен (07:30/19:30)

### TIS API особенности

- **POST** с пустым телом, все параметры в **query string**
- Rate limit: 1 запрос / 30с на `idMO`
- 18 токенов ротируются round-robin (`TIS_API_TOKENS`)
- `getMonitoringStats` даты: `DD.MM.YYYY HH:mm` (остальные: `DD.MM.YYYY`)
- Полные примеры: `kip/API_REQUEST_EXAMPLES.md`

### Встраивание в iframe

kip/client скрывает TopNavBar при `window.self !== window.top`.
Стартовая вкладка — `dst` (вкладка ДСТ по умолчанию).
В `frontend/` вкладка КИП рендерит `<iframe src="http://{hostname}:3001">`.

### Как добавить новый тип KPI

1. `kip/server/src/services/kpiCalculator.ts` — добавить вычисление
2. `kip/server/src/repositories/vehicleRecordRepo.ts` — добавить поле в upsert
3. `kip/server/src/migrate.ts` — добавить ALTER TABLE
4. `kip/client/src/VehicleDetailTable.tsx` — добавить колонку

### Как добавить новое ТС в реестр

1. Открыть `kip/config/vehicle-registry.json`
2. Добавить объект: `{"regNumber": "А000АА00", "type": "Экскаватор", "branch": "ТМС", "fuelNorm": 25}`
3. Убедиться, что тип ТС есть в `vehicle-types.json` (или добавить keyword)

### API Endpoints

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/health` | Проверка сервера |
| GET | `/api/vehicles` | Legacy: записи за одну дату |
| GET | `/api/vehicles/weekly` | Агрегированные средние для карты (основной) |
| GET | `/api/vehicles/:id/details` | Детали по ТС (дни/смены) |
| GET | `/api/vehicles/:id/requests` | Заявки ТС |
| GET | `/api/filters` | Каскадные опции фильтра |
| GET | `/api/geozones` | GeoJSON слой геозон |
| POST | `/api/admin/fetch` | Ручной trigger pipeline (async) |

### Структура проекта

```
kip/
├── client/src/
│   ├── App.tsx               — root, CSS Grid layout
│   ├── FilterPanel.tsx        — фильтры периода/смен/филиала/типа
│   ├── VehicleMap.tsx         — Leaflet карта
│   ├── VehicleDetailTable.tsx — детальная таблица
│   └── lib/utils.ts           — cn() утилита
├── server/src/
│   ├── index.ts               — Express + API routes
│   ├── jobs/dailyFetchJob.ts  — node-cron pipeline (07:30 UTC+5)
│   ├── services/
│   │   ├── tisClient.ts       — TIS API клиент
│   │   ├── kpiCalculator.ts   — формулы КИП
│   │   ├── shiftSplitter.ts   — разбивка по сменам
│   │   ├── geozoneAnalyzer.ts — Turf.js геозонный анализ
│   │   ├── monitoringParser.ts— парсинг GPS данных
│   │   ├── vehicleRegistry.ts — реестр ТС
│   │   └── plParser.ts        — парсинг ПЛ
│   └── repositories/          — SQL upsert логика
├── config/
│   ├── vehicle-registry.json  — ~170 ТС
│   ├── geozones.geojson       — геозоны
│   ├── vehicle-types.json     — фильтр pipeline
│   └── shifts.json            — границы смен
└── CLAUDE.md                  — команды и архитектура

```

### Отладка

```bash
# Проверить данные в БД
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles -c "SELECT report_date, count(*) FROM vehicle_records GROUP BY report_date ORDER BY report_date DESC LIMIT 10;"

# Ручной запуск pipeline
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-02-27"

# Health check
curl http://localhost:3001/api/health
```

### Ссылки

- TIS API примеры: `kip/API_REQUEST_EXAMPLES.md`
- Полная архитектура: `kip/CLAUDE.md`
- Schema БД: `kip/референсы и работа с агентом/DatabaseStructure.md`
- ⚠️ Особенности расчётов: `kip/docs/PIPELINE.md`
