# Tyagachi — Руководство

## 👤 Руководство пользователя

### Основной сценарий

#### Вариант A: React UI (новый)

1. Запустить backend: `cd tyagachi/ && python main.py --web --port 8000`
2. Запустить frontend: `cd frontend/ && npm run dev`
3. Открыть http://localhost:5173/tyagachi
4. Нажать **"Синхронизировать"** → выбрать период (1д / 3д / 1н / 2н)
5. Дождаться завершения (polling каждые 2 секунды)
6. Кликнуть на машину → развернуть список заявок
7. Кликнуть на заявку → открывается ReportView (3 колонки: ПЛ | карта | факт)

#### Вариант B: CLI (fetch + HTML-отчёт)

```bash
cd tyagachi/

# Загрузка и генерация отчёта за период
python main.py --fetch \
    --from-req 01.12.2025 --to-req 31.01.2026 \
    --from-pl 01.02.2026 --to-pl 28.02.2026

# Результат: Data/final/report.html (V2 layout)
# ВАЖНО: заявки создаются за 1-3 месяца до ПЛ — периоды должны различаться!
```

### Параметры синхронизации

| Кнопка | Период ПЛ | Период заявок |
|--------|-----------|---------------|
| 1д | последний день | 2 месяца назад |
| 3д | последние 3 дня | 2 месяца назад |
| 1н | последняя неделя | 2 месяца назад |
| 2н | последние 2 недели | 2 месяца назад |

### Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| 0% совпадений ПЛ и заявок | Одинаковый период для ПЛ и заявок | Период заявок должен начинаться на 2+ месяца раньше |
| Заявки не обновляются | `SUCCESSFULLY_COMPLETED` → stable | Ожидаемо — данные стабильных заявок не перезаписываются |
| Мониторинг не загружается | `has_monitoring=True` на PLRecord | Ожидаемо — стабильные ПЛ загружаются один раз |
| Долгая синхронизация | Rate limit TIS API: 1 req / 30с на ТС | Нормально, нельзя ускорить |
| Карта не показывает трек | Мониторинг не загружен для этого ПЛ | Дождаться sync или запустить с более широким периодом |

---

## 🛠 Руководство разработчика

### Запуск

```bash
cd tyagachi/

# Web-сервер (FastAPI + Uvicorn на :8000)
python main.py --web --port 8000

# CLI: загрузка данных из TIS API
python main.py --fetch --from DD.MM.YYYY --to DD.MM.YYYY

# CLI: раздельные периоды заявок и ПЛ
python main.py --fetch \
    --from-req 01.12.2025 --to-req 31.01.2026 \
    --from-pl 01.02.2026 --to-pl 28.02.2026

# CLI: только перегенерировать HTML из уже скачанных данных
python main.py --html-only

# CLI: без генерации HTML
python main.py --fetch --from ... --to ... --no-html

# Зависимости
pip install -r requirements.txt
```

### Конфигурация (config.yaml)

```yaml
api:
  base_url: "https://tt.tis-online.com/tt/api/v3"
  token: "YOUR_TOKEN"       # основной токен
  tokens: [...]             # список для параллельных запросов
  timeout: 30
  retry_count: 3

paths:
  input:
    requests: "Data/raw/Requests_raw.json"
    pl: "Data/raw/PL_raw.json"
  output:
    intermediate: "Data/intermediate/"
    final: "Data/final/"
    logs: "Data/logs/"

logging:
  level: "INFO"
  console: false
  file: true
```

### Структура проекта

```
tyagachi/
├── main.py                    — CLI точка входа
├── config.yaml                — конфигурация API + пути
├── requirements.txt           — Python зависимости
├── archive.db                 — SQLite база данных
│
├── src/
│   ├── api/
│   │   ├── client.py          — APIClient: TIS API запросы
│   │   └── fetcher.py         — DataFetcher: оркестрация
│   │
│   ├── parsers/
│   │   ├── request_parser.py  — парсинг заявок JSON → CSV
│   │   ├── pl_parser.py       — парсинг ПЛ; filter NOTUSED/GIVED_BACK
│   │   └── monitoring_parser.py — GPS трек + стоянки
│   │
│   ├── output/
│   │   ├── html_generator_v2.py  — ★ ОСНОВНОЙ (~4600 строк)
│   │   └── html_generator.py     — Legacy V1 (fallback)
│   │
│   └── web/
│       ├── server.py          — FastAPI endpoints
│       ├── models.py          — SQLAlchemy SQLite модели
│       ├── sync.py            — pipeline синхронизации
│       └── shifts.py          — разбивка на смены (07:30/19:30)
│
└── Data/
    ├── raw/                   — исходные JSON от TIS API
    ├── intermediate/          — промежуточные CSV
    ├── final/                 — отчёты HTML + matched.csv
    ├── history/               — сохранённые HTML-отчёты
    └── logs/                  — pipeline_YYYY-MM-DD.log
```

### TIS API

Те же endpoints что KIP:
- `getRequests` — заявки
- `getRouteListsByDateOut` — ПЛ по дате выезда (все статусы)
- `getMonitoringStats` — GPS мониторинг (даты: `DD.MM.YYYY HH:mm`)

**POST с пустым телом, параметры в query string:**
```
POST {base_url}?token=...&format=json&command=getRequests&from=01.02.2026&to=28.02.2026
```

### Как добавить новое поле в отчёт

1. **Из заявки:** `src/parsers/request_parser.py` → `_extract_fields()`
2. **Из ПЛ:** `src/parsers/pl_parser.py` → `_extract_fields()`
3. **Из мониторинга:** `src/parsers/monitoring_parser.py` → `parse_monitoring()`
4. **В HTML:** `src/output/html_generator_v2.py` → найти нужный шаблон секции

### Как изменить матчинг ПЛ ↔ заявки

Логика: `main.py` → `run_matching()` — inner join по `request_number == extracted_request_number`.
Альтернативная связь: `pl_calcs.id_order` (прямая, без regex).

### Как расширять HTML-генератор V2

⚠️ `html_generator_v2.py` — 4600-строчный монолит со встроенными CSS/JS. Изменения требуют осторожности.

**Ключевые функции для поиска:**
| Функция | Примерная строка | Назначение |
|---------|-----------------|-----------|
| `build_hierarchy()` | ~100 | Строит иерархию из matched_df |
| `generate_html_report()` | ~200 | Точка входа генерации |
| `_build_request_card_v2()` | ~4080 | Карточка заявки (3 колонки) |
| `_build_vehicle_fact_panel_v2()` | ~4403 | Правая панель (Факт→Смены→Топливо→Стоянки) |
| `_build_pl_html()` | ~4525 | HTML одного путевого листа |

**Откат на V1** (при критической ошибке в V2):
```python
# В main.py и src/web/server.py:
from src.output.html_generator import generate_html_report, build_hierarchy
# вместо html_generator_v2
```

### FastAPI endpoints

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/` | Legacy dashboard HTML (двухколоночный) |
| POST | `/api/reports` | Создать отчёт (фоновый pipeline) |
| GET | `/api/reports/{id}` | HTML отчёта V1 |
| GET | `/api/reports/{id}/v2` | HTML отчёта V2 |
| POST | `/api/reports/{id}/shifts` | Смены для ТС |
| GET | `/api/status` | Статус текущей загрузки |
| POST | `/api/sync` | Sync (`period_days`: 1/3/7/14) |
| GET | `/api/sync/status` | Статус sync |
| GET | `/api/vehicles` | Машины + статистика |
| GET | `/api/vehicles/{id}/requests` | Заявки машины |
| GET | `/api/vehicles/{id}/timeline` | Timeline-сегменты ПЛ |
| GET | `/api/timeline` | Timeline всех машин |
| GET | `/api/dashboard/summary` | Сводка dashboard |
| GET | `/api/request/{number}/data` | Hierarchical JSON для React UI |
| GET | `/api/request/{number}/report` | V2 HTML из `matched_data_json` |

### SQLite модели (src/web/models.py)

| Модель | Таблица | Ключ | Назначение |
|--------|---------|------|-----------|
| `Vehicle` | `vehicles` | `ts_id_mo` (unique) | Реестр машин |
| `TrackedRequest` | `tracked_requests` | `request_number` (unique) | Заявки с `matched_data_json` |
| `PLRecord` | `pl_records` | `pl_id` (unique) | ПЛ, связь машина↔заявка |
| `SyncLog` | `sync_log` | `id` | Журнал синхронизаций |
| `Report` | `reports` | `id` | Legacy HTML отчёты |
| `ShiftCache` | `shift_cache` | composite | Кэш данных смен |

### Отладка

```bash
# Логи pipeline
cat Data/logs/pipeline_$(date +%Y-%m-%d).log

# SQLite
sqlite3 archive.db ".tables"
sqlite3 archive.db "SELECT request_number, stability_status, last_synced_at FROM tracked_requests ORDER BY last_synced_at DESC LIMIT 10;"

# Статус sync через API
curl http://localhost:8000/api/sync/status

# Dashboard summary
curl http://localhost:8000/api/dashboard/summary
```

### Ссылки

- Архитектурные решения: `tyagachi/docs/HISTORY.md`
- Детали pipeline: `tyagachi/docs/PIPELINE.md`
- Frontend компоненты: `tyagachi/docs/FRONTEND.md`
- Расчёт плана (V1): `tyagachi/РАСЧЕТНЫЙ_ПЛАН_ЛОГИКА.md`
