# AGENTS.md — fuel-app

> ⚠️ **Expo SDK 56 — API ИЗМЕНИЛСЯ относительно прежних знаний модели.** Перед написанием ЛЮБОГО
> кода сверяйся с точными версионными доками: индекс https://docs.expo.dev/versions/v56.0.0/ и
> страницу конкретного пакета. Особо: **`expo-file-system`** (`uploadAsync` мог переехать в
> `expo-file-system/legacy`), `expo-sqlite`, `expo-image-picker`. **Не полагайся на память — читай доку.**

> Правила для ИИ-агентов (Codex / Claude), работающих над **приложением водителя** (Android-планшет,
> Expo RN + TypeScript) приложения выдачи топлива (АТЗ).
> **Это обязательный контракт. Не отклоняться без явного согласования.**
> Парный документ — бэкенд `fuel-backend/AGENTS.md` (тот же продукт, серверная сторона).
> `CLAUDE.md` импортит этот файл (`@AGENTS.md`) — источник один.

## Что это

Офлайн-first приложение для водителей АТЗ на **Android-планшетах**: личный вход (логин + PIN),
смены, выдача/получение топлива, фото ТТН. Данные вводятся **без сети** и синхронизируются на
РФ-VPS `https://atz.pisarenkovmax.ru`, когда связь появляется. Источник истины по остатку и
конфликтам — **сервер**. Клиент только копит события в outbox и отдаёт их батчами.

**Критичность синка — риск №1 проекта.** Корректность важнее скорости фич.

## Источник истины (Codex его НЕ видит — ключевое вынесено в этот файл)

Полный контекст — Obsidian vault `02-Projects/Приложение выдачи топлива/`:
`Архитектура.md` §3 (синк), §7 (экраны), §8 (стек) · `Architecture/API/Sync-API.md` (wire-контракт `/sync`) ·
`Process/Sync-Business-Rules.md` · `Process/Shift-Model.md` · `Design/Prototype.md`.
Codex **не имеет доступа** к vault и к `fuel-backend/` — поэтому wire-контракт и инварианты
**инлайнятся ниже**, а нужные куски прототипа/токенов даются в промпте содержимым.

---

## Стек — ПИНЫ (не менять без согласования)

| Слой | Выбор | Запрет |
|------|-------|--------|
| Framework | **Expo SDK 56** (managed), RN **0.85**, React **19.2** | НЕ bare RN, НЕ старые SDK, НЕ `expo prebuild` без согласования |
| Архитектура RN | **New Architecture — ВКЛ** (дефолт SDK 56) | не отключать |
| Язык | **TypeScript** strict, функц. компоненты + hooks | не JS, не классовые компоненты |
| Навигация | **Expo Router** (file-based, роуты в **`src/app/`**) | не React Navigation вручную |
| Локальная БД | **expo-sqlite + Drizzle ORM** (+ drizzle-kit миграции) | та же ORM, что на бэке → типы переиспользуются; не raw SQL вразнобой |
| Стили/UI | **NativeWind v4** (Tailwind для RN) | не styled-components, не inline-стили пачками |
| Состояние | **Zustand** (UI/сессия) + **TanStack Query v5** (server-cache) | без Redux |
| HTTP | typed-fetch обёртка + TanStack Query | (решено: fetch, не axios) |
| Secure storage | **expo-secure-store** (Android Keystore) | хранить **солёный хэш PIN**, НИКОГДА плейн-PIN или серверный JWT в обычном сторадже |
| Камера/фото | **expo-camera · expo-image-picker · expo-document-picker** | — |
| Сжатие фото | **expo-image-manipulator** → ≤500 КБ перед очередью | не слать оригинал |
| Аплоад | **expo-file-system** (multipart, **foreground** + ретраи) | НЕ background-session для крупных файлов (краши). ⚠ API v56 — сверить `uploadAsync` vs `/legacy` |
| UUID | **expo-crypto** `randomUUID()` | id событий — только клиентский UUID |
| Списки | **@shopify/flash-list** | поиск по тысячам ТС — в SQLite (LIKE/FTS) + debounce, **НЕ** в JS-памяти |
| Сборка | **EAS Build** (облако), профиль `tablet-apk` (`buildType: apk`) | НЕ `--local`, НЕ Android Studio |

> **Версии заморожены на init (3.1, 2026-06-13) под SDK 56.** В `package.json` — как зафиксировал
> `expo install` (Expo пинит react/react-native/нативные модули точно). Resolved-якоря: expo ~56.0.11 ·
> RN 0.85.3 · React 19.2.3 · expo-router ~56.2.10 · reanimated 4.3.1 (+react-native-worklets 0.8.3) ·
> TS ~6.0.3 · drizzle-orm + drizzle-kit · zustand · @tanstack/react-query · @shopify/flash-list ·
> expo-sqlite/secure-store/camera/image-picker/document-picker/image-manipulator/file-system/crypto (SDK-56-совместимые).
>
> **NativeWind + tailwindcss ставятся и пинятся в 3.2a.** ⚠ **tailwindcss ОБЯЗАТЕЛЬНО 3.4.x** —
> NativeWind v4 несовместим с tailwind v4. Критерий приёмки 3.2a — демо-экран рендерит токены **под New Architecture**.
>
> **Локальная БД (3.2b/c — Drizzle + expo-sqlite):** миграции `drizzle-kit generate`→`drizzle/`, применяются
> хуком `useDbMigrations()` в `src/app/_layout`. metro: `sourceExts.push("sql")` **+ обязательно
> `babel-plugin-inline-import@3.0.0` (dev)** c `{extensions:['.sql']}` в `babel.config.js` — иначе metro
> парсит `.sql` как JS и бандл падает («Missing semicolon»). schema: `reference.ts` (кэш) + `outbox.ts` (ядро, Claude).
>
> **Новые зависимости — только через `npx expo install` и только после согласования.**
> `npm install <pkg>` для RN-пакетов запрещён (ставит несовместимую с SDK версию). Build-tooling
> (drizzle-kit и т.п.) — `npm i -D` допустимо (это не RN-рантайм).

---

## Структура проекта (по факту шаблона SDK 56)

```
fuel-app/
├── AGENTS.md / CLAUDE.md(→@AGENTS.md)
├── app.json                 ← Expo config (New Arch on; эксперименты typedRoutes + reactCompiler ON)
├── eas.json                 ← профиль tablet-apk
├── drizzle.config.ts        ← (3.2b)
├── tailwind.config.js       ← (3.2a) токены из app.css
├── src/
│   ├── app/                 ← Expo Router (роуты = файлы). ⚠ tabs-демо из шаблона ЗАМЕНЯЕМ нашими экранами в 3.4
│   │   ├── _layout.tsx
│   │   ├── index.tsx        (роутинг: сессия → главный, иначе → login)
│   │   └── (driver)/…       (защищённая группа)
│   ├── global.css           ← NativeWind (файл уже есть из шаблона)
│   ├── db/                  ← Drizzle local SQLite: schema.ts (outbox, photo_queue, ref-cache), client.ts
│   ├── sync/                ← ⚠ ЯДРО (пишет Claude): outbox, sync-клиент, конфликты, фото-очередь, bootstrap-дельта
│   ├── api/                 ← typed client (/auth/login, /bootstrap, /sync, /uploads/ttn)
│   ├── stores/              ← Zustand (session, syncStatus)
│   ├── hooks/               ← TanStack Query hooks (обвязка над sync/api)
│   ├── components/          ← UI-атомы
│   ├── constants/           ← theme.ts (из шаблона)
│   └── theme/               ← маппинг токенов vydacha-topliva/app.css → NativeWind
└── assets/
```

> **TODO до 3.5 (EAS build):** `app.json` → задать `android.package` (reverse-domain) и определиться
> с `orientation` (шаблон = `portrait`; для планшета согласовать). Линковка EAS `projectId` — на первом build.

---

## Бэкенд, который потребляет клиент

- **Base URL:** `https://atz.pisarenkovmax.ru` (через `EXPO_PUBLIC_API_URL`). Эндпоинты — в корне.
- **Auth водителя:** `POST /auth/login {login, pin}` → `{ token (JWT 7д), driver-профиль, pinHash (для офлайн-кэша) }`.
  Дальше — заголовок `Authorization: Bearer <JWT>`. **Refresh-токена нет**: на `401` → повторный логин.
- `GET /bootstrap?since=<ISO>` → справочники (vehicles/organizations/atz водителя) + последние смены, **дельта по `since`**.
- `POST /sync` → батч событий (см. контракт ниже).
- `POST /uploads/ttn` → multipart-фото по UUID receipt-события.
- **TLS обязателен и валиден** (Let's Encrypt). Android отвергает self-signed — **проверку НЕ отключать никогда**.

---

## ⚠️ Синк — ИНВАРИАНТЫ и wire-контракт (зона Claude)

**`src/sync/*` пишет и ревьюит Claude.** Codex готовит вокруг: типы (зеркало контракта),
TanStack Query hooks, Zustand-стор, UI-индикатор синка, экраны — но **логику outbox / разрешения
конфликтов / фото-очереди не трогает** без ревью. (Симметрично `fuel-backend`: `/sync` там тоже Claude.)

### Инварианты (из `Архитектура.md §3`)
1. **Любая мутация = событие** с клиентским **UUID** + **`happenedAtClient`** (снимок времени **в момент ввода**,
   не отправки) + **`deviceId`**. Прямых правок «по месту» нет — только события.
2. **Outbox — state-machine `pending → in-flight → confirmed`.** Строка **НЕ удаляется до ACK сервера**
   (`status: applied`). Ретрай уже применённого безопасен (сервер делает upsert по UUID → без дублей).
3. **Фото ТТН — отдельная очередь** от событий. Жать ≤500 КБ → грузить `/uploads/ttn` **после того,
   как соответствующее receipt-событие подтверждено** (`applied`), foreground + ретраи.
4. **Офлайн-логин:** после первого онлайн-входа кэшировать `driver + pinHash` в secure-store; PIN
   проверять локально; старт смены кладётся в outbox.
5. **`deviceId`** генерится один раз (`expo-crypto`), хранится в secure-store.
6. Каждый экран работает 100% офлайн; синк — фоновая мелочь, **не блокер ввода**.

### Wire-контракт `POST /sync` (из `Architecture/API/Sync-API.md` — реализован на бэке, Фаза 2.4)

**Запрос:** `{ deviceId, events[1..500] }` — discriminated union по `type` (`driverId` берётся из JWT, в payload его НЕТ):

| `type` | поля |
|--------|------|
| `org_add` | `id, name` |
| `vehicle_add` | `id, gosNumber, mark?, vehicleType?, organizationId` |
| `shift_open` | `id, atzId, startedAtClient, openingRemainingLiters?` |
| `shift_close` | `id` (= UUID **той же** смены), `endedAtClient, closingRemainingLiters?` |
| `dispense_upsert` | `id, shiftId, vehicleId, liters, happenedAtClient, isDeleted?, editedAt?` |
| `receipt_upsert` | `id, shiftId, liters, happenedAtClient, isDeleted?, editedAt?` (без `vehicleId`) |

**Ответ:** `{ serverTime, results[в порядке запроса], atzBalances }`,
где `result = { id, type, status: applied | conflict | error, code?, message? }`,
`atzBalances` — пересчитанный сервером **авторитетный** остаток по каждому АТЗ.

**Коды конфликтов** (`code` при `status≠applied`) и реакция клиента:

| код | смысл | что делает клиент |
|-----|-------|-------------------|
| `atz_busy` | на АТЗ уже открыта смена | заблокировать старт, показать водителю; событие держать |
| `atz_not_found` / `atz_inactive` | АТЗ нет / выключен | показать ошибку, не ретраить вслепую |
| `shift_not_found` | смены нет | передоставить зависимость или отбросить |
| `forbidden` | чужая смена (single-writer) | не должно случаться (1 водитель = 1 планшет); лог + стоп |
| `shift_mismatch` | событие из другой смены | то же |
| `vehicle_not_found` / `org_not_found` | справочник не доехал | проверить порядок (org→vehicle→событие), переотправить |
| `stale` | на сервере правка новее | **отбросить локальную правку**, подтянуть `/bootstrap`, сервер прав |

**Семантика, на которую клиент опирается (НЕ дублировать на клиенте, но учитывать):**
сервер сам упорядочивает применение (org → vehicle → shift_open → dispense/receipt → shift_close),
ведёт **инкрементальный** остаток (ретрай = дельта 0; ручная psql-калибровка не затирается),
LWW по `editedAt`, дозапись в закрытую смену разрешена. `results` сопоставляются по индексу запроса.

### Бизнес-решения ядра (`Sync-Business-Rules.md`)
Остаток — накопительно (не пересчёт с нуля); правка побеждает по `editedAt` (старее → `stale`);
в закрытую смену дописывать можно; чужую смену нельзя; удаление мягкое (литры возвращаются).
П.1–2 — предварительные, проверяются на пилоте: **клиент не должен на них жёстко завязываться UI-логикой.**

---

## Экраны (Фаза 3.4, по `Design/Prototype.md` + `app.css`; светлая тема, планшет)

Вход (PIN-пад) → Главный (смена не начата: «Начать смену» / «Профиль и история») → Профиль и история
(карточки прошлых смен) → Старт смены (выбор своего АТЗ) → **Рабочий режим** (header · АТЗ+остаток ·
2 большие кнопки передача/получение · таблица заправок с «карандашиком») → Передача (поиск госномера
по SQLite-кэшу с разбивкой по организациям + «+ добавить ТС» → литры) → Добавление ТС → Получение
(литры + фото ТТН) → Правка (bottom-sheet) → Закрытие смены.
Каждый экран пишет через hooks из `src/sync`, **не** напрямую в БД. Время события — авто-снимок при вводе.
Tap-таргеты: основное действие 64px, вторичное 48px, минимум 44px, клавиша пада 72px (токены `app.css`).

---

## Безопасность (первый writeable-из-интернета клиент экосистемы)

- Только валидный TLS; проверку сертификата не отключать.
- В secure-store — **солёный хэш PIN**, не плейн-PIN. JWT — тоже secure-store.
- Фото перед отправкой жать (MIME/размер бэк дополнительно валидирует).
- Никаких секретов в коде/гите. `EXPO_PUBLIC_*` — только не-секретные (base URL).

## Команды (после init 3.1)

```bash
npx expo start              # Metro dev-сервер (Expo Go / dev client) — синк к боевому бэку
npx expo install <pkg>      # ЕДИНСТВЕННЫЙ способ добавить RN-зависимость
npm run lint                # expo lint (eslint)
npx tsc --noEmit            # типчек
npx expo-doctor             # совместимость пакетов с SDK
npm test                    # юнит-тесты sync-ядра (раннер ставится в 3.3)
npx drizzle-kit generate    # миграция локальной SQLite из schema.ts
eas build -p android --profile tablet-apk   # облачная сборка APK (3.5)
```

## Оркестрация (уроки Фазы 2)

- Codex запускать **`codex exec --sandbox workspace-write` строго из `fuel-app/`** (из подпапки =
  песочница сужается, задача молча не выполнится).
- В каждом промпте Codex: «**ПЕРВЫМ ДЕЛОМ прочитай AGENTS.md**» + явные пути к файлам вне `fuel-app/`
  давать **содержимым** (Codex не видит vault и `fuel-backend/`).
- Каждый атом ревьюится против конкретного документа; проверки Codex (lint/tsc/тесты) Claude
  перепроверяет сам; фиксы 1–5 строк Claude вносит сам с пометкой.

## Запреты (коротко)

- ❌ Bare RN / `expo prebuild` / старый SDK / отключать New Architecture.
- ❌ `npm install` RN-пакетов вместо `npx expo install`; новые RN-зависимости без согласования.
- ❌ tailwindcss v4 (NativeWind v4 требует tailwind 3.4.x).
- ❌ Генерировать id событий на клиенте иначе чем UUID; править данные «по месту» мимо outbox.
- ❌ Удалять outbox-строку до ACK сервера.
- ❌ Слать оригинал фото (без сжатия) / background-upload крупных файлов.
- ❌ Хранить плейн-PIN; отключать проверку TLS.
- ❌ Писать логику `src/sync/*` без ревью Claude.
- ❌ Держать справочник ТС в JS-памяти для поиска (только SQLite).
