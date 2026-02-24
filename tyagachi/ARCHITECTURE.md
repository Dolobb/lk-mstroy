# TransportAnalytics — Архитектура

> **Цель документа**: справочник для LLM-сессий, чтобы не тратить контекст на повторное чтение кода.

---

## 1. Обзор проекта

**Назначение**: Сопоставление транспортных заявок (Requests) и путевых листов (Route Lists / PL), загрузка мониторинга ГЛОНАСС, генерация HTML-отчётов.

**Основные сценарии**:
1. **CLI local mode** — парсинг локальных JSON-файлов, матчинг, генерация отчёта
2. **CLI fetch mode** — загрузка данных из TIS Online API, парсинг, матчинг, мониторинг, отчёт
3. **Web mode** — FastAPI сервер с UI для создания отчётов и истории

**Технологический стек**:
- Python 3.10+
- FastAPI + Uvicorn (веб-сервер)
- SQLAlchemy + SQLite (хранение истории/кэша)
- Pandas (работа с CSV)
- Leaflet.js (карты в отчётах)

---

## ⚠️ КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ

### Февраль 2026: V2 Layout — основной формат отчётов

**Архитектура отчётов изменена:**

| Версия | Файл | Статус | Описание |
|--------|------|--------|----------|
| **V2** | `html_generator_v2.py` | **ОСНОВНОЙ** | Трёхколоночный layout, встроенная карта, факт-панель справа |
| V1 | `html_generator.py` | Legacy | Вертикальный layout, карта под таблицами |

**V2 используется во всех режимах**: CLI fetch, CLI local, Web mode.

**V1 сохранён** для отката при обнаружении ошибок в V2.

### Методы выгрузки путевых листов

| Метод | API Command | Фильтрация | Статусы | Дополнительно |
|-------|-------------|------------|---------|---------------|
| **Новый (по умолчанию)** | `getRouteListsByDateOut` | По **дате выезда** (dateOut) | ВСЕ (CLOSED, PRINTING, NOTUSED, и т.д.) | Нет glonassData |
| **Legacy** | `getRouteLists` | По **дате закрытия** (closeList) | Только CLOSED | Есть glonassData |

---

## 2. Структура директорий

```
TransportAnalytics/
├── main.py                    # Точка входа CLI
├── config.yaml                # Конфигурация (API, пути, логи)
├── requirements.txt           # Python-зависимости
│
├── src/
│   ├── api/
│   │   ├── client.py          # APIClient — запросы к TIS Online
│   │   └── fetcher.py         # DataFetcher — оркестрация загрузки
│   │
│   ├── parsers/
│   │   ├── request_parser.py  # Парсинг заявок JSON → CSV
│   │   ├── pl_parser.py       # Парсинг путевых листов JSON → CSV
│   │   └── monitoring_parser.py # Парсинг данных мониторинга
│   │
│   ├── output/
│   │   ├── html_generator_v2.py  # ★ ОСНОВНОЙ генератор (V2 layout)
│   │   └── html_generator.py     # Legacy генератор (V1 layout)
│   │
│   ├── web/
│   │   ├── server.py          # FastAPI endpoints
│   │   ├── models.py          # SQLAlchemy модели (Report, ShiftCache, ArchivedRequest)
│   │   └── shifts.py          # Разбиение периода на смены
│   │
│   ├── matchers/              # Пустой пакет (не используется)
│   └── utils/                 # Вспомогательные утилиты
│
└── Data/
    ├── raw/                   # Исходные JSON-файлы
    ├── intermediate/          # Промежуточные CSV
    ├── final/                 # Итоговые файлы (matched.csv, report.html, ...)
    ├── history/               # Сохранённые HTML-отчёты
    ├── logs/                  # Логи pipeline_YYYY-MM-DD.log
    └── archive.db             # SQLite база данных
```

---

## 3. Генератор HTML V2 (`src/output/html_generator_v2.py`)

> **Это основной генератор отчётов** с февраля 2026.

### Ключевые отличия от V1

| Аспект | V2 (текущий) | V1 (legacy) |
|--------|--------------|-------------|
| Layout | Трёхколоночный | Вертикальный |
| Карта | Встроена в центр | Под таблицами, по клику |
| Факт-панель | Справа, всегда видна | В таблице, скрыта |
| Таймлайн | Под картой с фильтрами | Нет |
| Стоянки | Группировка по дням | Flat список |
| Смены | Сразу после Факта | В конце панели |

### Структура V2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Header: Поиск | Статистика | Глобальные фильтры                         │
├─────────────────────────────────────────────────────────────────────────┤
│ Filter Panel: Адреса отправления/назначения | Объекты затрат | Стоянки │
├──────────────────┬───────────────────────────┬──────────────────────────┤
│ LEFT COLUMN      │ CENTER COLUMN             │ RIGHT COLUMN             │
│ Заявка + ПЛ      │ Карта с треками           │ Факт-панель              │
│                  │ ─────────────────         │ ├─ Факт (мониторинг)     │
│ • Номер заявки   │ Таймлайн:                 │ ├─ Смены (кнопка)        │
│ • Маршрут        │ • Фильтр дат (visible)    │ ├─ Топливо               │
│ • ПЛ с машинами  │ • Стоянки toggle          │ └─ Стоянки (по дням)     │
│                  │ • Минимум минут           │                          │
└──────────────────┴───────────────────────────┴──────────────────────────┘
```

### Основные функции

```python
def build_hierarchy(
    matched_data: List[Dict],
    unmatched_requests: List[Dict] = None
) -> Dict[str, Any]:
    """
    Строит иерархию из плоских данных matched.csv:
    hierarchy = {
        request_number: {
            request_data...,
            pl_list: [{ pl_data..., vehicles: [...] }]
        }
    }
    """

def generate_html_report(
    hierarchy: Dict[str, Any],
    output_path: str,
    title: str = "Отчёт по заявкам и путевым листам",
    web_mode: bool = False,
    report_id: int = None
) -> str:
    """
    Генерирует HTML V2 с трёхколоночным layout.
    """
```

### Внутренние функции V2

| Функция | Строки | Назначение |
|---------|--------|------------|
| `_build_request_card_v2()` | ~4080 | Карточка заявки с 3 колонками |
| `_build_vehicle_fact_panel_v2()` | ~4403 | Правая панель: Факт → Смены → Топливо → Стоянки |
| `_build_pl_html()` | ~4525 | HTML путевого листа |

### Порядок секций в Fact Panel

```
1. Факт (мониторинг) — пробег, время, топливо
2. Смены — кнопка "Загрузить по сменам"
3. Топливо — заправки, сливы, расход
4. Стоянки — группировка по дням с заголовками
```

### CSS классы V2

| Класс | Назначение |
|-------|------------|
| `.request-layout` | Контейнер 3-колоночного layout |
| `.left-column` | Левая колонка (заявка + ПЛ) |
| `.center-column` | Центр (карта + таймлайн) |
| `.right-column` | Правая колонка (факт-панель) |
| `.map-layout` | Контейнер карты + таймлайн |
| `.timeline-area` | Область таймлайна под картой |
| `.timeline-time-filter` | Видимые поля фильтра дат |
| `.fact-panel` | Панель фактических данных |
| `.parking-day-group` | Группа стоянок за день |
| `.parking-item[data-duration]` | Стоянка с атрибутом длительности |

### JavaScript функции V2

| Функция | Назначение |
|---------|------------|
| `toggleRequest(reqNum)` | Свернуть/развернуть карточку |
| `initMap(reqNum)` | Инициализировать карту Leaflet |
| `updateParkingDisplay()` | Фильтр стоянок по минимуму минут |
| `toggleParkings(reqNum)` | Показать/скрыть стоянки на карте |
| `applyTimeFilter(reqNum)` | Применить фильтр дат к карте |
| `clearTimeFilter(reqNum)` | Сбросить фильтр дат |
| `loadShifts(...)` | AJAX загрузка смен |
| `selectVehicle(reqNum, vehUid)` | Выбрать машину → показать факт |

---

## 4. Legacy генератор V1 (`src/output/html_generator.py`)

> **Сохранён для отката** при обнаружении ошибок в V2.

### Когда использовать V1

- Обнаружена критическая ошибка в V2 layout
- Нужно сравнить результаты V2 с V1
- Пользователь явно запросил старый формат

### Как вернуться к V1

```python
# В main.py и server.py заменить:
from src.output.html_generator_v2 import generate_html_report, build_hierarchy

# На:
from src.output.html_generator import generate_html_report, build_hierarchy
```

### V1 Layout (вертикальный)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Header: Поиск | Статистика                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ Карточка заявки                                                         │
│ ├─ Заголовок (номер, маршрут, статус)                                  │
│ ├─ Таблица ПЛ                                                          │
│ │   └─ Строки машин с мониторингом                                     │
│ └─ Карта (по клику, под таблицей)                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Точка входа (`main.py`)

### CLI аргументы

| Аргумент | Описание |
|----------|----------|
| `--fetch` | Режим загрузки из API |
| `--from`, `--to` | Общий период (DD.MM.YYYY) |
| `--from-req`, `--to-req` | Период для заявок |
| `--from-pl`, `--to-pl` | Период для путевых листов |
| `-r`, `-p` | Пути к локальным JSON-файлам |
| `--web` | Запуск веб-сервера |
| `--port`, `--host` | Параметры веб-сервера |
| `--html-only` | Перегенерировать только HTML |
| `--no-html` | Не генерировать HTML |

### Режимы работы

```python
def main():
    if args.web:
        run_web_server(args)       # → src/web/server.py
    elif args.html_only:
        run_html_only_mode(...)    # Только HTML из CSV
    elif args.fetch:
        run_fetch_mode(...)        # API → Parse → Match → HTML
    else:
        run_local_mode(...)        # Local JSON → Parse → Match → HTML
```

Все режимы используют **html_generator_v2** по умолчанию.

---

## 6. Модули парсинга (`src/parsers/`)

### `request_parser.py`

Загружает `Requests_raw.json`, извлекает поля, сохраняет `requests_parsed.csv`.

**Ключевые поля:**
- `request_number`, `request_status`, `request_date_processed`
- `route_start_address`, `route_end_address`, `route_start_date`
- `route_distance`, `route_polyline`, `route_points_json`
- `object_expend_code`, `object_expend_name`

### `pl_parser.py`

Загружает `PL_raw.json`, фильтрует тягачи, сохраняет `pl_parsed.csv`.

```python
def extract_request_number(order_descr: str) -> Optional[int]:
    """
    Извлекает номер заявки из orderDescr.
    "№120360/1 от 31.12.2025..." → 120360
    """
```

**Ключевые поля:**
- `pl_id`, `pl_ts_number`, `pl_date_out`, `pl_status`
- `ts_id_mo`, `ts_reg_number`, `ts_name_mo`
- `extracted_request_number`

### `monitoring_parser.py`

Парсит ответ `getMonitoringStats` API.

**Возвращает:**
- `mon_distance`, `mon_moving_time_hours`, `mon_engine_time_hours`
- `mon_parkings` — массив стоянок с адресами, координатами, длительностью
- `mon_track` — упрощённый массив GPS-точек

---

## 7. API клиент (`src/api/`)

### `client.py`

```python
class APIClient:
    def get_requests(from_date, to_date) -> Dict

    def get_route_lists(from_date, to_date, use_legacy=False) -> Dict
        """По умолчанию getRouteListsByDateOut (все статусы)."""

    def get_route_lists_by_date_out(from_date, to_date) -> Dict
        """Фильтрация по dateOut, все статусы."""

    def get_route_lists_legacy(from_date, to_date) -> Dict
        """[LEGACY] Фильтрация по closeList, только CLOSED."""

    def get_monitoring_stats(id_mo, from_date, to_date) -> Dict
```

### `fetcher.py`

```python
class DataFetcher:
    def fetch_all(from_requests, to_requests, from_pl, to_pl,
                  save_raw=True, use_legacy_pl_method=False) -> Tuple[Dict, Dict]

    def extract_monitoring_tasks(pl_data) -> List[Dict]

    def fetch_monitoring_batch(tasks) -> Dict[Tuple, Dict]
```

---

## 8. Веб-сервер (`src/web/`)

### `server.py` — FastAPI Endpoints

#### Отчёты (legacy pipeline)

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| GET | `/` | Главная страница (dashboard с двухколоночным layout) |
| POST | `/api/reports` | Создать новый отчёт (фоновый pipeline) |
| GET | `/api/reports/{id}` | HTML отчёта V1 |
| GET | `/api/reports/{id}/v2` | HTML отчёта V2 |
| POST | `/api/reports/{id}/shifts` | Загрузить смены для ТС |
| GET | `/api/status` | Статус текущей загрузки отчёта |

#### Dashboard / Синхронизация (новое, февраль 2026)

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| POST | `/api/sync` | Запуск синхронизации (`period_days`: 1/3/7/14) |
| GET | `/api/sync/status` | Статус текущей синхронизации |
| GET | `/api/vehicles` | Список машин с агрегированной статистикой |
| GET | `/api/vehicles/{id}/requests` | Заявки конкретной машины |
| GET | `/api/vehicles/{id}/timeline` | Timeline-сегменты ПЛ для машины |
| GET | `/api/timeline` | Timeline для всех машин |
| GET | `/api/dashboard/summary` | Сводка: кол-во машин, заявок, статусы |
| GET | `/api/request/{number}/report` | V2 отчёт по заявке из кэша `matched_data_json` |

#### UI layout главной страницы

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Панель синхронизации (на всю ширину)                                    │
│ [1 день] [3 дня] [1 нед] [2 нед]  [Синхронизировать]                   │
│ Последняя синхр.: ... | X машин | Y заявок (Z стаб., W в работе)       │
├────────────────────────────────┬────────────────────────────────────────┤
│ Обзор машин (левая колонка)    │ Создать отчёт + История (правая)       │
│                                │                                        │
│ ┌──────────────────────────┐   │ [Форма создания отчёта]                │
│ │ А 123 АА 77 — КАМАЗ      │   │                                        │
│ │ Заявок: 5 (3 стаб, 2 раб)│   │ [История отчётов]                      │
│ │ ▼ Развернуть              │   │                                        │
│ │  [Таймлайн ████░░████]    │   │                                        │
│ │  #120360 — Москва→Сочи ✓  │   │                                        │
│ │  #120445 — Тверь→Казань ⟳ │   │                                        │
│ └──────────────────────────┘   │                                        │
└────────────────────────────────┴────────────────────────────────────────┘
```

### `models.py` — SQLite схема

#### Существующие модели (отчёты)

```python
class Report(Base):
    id, title, from_requests, to_requests, from_pl, to_pl
    created_at, html_filename, viewed_requests
    requests_count, pl_count, matched_count, pl_unmatched_count

class ShiftCache(Base):
    report_id, pl_id, ts_id_mo, shift_key, monitoring_data, loaded_at

class ArchivedRequest(Base):
    request_number, archived_at, notes, route_start_address, ...
```

#### Новые модели (dashboard, февраль 2026)

```python
class Vehicle(Base):
    """Реестр машин, автоматически из ПЛ."""
    __tablename__ = 'vehicles'
    id, ts_id_mo (unique, indexed), ts_reg_number, ts_name_mo
    first_seen_at, last_seen_at

class TrackedRequest(Base):
    """Отслеживаемые заявки с кумулятивным хранением."""
    __tablename__ = 'tracked_requests'
    id, request_number (unique, indexed)
    request_status          # из API: SUCCESSFULLY_COMPLETED, IN_PROGRESS, etc.
    stability_status        # 'stable' / 'in_progress'
    route_start_address, route_end_address, route_start_date, route_end_date
    route_distance, object_expend_code, object_expend_name, order_name_cargo
    matched_data_json       # JSON: все matched records для генерации V2 отчёта
    first_synced_at, last_synced_at

class PLRecord(Base):
    """Путевые листы — связь машина ↔ заявка."""
    __tablename__ = 'pl_records'
    id, vehicle_id (FK→vehicles), request_number (indexed)
    pl_id (unique), pl_ts_number, pl_date_out, pl_date_out_plan, pl_date_in_plan
    pl_status, pl_close_list
    has_monitoring           # True = мониторинг загружен, не перегружать

class SyncLog(Base):
    """Журнал синхронизаций."""
    __tablename__ = 'sync_log'
    id, synced_at, period_from_pl, period_to_pl, period_from_req, period_to_req
    vehicles_count, requests_total, requests_stable, requests_in_progress
    status, error_message
```

#### Ключевые методы Database для dashboard

| Метод | Назначение |
|-------|------------|
| `upsert_vehicle()` | Upsert по `ts_id_mo`, обновляет `last_seen_at` |
| `upsert_tracked_request()` | Upsert, **пропускает если `stability_status == 'stable'`** |
| `upsert_pl_record()` | Upsert по `pl_id` |
| `get_vehicles_with_stats()` | Машины + кол-во заявок (stable/in_progress) |
| `get_vehicle_requests()` | Заявки машины с вложенными PLRecord |
| `get_vehicle_timeline()` | Сегменты ПЛ для таймлайна с данными заявки |
| `get_dashboard_summary()` | Сводка для dashboard |

### `sync.py` — Логика синхронизации (новый файл)

```python
def sync_vehicle_data(period_from_pl, period_to_pl, db, progress_callback) -> dict
```

#### Pipeline синхронизации

```
1. Вычислить period_from_req = period_from_pl − 2 месяца
2. Загрузить ПЛ + заявки из API (2 вызова, дёшево)
3. Распарсить через PLParser / RequestParser
4. Отфильтровать ПЛ по статусам (исключить NOTUSED, GIVED_BACK)
5. Сматчить (inner join request_number ↔ extracted_request_number)
6. Upsert в Vehicle / TrackedRequest / PLRecord
7. Сохранить matched_data_json
8. Загрузить мониторинг (дорогая операция)
9. Записать SyncLog
```

#### Фильтр статусов ПЛ

```python
# --- ФИЛЬТР СТАТУСОВ ПЛ (изменить здесь при необходимости) ---
# sync.py, после чтения pl_parsed.csv
PL_EXCLUDE_STATUSES = ['NOTUSED', 'GIVED_BACK']
# Все статусы: PRINTING, CLOSED, GIVED_BACK, NOTUSED, CREATE
```

#### Логика стабильности заявок

| Критерий | stability_status | Поведение при sync |
|----------|------------------|--------------------|
| `request_status == 'SUCCESSFULLY_COMPLETED'` | `'stable'` | Данные в БД не перезаписываются |
| Любой другой статус | `'in_progress'` | Данные обновляются каждый sync |

#### Логика загрузки мониторинга

| Тип заявки | `has_monitoring` на PLRecord | Действие |
|------------|------------------------------|----------|
| Стабильная | `False` | Загрузить 1 раз → установить `True` |
| Стабильная | `True` | **Пропустить** (навсегда) |
| Нестабильная | любое | **Сбросить `False`** → перезагрузить |

Мониторинг — дорогая операция (1 запрос на машину×ПЛ, rate-limit 30с на ТС).
Оптимизация: стабильные ПЛ загружаются однократно; нестабильные — каждый sync.

#### `matched_data_json`

Хранит все matched records заявки в формате `List[Dict]`. Используется для генерации V2 отчёта через `build_hierarchy()` при клике на заявку в dashboard (endpoint `/api/request/{number}/report`).

### `shifts.py` — Посменная загрузка

```python
MORNING_START = (7, 30)   # 07:30
MORNING_END = (19, 30)    # 19:30
EVENING_START = (19, 30)  # 19:30
EVENING_END = (7, 30)     # 07:30 следующего дня

def split_period_into_shifts(from_dt, to_dt) -> List[Dict]
```

---

## 9. Конфигурация (`config.yaml`)

```yaml
api:
  base_url: "https://tt.tis-online.com/tt/api/v3"
  token: "YOUR_TOKEN"
  tokens: [...]  # Для параллельных запросов
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

---

## 10. Pipeline данных

```
TIS Online API
      │ getRequests / getRouteListsByDateOut
      ▼
DataFetcher.fetch_all()
      │ → Requests_*.json, PL_*.json
      ▼
RequestParser / PLParser
      │ → requests_parsed.csv, pl_parsed.csv
      ▼
run_matching()
      │ Inner join on request_number = extracted_request_number
      │ → matched.csv, *_unmatched.csv
      ▼
fetch_monitoring_batch()
      │ → matched_full.csv (с мониторингом)
      ▼
html_generator_v2.generate_html_report()
      │ → report.html (V2 layout)
      ▼
Готовый отчёт
```

---

## 11. Тестирование

### Периоды данных

**Заявки создаются за 1-3 месяца до выписки ПЛ.**

```bash
# Правильно:
python main.py --fetch \
    --from-req 01.12.2025 --to-req 31.01.2026 \
    --from-pl 01.02.2026 --to-pl 02.02.2026

# Неправильно (0% совпадений):
python main.py --fetch --from 01.02.2026 --to 02.02.2026
```

### Тест V2 отчёта

```bash
python test_v2_report.py
open output/report_v2.html
```

---

## 12. История изменений V2

### Февраль 2026 — V2 Release

**Изменения в `html_generator_v2.py`:**

1. **Filter panel readable** (строка 210):
   - `color: rgba(255,255,255,0.7)` → `rgba(255,255,255,0.9)`

2. **Порядок секций в Fact Panel** (~строки 4451-4470):
   - Было: Факт → Топливо → Стоянки → Смены
   - Стало: Факт → **Смены** → Топливо → Стоянки

3. **Фильтр стоянок работает** (~строки 2525-2547):
   - Добавлен `data-duration` атрибут к `.parking-item`
   - `updateParkingDisplay()` поддерживает flat список в `.fact-panel`

4. **Группировка стоянок по дням** (~строки 4498-4550):
   - Стоянки группируются в `.parking-day-group`
   - Заголовок дня с датой и суммарным временем
   - Показывается первые 4 стоянки на день

5. **Видимые поля дат** (~строки 4306-4316):
   - Скрытые `type="hidden"` заменены на видимые `type="date"` и `type="time"`
   - Добавлены кнопки ✓ (применить) и ✕ (сбросить)

---

## 13. FAQ для разработки

### Как добавить новое поле в отчёт?

1. **Из заявки:** `request_parser.py` → `_extract_fields()`
2. **Из ПЛ:** `pl_parser.py` → `_extract_fields()`
3. **Из мониторинга:** `monitoring_parser.py` → `parse_monitoring()`
4. **В HTML:** `html_generator_v2.py` → найти шаблон

### Как изменить логику матчинга?

`main.py:run_matching()` — inner join по `request_number == extracted_request_number`.

### Как вернуться к V1?

В `main.py` и `src/web/server.py`:
```python
# Заменить:
from src.output.html_generator_v2 import ...
# На:
from src.output.html_generator import ...
```

---

## Заметки

- `src/matchers/` — пустой пакет, логика в `main.py:run_matching()`
- `html_generator.py` (V1) сохранён как fallback
- `html_generator_v2.py` (~4600 строк) — монолит со встроенными CSS/JS
