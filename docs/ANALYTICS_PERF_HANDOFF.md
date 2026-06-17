# Handoff — оптимизация производительности вкладки «Аналитика» (карточки)

> Документ для продолжения работы свежей сессией. Написан под холодный старт: ничего не предполагает из предыдущего диалога. Дата: 2026-06-08. Ветка: `main`. Изменения **в рабочем дереве, не закоммичены**.

---

## 0. Протокол кодовой базы (обязательно прочитать первым)

Из `CLAUDE.md` монорепо: **прежде чем читать исходники — проверь документацию**. Порядок:
```
Obsidian vault → NAVIGATION.md → <сервис>/docs/*.md → исходный код
```
- Vault: `C:/Users/user_ogtr1/Documents/пмворкк/obsidian-vault/02-Projects/ЛК Мстрой/`
- **Наши наработки по аналитике** (это переоткрытый при анализе материал — опираться на него):
  - `Brainstorm/samosvaly-ideas-40.md` — 40 оформленных идей. Релевантны: **#1** (TanStack Query), **#2** (TanStack Virtual), **#32** (batch endpoint для onsite-сегментов — тот самый N+1), **#22** (discriminated union для `UnifiedRecord`), **#40** (расщепление god-component `AnalyticsPage`, ~1400 строк).
  - `Brainstorm/BRAINSTORM_INDEX.md` — карта компонент→идеи + таблица статусов (обновлять при реализации).
  - `Architecture/Services/Frontend.md` — раздел «Страница Аналитики».

---

## 1. Контекст и цель

Вкладка `/analytics`, вид **«Карточки»**, тормозит. Задача — баг-фикс + оптимизация без рискованной полной перестройки.

Ключевые файлы фронтенда (`frontend/src/features/analytics/`):
- `AnalyticsPage.tsx` — корневой god-component (~1400 строк): весь state, фильтрация, загрузка, рендер таблицы.
- `AnalyticsCardsView.tsx` — вид карточек (CSS `columns: 2` masonry, без виртуализации).
- `VehicleCard.tsx` — карточка ТС (иконка, чипы смен, микробары onsite).
- `api.ts` — `fetchUnifiedData`, `fetchShiftSegments`, `fetchTrack`, `fetchDstZones` и т.д.
- `types.ts` — `UnifiedVehicleRow`, `UnifiedRecord`, `KipSegment`.

Бэкенд-контекст:
- `analytics-backend/` — Express+TS, порт **:3007**, читает PG `mstroy` (схема `analytics`) + read-only `kip_vehicles`. Vite proxy `/api/analytics` → :3007. Сейчас обслуживает **только треки/группы**, не главный список карточек.
- Главный список карточек собирается **в браузере**: `fetchUnifiedData()` (`api.ts:~258`) параллельно дёргает `/api/dt/shift-records` (dump-trucks :3002) и `/api/kip/vehicles/weekly` (kip :3001), затем фронт сам группирует/склеивает.

---

## 2. Анализ — выводы (проверены по коду)

**Подтверждено чтением исходников:**

1. **ГЛАВНЫЙ БАГ — двойная загрузка onsite-сегментов (N+1 ×2).**
   - `AnalyticsPage.tsx` (~стр. 361): useEffect собирает ВСЕ onsite-записи (`dtRows.flatMap(...).filter(onsite)`) и делает `fetchShiftSegments` на каждую → пишет в state `chipSegments`.
   - `VehicleCard.tsx` (~стр. 53, **до фикса**): каждая карточка ПОВТОРНО грузила те же сегменты своим useEffect.
   - `AnalyticsCardsView` не прокидывал страничный `chipSegments` → карточки грузили сами. Итог: **2N** запросов (при ~80 onsite-сменах ≈160 мелких HTTP).

2. **Нет `React.memo` на `VehicleCard`** — `selectedChip` хранится в `AnalyticsPage` и передаётся во все карточки; клик по одному чипу ререндерил весь список.

3. **Геоматчинг DST в браузере** (`AnalyticsPage.tsx:~452`, `dstGeoMatch` → JS `pointInPolygon`).

4. **Агрегация в браузере** (`fetchUnifiedData` склеивает DT-смены + KIP weekly вручную).

5. **Виртуализации нет** — `columns: 2` CSS masonry рендерит весь DOM сразу.

**Слабее, чем может показаться:**
- StrictMode double-fetch (`main.tsx`) — реально удваивает запросы, но **только в dev**, в проде один. Усиливает локальное «тормозит», но не лечить.
- Полный BFF/CQRS read-model + PostGIS + materialized views — правильный end-state, но **недели работы и риск**. НЕ начинать без замеров.

**Приоритет (риск/выгода):** сначала дешёвое и точное (1→2→3 ниже), **потом измерить**, и только потом BFF/виртуализация.

---

## 3. Что уже сделано (этапы 1–3, в рабочем дереве)

**Этап 1 — дедупликация onsite-сегментов (главный фикс):**
- `VehicleCard.tsx` — удалён собственный `useState(chipSegments)` + useEffect с `fetchShiftSegments` (и неиспользуемый импорт). Карточка принимает `chipSegments?: Map<number, MicroBar[]>` пропом; микробары из `chipSegments?.get(shiftRecordId)`.
- `AnalyticsCardsView.tsx` — добавлен проп `chipSegments`, прокинут в каждый `VehicleCard`.
- `AnalyticsPage.tsx` — страничный `chipSegments` (useEffect ~стр. 361) теперь единственный источник, передаётся в `AnalyticsCardsView`. Табличный вид уже его использовал — не сломан.
- **Эффект:** запросы сегментов **2N → N (−50%)**, детерминированно. Остались только: страничный loader (`AnalyticsPage` ~стр. 372) и НЕ относящийся к багу polling по кнопке «Выгрузить» в `DtOnsiteGanttSection` (~стр. 1396) — корректно оставлены.

**Этап 2 — `React.memo` + стабильные колбэки:**
- `VehicleCard.tsx` — тело переименовано в `VehicleCardInner`, экспорт обёрнут в `React.memo`. `onSelectVehicle` теперь `(regNumber: string) => void` (вызывается с `row.regNumber`) — убрана inline-стрелка в `AnalyticsCardsView`, ломавшая memo.
- `AnalyticsPage.tsx` — `handleChipClick` и `handleSelectVehicleToMap` через `useCallback([])` (функциональный updater в `setSelectedChip`, чтобы не зависеть от `selectedChip`). `renderCardsChipDetail` уже был useCallback.

**Этап 3 — неблокирующий поиск:**
- `AnalyticsPage.tsx` — `useDeferredValue(searchQuery)`; фильтрация в `allRows` useMemo и зависимости переведены на `deferredSearchQuery`. Поле ввода осталось на `searchQuery` (отзывчивый набор).

**Этап 4 — допфикс memo для карточек:**
- `VehicleCard.tsx` — больше не принимает глобальный `selectedChip`; вместо этого принимает `activeChipKey?: string | null` только для своей машины.
- `AnalyticsCardsView.tsx` — вычисляет `activeChipKey` на уровне конкретной карточки: `selectedChip?.startsWith(v.regNumber + '_') ? selectedChip : null`.
- **Эффект:** при клике по чипу пропсы меняются только у старой активной карточки и новой активной карточки. Остальные карточки получают тот же `activeChipKey = null`, поэтому `React.memo` теперь реально может пропускать их рендер.

**Этап 5 — клиентский кэш `shift-segments`:**
- `frontend/src/features/samosvaly/api.ts` — `fetchShiftSegments(shiftRecordId)` теперь дедуплицирует одинаковые запросы через module-level `Map<number, Promise<ShiftSegment[]>>`.
- `ShiftGanttBar.tsx` — при обычном открытии detail использует кэш; при `reloadKey > 0` делает `force`.
- `AnalyticsPage.tsx` — polling после ручной «Выгрузить» вызывает `fetchShiftSegments(..., { force: true })`, чтобы не читать stale cache.
- **Эффект:** даже если несколько компонентов запросят один и тот же `shiftRecordId`, в Network должен быть один HTTP-запрос, а повторные чтения должны возвращаться из promise-кэша.

**Этап 6 — отключён массовый preload onsite micro-bars в Analytics:**
- `AnalyticsPage.tsx` — удалён useEffect, который на каждое обновление `dtRows` собирал все onsite-записи и делал `fetchShiftSegments` по каждой.
- `chipSegments` теперь стабильная пустая `Map`, поэтому `ShiftChip` в Analytics не рендерит `sv-chip-micro` и 24 DOM-бара на каждый onsite-чип.
- Подробный Gantt по выбранному onsite-чипу всё ещё грузится lazy через `ShiftGanttBar`, но это один выбранный shift, а не весь список.
- **Эффект:** в карточках не должно быть массовой пачки `shift-segments` и не должно быть DOM-элементов `span.sv-chip-vis.sv-chip-micro` / множества `i.sv-chip-microbar`.

**Изменённые файлы:** `VehicleCard.tsx`, `AnalyticsCardsView.tsx`, `AnalyticsPage.tsx`, `frontend/src/features/samosvaly/api.ts`, `frontend/src/components/ShiftGanttBar.tsx`.

---

## 4. Статус проверки

- ✅ `cd frontend && npm run lint` (`tsc --noEmit`) — проходит чисто после этапов 1–6.
- ✅ Статическая проверка: в `VehicleCard.tsx` больше нет `fetchShiftSegments` и `selectedChip`.
- ⚠️ **Замеры НЕ сняты.** React Profiler (commit time) и Network waterfall требуют интерактивного браузера — headless-агент их драйвить не мог. Численно подтверждён только детерминированный выигрыш по числу запросов (−50%). **Реальный commit time на большом периоде надо измерить вживую.**

---

## 5. Следующие шаги

1. **Сначала измерить** (в браузере, на большом периоде дат): React Profiler commit time + Network waterfall + при желании Server-Timing. Это решает, нужны ли этапы 5+.
2. Если после этапов 1–3 всё ещё медленно:
   - **Batch endpoint (#32):** `GET /api/dt/shift-segments/batch?ids=...` в `dump-trucks/server`. Теперь, когда источник один, даёт ещё **N → 1**. Средняя сложность, низкий риск — лучший следующий шаг.
   - **Виртуализация карточек (#2):** нетривиально из-за `columns: 2` masonry в `AnalyticsCardsView` — потребует перехода на grid / JS-masonry (`@tanstack/react-virtual` или `react-virtuoso`). Обсуждать отдельно, делать только при подтверждённой необходимости.
3. **Крупный заход (НЕ сейчас, только после замеров):** перенести сборку карточек в `analytics-backend` как BFF/read-model (один endpoint `GET /api/analytics/vehicles?from=&to=&view=cards` с готовыми агрегатами), геоматчинг в PostGIS (`ST_Contains`), при тяжёлых агрегатах — materialized views. Также архитектурные #1 (TanStack Query), #22 (discriminated union), #40 (расщепление AnalyticsPage).

---

## 6. Границы и правила (соблюдать)

- **НЕ** начинать BFF/PostGIS/materialized-views рефактор без замеров — многонедельный риск.
- **НЕ** трогать несвязанные «грязные» файлы в репо (есть незакоммиченные изменения в `ai-reports/`, frontend ai-reports и пр.) — не откатывать, не править.
- `cd frontend && npm run lint` после каждого этапа — должен быть чистым.
- Следовать стилю окружающего кода. `samosvaly.css` — главный CSS аналитики (классы `sv-*`).
- Предпочтение пользователя: управление данными — **только через Admin UI**, не curl/CLI.

---

## 7. Открытые вопросы

- Реальное «бутылочное горлышко» (сеть N+1 vs тяжёлый клиентский рендер vs агрегация) **не подтверждено профилированием** — этап 5+ выбирать по данным замера, не по интуиции.
- При большом парке (200+ ТС, длинный период) объём DT-данных растёт как «машины × смены × дни» — кандидат на серверную агрегацию, но сперва измерить.
## Update 2026-06-08 — стабилизационный этап выполнен

Ветка: `agent/glm/fix-analytics-cards-performance`.

Сделано:
- `dump-trucks/server`: добавлен `GET /api/dt/shift-segments/batch?ids=1,2,3` с валидацией и лимитом 500 id; backend возвращает `{ data: Record<string, ShiftSegment[]>, total }`.
- `frontend/src/features/samosvaly/api.ts`: добавлен `fetchShiftSegmentsBatch(ids, { force? })`; функция использует существующий per-id promise cache, chunk-ит по 500 id и наполняет cache batch-ответами.
- `AnalyticsCardsView`: CSS columns заменены на grid; карточки ограничены видимым срезом; добавлена кнопка `Показать ещё 60`; detail вынесен в нижнюю panel вне карточек; добавлен стабильный `EMPTY_RECORDS` для DST fallback.
- `VehicleCard`: больше не принимает и не рендерит `renderChipDetail`, поэтому выбор chip не меняет высоту карточки.
- `AnalyticsPage`: visible cards limit = 60, сброс при смене периода/смены/фильтров/поиска/focused object; onsite micro-bars грузятся batch-ом только для видимых cards или expanded rows table; после ручной DT `Выгрузить` force-fetch обновляет общий chip micro-bar cache.

Проверить вручную:
- Network по `shift-segments`: initial Cards должен давать batch-запросы, не N одинаковых запросов; chip clicks не должны запускать массовые запросы.
- DOM: до `Показать ещё` ожидается около 60 `.sv-veh-card`; onsite chips должны иметь `.sv-chip-microbar` там, где сегменты уже есть.
- UX: DT delivery открывает нижнюю detail panel с `ShiftSubTable`; DT onsite открывает Gantt; DST открывает KIP Gantt; карта из карточки всё ещё переключает на map.
