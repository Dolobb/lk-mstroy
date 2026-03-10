# Dump Trucks — Руководство

## Руководство пользователя

### Основные сценарии

**1. Просмотр заявок (вкладка «Заявки»)**

1. Открыть ЛК Мстрой → вкладка «Самосвалы»
2. Навигация по месяцам (← Март 2026 →), по умолчанию — текущий месяц
3. Отображаются все заявки, попадающие хотя бы на 1 день выбранного месяца
4. Заявки сгруппированы по городам, внутри — «Активные» и «Закрытые»
5. Закрытые сортируются по дате окончания (новые сверху); кнопка «По грузу» — группировка по типу груза
6. Каждая карточка показывает: маршрут (→/←), прогресс (факт/план), рейсы, ТС, ПЛ, груз, тоннаж/объём
7. Нажать на карточку → раскроется таблица Ганта (самосвалы × дата × смена, кол-во рейсов)

**2. Аналитика KPI (вкладка «Аналитика»)**

1. Переключиться на вкладку «Аналитика»
2. Доступны дополнительные фильтры: смена (все / 1-я / 2-я), объект
3. Таблица трёхуровневая: ТС → заявка → день
4. Нажать на строку ТС → раскрываются заявки
5. Нажать на строку заявки → раскрываются дни
6. Нажать на день → раскрывается детализация рейсов: таблица с временами въезда/выезда на погрузку и выгрузку
7. Флаг «По месту» — показывает ТС с типом работы `onsite` (работают на объекте без рейсов)

**3. Боковая панель (правая часть на вкладке «Заявки»)**

Показывает еженедельную статистику по объектам:
- Навигация неделями (`‹` / `›`)
- Для каждого объекта: кол-во самосвалов, рейсов, МиниДонат с % движения по сменам, КИП
- При наличии ремонтов — карточки ТС с типом (ремонт/ТО) и датами

**4. Ручной запуск фетча (admin)**

Для загрузки данных за конкретную дату/смену используется API напрямую:

```bash
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=2026-02-24&shift=shift1"
```

Ответ немедленный (`{ status: 'started' }`), pipeline выполняется в фоне. Результат — в логах сервера.

---

### Возможные проблемы

**«Нет данных за выбранный период»**

- Данные за этот период не были загружены из TIS API
- Решение: запустить ручной фетч через `POST /api/dt/admin/fetch`

**Заявки есть, но нет рейсов у самосвала**

- ТС не попало в геозоны достаточное время (< 3 мин в зоне погрузки или выгрузки)
- ТС определено как `onsite` (работало на объекте без рейсов)
- Нет геозон для данного объекта в `geo.zones` с тегами `dt_*`

**КИП = 0 или очень маленький**

- Мониторинг TIS API вернул пустой трек или нулевое время двигателя
- Проверить `raw_monitoring` в БД:
  ```sql
  SELECT reg_number, raw_monitoring FROM dump_trucks.shift_records
  WHERE report_date = '2026-02-24' AND shift_type = 'shift1';
  ```

**ТС определено на неверный объект**

- Срабатывает ограничение ObjectDetector (ТС работало на границе двух объектов)
- Объект определяется по максимальному кол-ву трек-точек в `dt_boundary`

---

## Руководство разработчика

### Запуск

```bash
# Сервер dump-trucks
cd /Users/max/Documents/Mstroy/lk-mstroy/dump-trucks/server
npm run dev        # Express на :3002 (ts-node-dev с перезагрузкой)

# Миграции (уже выполнены, повторно не нужно)
npm run migrate

# Фронтенд (запускается вместе с другими подпроектами)
cd /Users/max/Documents/Mstroy/lk-mstroy/frontend
npm run dev        # Vite на :5173, прокси /api/dt → :3002
```

### Тестовый режим

Добавить в `dump-trucks/server/.env`:

```env
DT_TEST_ID_MOS=781,15,1581
```

Тогда pipeline будет обрабатывать только три тестовых ТС (idMO 781, 15, 1581).
При наличии `DT_TEST_ID_MOS` endpoint `GET /api/dt/admin/config` вернёт `testMode: true`.

### Переменные окружения

Файл: `dump-trucks/server/.env`

| Переменная | Дефолт | Описание |
|-----------|--------|----------|
| `DB_HOST` | `localhost` | Хост PostgreSQL 17 |
| `DB_PORT` | `5433` | Порт PG17 (не 5432!) |
| `DB_NAME` | `mstroy` | База данных |
| `DB_USER` | `postgres` | Пользователь (реально используется `max`) |
| `DB_PASSWORD` | `` | Пароль |
| `DT_SERVER_PORT` | `3002` | Порт сервера |
| `NODE_ENV` | `development` | Окружение |
| `TIS_API_URL` | — | URL TIS Online API (обязательный) |
| `TIS_API_TOKENS` | — | 18 токенов через запятую (обязательный) |
| `DT_TEST_ID_MOS` | не задан | idMO через запятую для тест-режима (необязательный) |

### psql подключение

```bash
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy

-- Просмотр схемы
\dt dump_trucks.*

-- Последние записи
SELECT report_date, shift_type, reg_number, object_name, trips_count, kip_pct
FROM dump_trucks.shift_records
ORDER BY updated_at DESC
LIMIT 20;

-- Рейсы по смене
SELECT * FROM dump_trucks.trips WHERE shift_record_id = 42 ORDER BY trip_number;

-- Объекты с dt_* зонами
SELECT DISTINCT o.uid, o.name, o.smu
FROM geo.objects o
JOIN geo.zones z ON z.object_id = o.id
JOIN geo.zone_tags zt ON zt.zone_id = z.id
WHERE zt.tag LIKE 'dt_%'
ORDER BY o.name;
```

### Файловая структура сервера

```
dump-trucks/server/src/
├── index.ts                # Express-приложение, все endpoints
├── migrate.ts              # Запуск миграций
├── config/
│   ├── env.ts              # getEnvConfig() — загрузка .env
│   └── database.ts         # getPool() / closePool()
├── jobs/
│   ├── shiftFetchJob.ts    # runShiftFetch() — главный pipeline
│   └── scheduler.ts        # node-cron (08:30 / 20:30)
├── services/
│   ├── tisClient.ts        # TIS API клиент (axios + retry)
│   ├── tokenPool.ts        # Round-robin ротация токенов
│   ├── rateLimiter.ts      # Per-vehicle rate limit (30 сек)
│   ├── plParser.ts         # Парсинг путевых листов
│   ├── requestParser.ts    # Парсинг заявок TIS
│   ├── zoneAnalyzer.ts     # analyzeZones() + calcOnsiteSec()
│   ├── vehicleDetector.ts  # detectObject() — ObjectDetector
│   ├── tripBuilder.ts      # buildTrips()
│   ├── workTypeClassifier.ts # classifyWorkType()
│   ├── kpiCalculator.ts    # calculateKpi()
│   └── dumpTruckRegistry.ts # Справочник ТС (не используется в pipeline)
├── repositories/
│   ├── shiftRecordRepo.ts  # upsertShiftRecord() + queryShiftRecords()
│   ├── tripRepo.ts         # replaceTrips()
│   ├── zoneEventRepo.ts    # replaceZoneEvents()
│   ├── requestRepo.ts      # upsertRequests()
│   └── filterRepo.ts       # getDtObjects() + getAllDtZones()
├── types/
│   ├── domain.ts           # ShiftType, WorkType, ZoneTag, GeoZone, Trip, ShiftKpi ...
│   └── tis-api.ts          # TisRouteList, TisRequest, TisMonitoringStats ...
└── utils/
    ├── dateFormat.ts       # parseDdMmYyyyHhmm(), formatDateParam(), dayjs
    ├── logger.ts           # winston или console-based logger
    ├── csv.ts              # stringify() — JSON → CSV строка
    └── env.ts              # (дублирует config/env или утилиты)
```

### Как добавить новый строительный объект

1. В geo-admin создать объект в `geo.objects` с уникальным `uid`, заполнить `smu` и `region`
2. Нарисовать геозоны в geo-admin:
   - Одна зона с тегом `dt_boundary` — граница всего объекта
   - Одна или несколько зон с тегом `dt_loading` — места погрузки
   - Одна или несколько зон с тегом `dt_unloading` — места выгрузки
3. Объект автоматически появится в `GET /api/dt/objects` (при наличии хотя бы одной dt_* зоны)
4. При следующем запуске pipeline ТС, работающие на этом объекте, будут определяться через ObjectDetector

### Как запустить pipeline вручную

```bash
# Через HTTP (асинхронно, ответ мгновенный)
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=2026-02-24&shift=shift1"

# Результат в логах сервера:
# [ShiftFetch] Start: date=2026-02-24 shift=shift1
# [ShiftFetch] Got 42 route lists
# [ShiftFetch] Parsed 8 PLs with target vehicles
# ...
# [ShiftFetch] Done: processed=7 skipped=1 errors=0
```

### Отладка pipeline

**Проверить, какие ТС найдены в ПЛ:**

Логи сервера: `[ShiftFetch] Vehicles to process: N` — кол-во ТС.

**Проверить зоны в БД:**

```bash
curl http://localhost:3002/api/dt/objects
# Должен вернуть список объектов с dt_* зонами
```

**Проверить raw_monitoring после фетча:**

```sql
SELECT reg_number, raw_monitoring, trips_count, kip_pct
FROM dump_trucks.shift_records
WHERE report_date = '2026-02-24' AND shift_type = 'shift1'
ORDER BY reg_number;
```

**Проверить zone_events (что видит ZoneAnalyzer):**

```bash
curl "http://localhost:3002/api/dt/zone-events?vehicleId=781&date=2026-02-24&shiftType=shift1"
```

**Посмотреть конфигурацию сервера:**

```bash
curl http://localhost:3002/api/dt/admin/config
# testMode: true/false — важно для понимания режима работы
# tokensCount: сколько токенов TIS загружено
```

### Добавление ремонта вручную

```sql
INSERT INTO dump_trucks.repairs (reg_number, name_mo, type, reason, date_from, date_to, object_name)
VALUES ('А021АТ172', 'Самосвал SITRAK', 'repair', 'ДТП', '2026-02-20', null, 'Тобольск основа');
```

Типы: `repair` (ремонт) или `maintenance` (ТО). `date_to = null` означает «до сих пор в ремонте».

### Типичные ошибки

**`TIS_API_TOKENS not configured`**

Не задана переменная `TIS_API_TOKENS` в `.env`. Pipeline не запустится.

**`Failed to load geo zones` / `No dt_* zones found`**

Нет подключения к PG17 или в `geo.zone_tags` нет записей с тегами `dt_boundary/dt_loading/dt_unloading`. Pipeline завершится без обработки ТС.

**`No monitoring data for idMO=N`**

TIS API вернул `null` для данного ТС. Причины: ТС не работало, нет GPS-данных, неверный idMO.

**NUMERIC поля как строки в JS**

При работе с `queryShiftRecords` напрямую через `pool.query` (минуя репозиторий): поля `distance_km`, `kip_pct`, `movement_pct`, `fact_volume_m3` приходят как строки из PostgreSQL NUMERIC. Репозиторий `shiftRecordRepo.ts` оборачивает их в `Number()`. На фронте типы уже числовые (`types.ts`).

**Ошибка координат в Turf.js: `lon` и `lat` перепутаны**

GeoJSON использует порядок `[lon, lat]`, TIS API возвращает `{ lat, lon }`. В `zoneAnalyzer.ts:28` и `vehicleDetector.ts:43` порядок правильный: `point([pt.lon, pt.lat])`.
