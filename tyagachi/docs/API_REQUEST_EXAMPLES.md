# Инструкция по API TIS Online — примеры запросов и matching

## Общая схема запроса

Все команды API — это **POST** запрос с **пустым телом**. Параметры передаются **только через URL query string**.

```
POST {base_url}?token={token}&format=json&command={command}&{params}
```

Обязательные query-параметры для КАЖДОГО запроса:

| Параметр | Значение | Описание |
|---|---|---|
| `token` | `6C72DAA5076B` | Токен авторизации (12 hex символов) |
| `format` | `json` | Формат ответа |
| `command` | строка | Имя команды API |

> **Важно:** `Content-Type` заголовок не нужен — тело пустое. Никаких заголовков авторизации — всё в URL.

---

## Команда 1: `getRequests` — Получить заявки

### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getRequests&fromDate=26.01.2026&toDate=26.01.2026
```

Параметры:

| Параметр | Формат | Пример | Описание |
|---|---|---|---|
| `fromDate` | `DD.MM.YYYY` | `26.01.2026` | Начало периода |
| `toDate` | `DD.MM.YYYY` | `26.01.2026` | Конец периода |

### curl

```bash
curl -X POST "https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getRequests&fromDate=26.01.2026&toDate=26.01.2026"
```

### Node.js (axios)

```js
const axios = require('axios');

const BASE_URL = 'https://tt.tis-online.com/tt/api/v3';
const TOKEN = '6C72DAA5076B';

async function getRequests(fromDate, toDate) {
  const params = new URLSearchParams({
    token: TOKEN,
    format: 'json',
    command: 'getRequests',
    fromDate,  // "26.01.2026"
    toDate,    // "26.01.2026"
  });

  const { data } = await axios.post(`${BASE_URL}?${params}`);
  return data; // { list: [...] }
}
```

### Ответ (реальный пример, сокращён)

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

## Команда 2: `getRouteListsByDateOut` — Путевые листы

### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getRouteListsByDateOut&fromDate=08.02.2026&toDate=09.02.2026
```

Параметры:

| Параметр | Формат | Пример | Описание |
|---|---|---|---|
| `fromDate` | `DD.MM.YYYY` | `08.02.2026` | Начало по дате выезда |
| `toDate` | `DD.MM.YYYY` | `09.02.2026` | Конец по дате выезда |

### curl

```bash
curl -X POST "https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getRouteListsByDateOut&fromDate=08.02.2026&toDate=09.02.2026"
```

### Node.js (axios)

```js
async function getRouteListsByDateOut(fromDate, toDate) {
  const params = new URLSearchParams({
    token: TOKEN,
    format: 'json',
    command: 'getRouteListsByDateOut',
    fromDate,  // "08.02.2026"
    toDate,    // "09.02.2026"
  });

  const { data } = await axios.post(`${BASE_URL}?${params}`);
  return data; // { list: [...] }
}
```

### Ответ (реальный пример)

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
- `calcs[].orderDescr` = `"№121613/1 от 26.01.2026..."` -> извлекаем `121613`
- `ts[].idMO` = `17` -> используем для запроса мониторинга
- `ts[].regNumber` = `"Р028МС72"` -> госномер ТС
- `dateOutPlan` / `dateInPlan` -> период для мониторинга

### Legacy-команда: `getRouteLists`

Те же параметры, но фильтрует по дате **закрытия** (`closeList`) и возвращает только статус `CLOSED`.
Содержит дополнительное поле `glonassData`. Используется для бухгалтерских отчётов.

```
POST ...?command=getRouteLists&fromDate=08.02.2026&toDate=09.02.2026
```

---

## Команда 3: `getMonitoringStats` — Мониторинг ТС

### Запрос

```
POST https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getMonitoringStats&idMO=17&fromDate=08.02.2026 08:00&toDate=09.02.2026 08:00
```

Параметры:

| Параметр | Формат | Пример | Описание |
|---|---|---|---|
| `idMO` | int | `17` | ID объекта мониторинга из `ts[].idMO` |
| `fromDate` | `DD.MM.YYYY HH:MM` | `08.02.2026 08:00` | Начало периода |
| `toDate` | `DD.MM.YYYY HH:MM` | `09.02.2026 08:00` | Конец периода |

> **Формат дат отличается!** В `getRequests` и `getRouteListsByDateOut` — `DD.MM.YYYY`. В `getMonitoringStats` — `DD.MM.YYYY HH:MM` (с часами и минутами).

### curl

```bash
curl -X POST "https://tt.tis-online.com/tt/api/v3?token=6C72DAA5076B&format=json&command=getMonitoringStats&idMO=17&fromDate=08.02.2026%2008:00&toDate=09.02.2026%2008:00"
```

> **Важно:** пробел в дате нужно кодировать как `%20` в curl (или использовать `--data-urlencode`). В axios/fetch это делается автоматически через `URLSearchParams`.

### Node.js (axios)

```js
async function getMonitoringStats(idMO, fromDate, toDate) {
  const params = new URLSearchParams({
    token: TOKEN,
    format: 'json',
    command: 'getMonitoringStats',
    idMO: String(idMO),    // "17"
    fromDate,               // "08.02.2026 08:00"
    toDate,                 // "09.02.2026 08:00"
  });

  const { data } = await axios.post(`${BASE_URL}?${params}`);
  return data;
}
```

### Ответ (реальный пример)

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
    },
    {
      "lon": 73.15547,
      "lat": 55.14961,
      "begin": "14.01.2026 18:38:39",
      "end": "14.01.2026 23:59:00",
      "address": "960м на СЗ от Омск · Омский район"
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

### Единицы измерения

| Поле | Единица | Пояснение |
|---|---|---|
| `distance` | км | Пробег за период |
| `movingTime` | **секунды** | Перевод: `/ 3600` = часы |
| `engineTime` | **секунды** | Время работы двигателя |
| `engineIdlingTime` | **секунды** | Холостой ход |
| `speed` (в track) | км/ч | Скорость в точке |
| `fuels[].rate` | литры | Расход топлива за период |
| `fuels[].valueBegin/End` | литры | Уровень топлива в баке |
| `fuels[].charges` | литры | Заправки |
| `fuels[].discharges` | литры | Сливы |

---

## Полная цепочка Matching: Заявка -> ТС

### Шаг 1: Получить заявки

```js
const requests = await getRequests('26.01.2026', '26.01.2026');
// Находим заявку с number = 121613
```

### Шаг 2: Получить путевые листы

```js
const routeLists = await getRouteListsByDateOut('08.02.2026', '09.02.2026');
```

### Шаг 3: Связать заявку с ПЛ через номер в orderDescr

```js
function extractRequestNumber(orderDescr) {
  if (!orderDescr) return null;
  // Убираем "№" и пробелы, берём цифры до "/" или пробела
  const cleaned = orderDescr.replace(/^№\s*/, '');
  const match = cleaned.match(/^(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// Для каждого ПЛ ищем номер заявки в calcs
for (const pl of routeLists.list) {
  for (const calc of pl.calcs) {
    const reqNum = extractRequestNumber(calc.orderDescr);
    // reqNum = 121613 <- совпадает с request.number!

    if (reqNum === 121613) {
      // Нашли ПЛ, привязанный к заявке 121613
      // ТС находятся в pl.ts[]
      for (const vehicle of pl.ts) {
        console.log(vehicle.regNumber); // "Р028МС72"
        console.log(vehicle.idMO);      // 17
        console.log(vehicle.nameMO);    // "Самосвал Volvo FM Truck 6х4"
      }
    }
  }
}
```

### Шаг 4: Получить мониторинг для ТС

```js
// Используем idMO из ts[] и даты из ПЛ
const monitoring = await getMonitoringStats(
  17,                        // pl.ts[0].idMO
  '08.02.2026 08:00',       // pl.dateOutPlan
  '09.02.2026 08:00'        // pl.dateInPlan
);

console.log(monitoring.distance);      // 305.69 км
console.log(monitoring.engineTime);    // 27239 сек = 7.57 часов
console.log(monitoring.fuels[0].rate); // 164.1 литров
```

### Итоговая связка (визуально)

```
Заявка #121613 (getRequests)
  │  number: 121613
  │  orders[0].nameCargo: "Грунт (песок)"
  │  orders[0].route.points[0].address: "Карьер Качиповский"
  │
  │  MATCH по: request.number == extractNumber(pl.calcs[].orderDescr)
  │            121613       ==  "№121613/1 от 26.01.2026..." -> 121613
  ▼
Путевой лист (getRouteListsByDateOut)
  │  tsNumber: 1259065889
  │  dateOutPlan: "08.02.2026 08:00:00"
  │  dateInPlan:  "09.02.2026 08:00:00"
  │  calcs[0].orderDescr: "№121613/1 от 26.01.2026. ДСУ Мостострой-11"
  │
  │  ТС берём из ts[] того же объекта ПЛ
  ▼
ТС: ts[0]
  │  idMO: 17
  │  regNumber: "Р028МС72"
  │  nameMO: "Самосвал Volvo FM Truck 6х4"
  │
  │  Мониторинг запрашиваем по idMO + dateOutPlan/dateInPlan
  ▼
Мониторинг (getMonitoringStats)
    idMO: 17
    fromDate: "08.02.2026 08:00"
    toDate:   "09.02.2026 08:00"
    → distance, engineTime, fuels, parkings, track
```

---

## Разбивка по сменам

Период ПЛ (`dateOutPlan` -> `dateInPlan`) можно разбить на смены для детализации:

| Смена | Время |
|---|---|
| Утро (morning) | 07:30 -> 19:30 |
| Вечер (evening) | 19:30 -> 07:30 следующего дня |

Для каждой смены делается **отдельный** `getMonitoringStats` запрос.

```js
// Пример: ПЛ с 08.02.2026 08:00 по 09.02.2026 08:00
// Разбивается на:

const shifts = [
  { key: '08.02.2026_morning', from: '08.02.2026 08:00', to: '08.02.2026 19:30' },
  { key: '08.02.2026_evening', from: '08.02.2026 19:30', to: '09.02.2026 07:30' },
  { key: '09.02.2026_morning', from: '09.02.2026 07:30', to: '09.02.2026 08:00' },
];

// Для каждой смены — отдельный запрос мониторинга
for (const shift of shifts) {
  const data = await getMonitoringStats(17, shift.from, shift.to);
  // data.distance, data.engineTime и т.д. — за эту смену
}
```

> **Правило полуночи:** Период 00:00-07:30 относится к вечерней смене **предыдущего** дня.

---

## Rate Limits и ограничения

### Лимит на ТС

**1 запрос `getMonitoringStats` на одно ТС (`idMO`) — не чаще 30 секунд.**

Если вы запрашиваете мониторинг для `idMO=17`, следующий запрос для `idMO=17` можно делать только через 30 сек. Для `idMO=3241` — сразу, это другое ТС.

### Стратегия: round-robin по ТС

Если 10 ТС и 3 смены = 30 запросов, чередуем ТС:

```
idMO=17   смена1 → idMO=3241 смена1 → idMO=5650 смена1 → ... → idMO=17 смена2
```

Это минимизирует простои (пока ждём 30 сек для одного ТС, опрашиваем другие).

### Параллельность через несколько токенов

Каждый токен — независимый rate limit. С 18 токенами можно делать 18 параллельных запросов (по одному на токен), распределяя задачи round-robin.

```js
const tokens = ['6C72DAA5076B', '8FE4AB7FA54C', ...];

// Распределяем задачи по токенам
const queues = tokens.map(() => []);
tasks.forEach((task, i) => {
  queues[i % tokens.length].push(task);
});

// Каждый токен обрабатывает свою очередь параллельно
await Promise.all(
  queues.map((queue, i) => processQueue(queue, tokens[i]))
);
```

### HTTP-ошибки

| Код | Значение | Что делать |
|---|---|---|
| `200` | OK | Парсим JSON |
| `404` | ТС не найдено в мониторинге | Пропускаем, не ретраим |
| `429` | Rate limit | Ждём 10s, 20s, 30s... (до 5 попыток) |
| `5xx` | Ошибка сервера | Retry с exponential backoff: 1s, 2s, 4s |

---

## Node.js: полный пример клиента

```js
const axios = require('axios');

class TISClient {
  constructor(token, baseUrl = 'https://tt.tis-online.com/tt/api/v3') {
    this.token = token;
    this.baseUrl = baseUrl;
    this.timeout = 10000; // 10 сек
    this.maxRetries = 3;
  }

  async _request(command, params = {}) {
    const urlParams = new URLSearchParams({
      token: this.token,
      format: 'json',
      command,
      ...params,
    });

    const url = `${this.baseUrl}?${urlParams}`;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const { data } = await axios.post(url, null, {
          timeout: this.timeout,
        });
        return data;
      } catch (err) {
        if (err.response?.status === 404) {
          return null; // ТС нет в мониторинге
        }
        if (err.response?.status === 429) {
          const wait = 10000 * (attempt + 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
          continue;
        }
        throw err;
      }
    }
  }

  async getRequests(fromDate, toDate) {
    return this._request('getRequests', { fromDate, toDate });
  }

  async getRouteListsByDateOut(fromDate, toDate) {
    return this._request('getRouteListsByDateOut', { fromDate, toDate });
  }

  async getMonitoringStats(idMO, fromDate, toDate) {
    return this._request('getMonitoringStats', {
      idMO: String(idMO),
      fromDate,
      toDate,
    });
  }
}

module.exports = { TISClient };
```

### Использование

```js
const client = new TISClient('6C72DAA5076B');

// 1. Заявки
const requests = await client.getRequests('01.02.2026', '09.02.2026');

// 2. Путевые листы
const routeLists = await client.getRouteListsByDateOut('08.02.2026', '09.02.2026');

// 3. Мониторинг конкретного ТС
const monitoring = await client.getMonitoringStats(17, '08.02.2026 08:00', '09.02.2026 08:00');
```

---

## SQL-схема для matching в PostgreSQL

```sql
-- Заявки
CREATE TABLE requests (
  id INTEGER PRIMARY KEY,        -- API id
  number INTEGER UNIQUE NOT NULL, -- номер заявки (ключ matching)
  status VARCHAR(50),
  date_create TIMESTAMP,
  date_processed TIMESTAMP,
  cargo_name TEXT,
  cargo_weight NUMERIC,
  cargo_volume NUMERIC,
  count_ts INTEGER,
  cnt_trip INTEGER,
  route_start_address TEXT,
  route_end_address TEXT,
  route_distance NUMERIC,
  object_expend_code VARCHAR(20),
  object_expend_name TEXT,
  route_polyline TEXT
);

-- Путевые листы
CREATE TABLE route_lists (
  id INTEGER PRIMARY KEY,       -- API id
  ts_number BIGINT,             -- номер ПЛ
  date_out DATE,
  date_out_plan TIMESTAMP,
  date_in_plan TIMESTAMP,
  status VARCHAR(30)
);

-- Связь ПЛ -> Заявка (через calcs)
CREATE TABLE pl_calcs (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER REFERENCES route_lists(id),
  order_descr TEXT,
  extracted_request_number INTEGER, -- ← regex из orderDescr
  object_expend VARCHAR(20),
  driver_task TEXT
);

-- ТС в путевом листе
CREATE TABLE pl_vehicles (
  id SERIAL PRIMARY KEY,
  route_list_id INTEGER REFERENCES route_lists(id),
  id_mo INTEGER NOT NULL,       -- ID мониторинга
  reg_number VARCHAR(20),       -- госномер
  name_mo TEXT,                 -- "Самосвал Volvo FM Truck 6х4"
  category VARCHAR(10),
  garage_number VARCHAR(20)
);

-- Мониторинг (по сменам или за период ПЛ)
CREATE TABLE monitoring (
  id SERIAL PRIMARY KEY,
  pl_vehicle_id INTEGER REFERENCES pl_vehicles(id),
  shift_key VARCHAR(30),        -- "08.02.2026_morning" или NULL
  from_date TIMESTAMP,
  to_date TIMESTAMP,
  distance NUMERIC,             -- км
  moving_time INTEGER,          -- секунды
  engine_time INTEGER,
  engine_idling_time INTEGER,
  fuel_rate NUMERIC,            -- литры
  fuel_begin NUMERIC,
  fuel_end NUMERIC,
  parkings_count INTEGER,
  parkings_total_minutes NUMERIC
);

-- Matching: JOIN
SELECT
  r.number AS request_number,
  r.cargo_name,
  r.route_start_address,
  rl.ts_number AS pl_number,
  rl.date_out,
  v.reg_number,
  v.name_mo,
  m.distance,
  m.engine_time / 3600.0 AS engine_hours,
  m.fuel_rate
FROM requests r
JOIN pl_calcs pc ON pc.extracted_request_number = r.number
JOIN route_lists rl ON rl.id = pc.route_list_id
JOIN pl_vehicles v ON v.route_list_id = rl.id
LEFT JOIN monitoring m ON m.pl_vehicle_id = v.id;
```
