# Tyagachi — История и Возможности

## Что реализовано

| Функция | Статус | Примечание |
|---------|--------|-----------|
| TIS API клиент (Python) | ✅ Работает | `src/api/client.py` |
| DataFetcher (оркестрация запросов) | ✅ Работает | `src/api/fetcher.py` |
| Парсер заявок (request_parser.py) | ✅ Работает | → requests_parsed.csv |
| Парсер путевых листов (pl_parser.py) | ✅ Работает | → pl_parsed.csv; фильтр NOTUSED, GIVED_BACK |
| Парсер мониторинга (monitoring_parser.py) | ✅ Работает | GPS трек + стоянки |
| Матчинг ПЛ ↔ Заявки | ✅ Работает | inner join по `extracted_request_number` |
| HTML-генератор V2 | ✅ Работает | `html_generator_v2.py` ~4600 строк, основной |
| HTML-генератор V1 | ⚠️ Legacy | `html_generator.py`, сохранён для отката |
| FastAPI backend (:8000) | ✅ Работает | Dashboard + Reports endpoints |
| SQLite хранение | ✅ Работает | `archive.db`: Vehicle, TrackedRequest, PLRecord, SyncLog |
| Логика стабильности заявок | ✅ Работает | SUCCESSFULLY_COMPLETED → stable (не перезаписывается) |
| Оптимизация мониторинга | ✅ Работает | `has_monitoring=True` → не перегружается для стабильных ПЛ |
| React фронтенд (Dashboard) | ✅ Работает | `frontend/src/features/tyagachi/TyagachiDashboard.tsx` |
| React фронтенд (ReportView) | ✅ Работает | `TyagachiReportView.tsx`: 3 колонки, react-leaflet |
| CLI режим (--fetch) | ✅ Работает | `python main.py --fetch --from DD.MM.YYYY --to DD.MM.YYYY` |
| Web режим | ✅ Работает | `python main.py --web --port 8000` |
| Посменная загрузка | ✅ Работает | `src/web/shifts.py` (07:30/19:30) |

---

## Что можно получить из текущей архитектуры

| Идея | Сложность | Что потребуется |
|------|-----------|----------------|
| Экспорт отчёта в PDF | Низкая | headless Chrome / wkhtmltopdf для HTML→PDF |
| Уведомление при завершении sync | Низкая | webhook или email по окончании `sync_vehicle_data()` |
| Фильтрация по объекту затрат | Низкая | фильтр по `object_expend_code` уже есть в TrackedRequest |
| Сравнение план/факт расстояния | Низкая | `route_distance` из заявки vs `mon_distance` из мониторинга — оба есть |
| История синхронизаций (графики) | Средняя | SyncLog уже пишется, нужен UI |
| Поиск заявки по машине | Средняя | PLRecord → Vehicle → TrackedRequest, нужен endpoint |
| Тепловая карта стоянок | Средняя | `mon_parkings` хранится, нужен Leaflet heatmap слой |
| Экспорт в Excel | Средняя | openpyxl + endpoint `/api/request/{number}/export` |
| Автоматическая ежедневная синхронизация | Средняя | APScheduler в FastAPI вместо ручного запуска |
| Нормативный расчёт (план vs факт топлива) | Высокая | нормы ТС нет в текущей схеме, нужна таблица |

---

## Что ограничено архитектурой

| Ограничение | Причина | Что потребуется для исправления |
|-------------|---------|--------------------------------|
| `matched_data_json` — весь JSON в одном поле | Денормализация для простоты генерации V2 отчёта | Нормализация: отдельные таблицы ПЛ/мониторинга, рефакторинг `build_hierarchy()` |
| `html_generator_v2.py` — монолит 4600 строк | Исторически: встроенные CSS/JS в Python-шаблон | Разбивка на шаблоны Jinja2 + отдельные CSS/JS файлы |
| Timeline пересекающиеся события | Алгоритм раскладки не учитывает overlap | Полный рефакторинг JS timeline (переход на d3.js или подобное) |
| SQLite → ограниченная конкурентность | Один writer, blocker при sync | Миграция на PostgreSQL (схема `tyagachi` в mstroy) |
| Regex матчинг ПЛ↔заявки | `extract_request_number` может дать ложные совпадения | Добавить прямое поле `id_order` из API (уже есть в КИП) |
| Нет пагинации в React dashboard | Все заявки загружаются разом | Cursor-based pagination в `/api/vehicles/{id}/requests` |

---

## Версии HTML-генератора

| Версия | Файл | Статус | Layout |
|--------|------|--------|--------|
| **V2** (текущий) | `src/output/html_generator_v2.py` | **ОСНОВНОЙ** | Трёхколоночный: ПЛ \| Карта+Timeline \| Факт-панель |
| V1 (legacy) | `src/output/html_generator.py` | Сохранён для отката | Вертикальный, карта по клику |

**Откат на V1:**
```python
# В main.py и src/web/server.py заменить:
from src.output.html_generator_v2 import generate_html_report, build_hierarchy
# На:
from src.output.html_generator import generate_html_report, build_hierarchy
```

---

## История изменений

### Январь 2026 — Создание проекта
- Проект назывался **TransportAnalytics**
- Исходная задача: парсинг CSV + матчинг заявок и ПЛ
- Первая версия: pandas pipeline → matched_output.csv

### Февраль 2026 — V2 и FastAPI

| Дата | Изменение |
|------|-----------|
| 2026-02-05 | Логика "расчётного плана" — длинные/короткие рейсы |
| 2026-02-16 | **V2 HTML генератор** — трёхколоночный layout (основной) |
| 2026-02-16 | Перенос в монорепо `lk-mstroy/tyagachi/` |
| 2026-02-24 | **React фронтенд**: TyagachiDashboard + TyagachiReportView |
| 2026-02-24 | FastAPI новые endpoints: `/api/vehicles`, `/api/sync`, `/api/request/{num}/data` |
| 2026-02-24 | SQLite модели: Vehicle, TrackedRequest, PLRecord, SyncLog |

---

## Перенесённая документация

Следующие файлы удалены, содержимое включено в docs/:

| Удалённый файл | Содержимое перенесено в |
|---------------|------------------------|
| `tyagachi/ARCHITECTURE.md` | HISTORY.md + PIPELINE.md + FRONTEND.md |
| `tyagachi/TECHNICAL_SPEC.md` | PIPELINE.md (схема данных, алгоритмы) |
| `tyagachi/README.md` | DEVGUIDE.md (инструкция пользователя) |
| `tyagachi/CLAUDE.md` | DEVGUIDE.md (раздел разработчика) |
| `tyagachi/docs/V2_LAYOUT_GUIDE.md` | FRONTEND.md (CSS классы, JS функции V2) |
| `tyagachi/docs/API_REQUEST_EXAMPLES.md` | PIPELINE.md (примеры TIS API) |
| `tyagachi/docs/API_MIGRATION_GUIDE.md` | Устаревший — не перенесён |
| `tyagachi/MIGRATION_GUIDE_2026-02.md` | Устаревший — не перенесён |

Остаются нетронутыми:
- `tyagachi/РАСЧЕТНЫЙ_ПЛАН_ЛОГИКА.md` — детальное описание логики расчётного плана (V1)
- `tyagachi/переработка hmtl.md` — заметки по переработке HTML-генератора
