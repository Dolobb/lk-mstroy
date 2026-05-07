# План полного перехода на `getPassports` как первичный энумератор

## Контекст

Текущая архитектура самосвалов использует **ПЛ (`getRouteListsByDateOut`) как единственный источник списка idMO** для вызова `getMonitoringStats`. Если ТС не выписан в ПЛ за окно `[date-7d ... date+1d]`, оно **полностью невидимо** во всех view (заявки / аналитика / ганта).

Команда TIS API **`getPassports`** возвращает весь парк ТС (на момент проверки — 2047 машин, из них ~238 самосвалов по фильтру `modelOrMarkOrModif.includes('самосвал')`, ~113 с `registered=true`). Это даёт независимый от ПЛ источник списка idMO.

## Сравнение охвата (на момент 2026-05)

| Источник                                | Самосвалов |
|-----------------------------------------|------------|
| `getPassports` (всего)                  | 238        |
| `getPassports` `registered=true`        | 113        |
| `dump_trucks.shift_records` (all-time)  | 58         |
| `shift_records` за 30 дней              | 51         |

Слепая зона: **180 самосвалов** в parks никогда не появлялись в `shift_records`, из них **55 `registered=true`**.

## Текущее решение (этап 1, реализован)

`getPassports` подключён как **дополнительный** discovery-проход внутри `runShiftFetch` — НЕ замена основной логики:

1. Основной loop по `vehiclesMap` (из ПЛ) работает как раньше
2. После основного — discovery: для самосвалов из getPassports, не попавших в `vehiclesMap`, выполняется тот же per-vehicle pipeline с `pl_id=null, request_numbers=[]`
3. UI распознаёт «без заявки» по `pl_id IS NULL AND cardinality(request_numbers)=0`

## Целевая архитектура (этап 2, будущее)

`getPassports` становится **единственным** источником списка ТС. ПЛ остаётся только для обогащения метаданных (`pl_id`, `request_numbers`).

### Шаги миграции

1. **Кеширование passports в БД**
   - Таблица `dump_trucks.vehicle_passports` (idMO PK, regNumber, modelOrMarkOrModif, kindType, organization, registered, fetched_at)
   - Cron раз в сутки: `getPassports` → upsert
   - В `runShiftFetch` читаем из БД, а не из TIS (экономит запрос на каждый прогон)

2. **Унификация loop**
   - Удалить разделение «основной loop из ПЛ» + «discovery loop из passports»
   - Один loop: `for idMO of активные_самосвалы_за_сутки` (из vehicle_passports)
   - ПЛ-данные подмешивать через JOIN на `parsedPLs` по idMO для обогащения `pl_id`/`request_numbers`

3. **Фильтр «активные»**
   - Не дёргать мониторинг для всех 238 при каждом прогоне — это ~7 мин и нагрузка на TIS
   - Поддержать `last_seen_in_pl` или `last_engine_activity` колонку
   - Дёргать только тех, кто появлялся в ПЛ или имел engine>0 за последние, скажем, 30 дней
   - Раз в неделю — полный прогон по всем `registered=true` для обновления базы

4. **Удалить `vehicle-organizations.json`**
   - Заменить на JOIN с `vehicle_passports.organization` (id) → справочник организаций
   - Либо денормализованно хранить `org_name` прямо в passports (если TIS вернёт)

5. **plParser упростить**
   - Сейчас `plParser.ts` фильтрует ПЛ по `nameMO.includes('самосвал')` — это double-filter с passports
   - После миграции: ПЛ просто матчатся к idMO, фильтр по типу — на стороне passports
   - `requestNumbers` всё ещё извлекаются из `calcs[].orderDescr`

### Преимущества

- 100% покрытие парка: ездит → видим
- Меньше зависимости от качества заведения ПЛ (часто заводят пост-фактум)
- Чистая модель: один источник истины для «что такое самосвал»

### Риски и нюансы

- **TIS getPassports rate limit:** не выяснено, какой лимит. Нужно проверить, есть ли 429
- **Поле `kindType` в passports часто пустое** (1240 из 2047) — нельзя положиться, нужен fallback на `modelOrMarkOrModif`
- **`registered=false`** — означает «выведен из эксплуатации» или «новый, ещё не зарегистрирован». Для production использовать только `registered=true`
- **Кросс-организационные самосвалы**: top-org `721754553` имеет 21 orphan-самосвал. Нужно понять — это субподряд, или это филиал, чьи ПЛ просто не попадают к нам в TIS-аккаунт. От этого зависит UX «без заявки»

## Ссылки

- Реализация discovery (этап 1): `dump-trucks/server/src/jobs/shiftFetchJob.ts` — секция «Discovery via getPassports»
- TIS-метод: `getPassports` через стандартный POST с пустым телом
- Структура ответа: `{ passports: TisPassport[], organization: number, total: number }`
