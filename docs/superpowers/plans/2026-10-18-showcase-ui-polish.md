# Шоукейс-полировка UI ЛК Мстрой — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Claude) / раздел «Регламент Codex» (Codex). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** убрать все дефекты из UI-аудита (P0–P2 обязательно, P3 — по остатку времени), чтобы ЛК можно было записывать на видео и скриншоты для фриланс-портфолио; плюс три подготовительных пункта (цифры, маскировка госномеров, проверка КИП-отчёта).

**Architecture:** только фронтенд (frontend/src, kip/client/src, geo-admin/client/src, frontend/public/vydacha-topliva). Бэкенды и данные не меняем (исключение — нет). Корневые причины чиним в общем месте (токены `index.css`, общие компоненты), а не в каждом вызове. Каждая задача заканчивается автоматической проверкой (playwright-скрипт с PASS/FAIL) + скриншотом «после», который исполнитель смотрит глазами.

**Tech Stack:** React 18 + Vite + Tailwind v4 + shadcn/ui; playwright-core 1.56.1 + системный Chrome (`.ui-audit/tools/lib.mjs`); Codex CLI 0.163.0 `gpt-6.1-sol`, reasoning medium.

**Spec:** `docs/superpowers/specs/2026-10-18-showcase-ui-audit/*.md` (находки с ID C*/X*/D0, у каждой — где, скрин, источник file:line, фикс). Скриншоты «до»: `.ui-audit/shots/**` (не в git).

## Global Constraints

- Основной вьюпорт **1470×830** (MacBook, запись видео); обязательные проверки также **1280×800** и **1920×1080**. Обе темы; основная для записи — **светлая**.
- Ноль элементов за правым краем вьюпорта и ноль непреднамеренного горизонтального скролла на 1280/1470/1920 на всех основных экранах.
- Минимальный кегль интерфейса **10px** (кроме подписей тайлов карты).
- Один шрифтовой стек на весь фронт: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif` (как у body в `frontend/src/index.css:146`). DM Sans убрать (нет кириллицы).
- Поповеры, выпадающие меню, модалки, sticky-шапки — **непрозрачные** (alpha 1). Стеклянные полупрозрачные карточки (`--card`) остаются как есть.
- Копирайт интерфейса — по-русски; сырые статусы (`open`, `IN_WORK`, `closed`) и отладочные строки в UI запрещены.
- Не менять: бэкенды, БД, `.env`, API-контракты, бизнес-логику расчётов. Не нажимать удаление/рестарт/перевыгрузку/сабмит меняющих форм.
- Git: ветка `polish/showcase-ui`, атомарные коммиты по задаче, без push. Коммиты делает только Claude (после ревью diff Codex).
- `.ui-audit/` в `.git/info/exclude` — не коммитится.
- Прод :80 (Caddy, `frontend/dist`) пересобирается один раз в конце (Task 20) после зелёных `tsc` + `build`.

## Review Focus

1. **Тёмная тема после правок токенов** — непрозрачный `--popover` и новые поверхности должны иметь тёмные значения; ожидание: ни одного белого поповера/инпута в dark. Тест: `checks-claude.mjs#popover-opaque` гоняется в обеих темах (Task 3).
2. **1280×800** — пользователь пишет на 1470, но клиенты откроют на ноутбуке 1280; ожидание: меню, сайдбар аналитики, шапка самосвалов без переполнения. Тест: все `*-offscreen` проверки параметризованы тремя ширинами (Task 1).
3. **Длинные названия объектов** («СМУ Ремонт а/д Куртамыш – Прорывное в Куртамышском муниципальном округе Курганской области») — ожидание: 2 строки + многоточие + title везде, где показывается объект. Тест: `long-object-name` в Task 7 и Task 11.
4. **Пустые и ошибочные состояния после фильтров** — ожидание: понятный текст + действие сброса, без пустых таблиц. Тест: `analytics-empty-focus`, `analytics-search-empty` (Task 6), `tyagachi-404` (Codex T-X4).
5. **Маскировка госномеров не ломает поиск и ввод** — маска только в отображении текста, поле поиска принимает реальные номера; ожидание: поиск по реальному номеру находит ТС, на экране — маска. Тест: `demo-mask-search` (Task 17).

---

## Регламент Codex (сценарий использования)

- Бинарник: `C:\Users\monit\.codex\packages\standalone\releases\0.163.0-x86_64-pc-windows-msvc\bin\codex.exe`.
- Запуск (из Bash Claude, в фоне, stdin — файл промпта, без `< /dev/null`-ловушки):
  `codex exec -C /c/lk-mstroy -s danger-full-access -m gpt-6.1-sol -c model_reasoning_effort=medium - < .ui-audit/prompts/fix-<id>.txt > .ui-audit/logs/fix-<id>.log 2>&1`
  `danger-full-access` обязателен: в `workspace-write` sandbox Windows запрещает CreateProcess (node/скриншоты не работают). Разрешено пользователем 2026-10-18.
- Промпт самодостаточный: цель, ID находок со ссылкой на spec-файл, список **владеемых файлов** (править только их), запреты (git, бэкенды, данные), критерии приёмки = команда проверки + ожидаемый вывод + обязательные скрины «после» (Codex смотрит их своим просмотрщиком), формат отчёта в `.ui-audit/findings/fix-<id>-report.md`.
- Параллельность: Codex и Claude **никогда не правят один файл одновременно** — владение файлами зафиксировано в каждой задаче. Codex запускается не более чем в 2 параллельных процесса на непересекающихся задачах.
- Приёмка: Claude читает diff (`git diff -- <owned files>`), запускает проверку сам, смотрит 1–2 скрина «после», правит мелочи и коммитит. Отказ → промпт-доработка в тот же лог.
- Лимит: Codex упирается в usage limit (2026-10-18 сброс в **09:18** по локальному времени). Если процесс вернул `You've hit your usage limit` — Claude забирает оставшиеся задачи Codex себе, ничего не ждёт.

## Распределение (≈50/50 по объёму находок)

| Исполнитель | Задачи | Находки |
|---|---|---|
| Claude | 1–9, 16–20 | C1-*, C2-*, C3-*, D0-*, C5-10/11, токены, 3 доп. пункта, финал |
| Codex | X1–X5 (Tasks 10–14) | X1-*, C5-01..09/12, X2-*, X4-*, C4-* |

---

### Task 1: Харнес проверок

**Files:**
- Create: `.ui-audit/tools/checks-claude.mjs`, `.ui-audit/tools/checks-codex.mjs` (Codex наполняет свой)
- Modify: `.ui-audit/tools/lib.mjs` (уже есть `open/snap/overflowReport/offscreenReport`)

**Interfaces:**
- Produces: `node .ui-audit/tools/checks-claude.mjs [checkId...]` → строки `PASS <id> <w>x<h> <theme>` / `FAIL <id> … <деталь>`; exit 1 при любом FAIL. Реестр: `const CHECKS = { id: async ({page,w,h,theme}) => null | 'описание провала' }` + `PAGES` (путь для каждой проверки) + матрица ширин `[1280,1470,1920]` × тем `['light','dark']` (по умолчанию light 1470; флаг `--all`).

- [ ] **Step 1:** Реализовать раннер (одна сессия браузера на путь, контексты на ширину/тему).
- [ ] **Step 2:** Добавить проверки-«до» для известных P0/P1: `nav-offscreen` (/, ни один `nav *` с `right > vw`), `nav-single-line` (все `nav a,nav button` одной высоты ±1px), `analytics-tier-tabs-in-aside` (кнопки вкладок внутри `aside` по bbox), `analytics-table-no-hscroll` (`.sv-an-table-wrap` scrollWidth ≤ clientWidth), `samosvaly-gantt-cells-fit` (у каждой `.sv-gc` с текстом scrollWidth ≤ clientWidth и боковой зазор текста ≥ 1px), `samosvaly-donut-centered` (центр bbox группы «число+подпись» в MiniDonut совпадает с центром кольца ±1px), `min-font-10` (нет видимого текстового элемента с computed font-size < 10px вне `.leaflet-*`), `popover-opaque` (открыть FilterDropdown на /fuel → computed background alpha = 1).
- [ ] **Step 3:** Прогнать `node .ui-audit/tools/checks-claude.mjs --all` → ожидаемо FAIL по всем перечисленным (фиксирует «до»). Сохранить вывод в `.ui-audit/logs/checks-before.txt`.

### Task 2: Шрифт и минимальный кегль (D0-01, D0-02, C2-09, часть C2-02)

**Files:** Modify: `frontend/src/features/samosvaly/samosvaly.css:4,62` (+ все 6–9px в нём), `frontend/src/features/samosvaly/DumpTrucksPage.tsx` (инлайн fontSize 6–9, MiniDonut fontFamily), `frontend/src/features/analytics/**/*.tsx` (инлайн 6–9px), `frontend/src/components/DateRangePicker/DateRangePicker.css`, `frontend/src/components/DateTimeRangePicker/*`.

- [ ] **Step 1:** Удалить `@import` DM Sans; `.sv-root { font-family: inherit }`; MiniDonut `fontFamily="inherit"`.
- [ ] **Step 2:** Все font-size 6/7/8/9px → 10px (список мест — `_detector.json`, antipattern `design-system-font-size`, ignoreValue 6px–9px). Где элемент — Гант-ячейка/чип/подпись таймлайна, после замены сверить переполнение (это закрывает Task 7).
- [ ] **Step 3:** `node .ui-audit/tools/checks-claude.mjs min-font-10 --all` → PASS на /samosvaly и /analytics (все три вкладки и режима).
- [ ] **Step 4:** Скрины /samosvaly «Заявки» и /analytics «Таблица» — посмотреть: нет наездов текста. `cd frontend && npx tsc --noEmit` → 0 ошибок.
- [ ] **Step 5:** Commit `style(ui): единый системный шрифт и минимальный кегль 10px`.

### Task 3: Непрозрачные поверхности (корень X1-02, X1-04, X4-01; Review Focus 1)

**Files:** Modify: `frontend/src/index.css:15,58` (`--popover`), добавить `--surface-solid` (light `#ffffff`, dark `#0f172a`).

**Interfaces:** Produces: `--popover` непрозрачный в обеих темах; утилита `bg-popover` = безопасный фон для любого всплывающего слоя и sticky-шапки. Codex-задачи X1/X3 используют `bg-popover` вместо `bg-card` в поповерах/sticky.

- [ ] **Step 1:** `--popover: #ffffff` (light), `#0f172a` (dark).
- [ ] **Step 2:** `checks-claude.mjs popover-opaque --all` → PASS обе темы. Скрин /fuel «Марка» открыт — глазами: сквозь список ничего не читается.
- [ ] **Step 3:** Commit `fix(ui): непрозрачные поповеры в обеих темах`.

### Task 4: Верхнее меню (C1-01…C1-09)

**Files:** Modify: `frontend/src/components/TopNavBar.tsx` (единственный файл). Использовать существующий `frontend/src/components/ui/dropdown-menu.tsx` (shadcn).

**Interfaces:** Produces: структура `[Бренд] [6 основных разделов] … [Сервисы ▾] [тема-иконка]`; пункты «Сервисы»: Отчёты `/reports` (FileSpreadsheet), AI-отчёты `/ai-demo` (Sparkles), Состояние ТС `/vehicle-status` (Wrench), Гео `/geo-admin` (Map), Серверы `/admin` (Terminal), Выдача топлива `/vydacha-topliva/index.html` (Tablet + ExternalLink, target _blank).

- [ ] **Step 1:** Бренд слева: «ЛК Мониторинг» (решение по умолчанию = `<title>`; пометить в отчёте как вопрос пользователю). КИП — иконка `Gauge`.
- [ ] **Step 2:** Один компонент пункта (`whitespace-nowrap`, одна высота, иконка 16px); вспомогательные — в DropdownMenu; кнопка «Сервисы» подсвечена и показывает имя раздела, если pathname — один из вспомогательных (C1-09).
- [ ] **Step 3:** Тема — icon-button с `aria-label`/`title` «Тёмная тема»/«Светлая тема».
- [ ] **Step 4:** `checks-claude.mjs nav-offscreen nav-single-line --all` → PASS на 1280/1470/1920. Скрины трёх ширин + открытое меню «Сервисы» в обеих темах — посмотреть.
- [ ] **Step 5:** Commit `feat(nav): разгрузка верхнего меню — основные разделы + меню «Сервисы»`.

### Task 5: Сайдбар аналитики (C3-01, C3-13)

**Files:** Modify: `frontend/src/features/analytics/AnalyticsSidebar.tsx:256-310,387-440` (TierTab, aside, ObjectCard группы).

- [ ] **Step 1:** TierTab `minWidth:0`, обычный регистр 12px/700, ellipsis; подписи «Ключевые», «Прочие», «Без объекта»; aside `overflowX:'clip'`.
- [ ] **Step 2:** В ObjectCard скрыть группы с 0 ТС.
- [ ] **Step 3:** `checks-claude.mjs analytics-tier-tabs-in-aside --all` → PASS; плюс сценарий «клик Без объекта» — после клика левый край контента aside ≥ aside.left (добавить в ту же проверку). Скрины 1280/1470 — посмотреть.
- [ ] **Step 4:** Commit `fix(analytics): вкладки сайдбара не вылезают за край`.

### Task 6: Таблица и состояния аналитики (C3-02, C3-03, C3-07, C3-08, C3-09, C3-10, C3-14, C3-15)

**Files:** Modify: `frontend/src/features/analytics/AnalyticsPage.tsx:1292-1460,1571-1576` + стили `.sv-at`, `.sv-filter-*` в `samosvaly.css:447-470`; `frontend/src/components/DataFreshnessBadge*`.

- [ ] **Step 1:** Ширина: убрать колонку «Тип» (дублирует подгруппу), `№ заявки` max 110px + ellipsis + title, паддинги ячеек 6px, сайдбар `clamp(340px, 26vw, 400px)`.
- [ ] **Step 2:** Пустые состояния: «видимых строк 0» после всех фильтров → контекстный текст + кнопка («Снять фокус» / «Сбросить поиск»), иконка lucide вместо 📭.
- [ ] **Step 3:** Сдвиг периода ‹ › ровно на длительность (без −60 000 мс).
- [ ] **Step 4:** Бейдж свежести `tabular-nums` + фикс. ширина + title «Данные обновлены N назад».
- [ ] **Step 5:** Фильтры типов: подписи 11px полными словами; title у иконок-индикаторов (C3-15); чип смены — либо отклик, либо без cursor:pointer (C3-14).
- [ ] **Step 6:** `checks-claude.mjs analytics-table-no-hscroll analytics-empty-focus analytics-search-empty analytics-period-shift --all` → PASS (`analytics-period-shift`: после «‹» диапазон = 16.10 19:30 — 17.10 07:30). Скрины — посмотреть.
- [ ] **Step 7:** Commit `fix(analytics): таблица без горизонтального скролла, пустые состояния, сдвиг периода`.

### Task 7: Гант и донаты самосвалов (C2-01, C2-02, C2-03, C2-05, C2-14)

**Files:** Modify: `frontend/src/features/samosvaly/DumpTrucksPage.tsx:547-569` (MiniDonut), `638-820` (UnlinkedGantt), `890-1380` (GanttTable), `2727-3316` (GlobalGanttTab, `3111-3115` заголовок группы); `samosvaly.css:307-330,862,967-968`.

- [ ] **Step 1:** Ячейки: проценты без «%» внутри ячейки (заголовок колонки/легенда указывает единицу), `tabular-nums`, паддинг 0 1px; если всё равно не влезает при min-ширине — `font-size` ячейки 10px (не ниже).
- [ ] **Step 2:** MiniDonut: число `y = cy − size·0.06`, подпись `y = cy + size·0.14`, обе `dominantBaseline="central"`, шрифт наследуется.
- [ ] **Step 3:** Заголовок группы объекта — `position: sticky; left: 0` внутри td с фоном.
- [ ] **Step 4:** UnlinkedGantt: колонка имени `max-width:180px` + ellipsis + title.
- [ ] **Step 5:** GlobalGanttTab: ширина колонки дня = `(ширина контейнера − 180) / (дни × 2)`, не фиксированная.
- [ ] **Step 6:** `checks-claude.mjs samosvaly-gantt-cells-fit samosvaly-donut-centered samosvaly-gg-no-hscroll long-object-name --all` → PASS. Зум-кропы dpr 2 Ганта в заявке, «Без заявки», вкладки «Ганта» и донатов — посмотреть.
- [ ] **Step 7:** Commit `fix(samosvaly): числа в Ганте помещаются, донаты по центру, липкие заголовки объектов`.

### Task 8: Шапка, карточки, сайдбар самосвалов (C2-04 UI, C2-06, C2-07, C2-08, C2-10, C2-12, C2-13, C2-15…C2-21)

**Files:** Modify: `DumpTrucksPage.tsx:1380-1462` (OrderCardView), `1469-1712` (WeeklySidebar), `2259-2726` (AnalyticsTab), `3590-3720` (шапка, загрузка), `samosvaly.css` (`.sv-view-tab`, `.sv-sub-header`, `.sv-smu-*`, `.sv-obj-name`, `.sv-week-nav`); `frontend/src/components/DateRangePicker/*` (C2-15).

- [ ] **Step 1:** Шапка: вкладки строкой с lucide-иконками (`ClipboardList`, `CalendarRange`, `BarChart3`), фикс. высота шапки, `nowrap` на кнопках, select ≤ 280px, кнопки ‹ › месяца 28px.
- [ ] **Step 2:** Смена месяца: старый список остаётся (opacity .5) + тонкий прогресс сверху вместо пустого экрана.
- [ ] **Step 3:** Карточка заявки: убрать заливку `.sv-order-progress-fill`; эмодзи 📋 💬 📭 → lucide.
- [ ] **Step 4:** Лента объектов (Аналитика): карточка ≤ 260px, заголовок 2 строки; таблица: «№ заявки» влево + ellipsis, «Определители» → «Заявка и организация»; раскрытая строка: «Без заявки · …» вместо «#—».
- [ ] **Step 5:** Сайдбар: имя объекта 2 строки + title; «По машинам» — `stripSamosvaly` + госномер; пустая вторая смена — серое кольцо «нет данных»; `.sv-week-nav` нижняя граница.
- [ ] **Step 6:** `checks-claude.mjs samosvaly-header-stable samosvaly-smu-strip-fit long-object-name --all` (`samosvaly-header-stable`: высота `.sv-sub-header` одинакова на трёх вкладках, кнопки однострочные). Скрины трёх вкладок обе темы — посмотреть.
- [ ] **Step 7:** Commit `fix(samosvaly): стабильная шапка, карточки и сайдбар без сырости`.

### Task 9: Легенда Ганта (C2-11)

**Files:** Create: `frontend/src/features/samosvaly/GanttLegend.tsx`; Modify: `DumpTrucksPage.tsx` (вставка над GanttTable и в шапку вкладки «Ганта»).

**Interfaces:** Produces: `export function GanttLegend(): JSX.Element` — кнопка «ⓘ Обозначения» → Popover (shadcn `ui/popover.tsx`) с образцами: % КИП, N рейсов, ≈ на месте, → ← другая заявка, ! нет рейсов, • на объекте без рейсов, штриховка — нет данных, вертикальные линии — начало/конец заявки, `[факт/план]`, `N|M` — ТС в 1/2 смене.

- [ ] **Step 1:** Реализовать, используя существующие классы ячеек `.sv-gc.*` для образцов.
- [ ] **Step 2:** Скрин открытой легенды обе темы — посмотреть; `tsc` зелёный.
- [ ] **Step 3:** Commit `feat(samosvaly): легенда обозначений Ганта`.

### Task 10 (Codex, X1): Главная и Тягачи — общие компоненты (X1-01…X1-11, C5-02, C5-03)

**Owned files:** `frontend/src/components/dashboard/*`, `frontend/src/features/tyagachi/TyagachiVehicleBlock.tsx`, `TyagachiDashboard.tsx`.
**Consumes:** `bg-popover` непрозрачный (Task 3) — для dropdown адресов и sticky-шапки ДСТ.

- [ ] **Step 1:** Codex правит по фиксам из spec X1-*.md и C5-02/03.
- [ ] **Step 2:** Codex добавляет в `checks-codex.mjs`: `home-last-vehicle-visible` (последняя карточка полностью в видимой области после scroll до конца), `home-dropdown-opaque`, `home-dst-sticky-opaque`, `home-search-empty-text` («Нет совпадений»), `home-plural` (нет «1 заявок»), `tyagachi-single-period-label` (одно «Период:» на экране) → PASS light/dark 1470 + 1280.
- [ ] **Step 3:** Claude: ревью diff, свой прогон проверок, 2 скрина, commit `fix(home,tyagachi): …`.

### Task 11 (Codex, X2): КИП техники (X2-01…X2-14)

**Owned files:** `kip/client/src/**` (только фронт КИП).

- [ ] **Step 1:** Codex правит по spec X2-kip.md (непрозрачные поверхности в `kip/client/src/index.css` по образцу Task 3; MultiSelectDropdown dark; позиционирование поиска; модалка «Все параметры»; синхронизация карты с выбором; spiderfy; тексты/валидация дат; кнопка темы).
- [ ] **Step 2:** `checks-codex.mjs`: `kip-dark-dropdown-contrast` (контраст текста инпута и кнопок ≥ 4.5:1), `kip-search-in-viewport` (1280), `kip-modal-width` (≥ 900px на 1470), `kip-modal-opaque`, `kip-ghost-search-nd` (ghost → «Н/Д»), `kip-date-invalid-message` → PASS.
- [ ] **Step 3:** `cd kip/client && npx tsc --noEmit` → 0 ошибок; КИП-клиент раздаётся сервисом :3001 из сборки? — Codex проверяет, как сервится (`kip/client` dist или dev), и описывает в отчёте, что нужно для применения (Claude выполнит в Task 20).
- [ ] **Step 4:** Claude: ревью, прогон, commit `fix(kip): …`.

### Task 12 (Codex, X3): Топливо + Выдача топлива (X4-01…X4-07, доаудит X4)

**Owned files:** `frontend/src/features/fuel/FuelAdminPage.tsx`, `frontend/src/components/FilterDropdown.tsx`, `frontend/public/vydacha-topliva/*`.

- [ ] **Step 1:** Codex дозавершает аудит X4 по своему чеклисту (водители, редактирование события, статический прототип — экраны, которые не прошёл), дописывает находки в `.ui-audit/findings/X4-fuel.md`, затем правит все X4-*.
- [ ] **Step 2:** `checks-codex.mjs`: `fuel-statuses-localized` (нет «open/closed/смен» с неверным склонением), `fuel-edits-no-json` (нет `{` в видимом тексте истории правок), `vydacha-receive-no-overlap` (bbox «Принять» не пересекает кнопки Камера/Галерея/Файл), `vydacha-edit-gaps` (зазоры ≥ 12px) → PASS.
- [ ] **Step 3:** Claude: ревью, прогон, commit.

### Task 13 (Codex, X4): Тягачи-вьюер, Отчёты, AI, Состояние ТС (C5-01, C5-04…C5-09, C5-12)

**Owned files:** `frontend/src/features/tyagachi/TyagachiReportView.tsx`, `frontend/src/features/reports/*`, `frontend/src/features/ai-reports/*`, `frontend/src/features/vehicle-status/*`.

- [ ] **Step 1:** Codex правит по spec C5-*.
- [ ] **Step 2:** `checks-codex.mjs`: `tyagachi-404` (нет «API error», есть «не найдена»), `tyagachi-status-localized`, `reports-filters-no-overflow`, `ai-input-visible` (у инпута видимая рамка), `vs-filters-are-buttons`, `vs-duplicates-grouped` → PASS.
- [ ] **Step 3:** Claude: ревью, прогон, commit.

### Task 14 (Codex, X5): Админ-раздел (C4-01…C4-07)

**Owned files:** `frontend/src/features/admin/*`.

- [ ] **Step 1:** Codex правит по spec C4-admin.md. Подписи пайплайнов — человекочитаемые, технический id в title.
- [ ] **Step 2:** `checks-codex.mjs`: `admin-sticky-tabs` (при scroll шапка непрозрачна и не перекрывает текст), `admin-no-red-manual` → PASS (PIN-сессия из `.ui-audit/auth.json`).
- [ ] **Step 3:** Claude: ревью, прогон, commit.

### Task 15: Аналитика — Карточки v2 и Карта (C3-04, C3-05, C3-06, C3-11, C3-12, C3-16)

> Исходно планировалась Codex; оставлена Claude, т.к. стили `.sv-v2-*` живут в `samosvaly.css`, которым владеет Claude (правило «один файл — один исполнитель»).

**Files:** `frontend/src/features/analytics/{AnalyticsCardsViewV2,VehicleCardV2,DayTimelineNav,AnalyticsMapView}.tsx`, `samosvaly.css` (`.sv-v2-*`).

- [ ] **Step 1:** Убрать «Ledger смены …» из UI (за `?debug=1`).
- [ ] **Step 2:** Таблица рейсов в карточке — `table-layout:fixed; width:100%`, мини-бар % в шапку смены; сетка `align-items:start`.
- [ ] **Step 3:** Таймлайн: sticky top 0 с подложкой, подписи ≥ 10px, пустые дни без «—».
- [ ] **Step 4:** Карта: на зуме < 7 — компактные кружки с %, плашки с названием (max 160px, 2 строки) на зуме ≥ 7 и на hover; стартовый вид fitBounds по объектам.
- [ ] **Step 5:** `checks-claude.mjs cardsv2-no-hscroll cardsv2-no-debug map-labels-no-overlap` (`map-labels-no-overlap`: попарное пересечение bbox видимых плашек = 0 на стартовом виде) → PASS. Скрины — посмотреть.
- [ ] **Step 6:** Commit `fix(analytics): карточки v2 и карта без наложений`.

### Task 16: Гео внутри ЛК (C5-10, C5-11)

**Files:** `geo-admin/client/src/{main.ts,styles.css}`, `frontend/src/App.tsx` (GeoAdminPage — передать `?theme=`).

- [ ] **Step 1:** При `window.self !== window.top` скрывать `.header`, «Шпаргалку» — кнопкой в сайдбар; `?theme=dark` → класс на body и тёмные переменные для сайдбара/списка; плейсхолдер до `tileload`.
- [ ] **Step 2:** Выяснить, как сервится клиент гео (`geo-admin/client/dist` — по памяти проекта нужен `npm run build:client`); собрать. Скрин /geo-admin обе темы — посмотреть.
- [ ] **Step 3:** Commit `fix(geo): без второй шапки в ЛК, тема из оболочки`.

### Task 17: Демо-режим — маскировка госномеров (доп. пункт 2)

**Files:** Create: `frontend/src/lib/demoMask.ts`; Modify: `frontend/src/main.tsx` (вызов), `kip/client/src/main.tsx` (тот же код — копия файла `kip/client/src/lib/demoMask.ts`; разные бандлы), `frontend/src/components/TopNavBar.tsx` (иконка-индикатор «Демо» когда включено).

**Interfaces:** Produces: `export function maskPlate(plate: string): string` (детерминированно: тот же номер → та же маска; формат и регион сохраняются: `А016ОЕ172` → `К482ВМ172`, `0023ОА72` → `5718ТК72`; буквы из `АВЕКМНОРСТУХ`); `export function installDemoMask(root?: Node): void` — MutationObserver по текстовым узлам и атрибуту `title`, замена по регэкспам `/[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}/g` и `/\b\d{4}[АВЕКМНОРСТУХ]{2}\d{2,3}\b/g`. Включение: `?demo=1` → `localStorage['lk.demo']='1'`, `?demo=0` — выключить; iframe КИП получает `&demo=1` от оболочки.

- [ ] **Step 1:** Тест-ассерты в `frontend/src/lib/demoMask.check.mjs` (node, без фреймворка): детерминизм, сохранение региона/формата, «не номер» (`Заявка #142025`, `Р-404`, `71Н-1603`) не меняется.
- [ ] **Step 2:** Реализовать; прогнать `node frontend/src/lib/demoMask.check.mjs` → все assert OK.
- [ ] **Step 3:** `checks-claude.mjs demo-mask-visible demo-mask-search` (на /analytics, /samosvaly, /kip: в видимом тексте нет ни одного реального номера из `/api/...` ответа; поиск по реальному номеру находит строку) → PASS.
- [ ] **Step 4:** Commit `feat(demo): маскировка госномеров для записи видео (?demo=1)`. Ограничение (в отчёт): ФИО водителей не маскируются — показываются только в «Топливо → Водители»; не снимать этот экран или замазать при монтаже.

### Task 18: Сверка цифр для кейса (доп. пункт 1)

**Files:** Create: `.ui-audit/numbers.md` (+ копия в vault `02-Projects/ЛК Мстрой/Showcase/Цифры для кейса.md`).

- [ ] **Step 1:** Посчитать (read-only SQL / API): реестр КИП (`kip/config/vehicle-registry.json`), уникальные ТС с данными за последние 7/30 дней по КИП/самосвалам/тягачам, справочник TIS (getPassports — число из диалога «Добавить из TIS»: 2213), строк в «Состоянии ТС» (2390, из них уникальных госномеров — посчитать).
- [ ] **Step 2:** Таблица «формулировка для кейса → цифра → источник → дата замера»; явно отметить, какая цифра честная для «под мониторингом» и что «400+»/«227+» соответствуют/не соответствуют.
- [ ] **Step 3:** «30 мин → 30 сек»: замер времени генерации КИП-отчёта (Task 19) — внести фактическое время.

### Task 19: Проверка генерации КИП-отчёта (доп. пункт 3)

- [ ] **Step 1:** Playwright: /reports → «Отчёт КИП», период «прошлая неделя» → «Сгенерировать», ловить download; замерить время до файла.
- [ ] **Step 2:** Открыть xlsx (node, `xlsx`/`exceljs` из node_modules ai-reports, если есть; иначе — размер + листы через unzip) — проверить, что строки есть и группировка по категории.
- [ ] **Step 3:** Записать время/результат в `.ui-audit/numbers.md`; при сбое — диагноз в отчёт (не чинить бэкенд без пользователя).

### Task 20: Финальная верификация и выкатка

- [ ] **Step 1:** `cd frontend && npx tsc --noEmit && npm run build` → 0 ошибок; то же для `kip/client` (если менялся).
- [ ] **Step 2:** `node .ui-audit/tools/checks-claude.mjs --all` и `checks-codex.mjs --all` → все PASS; вывод в `.ui-audit/logs/checks-after.txt`.
- [ ] **Step 3:** Повторный критический проход «после»: те же сценарные скрипты (`claude-c2-*.mjs`, `claude-c3-*.mjs`, `claude-c4-*.mjs`, `claude-x356.mjs`) → смотреть скрины ключевых шагов; новые дефекты — исправить одной пачкой (bounded: один раунд).
- [ ] **Step 4:** Применить сборки на проде: `frontend` dist раздаётся Caddy (сборка Step 1 уже применила); КИП-клиент / гео-клиент — по выводу Task 11/16.
- [ ] **Step 5:** Отчёт пользователю: что исправлено (по ID), что осталось и почему, вопросы (название бренда в меню), инструкции записи (`?demo=1`, 1470×830, светлая тема).
