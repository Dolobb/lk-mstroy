# Технический обзор TransportAnalytics — для миграции на Node.js

## 1. API-клиент

### Внешний API: TIS Online v3

| Параметр | Значение |
|---|---|
| **Base URL** | `https://tt.tis-online.com/tt/api/v3` |
| **Авторизация** | Токен в query-параметре `token` (не в заголовке) |
| **Метод** | Все запросы — `POST` (тело пустое, всё через query params) |
| **Формат ответа** | JSON, `format=json` в query |
| **Токен** | 12-значная hex-строка, например `6C72DAA5076B` |

### Формат запросов

Все эндпоинты используют единый паттерн — POST на URL с query-параметрами:

```
POST https://tt.tis-online.com/tt/api/v3?token=XXX&format=json&command=COMMAND&param1=val1&param2=val2
```

Тело запроса **пустое**. Все параметры — в URL.

### Эндпоинты

#### 1. `getRequests` — Заявки на транспорт

```
?command=getRequests&fromDate=01.01.2026&toDate=15.01.2026
```

Ответ:
```json
{
  "list": [
    {
      "id": 233175,
      "number": 122218,
      "status": "IN_WORK",
      "dateCreate": "01.02.2026 05:28:00",
      "dateProcessed": "01.02.2026 05:28:32",
      "contactPerson": "Иванов И.И.",
      "orders": [
        {
          "type": "SPECIAL",
          "nameCargo": "Грунт",
          "weightCargo": 20.0,
          "volumeCargo": null,
          "countTs": 3,
          "cntTrip": 1,
          "route": {
            "polyline": "mzxfH...",
            "points": [
              {
                "address": "г. Омск, ул. Ленина",
                "latLon": {"lat": 54.98, "lng": 73.37},
                "date": "01.02.2026",
                "time": "08:00"
              }
            ],
            "distance": 45,
            "time": 60,
            "timeZoneTag": "МСК+3"
          },
          "objectExpend": {
            "code": "A362492",
            "name": "Прочий персонал (АУП)"
          },
          "kindType": "Автомобиль легковой"
        }
      ]
    }
  ]
}
```

#### 2. `getRouteListsByDateOut` — Путевые листы (основной метод)

```
?command=getRouteListsByDateOut&fromDate=01.02.2026&toDate=05.02.2026
```

Фильтрует по дате **выезда** (`dateOut`), возвращает **все статусы** (PRINTING, CLOSED, NOTUSED и т.д.).

Ответ:
```json
{
  "list": [
    {
      "id": 984772,
      "tsNumber": 1259006002,
      "tsType": "BUSNONPUBLIC",
      "dateOut": "03.02.2026",
      "dateOutPlan": "03.02.2026 06:00:00",
      "dateInPlan": "03.02.2026 22:00:00",
      "status": "PRINTING",
      "closeList": null,
      "startOdo": 328351,
      "finishOdo": 0,
      "ts": [
        {
          "idMO": 3241,
          "regNumber": "К173ТМ186",
          "nameMO": "Автобус Камаз 4237В2",
          "category": "M3",
          "garageNumber": "A00003336"
        }
      ],
      "drivers": [
        {"id": 8243, "tabelNumber": "В005687"}
      ],
      "fuelRates": [
        {
          "typeFuelTank": "DT",
          "fOut": 398.0,
          "fSpend": 0.0,
          "tankSize": 805.0,
          "fuelRateName": "1, 2"
        }
      ],
      "calcs": [
        {
          "orderDescr": "№121061/1 от 19.01.2026. ТФ \"Мостоотряд-29\"",
          "objectExpend": "A362492",
          "driverTask": "Перевозка пассажиров\nПассажиров 39 чел."
        }
      ]
    }
  ]
}
```

**Legacy-метод:** `getRouteLists` — фильтр по `closeList`, только CLOSED, содержит поле `glonassData`.

#### 3. `getMonitoringStats` — Мониторинг ТС

```
?command=getMonitoringStats&idMO=3241&fromDate=03.02.2026 06:00&toDate=03.02.2026 22:00
```

| Параметр | Формат | Описание |
|---|---|---|
| `idMO` | int | ID объекта мониторинга (из `ts[].idMO` путевого листа) |
| `fromDate` | `DD.MM.YYYY HH:MM` | Начало периода |
| `toDate` | `DD.MM.YYYY HH:MM` | Конец периода |

Ответ:
```json
{
  "moUid": "С335РН72",
  "orgName": "ТФ \"Мостоотряд-36\"",
  "nameMO": "С/тягач Volvo FM Truck 6х4 12.8",
  "distance": 305.69,
  "movingTime": 15982,
  "engineTime": 27239,
  "engineIdlingTime": 11257,
  "lastActivityTime": "14.01.2026 23:58",
  "movingRate": 147.79,
  "track": [
    {
      "lon": 69.516343,
      "lat": 56.157155,
      "direction": 82,
      "time": "14.01.2026 14:00:07",
      "speed": 78
    }
  ],
  "parkings": [
    {
      "lon": 72.216502,
      "lat": 55.884697,
      "begin": "14.01.2026 16:32:01",
      "end": "14.01.2026 16:43:30",
      "address": "2-я Магистральная улица · Тюкалинск"
    }
  ],
  "fuels": [
    {
      "unit": "LITRE",
      "charges": 0.0,
      "discharges": 23.8,
      "fuelName": "ДТ",
      "rate": 164.1,
      "valueBegin": 624.3,
      "valueEnd": 460.2
    }
  ]
}
```

### Обработка ошибок и лимиты

| Ситуация | Обработка |
|---|---|
| **404** | `NotFoundError` — ТС нет в системе мониторинга, пропускается |
| **429 (Rate Limit)** | До 5 ретраев с нарастающим ожиданием: 10s, 20s, 30s... |
| **Timeout** | 10 секунд (настраивается), 3 попытки с exponential backoff (1s, 2s, 4s) |
| **Rate Limit per vehicle** | 1 запрос на ТС в 30 секунд — `RATE_LIMIT_SECONDS = 30` |
| **Параллельность** | До 18 токенов, round-robin распределение задач, ThreadPoolExecutor |

Задачи мониторинга переупорядочиваются round-robin по `ts_id_mo` чтобы минимизировать ожидание rate limit'а.

---

## 2. Парсер данных

### Фильтрация ТС (какие машины загружаются)

Фильтр находится в `fetcher.py:148-151` и `pl_parser.py:265-270`:

```python
# Текущий фильтр (закомментирован "самосвал"):
ts_name = str(ts.get('nameMO', '')).lower()
if 'тягач' not in ts_name:
    continue
# Закомментировано: 'самосвал' not in ts_name and
```

**Список госномеров не хардкодится** — ТС берутся из массива `ts[]` путевых листов, фильтруются по **подстроке в `nameMO`**. Сейчас только тягачи; самосвалы были, но закомментированы.

### Связь Заявка <-> ПЛ (matching)

Ключ связи — **номер заявки**:
- В заявках: поле `number` (int)
- В ПЛ: извлекается из `calcs[].orderDescr` регулярным выражением

```python
# "№121061/1 от 19.01.2026..." -> 121061
re.match(r'^(\d+)', orderDescr.lstrip('№').lstrip())
```

Matching — `pandas.merge(inner join)` по этим номерам.

### Разбивка по сменам (`shifts.py`)

| Смена | Время |
|---|---|
| Утро (morning) | 07:30 -> 19:30 |
| Вечер (evening) | 19:30 -> 07:30 следующего дня |

Алгоритм:
1. Период ПЛ (`dateOutPlan` — `dateInPlan`) разбивается на смены
2. Для каждой смены делается **отдельный запрос** `getMonitoringStats` с границами смены
3. 00:00-07:30 относится к **вечерней** смене **предыдущего** дня

Ключ смены: `"25.01.2026_morning"` или `"25.01.2026_evening"`

### Ключевые расчётные поля из мониторинга

| Поле | Источник | Тип | Описание |
|---|---|---|---|
| `distance` | API | float, км | Пробег |
| `movingTime` | API | int, секунды | Время в движении |
| `engineTime` | API | int, секунды | Время работы двигателя |
| `engineIdlingTime` | API | int, секунды | Время холостого хода |
| `fuels[].rate` | API | float, литры | Расход топлива |
| `fuels[].valueBegin/End` | API | float, литры | Уровень топлива начало/конец |
| `fuels[].charges` | API | float, литры | Заправки |
| `fuels[].discharges` | API | float, литры | Сливы |
| `parkings[].duration_min` | **Вычисляется** | float, минуты | `(end - begin).total_seconds() / 60` |
| `mon_parkings_total_hours` | **Вычисляется** | float, часы | Сумма длительности стоянок |
| `*_hours` поля | **Вычисляется** | float, часы | Секунды / 3600 |

---

## 3. Для переноса на Node.js

### Ключевые файлы

| Файл | Что содержит | Для Node.js |
|---|---|---|
| `src/api/client.py` | API-клиент (запросы, retry, rate-limit) | -> `axios`/`node-fetch` сервис |
| `src/api/fetcher.py` | Оркестрация + параллельные запросы | -> сервис с `Promise.all` / worker threads |
| `src/parsers/monitoring_parser.py` | Парсинг ответа мониторинга | -> прямой перенос логики |
| `src/parsers/pl_parser.py` | Парсинг ПЛ + извлечение номера заявки | -> парсинг JSON + regex |
| `src/parsers/request_parser.py` | Парсинг заявок | -> парсинг JSON |
| `src/web/shifts.py` | Разбивка по сменам | -> утилита, чистая логика |
| `config.yaml` | Конфиг: URL, токены, пути | -> `.env` / config.js |

### Python-зависимости -> npm-аналоги

| Python | Для чего | npm-аналог |
|---|---|---|
| `requests` | HTTP-запросы к API | `axios` или `node-fetch` |
| `pyyaml` | Чтение config.yaml | `js-yaml` или перейти на JSON/.env |
| `pandas` | Matching заявок/ПЛ | Не нужен — используй SQL JOIN в PostgreSQL |
| `fastapi` + `uvicorn` | Web-сервер | `express` (по плану) |
| `sqlalchemy` | ORM (в web/models.py) | `prisma`, `drizzle-orm` или `knex` |

### Справочники и нормы

**Нет хардкоженых справочников** расхода топлива или моделей ТС в коде. Все данные о расходе приходят **из API** (`fuels[].rate`, `fuelRates[]`). Фильтрация ТС — только по подстроке `nameMO`.

### Что важно учесть при переносе

1. **Rate limit 30s/vehicle** — ключевое ограничение. В Node.js можно использовать `bottleneck` или custom queue.
2. **Параллельность через множество токенов** — 18 токенов в конфиге, каждый в своём потоке. В Node.js — `Promise.all` с отдельным rate-limiter на каждый токен.
3. **Matching заявок и ПЛ** — в PostgreSQL это просто `JOIN ON request.number = extracted_number_from_pl`.
4. **Формат дат API** — всегда `DD.MM.YYYY` или `DD.MM.YYYY HH:MM` / `DD.MM.YYYY HH:MM:SS`. При переносе используй `dayjs` с `customParseFormat`.
5. **Трек GPS** может быть огромным — текущий код упрощает его с интервалом 20 минут. Для React-карты (Leaflet/Mapbox) это тоже важно.
