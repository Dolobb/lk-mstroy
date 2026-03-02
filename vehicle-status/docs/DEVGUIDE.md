# Vehicle Status — Руководство

## Руководство пользователя

### Основной сценарий

1. Открыть ЛК Мстрой → нажать кнопку «Состояние ТС» (иконка гаечного ключа) в правом углу
   верхней навигации.
2. Страница загружается с последними данными из базы.
   Если данных нет — таблица пустая, появляется подсказка «Нет данных. Нажмите Синхронизировать».
3. Нажать кнопку **«Синхронизировать»** (правый верхний угол страницы):
   - Кнопка блокируется, появляется вращающаяся иконка и текст «Синхронизация…».
   - Сервер в фоне скачивает актуальный `.xlsx` из Google Drive и обновляет базу.
   - Когда sync завершится — таблица автоматически обновится, покажется время синхронизации.
   - Если через 60 секунд sync не завершился — кнопка разблокируется принудительно.
4. Просмотр данных:
   - Строки с красноватым фоном — машины **в ремонте** (бейдж «В ремонте»).
   - Строки без фона — исправные машины (показываются только если у них была история ремонта).
   - Колонка «Дней» красным шрифтом — количество дней текущего ремонта.
5. Фильтрация:
   - Переключатель **«Все / В ремонте»** — показать все записи или только активные ремонты.
   - Выпадающий список **«Все категории»** — фильтр по типу техники.
   - Кнопка **«Сбросить»** появляется при активном фильтре.

### Описание колонок таблицы

| Колонка | Описание |
|---------|---------|
| Гос. № | Государственный номер ТС (всегда заглавными буквами) |
| Категория | Тип техники (название вкладки Excel) |
| Тех. состояние | Текст из ячейки Excel в момент последней проверки |
| Статус | «В ремонте» / «Исправен» |
| Начало | Дата первой фиксации поломки |
| Конец | Дата восстановления (пусто если ремонт ещё не закрыт) |
| Дней | Количество дней ремонта (от начала до конца или до сегодня) |
| Проверка | Дата последнего успешного sync для этой машины |

### Возможные проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| «Синхронизация…» не завершается | Сервер vehicle-status не запущен | Запустить `npm run dev` в `vehicle-status/server/` |
| «API error: 502» при загрузке | Сервер недоступен | Проверить, что сервер запущен на порту 3004 |
| Sync завершился, но таблица пустая | Первый запуск, нет данных о ремонтах | Это нормально — в базу пишутся только машины в ремонте |
| Ошибки sync: «Tab "X": not found» | Вкладка переименована в Excel-файле | Обновить `sheetName` в `SHEET_TABS` (см. раздел «Как добавить вкладку») |
| Ошибки sync: «Failed to download file» | Нет доступа к Google Drive | Проверить `creds.json`, расшаренность файла на сервисный аккаунт |
| После рестарта сервера время sync сброшено | Sync state хранится в памяти процесса | Это ожидаемое поведение MVP |

---

## Руководство разработчика

### Запуск

```bash
cd /Users/max/Documents/Mstroy/lk-mstroy/vehicle-status/server/
npm install
npm run migrate   # создать схему vehicle_status + таблицу status_history
npm run dev       # Express на :3004
```

Фронтенд запускается отдельно:
```bash
cd /Users/max/Documents/Mstroy/lk-mstroy/frontend/
npm run dev       # Vite на :5173
```

### Конфигурация

Нужен файл `vehicle-status/server/creds.json` — Google Service Account JSON.
Этот файл НЕ коммитится (в `.gitignore`).

Как получить:
1. Google Cloud Console → IAM & Admin → Service Accounts → создать аккаунт
2. Создать JSON-ключ → скачать → сохранить как `vehicle-status/server/creds.json`
3. Открыть `.xlsx`-файл в Google Drive → «Поделиться» → добавить `client_email` из `creds.json`
   с правами «Читатель»

### Переменные окружения (vehicle-status/server/.env)

| Переменная | Значение по умолчанию | Обязательная | Описание |
|-----------|----------------------|-------------|---------|
| `GOOGLE_CREDS_PATH` | — | Да | Путь к `creds.json` относительно `server/`. Обычно просто `creds.json` |
| `GOOGLE_SHEET_ID` | — | Да | ID файла в Google Drive (из URL: `/d/{ID}/edit`) |
| `DB_HOST` | `localhost` | Нет | Хост PostgreSQL |
| `DB_PORT` | `5433` | Нет | Порт PostgreSQL 17 (не 5432!) |
| `DB_NAME` | `mstroy` | Нет | Имя БД |
| `DB_USER` | `postgres` | Нет | Пользователь БД (в проекте используется `max`) |
| `DB_PASSWORD` | `''` | Нет | Пароль БД |
| `VS_SERVER_PORT` | `3004` | Нет | Порт сервера |

Пример `.env`:
```
GOOGLE_CREDS_PATH=creds.json
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
DB_HOST=localhost
DB_PORT=5433
DB_NAME=mstroy
DB_USER=max
DB_PASSWORD=yourpassword
VS_SERVER_PORT=3004
```

### Файловая структура сервера

```
vehicle-status/server/
├── creds.json              ← Google Service Account (НЕ коммитить!)
├── .env                    ← переменные окружения
├── package.json
├── tsconfig.json
├── migrations/
│   └── 001_vehicle_status.sql   ← DDL схемы и таблицы
└── src/
    ├── index.ts            ← Express :3004, HTTP endpoints, in-memory sync state
    ├── migrate.ts          ← CLI: npm run migrate (читает migrations/*.sql)
    ├── config/
    │   ├── env.ts          ← getEnvConfig() — синглтон конфигурации
    │   └── database.ts     ← getPool() — PostgreSQL pool-синглтон (max: 10 соединений)
    ├── services/
    │   └── sheetsSyncService.ts  ← runSync(): Drive API → SheetJS → upsert
    └── repositories/
        └── vehicleStatusRepo.ts  ← SQL-запросы: findOpenRepair, insertRepair,
                                     updateRepairProgress, closeRepair, queryAll
```

### Как добавить новую вкладку Excel

1. Запустить sync — в ошибках придёт `Tab "X": not found. Available: A, B, C, ...`.
   Из списка `Available` взять точное имя нужной вкладки.
2. В файле `vehicle-status/server/src/services/sheetsSyncService.ts` добавить строку в `SHEET_TABS`:
   ```typescript
   { sheetName: 'ИмяВФайле', displayName: 'Читаемое/Название' }
   ```
3. В файле `frontend/src/features/vehicle-status/VehicleStatusPage.tsx` добавить `displayName`
   в массив `CATEGORIES`:
   ```typescript
   const CATEGORIES = [
     ...
     'Читаемое/Название',
   ];
   ```
4. Убедиться, что в новой вкладке Excel есть колонки `Гос. №` и `Тех. состояние`
   (поиск регистронезависимый, `тех.*состояние` — по prefixMatch).

### Как добавить новое поле в таблицу

1. Создать файл `vehicle-status/server/migrations/002_add_field.sql`:
   ```sql
   ALTER TABLE vehicle_status.status_history ADD COLUMN IF NOT EXISTS new_field TEXT;
   ```
2. Запустить `npm run migrate` — миграция применится автоматически.
3. Обновить `vehicleStatusRepo.ts`:
   - Добавить поле в `INSERT` в `insertRepair()`
   - Добавить поле в `SELECT` в `queryAll()`, маппинг в return
4. Обновить интерфейс `StatusRecord` в `vehicleStatusRepo.ts` и в `frontend/src/features/vehicle-status/types.ts`.
5. Отобразить поле в `VehicleStatusPage.tsx` (добавить в `<th>` и `<td>`).

### Как добавить автосинхронизацию

В файле `vehicle-status/server/src/index.ts` после запуска сервера:
```typescript
import cron from 'node-cron';

// Запуск каждый день в 09:00
cron.schedule('0 9 * * *', () => {
  if (!syncInProgress) {
    syncInProgress = true;
    runSync().then(result => {
      lastResult = result;
      lastSync = new Date().toISOString();
    }).finally(() => {
      syncInProgress = false;
    });
  }
});
```

Установить зависимость: `npm install node-cron && npm install -D @types/node-cron`.

### Отладка

**Проверить подключение к БД:**
```bash
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy -U max \
  -c "SELECT COUNT(*) FROM vehicle_status.status_history;"
```

**Запустить sync вручную через curl:**
```bash
curl -X POST http://localhost:3004/api/vs/vehicle-status/sync
# Сразу ответит { "status": "started" }

# Через 5-10 секунд проверить результат:
curl http://localhost:3004/api/vs/vehicle-status/sync-status
```

**Посмотреть логи сервера** — при успешном sync выводит:
```
[Sync] Done: processed=248 errors=0
```

**Узнать реальные имена вкладок в файле** — после первого sync с несуществующей вкладкой
в ошибках будет: `Tab "X": not found. Available: Стягачи, ДСТ  МС11 , ...`

**Проверить health:**
```bash
curl http://localhost:3004/api/vs/health
# { "status": "ok", "service": "vehicle-status", "time": "2026-02-27T..." }
```

**Проверить данные через API:**
```bash
# Все записи
curl "http://localhost:3004/api/vs/vehicle-status"

# Только в ремонте
curl "http://localhost:3004/api/vs/vehicle-status?isRepairing=true"

# По категории
curl "http://localhost:3004/api/vs/vehicle-status?category=ДСТ%20МС11"
```

### psql — прямые запросы к БД

```bash
/usr/local/opt/postgresql@17/bin/psql -p 5433 -d mstroy -U max

-- Текущие ремонты
SELECT plate_number, category, status_text, date_start, days_in_repair
FROM vehicle_status.status_history
WHERE is_repairing = TRUE
ORDER BY days_in_repair DESC;

-- Статистика по категориям
SELECT category, COUNT(*) as total_records,
       SUM(CASE WHEN is_repairing THEN 1 ELSE 0 END) as currently_repairing
FROM vehicle_status.status_history
GROUP BY category;
```

---

## Ссылки

- Исходное описание архитектуры (legacy): `vehicle-status/GUIDE.md`
- БД: схема `vehicle_status` в `mstroy` (PostgreSQL 17, порт 5433)
- Сервер: `vehicle-status/server/src/`
- Фронтенд: `frontend/src/features/vehicle-status/`
- Документация pipeline: `vehicle-status/docs/PIPELINE.md`
- Документация фронтенда: `vehicle-status/docs/FRONTEND.md`
