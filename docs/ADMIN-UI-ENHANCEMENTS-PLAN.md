# План: Админка «Топливо» — расширение управления

> Источник: vault `02-Projects/Приложение выдачи топлива/Tasks/Admin-UI-Enhancements.md`
> Мотивация: пилот 15.06 — зависшую открытую смену пришлось закрывать SQL-ом, в UI нет управляющих действий.
> Роли: **Claude = оркестратор + исполнитель трудных/ключевых задач**; **Codex (`codex exec gpt-5.5 high`) = лёгкие/средние задачи** под контролем и валидацией Claude.

## Решения продукта (подтверждены пользователем 15.06)
1. **Edit событий** — литры + мягкое удаление (`is_deleted=true`). Без правки времени/ТС/фото.
2. **Закрытие смены** — авто-снимок текущего остатка АТЗ + возможность переопределить вручную.
3. **Управление АТЗ** — создание **и** редактирование (калибровка `remaining_liters`, `title`, активация/деактивация).

## Архитектурные инварианты (НЕ нарушать)
- **Остаток АТЗ — инкрементальный tally.** Правки применяют *дельту* к `atz.remaining_liters`, а НЕ пересчитывают с нуля (иначе затрётся ручная psql-калибровка). Знаки: dispense уменьшает остаток, receipt увеличивает — зеркалить `sync.ts`.
- **`atz.updated_at`** бампается при любой мутации остатка/справочника — основа дельты `/bootstrap?since=`.
- **`event_edits`** — журнал before/after на каждую правку (`event_type` ∈ `shift|dispense|receipt`).
- **`edited_at=now()`** на правленых событиях — LWW, чтобы ретрай планшета не перетёр админскую правку.
- **Soft-delete** — `is_deleted=true`, физически не удалять.
- **`uniq_open_shift_per_atz`** — закрытие смены освобождает АТЗ; ошибка 23505 этого constraint → 409 `atz_busy`.
- **Транзакция** — мутация события + дельта остатка + журнал в одной `db.transaction`.
- **Auth** — все эндпоинты под `requireAdmin` (Bearer). Фронт ходит через `/api/fuel` (прокси инжектит токен). Новой авторизации не требуется.
- **Миграции БД не нужны** — все поля уже есть.
- ⚠️ **`src/services/sync.ts` НЕ редактировать** (Claude-only, см. AGENTS.md). Общую логику дельты выносим в новый `src/services/adminMutations.ts`.

## Правило делегирования (из памяти)
- Codex запускается из корня монорепо: `codex exec gpt-5.5 high` с подробным промптом.
- **НЕ редактировать файлы вручную, пока фоновый Codex работает** (песочница откатит). Делегируем последовательно: один Codex-таск → валидация → следующий. Свои 🔴-задачи Claude делает, когда Codex не запущен.

---

## Условные обозначения сложности
- 🟢 **Лёгкая** — CRUD/механика → Codex
- 🟡 **Средняя** — UI с состоянием/формами, рефактор → Codex (Claude ревьюит)
- 🔴 **Трудная/ключевая** — корректность остатка, транзакции, constraint → **Claude**

---

# ФАЗА 1 — Бэкенд (fuel-backend)

### B0 🔴 [Claude] Общий хелпер мутаций остатка — `src/services/adminMutations.ts`
**Ядро всех write-операций.** Экспортирует функции, работающие внутри переданного `tx`:
- `applyAtzDelta(tx, atzId, deltaCenti)` — `remaining_liters += delta`, `updated_at=now()`.
- `writeEventEdit(tx, { eventId, eventType, before, after })` — запись в `event_edits`.
- Утилиты `toCenti/numericToCenti/toNumeric` (вынести/переиспользовать из `sync.ts` без правки самого `sync.ts`).
**Валидация:** unit-тест на знак дельты и идемпотентность; ревью на соответствие `sync.ts` (строки 47–57, 136–144).
**Зависимости:** нет. **Делается первым.**

### B1 🟢 [Codex] `GET /admin/vehicles` — список ТС для заправки
Эндпоинт в `admin.ts`: select `vehicles` + join `organizations`; поля `id, gosNumber, mark, vehicleType, organizationName, source, isActive`. Параметр `?active=true|all` (default только активные). Сортировка по `gosNumber`. Zod на query.
**Codex-промпт (суть):** «Добавь GET-эндпоинт `/admin/vehicles` в `fuel-backend/src/routes/admin.ts` по образцу существующего `GET /admin/atz` (строки 212–277). Верни массив ТС с полями id, gosNumber, mark, vehicleType, organizationName (join organizations.name), source, isActive. Query-параметр active (zod enum true|all, default true). Drizzle, без сырого SQL. Сортировка по gosNumber asc.»
**Валидация Claude:** `curl`/тест возвращает корректный JSON; join не дублирует; типобезопасность Drizzle.
**Зависимости:** нет.

### B2 🟢 [Codex] `POST /admin/atz` + `PATCH /admin/atz/:id` — создание/редактирование АТЗ
- POST: `gosNumber` (req), `title?`, `tisVehicleId?`, `remainingLiters` (default 0 — стартовая калибровка), `isActive` (default true). Установить `updated_at`. Вернуть созданный АТЗ.
- PATCH: частичное обновление `title`, `isActive`, `tisVehicleId`, `remainingLiters` (прямой set — это ручная калибровка, дельта НЕ нужна). Бампнуть `updated_at`. 404 если нет.
**Codex-промпт (суть):** «Добавь POST `/admin/atz` и PATCH `/admin/atz/:id` в `admin.ts`. Zod-схемы рядом с `adminShiftsQuerySchema`. PATCH — все поля optional. `remaining_liters` в PATCH ставится напрямую (калибровка, не дельта). Оба ОБЯЗАНЫ ставить `updated_at=new Date()`. Используй существующий формат ответа АТЗ. Drizzle.»
**Валидация Claude:** `updated_at` бампается (иначе планшеты не увидят); прямой set остатка — осознанно; формат ответа совпадает с `GET /admin/atz`.
**Зависимости:** нет.

### B3 🔴 [Claude] `POST /admin/shifts/:id/close` — ручное закрытие смены
Транзакция:
1. Загрузить смену; если `status='closed'` → 409 `already_closed`.
2. `closingRemainingLiters` = тело запроса (override) **или** текущий `atz.remaining_liters` (авто-снимок).
3. Update: `status='closed'`, `ended_at_server=now()`, `ended_at_client = body.endedAtClient ?? now()`, `closing_remaining_liters`.
4. Если override ≠ текущему остатку → применить дельту через `applyAtzDelta` (калибровка по факту) + бамп `updated_at`.
5. `writeEventEdit(event_type='shift', before/after)`.
6. Вернуть обновлённый `ShiftDetail`.
**Edge cases:** освобождение `uniq_open_shift_per_atz`; смена уже закрыта; смена живёт на активном планшете (документировать риск LWW-конфликта при следующем `shift_close` с планшета — закрытие админом первично, ретрай планшета будет noop по `ended_at`).
**Валидация:** vitest — закрытие открытой смены, повторное закрытие → 409, override двигает остаток корректно, освобождение АТЗ позволяет открыть новую смену.
**Зависимости:** B0.

### B4 🔴 [Claude] `PATCH /admin/events/:type/:id` — правка литров / мягкое удаление
`:type` ∈ `dispense|receipt`. Транзакция:
1. Загрузить событие → его `shift` → `atz_id`.
2. `oldApplied` = `is_deleted ? 0 : liters`. `newApplied` = `delete ? 0 : (body.liters ?? liters)`.
3. `deltaLiters = newApplied − oldApplied`; знак: dispense → `−delta` к остатку, receipt → `+delta`. (Зеркалить `sync.ts`.)
4. `applyAtzDelta(tx, atzId, signedDeltaCenti)` + бамп `updated_at`.
5. Update события: `liters` (если правка), `is_deleted=true` (если удаление), `edited_at=now()`.
6. `writeEventEdit(before/after)`.
7. Вернуть обновлённое событие + новый остаток АТЗ.
**Корректность знаков — самая тонкая часть, поэтому Claude.**
**Валидация:** vitest — правка литров dispense уменьшает/увеличивает остаток на верный знак; правка receipt; soft-delete возвращает остаток; повторная правка по `edited_at`; журнал `event_edits` пишется.
**Зависимости:** B0.

### B5 🟢 [Codex] Тесты эндпоинтов B1, B2
Расширить `admin.test.ts` (vitest+supertest): GET /admin/vehicles (фильтр active), POST/PATCH /admin/atz (включая бамп `updated_at`).
**Codex-промпт (суть):** «Добавь интеграционные тесты в `fuel-backend/src/routes/admin.test.ts` по образцу существующих для новых эндпоинтов GET /admin/vehicles, POST /admin/atz, PATCH /admin/atz/:id. Проверь статус-коды, формат, что PATCH бампает updated_at.»
**Валидация Claude:** тесты реально гоняются на локальной `mstroy_fuel` (PG17 :5433), не моки; покрытие edge-кейсов.
**Зависимости:** B1, B2.

> Тесты для B3/B4 пишет Claude вместе с реализацией (корректность остатка критична).

---

# ФАЗА 2 — Фронтенд (frontend/src/features/fuel)

### F0 🟡 [Codex] Вынести `FilterDropdown` + `uniqueSorted` в общий компонент
Извлечь из `vehicle-status/VehicleStatusPage.tsx` (строки 67–167 и 45–57) в `frontend/src/components/FilterDropdown.tsx` (+ util). Переключить `VehicleStatusPage` на импорт без изменения поведения.
**Codex-промпт (суть):** «Вынеси компонент FilterDropdown (VehicleStatusPage.tsx:67-167) и функцию uniqueSorted (:45-57) в `frontend/src/components/FilterDropdown.tsx` как переиспользуемые (generic по строковым значениям). Обнови VehicleStatusPage на импорт. Поведение vehicle-status НЕ менять — это рефактор без регрессий.»
**Валидация Claude:** vehicle-status работает идентично (фильтры/поиск); компонент действительно generic.
**Зависимости:** нет.

### F1 🟢 [Codex] `types.ts` + `api.ts` — типы и fetch-функции
Добавить: `Vehicle`, `CreateAtzInput`, `UpdateAtzInput`, `EditEventInput`, `CloseShiftInput`. API: `fetchVehicles`, `createAtz` (POST), `updateAtz` (PATCH), `closeShift` (POST), `editEvent`/`deleteEvent` (PATCH). Паттерн как существующий `get<T>` + POST с `Content-Type: application/json`.
**Codex-промпт (суть):** «В `frontend/src/features/fuel/types.ts` и `api.ts` добавь типы и fetch-функции для новых эндпоинтов (vehicles, create/update atz, close shift, edit/delete event). Следуй существующему стилю api.ts (BASE=/api/fuel, хелпер get<T>). Для мутаций — fetch с method POST/PATCH, JSON-тело, бросать Error при !ok.»
**Валидация Claude:** сигнатуры совпадают с бэкендом B1–B4; пути верные.
**Зависимости:** B1–B4 (контракт). Можно стартовать после фиксации сигнатур.

### F2 🟡 [Codex] Вкладка «ТС» + компонент `VehicleCard`
Добавить `'vehicles'` в `TabId`/`TABS`, `renderVehicles()`, `VehicleCard` по подобию `AtzCard` (FuelAdminPage.tsx:173-211): госномер (mono), марка, тип, организация, бейдж активности. Та же сетка `grid ... xl:grid-cols-3 2xl:grid-cols-4`. State + `loadVehicles` (useCallback) + автополлинг как у atz.
**Codex-промпт (суть):** «В `FuelAdminPage.tsx` добавь вкладку ТС: тип TabId += 'vehicles', объект в TABS (иконка Truck), state vehicles/loading/error, loadVehicles через fetchVehicles, renderVehicles() с сеткой карточек. Компонент VehicleCard по образцу AtzCard (:173-211) — те же классы/StatusBadge. Поля: gosNumber, mark, vehicleType, organizationName, isActive.»
**Валидация Claude:** визуальное единство с AtzCard; полл не течёт; пустые состояния.
**Зависимости:** F1.

### F3 🟡 [Codex] Поиск по госномеру + фильтр по марке на вкладках АТЗ и ТС
Использовать общий `FilterDropdown` (F0). Поиск — input + `useMemo`-фильтр (`.toUpperCase().includes`, как vehicle-status:258-261). Фильтр марки — `uniqueSorted(items,'mark')` + `FilterDropdown`. Применить к рендеру обеих вкладок.
**Codex-промпт (суть):** «На вкладках АТЗ и ТС в FuelAdminPage добавь: поиск по госномеру (input + useMemo фильтр по toUpperCase includes) и фильтр по марке через общий FilterDropdown (`@/components/FilterDropdown`) со значениями из uniqueSorted. Паттерн скопируй из vehicle-status (поиск :256-269, фильтр :630-654). У АТЗ марки нет — для АТЗ только поиск по госномеру; у ТС — поиск + фильтр марки.»
**Валидация Claude:** фильтр/поиск работают на обеих вкладках; нет регрессий полла; кейс кириллица/латиница как в исходнике (только toUpperCase).
**Зависимости:** F0, F2.

### F4 🟡 [Codex] Диалог закрытия смены
Кнопка «Закрыть смену» в `ShiftDetailPanel`/строке открытой смены (видна при `status='open'`). shadcn `Dialog` + `Form` (react-hook-form + zod): поле остатка (предзаполнено текущим остатком АТЗ, редактируемо), опц. примечание. Вызов `closeShift`, затем `loadShifts()`/`loadAtz()`. Обработка 409 `already_closed`.
**Codex-промпт (суть):** «Добавь диалог закрытия смены в FuelAdminPage: кнопка у открытых смен, shadcn Dialog+Form (см. components/ui/dialog,form), поле closingRemainingLiters (default = остаток АТЗ), submit → closeShift(id,...) → перезагрузка. Покажи ошибку при !ok (в т.ч. 409). Паттерн модалки — из описания в плане.»
**Валидация Claude:** реальное закрытие зависшей смены освобождает АТЗ; ошибки видны; рефетч происходит.
**Зависимости:** B3, F1.

### F5 🟡 [Codex] Диалог правки/удаления события (литры, soft-delete)
В строках dispense/receipt (`ShiftDetailPanel`) — кнопки «Изменить»/«Удалить». Dialog с полем литров (для правки) и подтверждением удаления. Вызов `editEvent`/`deleteEvent`, рефетч детали смены + atz. Удалённые события отрисовать зачёркнуто (`is_deleted`).
**Codex-промпт (суть):** «Добавь в ShiftDetailPanel правку события: кнопки Изменить (Dialog с полем литров) и Удалить (подтверждение → soft-delete). Вызов editEvent/deleteEvent → рефетч fetchShiftDetail + fetchAtz. is_deleted события показывать зачёркнутыми.»
**Валидация Claude:** правка литров двигает остаток на верный знак (сверить с UI остатка АТЗ); удаление возвращает литры; журнал виден в детали.
**Зависимости:** B4, F1.

### F6 🟡 [Codex] Форма создания/редактирования АТЗ
На вкладке АТЗ: кнопка «+ АТЗ» (Dialog-форма создания) и «Изменить» на `AtzCard` (Dialog-форма редактирования: title, remainingLiters-калибровка, isActive). react-hook-form + zod. Вызов `createAtz`/`updateAtz` → `loadAtz()`.
**Codex-промпт (суть):** «Добавь на вкладке АТЗ кнопку создания нового АТЗ (Dialog+Form: gosNumber, title, remainingLiters, isActive) и на AtzCard кнопку редактирования (title, remainingLiters, isActive). Вызовы createAtz/updateAtz → loadAtz. Валидация zod, ошибки в форме.»
**Валидация Claude:** создание появляется в списке; калибровка остатка применяется; деактивация затемняет карточку.
**Зависимости:** B2, F1.

---

# ФАЗА 3 — Интеграция и приёмка (Claude)
- Сборка фронта (`npm run build` в frontend) — без TS-ошибок.
- Бэкенд-тесты зелёные (`cd fuel-backend && npm test` на локальной `mstroy_fuel`).
- Сквозной smoke: запустить `npm run dev`, на `/fuel` проверить все действия (прокси на боевой VPS — действия пишут в прод-БД! либо временно указать dev-бэкенд).
- ⚠️ Решить: тестировать против боевого `atz.pisarenkovmax.ru` или локального fuel-backend. Рекомендация — локальный fuel-backend + локальная БД, чтобы не трогать прод.
- Финальный self-review диффа (`/code-review`), затем коммиты по фазам.

---

## Граф зависимостей и порядок исполнения
```
B0(🔴Claude) ─┬─> B3(🔴Claude close)        F0(🟡Codex extract) ─> F3(🟡search/filter)
              └─> B4(🔴Claude edit)          F1(🟡types/api) ─┬─> F2(ТС tab) ─> F3
B1(🟢Codex vehicles) ─┐                                        ├─> F4(close dialog)   [needs B3]
B2(🟢Codex atz CRUD) ─┼─> B5(🟢Codex tests)                    ├─> F5(edit dialog)    [needs B4]
                                                               └─> F6(atz form)       [needs B2]
```
**Рекомендуемая последовательность (с учётом «не редактировать при живом Codex»):**
1. Claude: B0 → B3 → B4 (+ их тесты).
2. Codex (по очереди, Claude валидирует каждый): B1 → B2 → B5.
3. Codex (по очереди): F0 → F1 → F2 → F3 → F4 → F5 → F6.
4. Claude: Фаза 3 — интеграция, ревью, коммиты.

## Оценка объёма
| Слой | 🟢 | 🟡 | 🔴 | Исполнитель |
|------|----|----|----|-------------|
| Backend | B1,B2,B5 | — | B0,B3,B4 | Claude(3) + Codex(3) |
| Frontend | F1 | F0,F2,F3,F4,F5,F6 | — | Codex(7), ревью Claude |
