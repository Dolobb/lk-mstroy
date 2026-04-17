# Admin UI Refactor — Interview Notes & Future Ideas

> Дата: 2026-04-15. Результат обсуждения текущих проблем admin panel.

## Выявленные проблемы

### 1. Coverage врёт
- SQL `SELECT DISTINCT report_date` возвращает "зелёный" если за дату есть **хоть 1 запись** из 200+ ТС
- Нет порога полноты: 5 ТС = зелёный, 200 ТС = зелёный
- Единственная строка с реальным порогом — "KIP raw" (monitoring_raw >=90%), непонятна пользователям
- Для самосвалов — та же проблема (бинарное "есть/нет")

### 2. 9 кнопок действий — непонятно какую нажимать
- fetch / force fetch / refresh / recalc × 2 сервиса + сегменты
- Разница между fetch, force, refresh, recalc — неочевидна даже разработчику
- Справка (info-секция) — стена текста, не решает проблему

### 3. Двойное исполнение
- При нажатии кнопки запускаются И pg-boss job И legacy queue
- legacy queue нужна только для `fetchProgress` state → UI polling
- Потенциально — двойной fetch одних и тех же данных

### 4. Дублирование cron
- pg-boss cron в admin/server.ts
- node-cron в kip/scheduler.ts и dump-trucks/scheduler.ts
- Три источника одних и тех же задач

### 5. Enhanced coverage API (GLM) не подключён к UI
- GET /api/admin/data-coverage/detailed готов (per-shift, per-vehicle)
- Фронтенд использует старый GET /api/admin/data-coverage

## Принятые решения (v1 — текущий спринт)

| Решение | Детали |
|---------|--------|
| Эталон ТС | MAX(count) за последние 7 дней как базовая линия |
| Блок дня | Компактная карточка: дата + КИП count + DT count + сегменты + цвет фона |
| Кнопки | Контекстные: показывать только релевантные для ситуации |
| Метрики | Счётчики: requested / success / error в pipeline_runs |
| Покрытие | Реальные числа: "156/162 ТС" вместо зелёного кружка |
| Cron | pg-boss как основной, scheduler.ts как fallback |
| Legacy queue | Проверить зависимости, по возможности убрать в пользу pg-boss |

## Идеи на будущее (записаны "карандашиком")

### A. Независимый Health-Checker
Отдельный сервис/cron который:
- Периодически (каждые 4 часа) проверяет полноту данных за последние 7 дней
- Сравнивает route_lists.vehicles vs vehicle_records (точный audit)
- Если находит дыры — автоматически дозагружает (auto-heal)
- Алертит (email/telegram) если проблема критическая (>10% ТС потеряно)
- Полностью независим от основного pipeline

### B. TIS API Audit Trail
После каждого fetch — сохранять:
- Сколько ТС было в route_lists для этой даты
- Сколько ТС реально запрошено в TIS API
- Сколько ответов получено / ошибок / таймаутов
- Сравнение: запрошено vs записано в БД
- Хранить в pipeline_runs.metadata

### C. Trend Dashboard
- Спарклайн за 14 дней: кол-во ТС по дням
- Видно просадки сразу (резкое падение count)
- Сравнение с moving average — аномалии подсвечиваются

### D. Data Quality Score
Единый "индекс здоровья" за день (0-100):
- 40%: vehicle count vs expected
- 20%: monitoring_raw coverage (КИП)
- 15%: segments coverage
- 15%: ghost vehicles (мало = хорошо)
- 10%: pipeline success rate

### E. Smart Auto-Retry
Если fetch для конкретного ТС не получил данных (TIS timeout/error):
- Поставить retry через 30 мин (а не всего дня)
- Максимум 3 retry
- Логировать: "ТС X: попытка 2/3, причина: TIS timeout"
