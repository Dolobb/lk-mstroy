# KIP-3: Чейнджлог реализации

Ветка: `agent/glm/feat/kip3-gap-fill-zone-time`
Дата: 2026-04-14

---

## Суть изменений

Три логических изменения в KIP-пайплайне:

1. **C — Intra-shift gap fill**: заполнение пропусков трека внутри смены синтетическими точками, если GPS-отклонение < 500м
2. **B — Cap totalStayTime до 12ч**: если машина начала и закончила смену в одной зоне, но время в зоне < 12ч — дополнить до 12ч
3. **A — Inter-day gap fill + fuel levels**: создавать синтетические записи для дней без данных, если машина не уехала с объекта (топливо ±10л + GPS <500м)

---

## Изменённые файлы

### 1. `kip/server/src/services/geozoneAnalyzer.ts`

**Что изменилось:**

- Добавлен импорт `distance` из `@turf/distance` и `dayjs` из `dateFormat`
- Добавлены константы `GPS_GAP_FILL_RADIUS_M = 500` и `SYNTHETIC_POINT_INTERVAL_MS = 20 * 60 * 1000`
- Добавлена функция `haversineMeters(lat1, lon1, lat2, lon2)` — обёртка над `@turf/distance`
- Добавлена функция `fillTrackGaps(track)` — **изменение C**

  **Логика:** перед основным geozone-анализом, для каждого gap между `track[i]` и `track[i+1]`:
  - Если `haversineMeters(track[i], track[i+1]) < 500м` → машина стояла, заполнить gap синтетическими точками с координатами `track[i]`, шаг 20 мин
  - Если ≥ 500м → машина перемещалась, gap не заполняется
  - Нет лимита по времени gap-а — только GPS-проверка
  - Timestamp парсится через `parseDdMmYyyyHhmm`, генерируется через `dayjs().format('DD.MM.YYYY HH:mm:ss')` — формат совместим с последующим анализом

- Функция `analyzeTrackGeozones` обновлена:
  - Вызывает `fillTrackGaps(track)` перед основным циклом
  - Определяет `firstZoneId` и `lastZoneId` (зона первой и последней точки заполненного трека)
  - Возвращает их в `GeozoneResult`

### 2. `kip/server/src/types/domain.ts`

**Что изменилось:**

- `GeozoneResult`: добавлены поля `firstZoneId: string | null` и `lastZoneId: string | null`
- `ParsedMonitoringRecord`: добавлены поля `fuelValueBegin: number` и `fuelValueEnd: number`

### 3. `kip/server/src/jobs/dailyFetchJob.ts`

**Что изменилось:**

- Добавлен импорт `fillGapsForDate` из `./gapFillJob`
- Добавлена локальная константа `MAX_GAP_DAYS = 10`

- **Изменение B** (строка ~125): после `analyzeTrackGeozones`:
  ```ts
  if (geozoneResult.firstZoneId
      && geozoneResult.firstZoneId === geozoneResult.lastZoneId
      && totalStayTime > 0
      && totalStayTime < 12) {
    totalStayTime = 12;
  }
  ```

- **Изменение A1** (строка ~192): в вызов `upsertVehicleRecord` добавлены 3 новых поля:
  - `fuel_value_begin: monitoring.fuelValueBegin`
  - `fuel_value_end: monitoring.fuelValueEnd`
  - `is_gap_filled: false`

- **Изменение A3** (строка ~214): после основного цикла — gap-fill для диапазона `[-10, 0]` дней:
  ```ts
  const pool = getPool();
  for (let d = -MAX_GAP_DAYS; d <= 0; d++) {
    const gapDate = dayjs(targetDate).add(d, 'day').format('YYYY-MM-DD');
    await fillGapsForDate(pool, gapDate);
  }
  ```

### 4. `kip/server/src/jobs/recalculateJob.ts`

**Что изменилось:**

- Добавлен импорт `fillGapsForDate` из `./gapFillJob`

- **Изменение A1**: извлечение `fuelValueBegin`/`fuelValueEnd` из `fuel_json`:
  ```ts
  const fuelValueBegin = fuels.reduce((sum, f) => sum + (f.valueBegin ?? 0), 0);
  const fuelValueEnd = fuels.reduce((sum, f) => sum + (f.valueEnd ?? 0), 0);
  ```

- **Изменение B**: тот же cap до 12ч при `firstZone === lastZone`

- В вызов `upsertVehicleRecord` добавлены: `fuel_value_begin`, `fuel_value_end`, `is_gap_filled: false`

- **Условие 3** (синтетические записи для отсутствующих смен): добавлены `fuel_value_begin: null`, `fuel_value_end: null`, `is_gap_filled: false`

- **Изменение A3**: после цикла — `await fillGapsForDate(pool, date)`

### 5. `kip/server/src/services/monitoringParser.ts`

**Что изменилось:**

- Добавлен импорт `logger`
- В `parseMonitoringStats`:
  - Вычисление `fuelValueBegin` = `sum(fuels[].valueBegin)`, `fuelValueEnd` = `sum(fuels[].valueEnd)`
  - Warning-лог если `fuel.unit` не равно `'LITRE'`
  - Возвращаемый объект включает `fuelValueBegin` и `fuelValueEnd`

### 6. `kip/server/src/repositories/vehicleRecordRepo.ts`

**Что изменилось:**

- `VehicleRecordRow`: добавлены `fuel_value_begin: number | null`, `fuel_value_end: number | null`, `is_gap_filled: boolean`
- `NUMERIC_FIELDS`: добавлены `'fuel_value_begin'`, `'fuel_value_end'`
- `coerceNumericFields`: обработка `is_gap_filled` → `Boolean()`
- `WeeklyAggRow`: добавлено `gap_filled_count: number`
- `WEEKLY_NUMERIC_FIELDS`: добавлен `'gap_filled_count'`
- Weekly-агрегация SQL: добавлено `COUNT(*) FILTER (WHERE is_gap_filled = true)::int AS gap_filled_count`
- `getVehicleRecords` SELECT: добавлены `fuel_value_begin, fuel_value_end, is_gap_filled`
- `getVehicleDetails` SELECT: добавлены `fuel_value_begin, fuel_value_end, is_gap_filled`
- `upsertVehicleRecord`: INSERT/ON CONFLICT DO UPDATE — 23 параметра (было 20), добавлены `fuel_value_begin`, `fuel_value_end`, `is_gap_filled`

### 7. `kip/server/src/index.ts`

**Что изменилось:**

- Добавлен импорт `fillGapsForDate`
- Ghost-порог: `4` → `10` дней (строка 103-107)
- Ghost-объект в `enriched`: добавлено `gap_filled_count: 0`
- Новый endpoint: `POST /api/admin/gap-fill?date=YYYY-MM-DD` — запускает `fillGapsForDate` асинхронно

---

## Новые файлы

### 8. `kip/server/src/jobs/gapFillJob.ts`

**Назначение:** inter-day gap filling — создание синтетических записей для дней без данных.

**Экспортируемые:**
- `fillGapsForDate(pool, date): Promise<GapFillResult>` — основная функция
- `GapFillResult` — тип результата `{ date, filled, skipped, errors }`

**Алгоритм:**

1. Один батч-запрос: `SELECT vehicle_id, array_agg(shift_type) FROM vehicle_records WHERE report_date = $1 GROUP BY vehicle_id` — какие смены уже есть
2. Для каждого ТС из `vehicle-registry`, у которого не хватает смен:
   - Найти `lastRecord` — последняя запись ПЕРЕД date (в пределах 10 дней)
   - Найти `nextRecord` — первая запись ПОСЛЕ date (в пределах 10 дней)
   - Проверить GPS: `haversine(last.lat/lon, next.lat/lon) < 500м`
   - Проверить топливо: `|last.fuel_value_end - next.fuel_value_begin| < 10 литров` (абсолютно, не процент)
   - Решение: если есть fuel data → оба условия должны пройти; если нет fuel data → достаточно GPS
   - Для каждой недостающей смены (`morning` / `evening`): `upsertVehicleRecord` с `is_gap_filled: true`, `КИП=0%`, `нагрузка=0%`, `total_stay_time=12`, `engine_on_time=0`

**Идемпотентность:** повторный вызов безопасен — `ON CONFLICT DO UPDATE` перезапишет идентичную синтетику; реальная запись заменит синтетическую (`is_gap_filled` → `false`).

### 9. `kip/server/migrations/005_add_fuel_levels_and_gap_flag.sql`

```sql
ALTER TABLE vehicle_records
  ADD COLUMN IF NOT EXISTS fuel_value_begin NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fuel_value_end NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_gap_filled BOOLEAN DEFAULT false;
```

---

## Новая зависимость

- `@turf/distance@7.3.4` — установлена в `kip/server/` (уже совместима с `@turf/helpers@7.3.4` и `@turf/boolean-point-in-polygon@7.3.4`)

---

## Проверка

- `tsc --noEmit` (server): **0 ошибок**
- Миграция: не применена (нужно выполнить `npm run migrate --workspace=server` перед запуском)

---

## Что НЕ делалось (out of scope)

- UI-изменения на клиенте (пометка gap-filled строк серым, `is_gap_filled` в типах фронтенда)
- Query-параметр `excludeGapFilled` в `/api/vehicles/weekly` (заложена только `gap_filled_count` в ответе)
- Обновление AI-reports SQL-запросов (они читают `vehicle_records` напрямую — увидят `is_gap_filled`, но типы не обновлены)
- Интеграция с admin-сервером (DB Viewer preset)
