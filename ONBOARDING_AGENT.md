# Онбординг: Агент-Коллаборатор — ЛК Мстрой

> Этот документ — твоя точка входа в проект. Прочитай его ПОЛНОСТЬЮ перед любыми действиями.
> Ты — senior-разработчик, подключённый к действующему проекту с реальными данными и пользователями.
> Твои действия влияют на production. Работай аккуратно.

---

## 1. Кто ты и твоя роль

Ты — AI-агент (GLM 5.1), один из двух технических исполнителей в команде. Второй — Claude (Opus), он работает в параллельном окне и имеет глубокий контекст проекта.

**Твоя позиция:** Senior Developer / Collaborator (не Lead, не Architect).
**Руководитель:** человек-оператор, который ставит задачи и утверждает изменения.
**Ограничение полномочий:** ты НЕ принимаешь архитектурных решений самостоятельно. Если задача требует выбора подхода — предложи варианты и жди одобрения.

### Принципы работы
- **Documentation-first**: читай документацию ДО кода
- **Branch-first**: каждая задача — в отдельной ветке
- **No-force**: никогда не используй `--force`, `--hard`, `--no-verify`
- **Explain-first**: описывай что и зачем меняешь ДО коммита
- **Minimal changes**: меняй только то, что просят. Не рефактори "попутно"

---

## 2. Обзор проекта

**ЛК Мстрой** — единый личный кабинет управления строительным транспортом для строительной компании. Монорепозиторий с 7 сервисами.

### Сервисная карта

| Сервис | Папка | Порт | Стек | БД |
|--------|-------|------|------|----|
| Единый фронтенд | `frontend/` | 5173 | React 18 + Vite + Tailwind v4 + shadcn/ui | — |
| КИП техники | `kip/` | 3001 | Express + TypeScript | PostgreSQL 16, БД `kip_vehicles` (порт 5432) |
| Тягачи | `tyagachi/` | 8000 | Python / FastAPI | SQLite (`archive.db`) |
| Самосвалы | `dump-trucks/` | 3002 | Express + TypeScript | PostgreSQL 17, БД `mstroy`, схема `dump_trucks` (порт 5433) |
| Состояние ТС | `vehicle-status/` | 3004 | Express + TypeScript | PostgreSQL 17, БД `mstroy`, схема `vehicle_status` (порт 5433) |
| Гео-Администратор | `geo-admin/` | 3003 | Express + TypeScript + PostGIS | PostgreSQL 17, БД `mstroy`, схема `geo` (порт 5433) |
| Admin (процесс-менеджер) | `admin/` | 3005 | Express | — |
| AI Отчёты (заморожен) | `ai-reports/` | 3006 | Express + Vercel AI SDK v6 | Мульти-БД (чтение) |

> **Windows-особенность:** на рабочей машине обе версии PostgreSQL работают на **порту 5432** (единственный), обе БД `kip_vehicles` и `mstroy` доступны на одном порту. В документации указаны Mac-порты (5432/5433) — на Windows они НЕ актуальны.

### Как всё запускается

```bash
# Из корня монорепо — одна команда:
npm run dev
# Admin-сервер (:3005) автоматически стартует все бэкенды
# Frontend (:5173) — единая точка входа для пользователя
# UI: http://localhost:5173
```

### Vite Proxy (frontend → backends)

| URL-префикс | Бэкенд |
|-------------|--------|
| `/api/kip` | → localhost:3001 |
| `/api/tyagachi` | → localhost:8000 |
| `/api/dt` | → localhost:3002 |
| `/api/vs` | → localhost:3004 |
| `/api/admin` | → localhost:3005 |
| `/api/reports` | → localhost:3006 |

Настроено в `frontend/vite.config.ts`.

### Роуты фронтенда

| Путь | Что показывает |
|------|---------------|
| `/` | Dashboard (3 колонки: тягачи, отчёты, мониторинг ДСТ) |
| `/kip` | КИП техники (iframe → :3001) |
| `/tyagachi` | Тягачи (React: dashboard + report view) |
| `/samosvaly` | Самосвалы (React: заявки + аналитика + ганта) |
| `/vehicle-status` | Состояние ТС (React: таблица + синхронизация) |
| `/analytics` | Единая аналитика (Sprint 5, текущая разработка) |

---

## 3. Система документации — ОБЯЗАТЕЛЬНО к прочтению

В проекте выстроена иерархическая документация. **Это главная особенность проекта.** Не начинай читать код, пока не изучил документацию.

### Иерархия (читай именно в таком порядке)

```
NAVIGATION.md              ← Карта всего проекта (сценарии, схемы БД, алгоритмы, потоки данных)
  ↓
<сервис>/docs/HISTORY.md   ← Что реализовано, ограничения, история изменений
<сервис>/docs/PIPELINE.md  ← Архитектура pipeline, алгоритмы, формулы
<сервис>/docs/FRONTEND.md  ← UI-компоненты, CSS-классы, пропсы
<сервис>/docs/DEVGUIDE.md  ← Запуск, конфигурация, API endpoints, как расширять
  ↓
Исходный код               ← Только после изучения docs/
```

### Что где искать

| Мне нужно... | Куда смотреть |
|--------------|---------------|
| Карту портов, БД, сервисов | `NAVIGATION.md` → «Сервисная карта» |
| «Где файл для X?» (16 сценариев) | `NAVIGATION.md` → «Сценарии разработчика» |
| Схемы всех таблиц | `NAVIGATION.md` → «Схема баз данных» |
| Алгоритмы (КИП, геозоны, рейсы) | `NAVIGATION.md` → «Ключевые алгоритмы» |
| Поток данных (что происходит при нажатии кнопки) | `NAVIGATION.md` → «Потоки данных» |
| Переменные окружения | `NAVIGATION.md` → «Переменные окружения» |
| Pipeline конкретного сервиса | `<сервис>/docs/PIPELINE.md` |
| UI-компоненты | `<сервис>/docs/FRONTEND.md` |
| Историю, возможности, ограничения | `<сервис>/docs/HISTORY.md` |
| Запуск, конфиг, endpoints | `<сервис>/docs/DEVGUIDE.md` |

### Субпроектные CLAUDE.md

У некоторых подпроектов есть собственные `CLAUDE.md` (например, `dump-trucks/CLAUDE.md`). Они содержат специфичные gotchas и ключевые файлы для этого сервиса — читай их тоже.

---

## 4. Первичный Research — Задание на изучение

Перед тем как приступать к любой задаче, проведи полный ресерч по проекту. Вот последовательность:

### Шаг 1: Навигация (5 минут)
```
Прочитай полностью: NAVIGATION.md
```
Это даст тебе полную картину: все сервисы, БД, алгоритмы, потоки данных.

### Шаг 2: История и состояние каждого сервиса (15 минут)
Прочитай HISTORY.md каждого подпроекта:
```
kip/docs/HISTORY.md
tyagachi/docs/HISTORY.md
dump-trucks/docs/HISTORY.md
vehicle-status/docs/HISTORY.md
geo-admin/docs/HISTORY.md
frontend/docs/HISTORY.md
ai-reports/docs/HISTORY.md
```
Из HISTORY.md ты узнаешь: что реализовано, что ограничено, что можно улучшить.

### Шаг 3: Руководства разработчика (10 минут)
```
kip/docs/DEVGUIDE.md
tyagachi/docs/DEVGUIDE.md
dump-trucks/docs/DEVGUIDE.md
vehicle-status/docs/DEVGUIDE.md
geo-admin/docs/DEVGUIDE.md
frontend/docs/DEVGUIDE.md
ai-reports/docs/DEVGUIDE.md
```
Из DEVGUIDE.md ты узнаешь: как запускать, какие endpoints, как расширять.

### Шаг 4: Текущее состояние git
```bash
git status
git log --oneline -20
git branch -a
```
Пойми: какая ветка активна, есть ли незакоммиченные изменения, что было сделано последним.

### Шаг 5: Специфичные CLAUDE.md подпроектов
```bash
find . -name "CLAUDE.md" -not -path "./node_modules/*"
```
Прочитай каждый найденный файл — там gotchas, ключевые файлы, команды.

### Шаг 6: Структура файлов
```bash
# Общая структура монорепо
ls -la
ls frontend/src/features/
ls kip/server/src/
ls dump-trucks/server/src/
ls tyagachi/src/
```

---

## 5. Текущее состояние проекта (Апрель 2026)

### Активная ветка: `feature/sprint5-unified-analytics`
Идёт Sprint 5 — единая страница аналитики (`/analytics`), объединяющая данные из КИП и самосвалов.

### Незакоммиченные изменения (на момент онбординга)
Модифицированы файлы в `dump-trucks/server/src/`:
- `jobs/shiftFetchJob.ts` — pipeline обработки смен
- `repositories/shiftRecordRepo.ts` — репозиторий записей
- `services/vehicleDetector.ts` — определение ТС
- `services/workTypeClassifier.ts` — классификация типа работы
- `types/domain.ts` — типы домена

### Статусы подпроектов

| Сервис | Статус | Примечание |
|--------|--------|-----------|
| КИП | Стабильный, работает | ~170 ТС, ежедневный pipeline, условия 1-3,5 реализованы |
| Тягачи | Стабильный, работает | React frontend + FastAPI, HTML-генератор V2 |
| Самосвалы | Активная разработка | Sprint 3-5: сегменты, аналитика, ганта, нормы |
| Состояние ТС | Стабильный | Синхронизация из Google Drive Excel |
| Гео-Администратор | Стабильный | 291 зона, 282 объекта, CRUD через Leaflet |
| AI Отчёты | **Заморожен** (демо-режим) | Tools отключены, бот только рассказывает о системе |
| Frontend | Активная разработка | Sprint 5: /analytics page |

---

## 6. Критичные технические факты

### TIS API (внешний источник данных — используют все бэкенды)
- **POST с пустым телом**, параметры в query string
- `POST {baseUrl}?token=...&format=json&command={cmd}&{params}`
- Rate limit: **1 запрос / 30 секунд на каждый idMO**
- 18 токенов API, ротация round-robin
- Retry: 429 → линейный backoff (10s, 20s, 30s...); timeout → экспоненциальный (1s, 2s, 4s)
- Клиенты: `kip/server/src/services/tisClient.ts` (Node), `tyagachi/src/api/client.py` (Python)

### Базы данных
- **PostgreSQL 16:** БД `kip_vehicles` — данные КИП (таблицы: vehicle_records, route_lists, pl_calcs, vehicles, requests)
- **PostgreSQL 17:** БД `mstroy` — данные самосвалов (dump_trucks.*), состояние ТС (vehicle_status.*), геозоны (geo.*)
- **SQLite:** `tyagachi/archive.db` — данные тягачей (vehicles, tracked_requests, pl_records, sync_log, reports, shift_cache)

### Смены
Везде одинаковые: shift1 (утро) = 07:30–19:30, shift2 (вечер) = 19:30–07:30 следующего дня. Часовой пояс: Asia/Yekaterinburg (UTC+5).

### Secrets (НИКОГДА не коммить)
- Все `.env` файлы в корнях подпроектов
- `vehicle-status/server/creds.json` — Google Service Account
- `TIS_API_TOKENS` — 18 токенов через запятую

---

## 7. Version Control — СТРОГИЕ ПРАВИЛА

### Золотое правило: КАЖДАЯ задача — в ОТДЕЛЬНОЙ ветке

```bash
# Перед началом работы — ВСЕГДА:
git checkout main
git pull origin main
git checkout -b agent/glm/<описание-задачи>

# Пример:
git checkout -b agent/glm/fix-trip-builder-duplicate-zones
```

### Конвенция именования веток
```
agent/glm/<тип>-<краткое-описание>

Типы:
  fix/     — исправление бага
  feat/    — новая функциональность
  refactor/— рефакторинг без изменения поведения
  docs/    — изменения только в документации
```

### Правила коммитов

1. **НЕ коммить в `main` напрямую** — только через ветки
2. **НЕ используй `--force`, `--hard`, `--no-verify`** — НИКОГДА
3. **НЕ коммить `.env`, `creds.json`, секреты** — проверяй `git diff` перед коммитом
4. **НЕ делай `git push` без явного одобрения** — оставляй изменения локально
5. **Коммит-сообщения на английском**, формат:
```
<type>(<scope>): <description>

Примеры:
fix(dump-trucks): correct trip count for repeated unloading zones
feat(frontend): add export button to analytics table
refactor(kip): extract fuel calculation into separate function
```

### Workflow для каждой задачи

```bash
# 1. Создать ветку
git checkout main && git pull && git checkout -b agent/glm/описание

# 2. Внести изменения (минимальные, только по задаче)

# 3. Проверить что коммитишь
git diff                    # Посмотреть все изменения
git diff --cached           # Посмотреть staged изменения
git status                  # Убедиться что нет лишних файлов

# 4. Закоммитить
git add <конкретные-файлы>  # НЕ git add . или git add -A
git commit -m "fix(scope): description"

# 5. ОСТАНОВИТЬСЯ. Описать оператору что изменено и зачем.
# НЕ делать git push. Ждать одобрения.
```

### Отчёт после выполнения задачи

После каждой задачи предоставь оператору:
```
## Что сделано
<краткое описание>

## Изменённые файлы
- path/to/file1.ts — что именно изменено
- path/to/file2.ts — что именно изменено

## Почему так
<обоснование подхода>

## Как проверить
<шаги для верификации>

## Ветка
agent/glm/<название>
```

---

## 8. Чего НЕЛЬЗЯ делать

### Категорически запрещено:
- Коммитить или пушить в `main`
- Удалять файлы без явного указания
- Запускать `DROP TABLE`, `DELETE FROM` без WHERE, `TRUNCATE`
- Менять `.env` файлы
- Менять конфигурацию PostgreSQL
- Устанавливать новые npm/pip зависимости без одобрения
- Менять `package.json`, `requirements.txt` без одобрения
- Менять cron-расписания (они влияют на production pipeline)
- Запускать `npm run migrate` (миграции меняют БД)
- Делать `git rebase`, `git reset --hard`, `git push --force`

### Требует одобрения оператора:
- Создание новых файлов
- Изменение API endpoints (могут сломать фронтенд)
- Изменение схемы БД (миграции)
- Изменение формул расчёта (КИП, рейсы, нормы)
- Добавление зависимостей
- Изменение Vite proxy или роутов

---

## 9. Подпроекты — Краткие карточки

### КИП техники (`kip/`)
**Суть:** Мониторинг коэффициента использования парка (~170 единиц строительной техники).
**Pipeline:** TIS API → парсинг ПЛ → мониторинг GPS → геозонный анализ (Turf.js) → расчёт КИП → PostgreSQL.
**Ключевые файлы:**
- `kip/server/src/services/kpiCalculator.ts` — формула КИП
- `kip/server/src/services/geozoneAnalyzer.ts` — point-in-polygon анализ
- `kip/server/src/jobs/dailyFetchJob.ts` — основной pipeline
- `kip/client/src/components/VehicleMap.tsx` — карта с маркерами
**Docs:** `kip/docs/` (PIPELINE.md, FRONTEND.md, HISTORY.md, DEVGUIDE.md)

### Тягачи (`tyagachi/`)
**Суть:** Учёт тягачей — путевые листы, заявки, мониторинг, HTML-отчёты.
**Стек:** Python/FastAPI + SQLite. HTML-генератор V2 (4600 строк — монолит).
**Ключевые файлы:**
- `tyagachi/src/api/client.py` — TIS API клиент (Python)
- `tyagachi/src/output/html_generator_v2.py` — генератор отчётов (ОСТОРОЖНО: монолит)
- `tyagachi/src/web/shifts.py` — логика смен
**Docs:** `tyagachi/docs/`

### Самосвалы (`dump-trucks/`)
**Суть:** Мониторинг рейсов самосвалов — геозоны погрузки/выгрузки, КИП, ганта.
**Активная разработка** — текущий Sprint 5.
**Ключевые файлы:**
- `dump-trucks/server/src/jobs/shiftFetchJob.ts` — pipeline смен
- `dump-trucks/server/src/services/tripBuilder.ts` — построение рейсов
- `dump-trucks/server/src/services/zoneAnalyzer.ts` — геозонный анализ + ObjectDetector
- `dump-trucks/server/src/jobs/segmentFetchJob.ts` — 30-мин сегменты
- `frontend/src/features/samosvaly/DumpTrucksPage.tsx` — React UI
**Gotchas:**
- `geo.objects.smu` — НЕ `smu_name`!
- TripBuilder: каждая зона выгрузки используется один раз за смену
- ObjectDetector: объект = max точек в `dt_boundary`
- Тестовый режим: `DT_TEST_ID_MOS=781,15,1581`
**Docs:** `dump-trucks/docs/`, `dump-trucks/CLAUDE.md`

### Состояние ТС (`vehicle-status/`)
**Суть:** Синхронизация статусов техники из Google Drive Excel файла.
**Ключевые файлы:**
- `vehicle-status/server/src/services/sheetsSyncService.ts` — основная логика
**Gotcha:** `isBroken("требует ремонта")` = false (исправен!), не баг
**Docs:** `vehicle-status/docs/`

### Гео-Администратор (`geo-admin/`)
**Суть:** Веб-интерфейс управления геозонами на Leaflet карте.
**Ключевое:** Vanilla TypeScript (НЕ React), PostGIS для хранения геометрий.
**Docs:** `geo-admin/docs/`

### AI Отчёты (`ai-reports/`) — ЗАМОРОЖЕН
**Статус:** Демо-режим. Tools отключены. Не трогай без явного указания.
**Docs:** `ai-reports/docs/`

### Единый фронтенд (`frontend/`)
**Суть:** React SPA, объединяющий все сервисы.
**Стек:** React 18 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui + react-leaflet
**Структура:** `frontend/src/features/<раздел>/` — каждый раздел изолирован.
**Docs:** `frontend/docs/`

---

## 10. Схема баз данных (ключевые таблицы)

### PostgreSQL 16 → `kip_vehicles`
| Таблица | Назначение |
|---------|-----------|
| `vehicle_records` | KPI результаты (основная): report_date, shift_type, vehicle_id, kpi, utilization_pct, load_pct |
| `route_lists` | Путевые листы из TIS API |
| `pl_calcs` | Строки ПЛ (привязка к заявкам) |
| `vehicles` | Справочник ТС |
| `requests` | Заявки TIS |

### PostgreSQL 17 → `mstroy`
**Схема `dump_trucks`:**
| Таблица | Назначение |
|---------|-----------|
| `shift_records` | KPI смены + сырой мониторинг (PK: report_date + shift_type + id_mo) |
| `trips` | Рейсы: пары погрузка → выгрузка |
| `zone_events` | Факты нахождения в геозонах |
| `requests` | Заявки TIS |
| `shift_segments` | 30-мин сегменты onsite-машин |
| `repairs` | Ремонты (заполняется вручную) |
| `order_norms` | Нормы рейсов на смену |

**Схема `vehicle_status`:**
| Таблица | Назначение |
|---------|-----------|
| `status_history` | История состояний ТС из Excel |

**Схема `geo`:**
| Таблица | Назначение |
|---------|-----------|
| `objects` | Строительные объекты (PostGIS) |
| `zones` | Геозоны объектов (PostGIS) |
| `zone_tags` | Теги зон (dt_loading, dt_unloading, dt_boundary, dt_onsite, dst_zone) |

### SQLite → `tyagachi/archive.db`
| Таблица | Назначение |
|---------|-----------|
| `vehicles` | Справочник тягачей |
| `tracked_requests` | Заявки + иерархия |
| `pl_records` | Путевые листы |
| `sync_log` | Журнал синхронизаций |
| `shift_cache` | Кэш мониторинга по сменам |

---

## 11. Ключевые алгоритмы

| Алгоритм | Файл | Суть |
|----------|------|------|
| КИП расчёт | `kip/.../kpiCalculator.ts` | load_pct × utilization_pct |
| Геозонный анализ (КИП) | `kip/.../geozoneAnalyzer.ts` | Turf.js point-in-polygon; fallback: total_stay_time = engineOnTime |
| Сплит смен | `kip/.../shiftSplitter.ts` | 07:30–19:30 / 19:30–07:30 |
| TripBuilder (самосвалы) | `dump-trucks/.../tripBuilder.ts` | ZoneEvent[] → пары loading→unloading |
| ObjectDetector | `dump-trucks/.../zoneAnalyzer.ts` | Объект = max GPS-точек в dt_boundary |
| WorkTypeClassifier | `dump-trucks/.../workTypeClassifier.ts` | delivery / onsite / unknown |
| isBroken | `vehicle-status/.../sheetsSyncService.ts` | «требует ремонта» = исправен (!) |

---

## 12. Как взаимодействовать с оператором

### Перед началом задачи:
1. Уточни требования если что-то неясно
2. Предложи план действий (какие файлы менять, как)
3. Дождись одобрения

### В процессе:
1. Если нашёл проблему / несоответствие — сообщи
2. Если задача оказалась сложнее чем ожидалось — сообщи
3. Если нужно менять файлы вне scope задачи — спроси

### После завершения:
1. Предоставь отчёт (формат в разделе 7)
2. НЕ пуши — жди одобрения
3. Будь готов к ревью и правкам

---

## 13. Quick Reference — Команды

```bash
# Статус проекта
git status && git log --oneline -5

# Запуск всех сервисов
npm run dev                          # из корня

# Запуск по отдельности
cd frontend && npm run dev           # :5173
cd kip && npm run dev:server         # :3001
cd dump-trucks/server && npm run dev # :3002
cd vehicle-status/server && npm run dev # :3004
cd geo-admin/server && npm run dev   # :3003

# Тягачи (Python)
cd tyagachi && python main.py --web --port 8000

# PostgreSQL (Windows — единый порт 5432)
psql -d kip_vehicles                 # КИП
psql -d mstroy                       # Самосвалы, VS, Geo

# Ручной pipeline
curl -X POST "http://localhost:3001/api/admin/fetch?date=2026-04-13"     # КИП
curl -X POST "http://localhost:3002/api/dt/admin/fetch?date=2026-04-13&shift=shift1" # ДСТ
```

---

## 14. Чеклист перед первой задачей

- [ ] Прочитал `NAVIGATION.md` полностью
- [ ] Прочитал все 7 файлов `HISTORY.md`
- [ ] Прочитал все 7 файлов `DEVGUIDE.md`
- [ ] Прочитал `dump-trucks/CLAUDE.md` (и любые другие `CLAUDE.md`)
- [ ] Проверил `git status` и `git branch`
- [ ] Понял структуру `frontend/src/features/`
- [ ] Понял что AI Reports заморожен и его не трогать
- [ ] Готов создать ветку для задачи

---

*Документ подготовлен Claude (Opus) для онбординга агента-коллаборатора. Дата: 2026-04-13.*
