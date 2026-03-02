# Tyagachi — Pipeline Reference

## Схема

```
TIS Online API
    │ POST с пустым телом, параметры в query string
    ▼
src/api/client.py (APIClient)     src/api/fetcher.py (DataFetcher)
    │                                   │
    │ getRequests + getRouteListsByDateOut
    ▼                                   ▼
src/parsers/request_parser.py    src/parsers/pl_parser.py
    │ requests_parsed.csv              │ pl_parsed.csv
    └──────────────┬───────────────────┘
                   │ pandas.merge (inner join)
                   ▼
             matched_df
                   │
                   ▼
        src/web/sync.py
        upsert → SQLite (archive.db)
        Vehicle / TrackedRequest / PLRecord / SyncLog
                   │
                   ▼
        matched_data_json в TrackedRequest
                   │
                   ▼
        FastAPI (src/web/server.py) → React UI
```

---

## 1. Источник данных

### TIS Online API (src/api/client.py)

- **Метод:** POST с **пустым телом**, все параметры в **query string**
- **Base URL:** `https://tt.tis-online.com/tt/api/v3`
- **Формат:** `POST {base_url}?token=XXX&format=json&command=COMMAND&param1=val1&...`
- **Авторизация:** токен в query-параметре `token`, не в заголовке
- **Токены:** читаются из `config.yaml` (`api.token` или `api.tokens[]`)
- **Таймаут:** 30 секунд (настраивается)

**Обработка ошибок в `_make_request`:**

| Код | Поведение |
|-----|-----------|
| 404 | Выбрасывает `NotFoundError` — ТС не в мониторинге, пропускается |
| 429 | Ждёт 10s×N, до 5 раз |
| Timeout | Экспоненциальный backoff: 1s, 2s, 4s; 3 попытки |

**Команды API:**

| Команда | Параметры | Формат дат | Примечание |
|---------|-----------|------------|------------|
| `getRequests` | `fromDate`, `toDate` | `DD.MM.YYYY` | Заявки за период |
| `getRouteListsByDateOut` | `fromDate`, `toDate` | `DD.MM.YYYY` | ПЛ по дате выезда, все статусы |
| `getMonitoringStats` | `idMO`, `fromDate`, `toDate` | `DD.MM.YYYY HH:MM` | Мониторинг ТС за период |
| `getRouteLists` | `fromDate`, `toDate` | `DD.MM.YYYY` | **Legacy**: только CLOSED, есть `glonassData` |

**Важно:** `getMonitoringStats` использует другой формат дат — с часами и минутами (`DD.MM.YYYY HH:MM`), в отличие от остальных команд.

**Rate limit:** 1 запрос `getMonitoringStats` на одно `idMO` не чаще 30 секунд. При нескольких токенах задачи распределяются round-robin.

**Ответ `getMonitoringStats`:**

| Поле | Тип | Единица |
|------|-----|---------|
| `distance` | float | км |
| `movingTime` | int | секунды → `/3600` = часы |
| `engineTime` | int | секунды |
| `engineIdlingTime` | int | секунды |
| `track[].time` | string | `DD.MM.YYYY HH:MM:SS` |
| `parkings[].begin/end` | string | `DD.MM.YYYY HH:MM:SS` |
| `fuels[].rate` | float | литры за период |

---

## 2. Парсеры (src/parsers/)

### pl_parser.py — Парсинг путевых листов

**Что делает:**
- Загружает PL_raw.json
- Разворачивает массив `calcs` (один ПЛ → несколько строк, по одной на calc)
- Фильтрует ТС по типу: только записи где `nameMO` содержит `'тягач'` (строка 269)
- Применяет `extract_request_number()` к каждому `calc.orderDescr`
- Сохраняет `pl_parsed.csv`

**Фильтр ТС (src/parsers/pl_parser.py:265-270):**
```python
def is_target_vehicle(t: dict) -> bool:
    name = str(t.get('nameMO', '')).lower()
    return 'тягач' in name
# Самосвалы закомментированы: 'самосвал' not in name
```

**Фильтр статусов ПЛ** применяется в `sync.py`, не в парсере:
```python
# src/web/sync.py:101
PL_EXCLUDE_STATUSES = ['NOTUSED', 'GIVED_BACK']
pl_df = pl_df[~pl_df['pl_status'].isin(PL_EXCLUDE_STATUSES)]
# Все возможные статусы: PRINTING, CLOSED, GIVED_BACK, NOTUSED, CREATE
```

**Ключевые поля pl_parsed.csv:**

| Поле | Источник | Описание |
|------|----------|----------|
| `pl_id` | `tsNumber_dateOut` | Сгенерированный ID |
| `pl_ts_number` | `tsNumber` | Номер ПЛ |
| `pl_date_out` | `dateOut` | Дата выезда |
| `pl_date_out_plan` | `dateOutPlan` | Плановое начало |
| `pl_date_in_plan` | `dateInPlan` | Плановый конец |
| `pl_status` | `status` | PRINTING / CLOSED / NOTUSED / GIVED_BACK / CREATE |
| `ts_id_mo` | `ts[].idMO` | ID мониторинга ТС |
| `ts_reg_number` | `ts[].regNumber` | Госзнак |
| `ts_name_mo` | `ts[].nameMO` | Название ТС |
| `extracted_request_number` | regex из `orderDescr` | Номер заявки |

**extract_request_number (src/parsers/pl_parser.py:18-44):**

```python
def extract_request_number(order_descr: str) -> Optional[int]:
    """
    "№120360/1 от 31.12.2025..." → 120360
    """
    cleaned = order_descr.lstrip('№').lstrip()
    match = re.match(r'^(\d+)', cleaned)
    if match:
        return int(match.group(1))
    return None
```

> **ВНИМАНИЕ:** Regex `r'^(\d+)'` срабатывает на любую последовательность цифр в начале строки после удаления символа «№». Если `orderDescr` начинается не с номера заявки (например, с года, кода объекта или произвольного числа), функция вернёт ложный результат. Это влияет на матчинг ПЛ↔заявка — ПЛ будет привязан к несуществующей или чужой заявке.
> (`src/parsers/pl_parser.py:39`)

### request_parser.py — Парсинг заявок

**Что делает:**
- Загружает Requests_raw.json
- Извлекает поля из вложенной структуры `request.orders[0].route.points[]`
- Сохраняет `requests_parsed.csv`

**Ключевые поля requests_parsed.csv:**

| Поле | Источник JSON | Описание |
|------|---------------|----------|
| `request_number` | `number` | Бизнес-ключ для матчинга |
| `request_status` | `status` | SUCCESSFULLY_COMPLETED / IN_WORK / и др. |
| `route_start_address` | `orders[0].route.points[0].address` | Адрес отправления |
| `route_end_address` | `orders[0].route.points[-1].address` | Адрес назначения |
| `route_start_date` | `orders[0].route.points[0].date` | Дата начала маршрута |
| `route_distance` | `orders[0].route.distance` | Расстояние по плану |
| `object_expend_code` | `orders[0].objectExpend.code` | Код объекта затрат |
| `object_expend_name` | `orders[0].objectExpend.name` | Название объекта затрат |
| `order_name_cargo` | `orders[0].nameCargo` | Наименование груза |

### monitoring_parser.py — Парсинг мониторинга

**Что делает:**
- Парсит ответ `getMonitoringStats`
- Вычисляет производные поля (duration_min для стоянок, часы из секунд)
- Возвращает структурированный dict с `mon_*` полями

**Ключевые вычисляемые поля:**

| Поле | Вычисление |
|------|------------|
| `mon_distance` | `response.distance` |
| `mon_engine_time_hours` | `response.engineTime / 3600` |
| `mon_moving_time_hours` | `response.movingTime / 3600` |
| `mon_idling_time_hours` | `response.engineIdlingTime / 3600` |
| `parkings[].duration_min` | `(end - begin).total_seconds() / 60` |
| `mon_parkings_total_hours` | сумма длительностей стоянок |
| `mon_track` | упрощённый массив GPS-точек (интервал 20 мин) |

---

## 3. Матчинг ПЛ ↔ Заявки

**Алгоритм:** `pandas.merge` с `how='inner'` по номеру заявки.

```python
# src/web/sync.py:105
matched_df = pd.merge(
    requests_df,
    pl_df,
    left_on='request_number',       # из requests_parsed.csv
    right_on='extracted_request_number',  # из pl_parsed.csv
    how='inner',
    suffixes=('_req', '_pl')
)
```

**Ключ связи:**
- В заявках: поле `request_number` (int)
- В ПЛ: `extracted_request_number` — результат `extract_request_number(orderDescr)`

**Период заявок** всегда шире периода ПЛ — заявки создаются за 1-3 месяца до выписки ПЛ:
```python
# src/web/sync.py:59
period_from_req = (from_pl_dt - timedelta(days=60)).strftime('%d.%m.%Y')
```

---

## 4. sync.py — Синхронизация (src/web/sync.py)

**Функция:** `sync_vehicle_data(period_from_pl, period_to_pl, db, progress_callback)`

**Pipeline sync (9 шагов):**

```
1. Вычислить period_from_req = period_from_pl − 60 дней
2. Загрузить ПЛ + заявки из API (DataFetcher.fetch_all)
3. Распарсить через PLParser / RequestParser → intermediate CSVs
4. Прочитать CSVs в pandas DataFrame
5. Применить фильтр статусов ПЛ (исключить NOTUSED, GIVED_BACK)
6. Сделать inner join → matched_df
7. Upsert в Vehicle / TrackedRequest / PLRecord
8. Сохранить matched_data_json (с мониторингом)
9. Загрузить мониторинг для ПЛ без has_monitoring=True
10. Записать SyncLog
11. Очистка данных старше 60 дней (cleanup_old_data)
```

**Логика стабильности:**

| Условие | stability_status | Поведение при следующем sync |
|---------|------------------|------------------------------|
| `request_status == 'SUCCESSFULLY_COMPLETED'` | `'stable'` | `upsert_tracked_request` возвращает `'skipped'` — данные не меняются |
| Любой другой статус | `'in_progress'` | Данные перезаписываются |

**Логика загрузки мониторинга:**

| Тип заявки | `has_monitoring` у PLRecord | Действие |
|------------|----------------------------|----------|
| Стабильная | False | Загрузить один раз → поставить True |
| Стабильная | True | Пропустить — никогда не перезагружать |
| Нестабильная | любое | Сбросить в False → перезагрузить |

Дополнительно: «orphan» ПЛ (в БД есть, но в текущем sync не попали) — догружаются отдельно.

---

## 5. HTML Генератор V2 (src/output/html_generator_v2.py)

**Размер:** ~5003 строки, монолит. Содержит встроенные CSS (~1600 строк), JavaScript (~2500 строк), Python-шаблоны.

**Используется:** во всех режимах (CLI fetch, CLI local, Web mode, API endpoint).

**Входная точка:**

```python
# src/output/html_generator_v2.py:15
def generate_html_report(
    hierarchy: Dict[str, Any],
    output_path: str,
    title: str = "Отчёт по заявкам и путевым листам",
    web_mode: bool = False,
    report_id: int = None
) -> str:
```

### build_hierarchy() (src/output/html_generator_v2.py:4921)

**Назначение:** трансформирует плоский список matched-записей в иерархическую структуру.

```python
def build_hierarchy(
    matched_data: List[Dict],       # список записей из matched_data_json
    unmatched_requests: List[Dict] = None  # игнорируется
) -> Dict[str, Any]:
    # Возвращает:
    # {
    #   "121613": {
    #     request_number, request_status, route_start_address, route_end_address,
    #     route_start_date, order_name_cargo, route_distance, route_polyline,
    #     route_points_json, ...
    #     pl_list: [
    #       {
    #         pl_id, pl_date_out, pl_date_out_plan, pl_date_in_plan, pl_status,
    #         vehicles: [
    #           { ts_id_mo, ts_reg_number, ts_name_mo, mon_distance, mon_track, mon_parkings, ... }
    #         ]
    #       }
    #     ]
    #   }
    # }
```

### _build_html() (src/output/html_generator_v2.py:55)

**Назначение:** строит полный HTML-документ.

**Что генерирует:**
- Весь CSS (встроен, ~1600 строк)
- Весь JavaScript (встроен, Leaflet-карта, таймлайн, фильтры)
- Header со статистикой (кол-во заявок, ПЛ, ТС)
- Filter Panel (адреса отправления/назначения, объекты затрат)
- Карточки заявок через `_build_request_html()`
- Сортирует заявки по `route_start_date` (descending)

### _build_request_html() (src/output/html_generator_v2.py:3914)

**Назначение:** генерирует HTML для одной заявки в 3-колонном layout V2.

```
┌──────────────────┬──────────────────────┬──────────────────────┐
│ LEFT (320px)     │ CENTER (flex:1)       │ RIGHT (360px)        │
│ Заявка + ПЛ      │ Leaflet карта         │ Факт-панель          │
│ • Номер заявки   │ Полилиния маршрута    │ (один vehicle)       │
│ • Маршрут        │ ─────────────────     │                      │
│ • Список ПЛ      │ Таймлайн:             │                      │
│                  │ • GPS-точки           │                      │
│                  │ • Стоянки             │                      │
│                  │ • Фильтр дат          │                      │
└──────────────────┴──────────────────────┴──────────────────────┘
```

**Данные для карты:** `route_polyline` (encoded polyline) и `route_points_json` (массив точек маршрута).

### _build_vehicle_fact_panel_v2() (src/output/html_generator_v2.py:4408)

**Назначение:** генерирует HTML правой колонки (факт-панель) для одного ТС.

**Структура:**
1. Шапка: госзнак + название ТС
2. Секция «Факт (мониторинг)»: сетка пробег/время/топливо/стоянки
3. Кнопка «Загрузить по сменам» (если есть `ts_id_mo`, `from_date`, `to_date`)
4. Топливо: заправки, сливы, уровень начало/конец
5. Стоянки: группировка по дням, первые 4 стоянки в день

### Timeline (src/output/html_generator_v2.py:~3028-3227)

Таймлайн — вертикальный список событий (GPS-точки + стоянки) по времени, рендерится через JavaScript функцию `buildTimeline(requestId)`.

**Алгоритм показа точек трека:**
- Базовый интервал: 20 минут
- Дополнительно: заполнение промежутков между близкими стоянками (< 20 мин)

> **ВНИМАНИЕ:** Пересекающиеся по времени события (когда `parking.begin < track_point.time < parking.end`) размещаются в списке без учёта перекрытия — просто сортируются по времени начала. В редких случаях это приводит к визуальному наложению соседних элементов таймлайна. Алгоритм раскладки не обрабатывает overlap — решение потребует полного рефакторинга. (`src/output/html_generator_v2.py:3176`)

---

## 6. База данных (SQLite, tyagachi/Data/archive.db)

Схема в `src/web/models.py`. БД создаётся автоматически при старте сервера.

### Модели

**Vehicle (src/web/models.py:139)** — реестр машин:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | Integer PK | |
| `ts_id_mo` | Integer UNIQUE | ID мониторинга (ключ upsert) |
| `ts_reg_number` | String | Госзнак |
| `ts_name_mo` | String | Название ТС |
| `first_seen_at` | DateTime | Первое появление |
| `last_seen_at` | DateTime | Последнее обновление |

**TrackedRequest (src/web/models.py:163)** — отслеживаемые заявки:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | Integer PK | |
| `request_number` | Integer UNIQUE | Номер заявки (ключ upsert) |
| `request_status` | String | Из API: SUCCESSFULLY_COMPLETED, IN_WORK и др. |
| `stability_status` | String | `'stable'` / `'in_progress'` |
| `route_start_address` | String | |
| `route_end_address` | String | |
| `route_start_date` | String | |
| `route_distance` | String | Хранится как строка |
| `object_expend_code` | String | |
| `object_expend_name` | String | |
| `order_name_cargo` | String | |
| `matched_data_json` | Text | **Денормализованное хранение** |
| `first_synced_at` | DateTime | |
| `last_synced_at` | DateTime | |

> **ВНИМАНИЕ:** `matched_data_json` (`src/web/models.py:181`) хранит **весь** список matched-записей для заявки единым JSON-блоком в поле `Text`. Каждая запись включает данные мониторинга: трек GPS, стоянки, топливо. При большом числе ТС на заявку или длинных периодах наблюдения JSON может достигать нескольких МБ. SQLite не имеет ограничения на размер Text, но десериализация всего блока при каждом запросе `/api/request/{N}/data` — это O(размер JSON). При накоплении данных нескольких синхронизаций это может стать узким местом.

**PLRecord (src/web/models.py:205)** — путевые листы, связь машина ↔ заявка:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | Integer PK | |
| `vehicle_id` | Integer FK→vehicles | |
| `request_number` | Integer | |
| `pl_id` | String UNIQUE | Ключ upsert |
| `pl_ts_number` | String | |
| `pl_date_out` | String | DD.MM.YYYY |
| `pl_date_out_plan` | String | DD.MM.YYYY HH:MM |
| `pl_date_in_plan` | String | DD.MM.YYYY HH:MM |
| `pl_status` | String | |
| `has_monitoring` | Boolean | True = мониторинг загружен, не перезагружать |

**SyncLog (src/web/models.py:244)** — журнал синхронизаций:

| Поле | Описание |
|------|----------|
| `synced_at` | Время синхронизации |
| `period_from_pl` / `period_to_pl` | Период ПЛ |
| `period_from_req` / `period_to_req` | Период заявок |
| `vehicles_count` | Кол-во машин в sync |
| `requests_total` / `requests_stable` / `requests_in_progress` | Статистика |
| `status` | `'success'` / `'error'` |
| `error_message` | Текст ошибки (если есть) |

### Ключевые методы Database (src/web/models.py:623+)

| Метод | Описание |
|-------|----------|
| `upsert_vehicle(ts_id_mo, ...)` | Upsert по `ts_id_mo`, обновляет `last_seen_at` |
| `upsert_tracked_request(data)` | Upsert, **пропускает если `stability_status == 'stable'`** |
| `upsert_pl_record(data)` | Upsert по `pl_id` |
| `get_vehicles_with_stats(days?)` | Машины + кол-во заявок с фильтром по периоду |
| `get_vehicle_requests(vehicle_id, days?)` | Заявки машины с вложенными PLRecord |
| `get_vehicle_timeline(vehicle_id, days?)` | Сегменты ПЛ для таймлайна |
| `get_dashboard_summary()` | Сводка для dashboard |
| `cleanup_old_data(max_age_days=60)` | Удаляет данные старше N дней |

---

## 7. FastAPI Endpoints (src/web/server.py)

**Отчёты (legacy pipeline):**

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| GET | `/` | Главная страница (HTML с sync-панелью и vehicle-списком) |
| POST | `/api/fetch` | Старый fetch pipeline (не sync) |
| GET | `/api/status` | Статус старого fetch |
| POST | `/api/reports` | Создать legacy отчёт |
| GET | `/api/reports/{id}` | HTML отчёта V1 |
| GET | `/api/reports/{id}/v2` | HTML отчёта V2 |
| POST | `/api/reports/{id}/shifts` | Загрузить смены для ТС в legacy отчёте |
| DELETE | `/api/reports/{id}` | Удалить отчёт |

**Dashboard / Синхронизация:**

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| POST | `/api/sync` | Запуск синхронизации (`period_days`: 1/3/7/14) |
| GET | `/api/sync/status` | Статус текущей синхронизации |
| GET | `/api/vehicles` | Список машин с агрегированной статистикой |
| GET | `/api/vehicles/{id}/requests` | Заявки конкретной машины |
| GET | `/api/vehicles/{id}/timeline` | Timeline-сегменты ПЛ для машины |
| GET | `/api/timeline` | Timeline для всех машин |
| GET | `/api/dashboard/summary` | Сводка: кол-во машин, заявок, статусы |
| GET | `/api/route-addresses` | Уникальные адреса маршрутов |

**React viewer:**

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| GET | `/api/request/{number}/report` | V2 HTML отчёт по заявке (из `matched_data_json`) |
| GET | `/api/request/{number}/data` | Иерархический JSON для React viewer |

**`/api/request/{N}/data` — детали (src/web/server.py:1312):**
```python
# Читает matched_data_json из TrackedRequest
# Вызывает build_hierarchy(matched_records, [])
# Возвращает: { request_number, request_info, hierarchy }
```

---

## 8. Привязка pipeline к UI

```
POST /api/sync { period_days }
    → run_sync_pipeline (background thread)
    → sync_vehicle_data() → DB
    ↓
GET /api/sync/status  (polling каждые 2с из React SyncPanel)
    → { running, progress, mon_current, mon_total, stats }
    ↓
GET /api/vehicles      → TyagachiVehicleBlock → список машин
    ↓
GET /api/vehicles/{id}/requests → раскрытие машины → заявки
    ↓ клик на заявку
GET /api/request/{N}/data → TyagachiReportView
    → build_hierarchy() → { hierarchy }
    → 3-колонный viewer с react-leaflet картой
```

---

## 9. Примеры API запросов (из docs/API_REQUEST_EXAMPLES.md)

### getRequests

```
POST https://tt.tis-online.com/tt/api/v3?token=TOKEN&format=json&command=getRequests&fromDate=26.01.2026&toDate=26.01.2026
```

Ответ: `{ "list": [{ "id": 232560, "number": 121613, "status": "IN_WORK", "orders": [...] }] }`

Ключевое поле для matching: `list[].number`

### getRouteListsByDateOut

```
POST ...?command=getRouteListsByDateOut&fromDate=08.02.2026&toDate=09.02.2026
```

Ответ содержит `calcs[].orderDescr = "№121613/1 от 26.01.2026. ДСУ Мостострой-11"` → извлекаем `121613`.

Также: `ts[].idMO` — используется для мониторинга, `dateOutPlan`/`dateInPlan` — период для `getMonitoringStats`.

### getMonitoringStats

```
POST ...?command=getMonitoringStats&idMO=17&fromDate=08.02.2026 08:00&toDate=09.02.2026 08:00
```

**Важно:** пробел в дате при curl кодируется как `%20`. В Python `requests` и `URLSearchParams` кодируется автоматически.

### Разбивка по сменам

| Смена | Время |
|-------|-------|
| Утро (morning) | 07:30 → 19:30 |
| Вечер (evening) | 19:30 → 07:30 следующего дня |

Правило полуночи: период 00:00-07:30 относится к вечерней смене **предыдущего** дня.

### Rate limit

1 запрос `getMonitoringStats` на `idMO` не чаще 30 секунд. При 18 токенах — 18 параллельных очередей с round-robin по `idMO`.
