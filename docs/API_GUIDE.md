# API Guide — ЛК Мстрой

Единый справочник по всем API, используемым в проекте: внешний TIS Online API и внутренние REST API подсистем.

---

## Справка для TIS: используемые данные

> Этот раздел предназначен для специалистов TIS Online. Описывает, какие методы API и какие конкретные поля ответов используются в системе «ЛК Мстрой». При обновлениях структур ответов просьба учитывать зависимости, перечисленные ниже.

### Методы, которые мы
 вызываем

| Метод                      | Для чего используется                                           |
|----------------------------|-----------------------------------------------------------------|
| `getRequests`              | Список заявок — для сопоставления с путевыми листами           |
| `getRouteListsByDateOut`   | Путевые листы по дате выезда — основной источник данных        |
| `getRouteLists`            | ПЛ по дате закрытия — только для бухгалтерских отчётов (legacy)|
| `getMonitoringStats`       | GPS-трек и телеметрия ТС — расчёт КПИ и анализ маршрута       |

---

### `getRequests` — используемые поля

Запрос: `fromDate`, `toDate` (DD.MM.YYYY).

| Поле                             | Как используется                                              |
|----------------------------------|---------------------------------------------------------------|
| `list[].number`                  | **Ключ сопоставления** с путевым листом (через `orderDescr`) |
| `list[].id`                      | Внутренний идентификатор, хранится в БД                      |
| `list[].status`                  | Статус заявки (влияет на логику обновления данных)           |
| `list[].dateCreate`              | Дата создания заявки                                          |
| `list[].dateProcessed`           | Дата обработки заявки                                         |
| `list[].orders[0].nameCargo`     | Наименование груза                                            |
| `list[].orders[0].weightCargo`   | Вес груза                                                     |
| `list[].orders[0].volumeCargo`   | Объём груза                                                   |
| `list[].orders[0].countTs`       | Количество ТС в заявке                                        |
| `list[].orders[0].cntTrip`       | Количество рейсов                                             |
| `list[].orders[0].route.points[].address`   | Адреса точек маршрута (откуда / куда)          |
| `list[].orders[0].route.points[].latLon`    | Координаты точек маршрута (`lat`, `lng`)        |
| `list[].orders[0].route.distance`           | Расстояние маршрута                            |
| `list[].orders[0].route.polyline`           | Полилиния маршрута (для карты)                 |
| `list[].orders[0].objectExpend.code`        | Код объекта затрат                             |
| `list[].orders[0].objectExpend.name`        | Наименование объекта затрат                    |
| `list[].orders[0].kindType`                 | Тип ТС в заявке                               |

> Используем только первый элемент `orders[0]`. Остальные заказы в заявке не обрабатываются.

---

### `getRouteListsByDateOut` — используемые поля

Запрос: `fromDate`, `toDate` (DD.MM.YYYY).

| Поле                         | Как используется                                                        |
|------------------------------|-------------------------------------------------------------------------|
| `list[].id`                  | Идентификатор ПЛ, хранится в БД                                         |
| `list[].tsNumber`            | Номер путевого листа                                                    |
| `list[].status`              | Статус ПЛ (NOTUSED и GIVED_BACK исключаются из аналитики)              |
| `list[].dateOut`             | Дата выезда (DD.MM.YYYY)                                               |
| `list[].dateOutPlan`         | **Начало периода** для запроса `getMonitoringStats`                    |
| `list[].dateInPlan`          | **Конец периода** для запроса `getMonitoringStats`                     |
| `list[].ts[].idMO`           | **ID ТС в мониторинге** — передаётся в `getMonitoringStats`            |
| `list[].ts[].regNumber`      | Госномер ТС                                                             |
| `list[].ts[].nameMO`         | Наименование ТС (используется для фильтрации по типу)                  |
| `list[].ts[].category`       | Категория ТС                                                            |
| `list[].ts[].garageNumber`   | Гаражный номер                                                          |
| `list[].calcs[].orderDescr`  | **Источник номера заявки**: из строки вида `"№121613/1 от 26.01.2026"` извлекаем цифры до `/` |
| `list[].calcs[].objectExpend`| Код объекта затрат                                                      |
| `list[].calcs[].address`     | Адрес задания                                                           |

> Поле `list[].calcs[].orderDescr` — критически важно. Именно из него мы извлекаем номер заявки для сопоставления. Формат: `"№{number}/{suffix} от {date}"`.

---

### `getMonitoringStats` — используемые поля

Запрос: `idMO`, `fromDate`, `toDate` (DD.MM.YYYY HH:MM — с временем).

| Поле                      | Как используется                                                     |
|---------------------------|----------------------------------------------------------------------|
| `distance`                | Пробег (км) — используется в КПИ и отчётах                         |
| `movingTime`              | Время движения (секунды) — конвертируется в часы                    |
| `engineTime`              | Время работы двигателя (секунды) — базовый показатель КПИ           |
| `engineIdlingTime`        | Время холостого хода (секунды)                                       |
| `track[].lat`             | Широта точки трека                                                   |
| `track[].lon`             | Долгота точки трека                                                  |
| `track[].time`            | Время точки трека (DD.MM.YYYY HH:mm:ss) — поле именно `time`       |
| `track[].speed`           | Скорость в точке (км/ч)                                             |
| `parkings[].begin`        | Начало стоянки (DD.MM.YYYY HH:mm:ss) — поле именно `begin`         |
| `parkings[].end`          | Конец стоянки — поле именно `end`                                   |
| `parkings[].lat`          | Координаты стоянки                                                   |
| `parkings[].lon`          | Координаты стоянки                                                   |
| `parkings[].address`      | Адрес стоянки (для отображения)                                      |
| `fuels[].rate`            | Расход топлива за период (литры) — суммируется по всем записям      |
| `fuels[].valueBegin`      | Уровень топлива в начале периода (литры)                            |
| `fuels[].valueEnd`        | Уровень топлива в конце периода (литры)                             |
| `fuels[].fuelName`        | Наименование вида топлива                                            |

> **Важно по именам полей:**
> - В `track[]`: поле называется `time` (не `timestamp`, не `datetime`)
> - В `parkings[]`: поля называются `begin` и `end` (не `start`/`stop`, не `startTime`/`endTime`)
> - Все временны́е поля — строки формата `DD.MM.YYYY HH:mm:ss`
> - `movingTime`, `engineTime`, `engineIdlingTime` — целые числа в **секундах**

---

### Схема зависимостей между методами

```
getRequests(fromDate, toDate)
  └─ list[].number  ←──────────────────────────────────┐
                                                        │ сопоставление
getRouteListsByDateOut(fromDate, toDate)                │
  ├─ list[].calcs[].orderDescr  → извлекаем number ────┘
  ├─ list[].ts[].idMO           → передаём в getMonitoringStats
  ├─ list[].dateOutPlan         → fromDate для getMonitoringStats
  └─ list[].dateInPlan          → toDate для getMonitoringStats

getMonitoringStats(idMO, fromDate, toDate)
  ├─ distance, movingTime, engineTime  → расчёт КПИ
  ├─ track[]                           → анализ геозон, карта
  ├─ parkings[]                        → время стоянок
  └─ fuels[]                           → расход топлива
```

---

## Содержание

1. [TIS Online API (внешний)](#1-tis-online-api-внешний)
   - 1.1 Общий формат запроса
   - 1.2 Авторизация и токены
   - 1.3 `getRequests` — Заявки
   - 1.4 `getRouteListsByDateOut` — Путевые листы
   - 1.5 `getRouteLists` (legacy) — ПЛ по дате закрытия
   - 1.6 `getMonitoringStats` — Мониторинг ТС
   - 1.7 Rate Limits и стратегия ретраев
   - 1.8 Matching chain: Заявка → ТС → Мониторинг
   - 1.9 Разбивка по сменам
2. [KIP Server API (:3001)](#2-kip-server-api-3001)
3. [Dump-trucks Server API (:3002)](#3-dump-trucks-server-api-3002)
4. [Geo-admin Server API (:3003)](#4-geo-admin-server-api-3003)
5. [Tyagachi FastAPI (:8000)](#5-tyagachi-fastapi-8000)
6. [Конфигурация и переменные окружения](#6-конфигурация-и-переменные-окружения)

---

## 1. TIS Online API (внешний)

**Base URL:** `https://tt.tis-online.com/tt/api/v3`

### 1.1 Общий формат запроса

Все команды — это **POST** с **пустым телом**. Параметры передаются **исключительно через query string**:

```
POST {base_url}?token={token}&format=json&command={command}&{params}
```

Обязательные параметры для каждого запроса:

| Параметр  | Значение         | Описание                        |
|-----------|------------------|---------------------------------|
| `token`   | `6C72DAA5076B`   | Токен авторизации (12 hex-символов) |
| `format`  | `json`           | Формат ответа                   |
| `command` | строка           | Имя команды API                 |

> **Важно:** `Content-Type` заголовок не нужен — тело пустое. Никаких заголовков авторизации — токен только в URL.

**curl-пример минимального запроса:**
```bash
curl -X POST "https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getRequests&fromDate=26.01.2026&toDate=26.01.2026"
```

---

### 1.2 Авторизация и токены

- Используется **пул из 18 токенов** (comma-separated в `TIS_API_TOKENS`)
- Распределение: **round-robin** — каждый следующий запрос берёт следующий токен
- Каждый токен — независимый rate limit
- С 18 токенами можно делать 18 параллельных очередей запросов

```js
// Node.js: round-robin по токенам
const tokens = process.env.TIS_API_TOKENS.split(',');
let tokenIndex = 0;
function nextToken() {
  return tokens[tokenIndex++ % tokens.length];
}
```

```python
# Python: если один токен в config.yaml
api_config.get('token', '')

# Если несколько — брать из массива tokens
api_config.get('tokens', [])
```

---

### 1.3 `getRequests` — Заявки

**Назначение:** Получить список транспортных заявок за период.

#### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=...&format=json&command=getRequests&fromDate=26.01.2026&toDate=26.01.2026
```

| Параметр   | Формат       | Пример       | Описание          |
|------------|--------------|--------------|-------------------|
| `fromDate` | `DD.MM.YYYY` | `26.01.2026` | Начало периода    |
| `toDate`   | `DD.MM.YYYY` | `26.01.2026` | Конец периода     |

#### Node.js
```js
const params = new URLSearchParams({
  token: TOKEN,
  format: 'json',
  command: 'getRequests',
  fromDate: '26.01.2026',
  toDate:   '26.01.2026',
});
const { data } = await axios.post(`${BASE_URL}?${params}`);
// data.list — массив заявок
```

#### Python
```python
response = client.get_requests('26.01.2026', '26.01.2026')
# response['list'] — массив заявок
```

#### Ответ (реальный пример, сокращён)
```json
{
  "list": [
    {
      "id": 232560,
      "number": 121613,
      "status": "IN_WORK",
      "dateCreate": "26.01.2026 11:59:00",
      "dateProcessed": "26.01.2026 11:59:56",
      "contactPerson": "Дерябин Илья Сергеевич",
      "phonePerson": "79026222914",
      "idOwnCustomer": -1570540425,
      "responsiblePerson": "Каргаполов Владислав Сергеевич",
      "orders": [
        {
          "id": 234793,
          "type": "CARGO",
          "typeOfWork": "Транспортировка грунта. V в смену = 1000м3",
          "nameCargo": "Грунт (песок)",
          "weightCargo": 52416.0,
          "volumeCargo": 37440.0,
          "countTs": 8,
          "cntTrip": 2496,
          "route": {
            "polyline": "ajt`Jaky~K`A[vAs@...",
            "points": [
              {
                "address": "Качипова, Р-404 Тюмень — Тобольск",
                "latLon": { "lat": 57.9464, "lng": 68.1331 },
                "date": "03.02.2026",
                "time": "08:00",
                "person": "Дерябин Илья Сергеевич",
                "addressdesc": "Карьер Качиповский 1 (205 км)"
              },
              {
                "index": 1,
                "address": "Сумкино, Р-404 Тюмень — Тобольск",
                "latLon": { "lat": 58.1264, "lng": 68.3031 },
                "date": "01.03.2026",
                "time": "08:00",
                "addressdesc": "Строительство а/д Р-404"
              }
            ],
            "distance": 27860,
            "time": 1698457,
            "timeZoneTag": "МСК+2"
          },
          "objectExpend": {
            "code": "A361975",
            "name": "Строительство моста через р. Иртыш. А/д Р-404"
          },
          "kindType": "Самосвал 6х4",
          "notes": "Транспортировка песко-грунта с карьера..."
        }
      ]
    }
  ]
}
```

**Ключевое поле для matching:** `list[].number` = `121613`

---

### 1.4 `getRouteListsByDateOut` — Путевые листы

**Назначение:** Получить путевые листы (ПЛ) по дате выезда. Возвращает все статусы (CLOSED, PRINTING, NOTUSED и др.).

#### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=...&format=json&command=getRouteListsByDateOut&fromDate=08.02.2026&toDate=09.02.2026
```

| Параметр   | Формат       | Пример       | Описание                    |
|------------|--------------|--------------|---------------------------|
| `fromDate` | `DD.MM.YYYY` | `08.02.2026` | Начало периода по dateOut  |
| `toDate`   | `DD.MM.YYYY` | `09.02.2026` | Конец периода по dateOut   |

#### Node.js
```js
const params = new URLSearchParams({
  token: TOKEN,
  format: 'json',
  command: 'getRouteListsByDateOut',
  fromDate: '08.02.2026',
  toDate:   '09.02.2026',
});
const { data } = await axios.post(`${BASE_URL}?${params}`);
// data.list — массив ПЛ
```

#### Python
```python
response = client.get_route_lists_by_date_out('08.02.2026', '09.02.2026')
# response['list'] — массив ПЛ
```

#### Ответ (реальный пример)
```json
{
  "list": [
    {
      "id": 984659,
      "tsNumber": 1259065889,
      "tsType": "CARGOC",
      "dateOut": "08.02.2026",
      "dateOutPlan": "08.02.2026 08:00:00",
      "dateInPlan": "09.02.2026 08:00:00",
      "startOdo": 933357,
      "finishOdo": 0,
      "status": "GIVED_BACK",
      "closeList": null,
      "ts": [
        {
          "idMO": 17,
          "regNumber": "Р028МС72",
          "nameMO": "Самосвал Volvo FM Truck 6х4",
          "category": "N3",
          "garageNumber": "A00001626"
        }
      ],
      "drivers": [
        { "id": 226, "tabelNumber": "D007734" }
      ],
      "fuelRates": [
        {
          "typeFuelTank": "DT",
          "fOut": 261.0,
          "fSpend": 0.0,
          "fIn": 261.0,
          "tankSize": 412.0,
          "fuelRateName": "1",
          "isSensorGlonass": true
        }
      ],
      "calcs": [
        {
          "idOrder": 0,
          "orderDescr": "№121613/1 от 26.01.2026. ДСУ Мостострой-11",
          "objectExpend": "A361975",
          "address": "Качипова, Р-404 Тюмень — Тобольск — Ханты-Мансийск",
          "driverTask": "Перевозка груза\nНаименование: Грунт (песок)\nОбъем: 37 440 м3"
        }
      ]
    }
  ]
}
```

**Ключевые поля для matching:**
- `calcs[].orderDescr` = `"№121613/1 от 26.01.2026..."` → извлекаем `121613`
- `ts[].idMO` = `17` → используем для запроса мониторинга
- `ts[].regNumber` = `"Р028МС72"` → госномер ТС
- `dateOutPlan` / `dateInPlan` → период для мониторинга

**Фильтрация статусов ПЛ:** в пайплайне исключаем `NOTUSED` и `GIVED_BACK` для аналитики.

---

### 1.5 `getRouteLists` (legacy) — ПЛ по дате закрытия

**Назначение:** Устаревший метод. Фильтрует по дате **закрытия** (`closeList`), возвращает только статус `CLOSED`. Содержит дополнительное поле `glonassData`. Используется для бухгалтерских отчётов.

```
POST ...?command=getRouteLists&fromDate=08.02.2026&toDate=09.02.2026
```

```python
# Python (tyagachi)
response = client.get_route_lists_legacy('08.02.2026', '09.02.2026')
```

Когда использовать:
- Нужны только **закрытые** ПЛ (accounting)
- Нужно поле **`glonassData`**
- Не подходит для оперативного анализа (пропускает незакрытые ПЛ)

---

### 1.6 `getMonitoringStats` — Мониторинг ТС

**Назначение:** Получить GPS-трек, пробег, время работы двигателя, топливо, стоянки за период.

> **Формат дат отличается!** Только в этой команде даты передаются с временем: `DD.MM.YYYY HH:MM`.

#### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=...&format=json&command=getMonitoringStats&idMO=17&fromDate=08.02.2026 08:00&toDate=09.02.2026 08:00
```

| Параметр   | Формат              | Пример               | Описание                              |
|------------|---------------------|----------------------|---------------------------------------|
| `idMO`     | int                 | `17`                 | ID объекта мониторинга из `ts[].idMO` |
| `fromDate` | `DD.MM.YYYY HH:MM`  | `08.02.2026 08:00`   | Начало периода (с временем!)          |
| `toDate`   | `DD.MM.YYYY HH:MM`  | `09.02.2026 08:00`   | Конец периода (с временем!)           |

> **curl:** Пробел в дате кодировать как `%20`. В axios/fetch — автоматически через `URLSearchParams`.

```bash
curl -X POST "https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getMonitoringStats&idMO=17&fromDate=08.02.2026%2008:00&toDate=09.02.2026%2008:00"
```

#### Node.js
```js
const params = new URLSearchParams({
  token: TOKEN,
  format: 'json',
  command: 'getMonitoringStats',
  idMO: String(17),
  fromDate: '08.02.2026 08:00',
  toDate:   '09.02.2026 08:00',
});
const { data } = await axios.post(`${BASE_URL}?${params}`);
```

#### Python
```python
data = client.get_monitoring_stats(17, '08.02.2026 08:00', '09.02.2026 08:00')
```

#### Ответ (реальный пример)
```json
{
  "moUid": "С335РН72",
  "orgName": "ТФ \"Мостоотряд-36\" филиал АО \"Мостострой-11\"",
  "nameMO": "С/тягач Volvo FM Truck 6х4 12.8",
  "invNumber": null,
  "distance": 305.69,
  "movingTime": 15982,
  "engineTime": 27239,
  "lastActivityTime": "14.01.2026 23:58",
  "engineIdlingTime": 11257,
  "ignitionWork": true,
  "equipmentTime": null,
  "movingRate": 147.79,
  "track": [
    {
      "lon": 69.516343,
      "lat": 56.157155,
      "direction": 82,
      "time": "14.01.2026 14:00:07",
      "speed": 78
    },
    {
      "lon": 73.155472,
      "lat": 55.14961,
      "direction": 75,
      "time": "14.01.2026 23:59:00",
      "speed": 0
    }
  ],
  "parkings": [
    {
      "lon": 72.216502,
      "lat": 55.884697,
      "begin": "14.01.2026 16:32:01",
      "end": "14.01.2026 16:43:30",
      "address": "2-я Магистральная улица · Тюкалинск, Омская область"
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

#### Единицы измерения

| Поле                  | Единица      | Пояснение                               |
|-----------------------|--------------|-----------------------------------------|
| `distance`            | км           | Пробег за период                        |
| `movingTime`          | **секунды**  | Перевод в часы: `/ 3600`               |
| `engineTime`          | **секунды**  | Время работы двигателя                  |
| `engineIdlingTime`    | **секунды**  | Холостой ход                            |
| `track[].speed`       | км/ч         | Скорость в точке трека                  |
| `track[].time`        | строка       | Поле называется `time` (не `timestamp`) |
| `parkings[].begin`    | строка       | Начало стоянки (`begin`, не `start`)    |
| `parkings[].end`      | строка       | Конец стоянки                           |
| `fuels[].rate`        | литры        | Расход топлива за период                |
| `fuels[].valueBegin`  | литры        | Уровень топлива в начале               |
| `fuels[].valueEnd`    | литры        | Уровень топлива в конце                 |
| `fuels[].charges`     | литры        | Заправки                                |
| `fuels[].discharges`  | литры        | Сливы                                   |

---

### 1.7 Rate Limits и стратегия ретраев

#### Лимит на ТС

**1 запрос `getMonitoringStats` на одно ТС (`idMO`) — не чаще 30 секунд.**

Лимит привязан к `idMO`, а не к токену. Разные `idMO` — запросы независимы.

```
Правильно:  idMO=17 → idMO=3241 → idMO=5650 → ... → idMO=17 (через 30+ сек)
Неправильно: idMO=17 → idMO=17 (подряд — 429!)
```

#### Стратегия с несколькими токенами

Каждый токен — независимый rate limit. С 18 токенами можно держать 18 очередей параллельно.

```js
// Распределяем задачи по токенам (round-robin)
const queues = tokens.map(() => []);
tasks.forEach((task, i) => {
  queues[i % tokens.length].push(task);
});

// Каждая очередь работает независимо
await Promise.all(
  queues.map((queue, i) => processQueue(queue, tokens[i]))
);
```

#### HTTP-ошибки и ретраи

| Код      | Значение              | Что делать                                              |
|----------|-----------------------|---------------------------------------------------------|
| `200`    | OK                    | Парсим JSON                                             |
| `404`    | ТС нет в мониторинге  | Пропускаем, **не** ретраим (NotFoundError в Python)    |
| `429`    | Rate limit            | Линейный backoff: 10s, 20s, 30s, 40s, 50s (до 5 попыток) |
| Timeout  | Сеть                  | Экспоненциальный backoff: 1s, 2s, 4s (до 3 попыток)    |
| `5xx`    | Ошибка сервера        | Экспоненциальный backoff: 1s, 2s, 4s                   |

**TypeScript (реализация из `kip/server/src/services/tisClient.ts`):**
```ts
const MAX_RETRY_429 = 5;
const BACKOFF_429_BASE_MS = 10_000;   // linear: 10s, 20s, 30s, 40s, 50s

const MAX_RETRY_TIMEOUT = 3;
const BACKOFF_TIMEOUT_BASE_MS = 1_000; // exponential: 1s, 2s, 4s

// 404 → return null
if (axiosErr.response?.status === 404) return null;

// 429 → linear backoff
if (axiosErr.response?.status === 429) {
  const waitMs = BACKOFF_429_BASE_MS * (attempt429 + 1);
  await sleep(waitMs);
}

// Timeout → exponential backoff
if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
  const waitMs = BACKOFF_TIMEOUT_BASE_MS * Math.pow(2, attemptTimeout);
  await sleep(waitMs);
}
```

**Python (реализация из `tyagachi/src/api/client.py`):**
```python
# 404 → raise NotFoundError (не ретраим)
if e.response.status_code == 404:
    raise NotFoundError(f"Resource not found: {command}")

# 429 → линейный backoff (не считается как attempt)
if e.response.status_code == 429:
    wait_time = 10 * rate_limit_retries  # 10s, 20s, 30s...
    time.sleep(wait_time)
    continue  # retry без инкремента attempt

# Timeout → экспоненциальный backoff
time.sleep(2 ** (attempt - 1))  # 1s, 2s, 4s
```

---

### 1.8 Matching chain: Заявка → ТС → Мониторинг

```
Заявка #121613 (getRequests)
  │  number: 121613
  │  orders[0].nameCargo: "Грунт (песок)"
  │  orders[0].route.points[0].address: "Карьер Качиповский"
  │
  │  MATCH: request.number == extractNumber(pl.calcs[].orderDescr)
  │          121613         ==  "№121613/1 от 26.01.2026..." → 121613
  ▼
Путевой лист (getRouteListsByDateOut)
  │  tsNumber: 1259065889
  │  dateOutPlan: "08.02.2026 08:00:00"
  │  dateInPlan:  "09.02.2026 08:00:00"
  │  calcs[0].orderDescr: "№121613/1 от 26.01.2026. ДСУ Мостострой-11"
  │
  │  ТС — из ts[] того же объекта ПЛ
  ▼
ТС: ts[0]
  │  idMO: 17
  │  regNumber: "Р028МС72"
  │  nameMO: "Самосвал Volvo FM Truck 6х4"
  │
  │  Мониторинг запрашиваем по idMO + dateOutPlan / dateInPlan
  ▼
Мониторинг (getMonitoringStats)
  idMO: 17
  fromDate: "08.02.2026 08:00"
  toDate:   "09.02.2026 08:00"
  → distance, engineTime, fuels, parkings, track
```

#### Функция извлечения номера заявки из `orderDescr`

**JavaScript:**
```js
function extractRequestNumber(orderDescr) {
  if (!orderDescr) return null;
  const cleaned = orderDescr.replace(/^№\s*/, '');
  const match = cleaned.match(/^(\d+)/);
  return match ? parseInt(match[1]) : null;
}
// "№121613/1 от 26.01.2026. ДСУ Мостострой-11" → 121613
```

**Python (tyagachi/src/parsers/):**
Используется регулярное выражение: извлечь цифры с начала строки до `/` или пробела.

---

### 1.9 Разбивка по сменам

Период ПЛ (`dateOutPlan` → `dateInPlan`) разбивается на смены для детализации. Для каждой смены делается **отдельный** `getMonitoringStats` запрос.

| Смена   | Начало | Конец             |
|---------|--------|-------------------|
| Утро    | 07:30  | 19:30             |
| Вечер   | 19:30  | 07:30 следующего дня |

> **Правило полуночи:** Период 00:00–07:30 относится к **вечерней смене предыдущего дня**.

```js
// Пример: ПЛ с 08.02.2026 08:00 по 09.02.2026 08:00
const shifts = [
  { key: '08.02.2026_morning', from: '08.02.2026 08:00', to: '08.02.2026 19:30' },
  { key: '08.02.2026_evening', from: '08.02.2026 19:30', to: '09.02.2026 07:30' },
  { key: '09.02.2026_morning', from: '09.02.2026 07:30', to: '09.02.2026 08:00' },
];

for (const shift of shifts) {
  const data = await getMonitoringStats(idMO, shift.from, shift.to);
}
```

---

## 2. KIP Server API (:3001)

**Файл:** `kip/server/src/index.ts`
**Описание:** Express сервер, отдаёт API + React build (`client/dist`) на одном порту.

### Эндпоинты

| Метод  | Путь                          | Описание                                      |
|--------|-------------------------------|-----------------------------------------------|
| GET    | `/api/health`                 | Health check                                  |
| GET    | `/api/vehicles`               | Устаревший: записи за одну дату              |
| GET    | `/api/vehicles/weekly`        | Агрегированные средние для карты (основной)   |
| GET    | `/api/vehicles/:id/details`   | Детали по ТС: по дням и сменам               |
| GET    | `/api/vehicles/:id/requests`  | Заявки, привязанные к ТС                     |
| GET    | `/api/filters`                | Каскадные опции фильтров                      |
| GET    | `/api/geozones`               | GeoJSON слой геозон                           |
| POST   | `/api/admin/fetch`            | Ручной запуск пайплайна (async)              |

### Параметры эндпоинтов

**`GET /api/vehicles/weekly`** — основной для карты:
```
?from=YYYY-MM-DD&to=YYYY-MM-DD&shift=morning|evening|all&branch[]=...&type[]=...&department[]=...&kpiRange[]=...
```

**`GET /api/vehicles/:id/details`:**
```
?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**`GET /api/vehicles/:id/requests`:**
```
?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**`GET /api/filters`:**
```
?from=YYYY-MM-DD&to=YYYY-MM-DD&branch[]=...&type[]=...
```

**`POST /api/admin/fetch`:**
```
?date=YYYY-MM-DD
```

### База данных

PostgreSQL 16, БД `kip_vehicles`, порт `5432`.
Таблицы: `vehicle_records`, `route_lists`, `pl_calcs`, `vehicles`, `requests`.

> **Gotcha:** PostgreSQL NUMERIC возвращает строки в JS — всегда оборачивать `Number()` перед арифметикой.

```bash
# Подключение
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles
```

### KPI цвета
- **RED** < 50%
- **BLUE** 50–75%
- **GREEN** >= 75%

---

## 3. Dump-trucks Server API (:3002)

**Файл:** `dump-trucks/server/src/index.ts`
**Описание:** Express сервер для аналитики самосвалов.

### Эндпоинты

| Метод  | Путь                              | Описание                             |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/dt/health`                  | Health check                         |
| GET    | `/api/dt/shift-records`           | Записи смен (основной)               |
| GET    | `/api/dt/objects`                 | Объекты с зонами типа `dt_*`         |
| POST   | `/api/dt/admin/fetch`             | Ручной запуск пайплайна              |
| GET    | `/api/dt/trips`                   | Поездки за смену                     |
| GET    | `/api/dt/zone-events`             | События входа/выхода в зону          |
| GET    | `/api/dt/export/summary.csv`      | CSV: сводка                          |
| GET    | `/api/dt/export/trips.csv`        | CSV: поездки                         |
| GET    | `/api/dt/export/zone-events.csv`  | CSV: события зон                     |
| GET    | `/api/dt/admin/config`            | Конфиг для отладки                   |

### Параметры эндпоинтов

**`GET /api/dt/shift-records`** — основной:
```
?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&objectUid=...&shiftType=shift1|shift2
```

**`POST /api/dt/admin/fetch`:**
```
?date=YYYY-MM-DD&shift=shift1|shift2
```

**`GET /api/dt/trips`:**
```
?shiftRecordId=...
```

**`GET /api/dt/zone-events`:**
```
?vehicleId=...&date=YYYY-MM-DD&shiftType=shift1|shift2
```

### База данных

PostgreSQL 17 (порт `5433`), БД `mstroy`, схема `dump_trucks`.
Таблицы: `shift_records`, `trips`, `zone_events`, `requests`, `_migrations`.

```bash
# Подключение
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy
```

**Тест-режим:** `DT_TEST_ID_MOS` в `.env` — ограничивает обработку тестовыми ТС (idMO: `{781, 15, 1581}`).

**Объекты с dt_* зонами:**
- «Тобольск основа»
- «Екатеринбург»
- «г. Тюмень, станция Новотуринская Бетонный завод»

> **Gotcha:** В таблице `geo.objects` поле называется `smu` (не `smu_name`!).

---

## 4. Geo-admin Server API (:3003)

**Файл:** `geo-admin/server/src/index.ts`
**Описание:** Express сервер для управления геозонами и объектами.

### Эндпоинты

| Метод   | Путь                                  | Описание                        |
|---------|---------------------------------------|---------------------------------|
| GET     | `/api/geo/health`                     | Health check                    |
| GET     | `/api/geo/objects`                    | Все объекты                     |
| GET     | `/api/geo/objects/:uid`               | Объект по uid                   |
| POST    | `/api/geo/objects`                    | Создать объект                  |
| PUT     | `/api/geo/objects/:uid`               | Обновить объект                 |
| DELETE  | `/api/geo/objects/:uid`               | Удалить объект                  |
| GET     | `/api/geo/zones/by-object/:objectUid` | Зоны объекта (опц. фильтр тегов)|
| GET     | `/api/geo/zones/by-tag/:tag`          | Зоны по тегу                    |
| POST    | `/api/geo/zones`                      | Создать зону                    |
| PUT     | `/api/geo/zones/:uid`                 | Обновить зону                   |
| DELETE  | `/api/geo/zones/:uid`                 | Удалить зону                    |
| POST    | `/api/geo/admin/migrate-from-files`   | Импорт геозон из файлов         |
| GET     | `/admin/*`                            | Admin UI (SPA)                  |

### Форматы тел запросов

**`POST /api/geo/objects`:**
```json
{ "name": "Тобольск основа", "smu": "ДСУ-4", "region": "Тюменская область" }
```

**`POST /api/geo/zones`:**
```json
{
  "objectUid": "...",
  "name": "Карьер Качиповский",
  "tags": ["dt_loading"],
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lon, lat], ...]]
  }
}
```

**`GET /api/geo/zones/by-object/:objectUid`:**
```
?tags=dt_loading,dt_unloading   (опционально, comma-separated)
```

### База данных

PostgreSQL 17 (порт `5433`), БД `mstroy`, схема `geo`. PostGIS 3.6.
Таблицы: `objects`, `zones`, `zone_tags`, `_migrations`.

Импортировано: 291 зона, 282 объекта.

```bash
# Подключение
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy
```

> **Gotcha (пути к .env в geo-admin/server):**
> - из `src/` → `'../.env'`
> - из `src/config/` → `'../../.env'`
> - из `src/services/` → `'../../.env'`

---

## 5. Tyagachi FastAPI (:8000)

**Файл:** `tyagachi/src/web/server.py`
**Описание:** FastAPI + Uvicorn. Аналитика тягачей: отчёты, синхронизация, дашборд.

### Эндпоинты

| Метод   | Путь                                    | Описание                                  |
|---------|-----------------------------------------|-------------------------------------------|
| GET     | `/`                                     | Главный HTML-интерфейс                    |
| GET     | `/report`                               | Текущий report.html                       |
| **Fetch** |                                       |                                           |
| POST    | `/api/fetch`                            | Запуск пайплайна fetch                    |
| GET     | `/api/status`                           | Статус fetch                              |
| **Reports** |                                     |                                           |
| GET     | `/api/reports`                          | Список отчётов                            |
| POST    | `/api/reports`                          | Создать отчёт                             |
| GET     | `/api/reports/{report_id}`              | HTML отчёта                               |
| GET     | `/api/reports/{report_id}/v2`           | HTML V2 (3 колонки)                       |
| GET     | `/api/reports/{report_id}/info`         | Метаданные отчёта                         |
| POST    | `/api/reports/{report_id}/save`         | Сохранить состояние отчёта                |
| POST    | `/api/reports/{report_id}/shifts`       | Загрузить данные смены                    |
| DELETE  | `/api/reports/{report_id}`              | Удалить отчёт                             |
| **Archive** |                                     |                                           |
| GET     | `/api/archive`                          | Архивированные заявки                     |
| POST    | `/api/archive`                          | Архивировать заявку                       |
| DELETE  | `/api/archive`                          | Разархивировать заявку                    |
| GET     | `/api/archived-numbers`                 | Набор архивированных номеров              |
| **Sync** |                                        |                                           |
| POST    | `/api/sync`                             | Запуск синхронизации                      |
| GET     | `/api/sync/status`                      | Статус синхронизации                      |
| **Vehicles** |                                    |                                           |
| GET     | `/api/vehicles`                         | ТС со статистикой                         |
| GET     | `/api/vehicles/{vehicle_id}/requests`   | Заявки ТС                                 |
| GET     | `/api/vehicles/{vehicle_id}/timeline`   | Timeline ТС                               |
| GET     | `/api/timeline`                         | Timeline всех ТС                          |
| **Dashboard** |                                   |                                           |
| GET     | `/api/dashboard/summary`                | Сводка дашборда                           |
| GET     | `/api/request/{request_number}/report`  | HTML отчёта по заявке                     |

### Форматы тел запросов

**`POST /api/fetch`:**
```json
{
  "from_requests": "01.02.2026",
  "to_requests": "09.02.2026",
  "from_pl": "01.02.2026",
  "to_pl": "09.02.2026",
  "use_legacy_pl_method": false
}
```

**`POST /api/sync`:**
```json
{ "period_days": 7 }
// period_days: 1 | 3 | 7 | 14
```

**`POST /api/archive`:**
```json
{
  "request_number": "121613",
  "notes": "Завершено",
  "route_start_address": "Карьер",
  "route_end_address": "Объект",
  "route_start_date": "08.02.2026",
  "pl_count": 3
}
```

**`POST /api/reports/{report_id}/shifts`:**
```json
{
  "pl_id": 984659,
  "ts_id_mo": 17,
  "from_date": "08.02.2026 08:00",
  "to_date": "09.02.2026 08:00"
}
```

### База данных

SQLite (SQLAlchemy ORM).
Модели: `Vehicle`, `TrackedRequest`, `PLRecord`, `Report`, `SyncLog`, `ArchiveEntry`.

**Стабильность заявок:**
- `SUCCESSFULLY_COMPLETED` → stable (не обновляется при sync)
- Остальные → in_progress (обновляются при каждом sync)

---

## 6. Конфигурация и переменные окружения

### KIP (`kip/.env`)

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=kip_vehicles
DB_USER=postgres
DB_PASSWORD=

TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=token1,token2,...   # 18 токенов через запятую

RATE_LIMIT_PER_VEHICLE_MS=30000    # 30 сек между запросами на одно ТС

SERVER_PORT=3001
NODE_ENV=development
```

### Dump-trucks (`dump-trucks/server/.env`)

```env
DB_HOST=localhost
DB_PORT=5433          # PostgreSQL 17 (не 16!)
DB_NAME=mstroy
DB_USER=postgres
DB_PASSWORD=

TIS_API_URL=https://tt.tis-online.com/tt/api/v3
TIS_API_TOKENS=token1,token2,...

DT_TEST_ID_MOS=781,15,1581   # тест-режим: только эти ТС

SERVER_PORT=3002
```

### Geo-admin (`geo-admin/server/.env`)

```env
DB_HOST=localhost
DB_PORT=5433          # PostgreSQL 17
DB_NAME=mstroy
DB_USER=postgres
DB_PASSWORD=

GEO_SERVER_PORT=3003
NODE_ENV=development
```

### Tyagachi (`tyagachi/config.yaml`)

```yaml
api:
  base_url: "https://tt.tis-online.com/tt/api/v3"
  token: "PRIMARY_TOKEN"           # один токен (simple mode)
  tokens:                          # пул токенов (если реализован round-robin)
    - "TOKEN_1"
    - "TOKEN_2"
    # ... до 18
  format: "json"
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

parsing:
  fail_on_missing_fields: false
  log_warnings: true

logging:
  level: "INFO"
  console: false
  file: true
  file_format: "pipeline_{date}.log"
```

---

## Сводка портов

| Порт   | Сервис                          |
|--------|---------------------------------|
| `:3001` | KIP Server (Express + React build) |
| `:3002` | Dump-trucks Server (Express)   |
| `:3003` | Geo-admin Server (Express + SPA) |
| `:5173` | Frontend shell (Vite dev)      |
| `:8000` | Tyagachi (FastAPI + Uvicorn)   |
| `5432`  | PostgreSQL 16 (`kip_vehicles`) |
| `5433`  | PostgreSQL 17 (`mstroy`)       |

---

## Команды запуска

```bash
# KIP
cd kip && npm run dev:server     # :3001

# Dump-trucks
cd dump-trucks/server && npm run dev  # :3002

# Geo-admin
cd geo-admin/server && npm run dev    # :3003

# Tyagachi
cd tyagachi && python main.py --web --port 8000

# Frontend shell
cd frontend && npm run dev            # :5173
```
