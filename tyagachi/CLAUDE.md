# CLAUDE.md — Тягачи (tyagachi/)

## Команды

```bash
python main.py --web --port 8000                              # FastAPI сервер
python main.py --fetch --from DD.MM.YYYY --to DD.MM.YYYY     # CLI: загрузить данные
python main.py --fetch \
    --from-req 01.12.2025 --to-req 31.01.2026 \
    --from-pl  01.02.2026 --to-pl  28.02.2026                # раздельные периоды
python main.py --html-only                                    # перегенерировать HTML без fetch

pip install -r requirements.txt
```

Конфигурация: `config.yaml` — `api.token`, `api.tokens` (список), `paths.*`

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `src/output/html_generator_v2.py` | **ОСНОВНОЙ** (~4600 строк): HTML-отчёт, CSS, JS |
| `src/web/server.py` | FastAPI endpoints |
| `src/web/sync.py` | Pipeline синхронизации |
| `src/web/models.py` | SQLAlchemy: Vehicle, TrackedRequest, PLRecord, SyncLog |
| `src/api/client.py` | TIS API клиент (Python) |
| `src/parsers/pl_parser.py` | Парсинг ПЛ + extract_request_number |
| `main.py` | CLI точка входа |

### Ключевые функции html_generator_v2.py

| Функция | ~Строка | Назначение |
|---------|---------|-----------|
| `build_hierarchy()` | 100 | matched_data_json → иерархия для отчёта |
| `generate_html_report()` | 200 | Точка входа генерации |
| `_build_request_card_v2()` | 4080 | Карточка заявки (3 колонки) |
| `_build_vehicle_fact_panel_v2()` | 4403 | Правая панель (факт/смены/топливо) |
| `_build_pl_html()` | 4525 | HTML одного путевого листа |

## ⚠️ Gotchas

**Стабильность заявок**: `SUCCESSFULLY_COMPLETED` → `stable` — данные **не перезаписываются** при sync. Остальные статусы обновляются каждый раз.

**html_generator_v2.py — монолит**: CSS-переменные и JS-обработчики разбросаны по всему файлу. Изменение в одной функции может сломать другую. Искать зависимости по всему файлу.

**extract_request_number**: regex `^(\d+)` из `orderDescr` — может давать ложные совпадения на любые 3+ цифры в начале строки. Прямая связь через `pl_calcs.id_order` надёжнее (ещё не внедрена).

**Фильтр статусов ПЛ**: `NOTUSED` и `GIVED_BACK` исключаются при парсинге. Если ПЛ не появляется — проверить статус.

**Периоды заявок vs ПЛ**: заявки создаются за 1–3 месяца до ПЛ. Одинаковые периоды → 0% совпадений.

**Откат на V1** (при критической ошибке в V2):
```python
# В main.py и src/web/server.py заменить:
from src.output.html_generator_v2 import ...
# На:
from src.output.html_generator import ...
```

## База данных

SQLite `archive.db`. Основная таблица: `tracked_requests` (поле `matched_data_json` — JSON со всей иерархией для V2 отчёта).

```bash
sqlite3 archive.db ".tables"
sqlite3 archive.db "SELECT request_number, stability_status, last_synced_at FROM tracked_requests ORDER BY last_synced_at DESC LIMIT 10;"
```

## Документация

- `docs/PIPELINE.md` — pipeline, алгоритм матчинга, схема БД
- `docs/FRONTEND.md` — React компоненты (TyagachiDashboard, TyagachiReportView)
- `docs/HISTORY.md` — что реализовано, ограничения, версии HTML-генератора
- `docs/DEVGUIDE.md` — FastAPI endpoints, SQLite модели, отладка
