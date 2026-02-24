# Database Structure — КИП техники

> Последнее обновление: 2026-02-16

## Общая информация

| Параметр | Значение |
|----------|----------|
| СУБД | PostgreSQL 16 |
| Имя БД | `kip_vehicles` |
| Хост | `localhost` (данные хранятся локально на машине, где запущен сервер) |
| Порт | 5432 |
| Пользователь | из `.env` (`DB_USER`) |
| Установка | Homebrew (`postgresql@16`) |

Данные хранятся **физически на локальной машине** в директории PostgreSQL (обычно `/usr/local/var/postgresql@16/`). Это **не облачный сервис** — вся БД и данные находятся на том же компьютере, где запущено приложение.

---

## Подключение к БД

```bash
# Через psql
/usr/local/opt/postgresql@16/bin/psql -d kip_vehicles

# Или если psql в PATH:
psql -d kip_vehicles
```

---

## Схема таблиц (5 таблиц)

### Диаграмма связей

```
requests (заявки)
   ↑ matching через number ↔ pl_calcs.extracted_request_number
   |
route_lists (путевые листы)
   ├── pl_calcs (задания из ПЛ)        FK → route_lists.id
   └── vehicles (ТС из ПЛ)             FK → route_lists.id
                |
                ↓ vehicles.reg_number = vehicle_records.vehicle_id
vehicle_records (итоговые KPI по сменам) — основная таблица для UI
```

---

### 1. `vehicle_records` — итоговые KPI (главная таблица)

Одна запись = один ТС за одну смену за один день. Это **основная таблица для UI** — все данные на карте и в таблицах берутся отсюда.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | Автоинкремент |
| `report_date` | DATE NOT NULL | Дата отчёта |
| `shift_type` | VARCHAR(20) NOT NULL | `'morning'` или `'evening'` |
| `vehicle_id` | VARCHAR(20) NOT NULL | Гос. номер ТС (= `vehicles.reg_number`) |
| `vehicle_model` | VARCHAR(200) NOT NULL | Название модели (из TIS API `nameMO`) |
| `company_name` | VARCHAR(200) NOT NULL | Организация (из ПЛ) |
| `department_unit` | VARCHAR(200) NOT NULL | СМУ / подразделение (из геозон) |
| `total_stay_time` | NUMERIC(8,4) NOT NULL | Время на объектах, часы (из геозон) |
| `engine_on_time` | NUMERIC(8,4) NOT NULL | Время работы двигателя, часы |
| `idle_time` | NUMERIC(8,4) NOT NULL | Время простоя, часы |
| `fuel_consumed_total` | NUMERIC(10,4) NOT NULL | Расход топлива фактический, л |
| `fuel_rate_fact` | NUMERIC(10,4) NOT NULL | Фактический расход, л/ч |
| `max_work_allowed` | NUMERIC(8,4) NOT NULL | Макс. допустимое время работы, ч |
| `fuel_rate_norm` | NUMERIC(10,4) NOT NULL | Норма расхода, л/ч (из vehicle-registry) |
| `fuel_max_calc` | NUMERIC(10,4) NOT NULL | Расход по норме × время, л |
| `fuel_variance` | NUMERIC(10,4) NOT NULL | Отношение факт/норма |
| `load_efficiency_pct` | NUMERIC(6,2) NOT NULL | **КИП нагрузки**, % |
| `utilization_ratio` | NUMERIC(6,2) NOT NULL | **КИП использования**, % |
| `latitude` | NUMERIC(10,7) | Последняя GPS-координата (широта) |
| `longitude` | NUMERIC(10,7) | Последняя GPS-координата (долгота) |
| `track_simplified` | JSONB | Упрощённый трек для отображения на карте |
| `created_at` | TIMESTAMP | Время создания записи |

**Уникальный ключ**: `(report_date, shift_type, vehicle_id)` — одна запись на ТС на смену на дату.

**Индексы**:
- `idx_vehicle_records_date` → `report_date`
- `idx_vehicle_records_vehicle` → `vehicle_id`
- `idx_vehicle_records_company` → `company_name`
- `idx_vehicle_records_department` → `department_unit`

---

### 2. `route_lists` — путевые листы

Один ПЛ из TIS API. Может содержать несколько заданий (pl_calcs) и ТС (vehicles).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | Автоинкремент |
| `pl_id` | BIGINT NOT NULL UNIQUE | ID путевого листа из API |
| `ts_number` | BIGINT | Номер ТС |
| `ts_type` | VARCHAR(30) | Тип ТС |
| `date_out` | DATE | Дата выезда |
| `date_out_plan` | TIMESTAMP | Плановая дата/время выезда |
| `date_in_plan` | TIMESTAMP | Плановая дата/время возврата |
| `status` | VARCHAR(30) | Статус ПЛ |
| `created_at` | TIMESTAMP | Время записи в БД |

**Индекс**: `idx_route_lists_date` → `date_out`

---

### 3. `pl_calcs` — задания из путевого листа

Одно задание из массива `calcs[]` в ПЛ. Содержит описание работы, откуда извлекается номер заявки.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | Автоинкремент |
| `route_list_id` | INTEGER NOT NULL | FK → `route_lists.id` (CASCADE DELETE) |
| `order_descr` | TEXT | Описание задания (текст, откуда берётся номер заявки) |
| `extracted_request_number` | INTEGER | Номер заявки, извлечённый regex из `order_descr` |
| `id_order` | INTEGER | ID заказа из API |
| `object_expend` | VARCHAR(50) | Объект расходования |
| `driver_task` | TEXT | Задание водителю |

**Индексы**:
- `idx_pl_calcs_request` → `extracted_request_number`
- `idx_pl_calcs_id_order` → `id_order`

---

### 4. `vehicles` — ТС из путевого листа

Транспортное средство, прикреплённое к ПЛ. Содержит `id_mo` для запросов мониторинга и `reg_number` для связи с `vehicle_records`.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | Автоинкремент |
| `route_list_id` | INTEGER NOT NULL | FK → `route_lists.id` (CASCADE DELETE) |
| `id_mo` | INTEGER NOT NULL | ID для TIS API `getMonitoringStats` |
| `reg_number` | VARCHAR(20) NOT NULL | Гос. номер (= `vehicle_records.vehicle_id`) |
| `name_mo` | VARCHAR(200) | Название модели из TIS |
| `category` | VARCHAR(10) | Категория ТС |
| `garage_number` | VARCHAR(30) | Гаражный номер |

**Индексы**:
- `idx_vehicles_reg` → `reg_number`
- `idx_vehicles_idmo` → `id_mo`

---

### 5. `requests` — заявки на технику

Заявки из TIS API (`getRequests`). Связываются с ПЛ через `number` ↔ `pl_calcs.extracted_request_number`.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | Автоинкремент |
| `request_id` | INTEGER NOT NULL UNIQUE | ID заявки из API |
| `number` | INTEGER NOT NULL | Номер заявки (для matching с ПЛ) |
| `status` | VARCHAR(30) | Статус заявки |
| `date_create` | TIMESTAMP | Дата создания |
| `date_processed` | TIMESTAMP | Дата обработки |
| `contact_person` | VARCHAR(200) | Контактное лицо |
| `raw_json` | JSONB | Полный ответ API (все поля заявки) |
| `created_at` | TIMESTAMP | Время записи в БД |

**Индекс**: `idx_requests_number` → `number`

**Важно**: `number` НЕ уникален (миграция 003) — одна заявка может быть пересоздана/дублирована в API.

---

## Миграции

Файлы в `server/migrations/`, выполняются через `npm run migrate --workspace=server`:

| Файл | Описание |
|------|----------|
| `001_init.sql` | Создание всех 5 таблиц + индексы |
| `002_add_id_order.sql` | Добавление `id_order` в `pl_calcs` |
| `003_drop_requests_number_unique.sql` | Снятие UNIQUE с `requests.number` |

---

## Upsert-логика

Все записи сохраняются через `INSERT ... ON CONFLICT DO UPDATE` — если запись с таким ключом уже есть, она обновляется. Это позволяет безопасно перезапускать pipeline за одну и ту же дату.

| Таблица | Ключ конфликта |
|---------|---------------|
| `vehicle_records` | `(report_date, shift_type, vehicle_id)` |
| `route_lists` | `pl_id` |
| `requests` | `request_id` |

`pl_calcs` и `vehicles` удаляются каскадно при обновлении `route_lists` и вставляются заново.

---

## Gotcha: NUMERIC → string в Node.js

PostgreSQL NUMERIC-колонки возвращаются как **строки** в JS через `pg`:
```js
row.utilization_ratio  // "85.50" (string!)
```

В `vehicleRecordRepo.ts` есть функция `coerceNumericFields()`, которая конвертирует все числовые поля через `Number()` перед отдачей в API.

---

## Полезные SQL-запросы для администратора

### Сколько записей в БД

```sql
SELECT count(*) FROM vehicle_records;
SELECT min(report_date), max(report_date) FROM vehicle_records;
```

### Записи за конкретную дату

```sql
SELECT vehicle_id, shift_type, vehicle_model,
       round(utilization_ratio, 1) as kip_use,
       round(load_efficiency_pct, 1) as kip_load,
       department_unit
FROM vehicle_records
WHERE report_date = '2026-02-10'
ORDER BY vehicle_id, shift_type;
```

### Средний КИП за период

```sql
SELECT vehicle_id, vehicle_model,
       round(avg(utilization_ratio), 1) as avg_kip_use,
       round(avg(load_efficiency_pct), 1) as avg_kip_load,
       count(*) as records
FROM vehicle_records
WHERE report_date BETWEEN '2026-02-01' AND '2026-02-14'
GROUP BY vehicle_id, vehicle_model
ORDER BY avg_kip_use DESC;
```

### Все ТС за дату с заявками

```sql
SELECT vr.vehicle_id, vr.vehicle_model, vr.shift_type,
       pc.extracted_request_number, pc.order_descr
FROM vehicle_records vr
JOIN vehicles v ON v.reg_number = vr.vehicle_id
JOIN route_lists rl ON rl.id = v.route_list_id
JOIN pl_calcs pc ON pc.route_list_id = rl.id
WHERE vr.report_date = '2026-02-10'
  AND rl.date_out = '2026-02-10';
```

### Заявки с деталями

```sql
SELECT request_id, number, status, date_create, contact_person,
       raw_json->>'objectName' as object_name,
       raw_json->>'typeOfWork' as type_of_work
FROM requests
WHERE number = 12345;
```

### Проверить путевые листы за дату

```sql
SELECT rl.pl_id, rl.date_out, rl.status,
       v.reg_number, v.name_mo, v.id_mo,
       pc.order_descr, pc.extracted_request_number
FROM route_lists rl
JOIN vehicles v ON v.route_list_id = rl.id
LEFT JOIN pl_calcs pc ON pc.route_list_id = rl.id
WHERE rl.date_out = '2026-02-10'
ORDER BY v.reg_number;
```

### Экспорт «сухих данных» в CSV

```sql
\COPY (
  SELECT report_date, shift_type, vehicle_id, vehicle_model,
         company_name, department_unit,
         total_stay_time, engine_on_time, idle_time,
         fuel_consumed_total, fuel_rate_fact, fuel_rate_norm,
         load_efficiency_pct, utilization_ratio
  FROM vehicle_records
  WHERE report_date BETWEEN '2026-02-01' AND '2026-02-14'
  ORDER BY report_date, shift_type, vehicle_id
) TO '/tmp/kip_export.csv' WITH CSV HEADER;
```

---

## Где хранятся данные физически

- **PostgreSQL data directory**: `/usr/local/var/postgresql@16/` (macOS Homebrew)
- **Конфиг БД**: задаётся через `.env` в корне проекта (НЕ в git)
- **Бэкап**: стандартный `pg_dump -d kip_vehicles > backup.sql`
- **Восстановление**: `psql -d kip_vehicles < backup.sql`
- При необходимости БД можно перенести на отдельный сервер — достаточно изменить `DB_HOST`/`DB_PORT` в `.env`

---

## Потоки данных

### Запись (pipeline → БД)

```
TIS API → dailyFetchJob.ts → repositories/*Repo.ts → PostgreSQL
                                                        ↓
                                                  5 таблиц (upsert)
```

### Чтение (UI → БД)

```
React (client) → Axios → Express API → vehicleRecordRepo.ts → PostgreSQL
                                         ↓
                          SQL-запросы с агрегацией (AVG, GROUP BY)
                          + обогащение из vehicle-registry.json (type, branch)
                          + coerceNumericFields (string → number)
```

### Обогащение данных

Данные из `vehicle_records` обогащаются на лету при чтении:
- `vehicle_type` и `branch` — из `config/vehicle-registry.json` по `vehicle_id` (гос. номер)
- `request_numbers` — JOIN через `vehicles` → `route_lists` → `pl_calcs` по `extracted_request_number`
