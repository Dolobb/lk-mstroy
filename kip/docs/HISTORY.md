# KIP — История и Возможности

## Что реализовано

### Бэкенд (kip/server/)

- Полный TIS API клиент с ротацией 18 токенов round-robin (`tisClient.ts`, `tokenPool.ts`)
- Per-vehicle rate limiter: 1 запрос/30с на `idMO` (`rateLimiter.ts`)
- Retry-логика: 429 → линейный backoff до 5 попыток; таймаут → экспоненциальный до 3 попыток
- Pipeline: ПЛ (7 дней) + заявки (2 месяца) + мониторинг → расчёт КИП → PostgreSQL
- ShiftSplitter: разбивка периода ПЛ на смены (утро 07:30–19:30, вечер 19:30–07:30)
- GeozoneAnalyzer: point-in-polygon через Turf.js, анализ времени в рабочих зонах
- KpiCalculator: расчёт утилизации, загрузки, расхода топлива
- Vehicle Registry: ~170 ТС, фильтрация + нормы топлива + тип/филиал
- PostgreSQL upsert: `ON CONFLICT DO UPDATE` для всех таблиц
- DailyFetchJob: автоматический сбор в 07:30 Asia/Yekaterinburg (node-cron)
- Ручной запуск pipeline: `POST /api/admin/fetch?date=YYYY-MM-DD`
- Каскадные фильтры: API `/api/filters` с поддержкой branch/type
- Интерливинг задач по idMO для оптимизации rate limiting

### Фронтенд (kip/client/)

- React 18 + Tailwind CSS v4 + Vite (hot reload, сборка в dist/)
- Leaflet карта с MarkerClusterGroup, маркеры-"пилюли" с госномером
- Цветовые маркеры по КИП (RED/BLUE/GREEN)
- FlyTo при выборе ТС, deselect при клике на пустое место
- Геозоны на карте (GeoJSON слой, полупрозрачные полигоны)
- Трек выбранного ТС (упрощённый, синяя пунктирная линия)
- FilterPanel: период (пресеты + date picker), смена, филиал, тип ТС, СМУ
- Поиск ТС по госномеру (React Portal, живой поиск)
- KPI диапазоны: multi-toggle для фильтрации по диапазонам КИП
- Средний КИП: агрегат по всем загруженным ТС
- VehicleDetailTable: pivot-таблица КИП/нагрузка по дням/сменам
- DetailPanel: карточка ТС + навигатор заявок
- Диалог "Все параметры": полная таблица со всеми расчётными полями
- Скрытие TopNavBar в iframe-режиме, автоматическая вкладка 'dst'
- Single-port serving: Express раздаёт и API, и React build на :3001

### Инфраструктура

- npm workspaces монорепо (client + server)
- TypeScript на обеих сторонах
- PostgreSQL миграции (src/migrate.ts + migrations/*.sql)
- Docker Compose конфигурация (db + server + client)
- .env.example с описанием переменных

---

## История изменений

### Версия 1: MUI + CRA (исходная)
- Изначальный стек: Material UI + Create React App
- Отдельный порт для клиента

### Миграция: MUI+CRA → Tailwind+Vite
- Полная переработка фронтенда: Material UI заменён на Tailwind CSS v4 + shadcn/ui
- CRA заменён на Vite (значительно быстрее сборка и hot-reload)
- Убраны зависимости от MUI компонентов, добавлены shadcn/ui Table, Dialog
- Переработан UI: тёмная тема, glass-card стиль, compact layout

### Реструктуризация в монорепо lk-mstroy
- Проект КИП (`kip/`) стал подпроектом единого монорепо `lk-mstroy/`
- Добавлен единый фронтенд-оболочка (`frontend/`) с iframe-интеграцией КИП
- kip/client патч: обнаружение iframe (`window !== window.parent`) → скрытие навбара + старт с 'dst'

### Добавлены функции (по мере разработки)
- Weekly aggregated API endpoint (`/api/vehicles/weekly`) — агрегация за период вместо одной даты
- MarkerClusterGroup для карты — кластеризация маркеров при малом масштабе
- Поиск ТС в FilterPanel через React Portal
- KPI диапазоны в FilterPanel — фильтрация по диапазонам утилизации
- Каскадные фильтры: при выборе Филиала → сброс фильтра СМУ
- GeozoneLayer на карте — отображение рабочих площадок
- Трек ТС на карте — polyline из track_simplified
- Диалог "Все параметры" — полная детализация в модальном окне

---

## Что можно получить из текущей архитектуры

| Возможность | Сложность | Основание |
|------------|-----------|-----------|
| Алерты при КИП < X% (email/webhook) | Низкая | Добавить проверку после upsert в dailyFetchJob |
| Экспорт в Excel/CSV | Низкая | Новый GET endpoint + библиотека xlsx |
| Исторические графики КИП по ТС | Низкая | Данные уже есть в vehicle_records, нужен D3/recharts |
| Сравнение смен (утро vs вечер) | Низкая | Данные уже разбиты по сменам |
| Топ-N худших ТС по КИП | Низкая | ORDER BY utilization_ratio ASC LIMIT N |
| Детализация по конкретной геозоне (СМУ) | Средняя | zoneBreakdown уже считается, нужно сохранять в БД |
| Ретроспективный пересчёт (изменение норм) | Средняя | Pipeline можно запустить вручную за любую дату |
| Dashboard с агрегатами по компании/филиалу | Средняя | Добавить GROUP BY company_name/branch в API |
| Отчёт по расходу топлива vs норма | Низкая | Поля fuel_rate_fact, fuel_rate_norm уже в БД |
| Push-уведомления в браузере | Средняя | Web Push API + Service Worker |

---

## Что ограничено архитектурой

| Ограничение | Причина | Обходной путь |
|-------------|---------|---------------|
| Нет real-time обновлений | Polling-based pipeline, не стриминг | WebSocket или Server-Sent Events поверх /api/admin/fetch |
| Геозоны — только polygon, не multipolygon | Turf.js фильтр `type === 'Polygon'` | Добавить обработку MultiPolygon |
| Fallback КИП=100% для ТС без GPS | Архитектурное решение (не ошибка) | Хранить флаг `geozone_matched: bool` в vehicle_records |
| Нормы топлива — одно значение на ТС | vehicle-registry.json — одно поле fuelNorm | Добавить сезонные/режимные нормы |
| Точность 50/50 при пересечении границы | Интерполяция по точкам трека | Более частый трек (но TIS API не позволяет) |
| Интерливинг задач — sequential, не parallel | Rate limit 30с/ТС, параллелить нет смысла | С 18 токенами теоретически можно параллелить по токенам |
| Фильтрация branch/type в памяти | Эти поля не в БД, только в JSON | Денормализовать в vehicle_records при upsert |
| vehicle-registry.json — ручное обновление | Нет синхронизации с TIS API | Автоматически импортировать из ПЛ при первом появлении |
