# Задачи для разработчика (Python / tyagachi)

**«Тягачи»** (`tyagachi/`) — это Python-часть монорепо
«ЛК Мстрой». Ниже: как устроена работа с проектом и два конкретных ТЗ.

## 0. Общие инструкции по работе с проектом

### 0.1. Что это за проект
Монорепо из нескольких сервисов. Ты работаешь **только** в папке `tyagachi/` (Python / FastAPI + SQLite,
порт 8000)
возможно в `dump-trucks/scripts/` (служебные Python-скрипты). Остальное —
фронтенд на React/TypeScript и другие бэкенды на Node

### 0.2. Git — рабочий процесс
1. **Каждая задача — отдельная ветка.** Не коммить в `main`.
   Имя ветки: `feat/tyagachi-auto-sync` или `feat/tyagachi-excel-export` (по смыслу задачи).
   ```bash
   git checkout main
   git pull
   git checkout -b feat/tyagachi-excel-export
   ```
2. Коммить маленькими логичными шагами. Сообщение коммита — на русском, в формате:
   `feat(tyagachi): экспорт заявки в Excel` / `fix(tyagachi): ...` / `chore(tyagachi): ...`.
3. Когда задача готова — **не мёржи сам**. Запушь ветку и сообщи, что готово к ревью.
   ```bash
   git push -u origin feat/tyagachi-excel-export
   ```
4. Перед пушем проверь `git status` — не должно быть случайно добавленных файлов
   (особенно `config.yaml`, `archive.db`, содержимое `Data/`).

### 0.3. Секреты — что завести у себя локально
Чтобы сервис вообще заработал, нужен файл `tyagachi/config.yaml`. Его **нет в git** (он в `.gitignore`,
там лежат боевые API-токены) — поэтому после клонирования его у тебя не будет, сервис упадёт.

Что сделать:
1. Скопируй шаблон в рабочий конфиг (он уже лежит в репо):
   ```bash
   cd tyagachi
   cp config.example.yaml config.yaml
   ```
2. Открой `config.yaml` и заполни **TIS API токены** — это и есть единственный секрет, который тебе нужен:
   ```yaml
   api:
     base_url: "https://tt.tis-online.com/tt/api/v3"   # оставь как есть
     token: "<ОСНОВНОЙ_ТОКЕН>"        # ← попроси у меня
     tokens:                          # ← список токенов для параллельных запросов
       - "<ТОКЕН_1>"
       - "<ТОКЕН_2>"
       # ... остальные токены дам отдельным сообщением
   ```
   - `token` — основной (обязателен).
   - `tokens` — список дополнительных; ускоряют загрузку (лимит TIS привязан к паре токен+машина).
     Полный список (их много) пришлю тебе **в личку / в зашифрованном виде, не в чат и не в git**.
   - Остальные секции (`paths`, `parsing`, `logging`) **не трогай** — оставь как в шаблоне.
3. Токены тебе передам я лично. **Никогда** не вставляй их в код, в коммиты, в README, в скриншоты
   и не пересылай в открытых каналах.

> Других секретов у тягачей нет: ни БД-паролей (SQLite — локальный файл), ни Google-кредов
> (это в другом сервисе). Только `config.yaml` с TIS-токенами.

⚠️ Проверь, что `config.yaml` **не попадает** в коммиты: `git status` не должен его показывать
(он уже в `.gitignore`). Если вдруг видишь его в `git status` — останови и скажи мне, не коммить.

### 0.5. Как запускать
Python на этой машине запускается через админ-панель (она сама находит `python.exe` и поднимает все сервисы).
Для локальной разработки тягачей достаточно:
```bash
cd tyagachi
pip install -r requirements.txt        # после изменения зависимостей
python main.py --web --port 8000       # FastAPI на http://localhost:8000
```
Если меняешь `requirements.txt` или `config.yaml` — изменения подхватятся **после перезапуска сервиса
через Admin UI** (`http://localhost:5173/admin`), а не правкой из консоли в проде.

**Если сервис падает при старте** (exit code 1, нет сообщений в консоли): скорее всего не установлены
зависимости Python. Проверить:
```bash
python -c "import fastapi; import uvicorn; import pandas; print('OK')"
# Если ModuleNotFoundError — установить:
pip install -r requirements.txt
```
Если `python` не находится вообще (`command not found`) — убедись, что Python 3.9+ установлен и
добавлен в PATH (`where python` в PowerShell на Windows).

### 0.6. Где искать информацию (порядок!)
Прежде чем читать исходники — загляни в документацию, она написана чтобы не тратить время:
1. `tyagachi/docs/DEVGUIDE.md` — запуск, endpoints, модели БД, отладка.
2. `tyagachi/docs/PIPELINE.md` — как устроен пайплайн и матчинг.
3. `tyagachi/docs/HISTORY.md` — что уже сделано и какие ограничения.
Только потом — сам код.

### 0.7. База данных (для отладки)
SQLite, файл `tyagachi/archive.db`. Основная таблица — `tracked_requests`,
ключевое поле `matched_data_json` (JSON со всеми сматченными данными заявки).
```bash
sqlite3 archive.db ".tables"
sqlite3 archive.db "SELECT request_number, stability_status FROM tracked_requests LIMIT 10;"
```

### 0.8. Definition of Done (для любой задачи)
- Код в отдельной ветке, запушен, секреты/данные не закоммичены.
- Выполнены все «Критерии приёмки» из ТЗ.
- Сервис запускается без ошибок (`python main.py --web --port 8000`).
- Существующая функциональность не сломана (ручной sync, открытие отчётов).
- Если что-то непонятно — **спроси до того, как делать**, а не после.

---

## ТЗ-1. Автоматическая ежедневная синхронизация (APScheduler)

### Контекст
Сейчас синхронизация запускается **только вручную** — кнопкой «Синхронизировать» в UI, которая
дёргает `POST /api/sync`. Нужно, чтобы сервис сам раз в сутки запускал sync за последние несколько дней.

### Где что лежит
| Файл | Что там |
|------|---------|
| `src/web/server.py` | FastAPI-приложение (`app = FastAPI(...)`, ~строка 44). Endpoint `POST /api/sync` (~1188) и фоновая функция `run_sync_pipeline(from_pl, to_pl)` (~1346) |
| `src/web/sync.py` | `sync_vehicle_data(period_from_pl, period_to_pl, db, ...)` — весь пайплайн |
| `config.yaml` | конфиг (секрет, не в git). Сюда добавить настройки расписания |
| `requirements.txt` | добавить `apscheduler` |
| `main.py` | CLI точка входа, режим `--web` поднимает uvicorn |

### Задача
1. Добавить `apscheduler>=3.10` в `requirements.txt`, выполнить `pip install -r requirements.txt`.
2. В `server.py` поднять планировщик на старте приложения (FastAPI startup-хук / lifespan).
   Использовать `BackgroundScheduler` (или `AsyncIOScheduler`).
3. Зарегистрировать **одну cron-задачу** (раз в сутки в заданное время), которая вызывает уже
   существующую `run_sync_pipeline(from_pl, to_pl)`.
   - Период считать как в `POST /api/sync` (~строки 1206–1209):
     `to_pl = сегодня`, `from_pl = сегодня − period_days`.
   - `period_days` для авто-режима брать из конфига (по умолчанию **3**).
4. **Защита от наложений (обязательно):** перед запуском проверять `sync_status['running']`
   под `sync_lock`. Если sync уже идёт — пропустить запуск и записать в лог, **не падать**.
5. Настройки вынести в `config.yaml`, новая секция:
   ```yaml
   scheduler:
     enabled: true        # можно выключить авто-синк
     time: "05:30"        # время ежедневного запуска (локальное)
     period_days: 3       # за сколько дней синхронизировать
   ```
   `scheduler.enabled: false` → планировщик не регистрирует задачу.
6. Лог-строка при каждом авто-запуске и при пропуске (логгер `'sync'` уже есть в `sync.py`).

### Критерии приёмки
- При старте `python main.py --web --port 8000` в логе видно, что планировщик поднялся, и показано
  время следующего запуска.
- В заданное время автоматически отрабатывает тот же пайплайн, что и кнопка «Синхронизировать»;
  в БД появляется новая запись: `sqlite3 archive.db "SELECT * FROM sync_log ORDER BY id DESC LIMIT 3;"`.
- Если в момент срабатывания идёт ручной sync — авто-запуск пропускается с записью в лог, без ошибок.
- `scheduler.enabled: false` полностью отключает авто-синк.
- Ручной `POST /api/sync` продолжает работать как раньше.

### Как проверить локально
- Поставить в конфиге `time` на «через 2 минуты» и убедиться, что задача отработала.
- Защита от наложений: запустить ручной sync кнопкой и дождаться авто-срабатывания → должно быть «пропущено».

### Подводные камни
- Один воркер uvicorn (так и запускает админка) — планировщик в единственном экземпляре, это ок.
  Не добавлять `--workers`.
- **Синк идёт медленно — это норма.** TIS API ограничивает до 1 запроса в 30 секунд на одну машину
  (точнее: на пару `(токен, idMO)`). При синке за 3 дня с 20+ тягачами — суммарно это несколько минут.
  Не пытайся «ускорить» параллельными запросами — ограничение на стороне TIS, за нарушение банят токен.

---

## ТЗ-2. Экспорт заявки в Excel (openpyxl)
### Контекст
Сейчас по заявке можно открыть только HTML-отчёт (`GET /api/request/{number}/report`).
Нужен выгружаемый **Excel** по заявке — открыть в таблице / переслать.

### Где что лежит
| Файл | Что там |
|------|---------|
| `src/web/server.py` | сюда добавить новый endpoint. Образец чтения данных — `GET /api/request/{request_number}/report` (~1277) и `/data` (~1312) |
| `src/web/models.py` | модель `TrackedRequest`, поле `matched_data_json` |
| `requirements.txt` | добавить `openpyxl` |
| `src/output/excel_export.py` | **создать** — новый модуль генерации .xlsx (НЕ трогать html_generator) |

### Источник данных
Как в `/report`: берём `TrackedRequest.matched_data_json` по `request_number` — это список dict-ов
(одна строка = один сматченный ПЛ). Доступные поля в каждой записи:
`request_number`, `request_status`, `stability_status`, `route_start_address`, `route_end_address`,
`route_start_date`, `route_end_date`, `route_distance`, `object_expend_code`, `object_expend_name`,
`order_name_cargo`, `pl_id`, `pl_ts_number`, `pl_date_out`, `pl_date_out_plan`, `pl_date_in_plan`,
`pl_status`, `ts_reg_number`, `ts_name_mo`, `ts_id_mo` + поля мониторинга (`mon_distance` и т.п., если есть).

### Задача
1. Добавить `openpyxl>=3.1` в `requirements.txt`, `pip install`.
2. Создать `src/output/excel_export.py` с функцией:
   ```python
   def build_request_workbook(request_number: int, matched_records: list[dict]) -> "openpyxl.Workbook":
       ...
   ```
   - Лист **«Заявка»** — общие поля (номер, статус, маршрут, объект затрат, груз, плановое расстояние).
   - Лист **«Путевые листы»** — таблица, одна строка на ПЛ. Колонки: ПЛ №, госномер ТС, название ТС,
     дата выезда (план/факт), дата возврата, статус ПЛ, факт. пробег (`mon_distance`) и т.д.
   - Заголовки жирным, разумная ширина колонок, даты — текстом в `DD.MM.YYYY HH:MM` (не пересчитывать).
3. В `server.py` добавить endpoint `GET /api/request/{request_number}/export`:
   - Читает `matched_data_json` (404, если заявки/данных нет — как в `/report`).
   - Вызывает `build_request_workbook`, сохраняет в `BytesIO`, отдаёт через `StreamingResponse`:
     `media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`,
     заголовок `Content-Disposition: attachment; filename="request_{number}.xlsx"`.
4. (Опционально, если останется время) кнопка «Скачать Excel» рядом с заявкой в legacy-дашборде
   `server.py`. **Основное — рабочий endpoint.**

### Критерии приёмки
- `GET /api/request/{существующий_номер}/export` отдаёт валидный .xlsx, открывается в Excel/LibreOffice.
- Два листа; данные совпадают с HTML-отчётом по той же заявке.
- Кириллица не ломается.
- Несуществующая заявка / заявка без `matched_data_json` → корректный 404 с понятным сообщением.

### Как проверить локально
- Найти заявку с данными:
  `sqlite3 archive.db "SELECT request_number FROM tracked_requests WHERE matched_data_json IS NOT NULL LIMIT 5;"`.
- Открыть `http://localhost:8000/api/request/{number}/export` в браузере → скачается xlsx.

### Подводные камни
- `matched_data_json` может содержать `None`/пустые поля — везде `.get(...)`, не падать на отсутствующих ключах.
- Новый код и зависимости подхватятся после перезапуска сервиса через Admin UI.
