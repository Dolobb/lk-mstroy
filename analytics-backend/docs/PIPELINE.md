# Analytics Backend — Pipeline

Сервис аналитики треков и текущих позиций ТС. Порт 3007.

## Поток данных

```
TIS API (getMonitoringStats)
  ↓
TrackSimplifier (≤5 мин, <50м → skip)
  ↓
DwellExtractor (50м/5мин кластеры → dwell)
  ↓
analytics.track_sessions + analytics.track_points (PG17, mstroy)
  ↓
GET /api/analytics/tracks
```

## Схема данных (PG17, `mstroy`, схема `analytics`)

### `analytics.track_sessions`
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | uuid PK | Уникальный ID сессии |
| vehicle_id | varchar | Регномер ТС |
| date | date | Дата трека |
| shift | varchar | 'full', 'live', 'morning', 'evening' |
| fetched_at | timestamptz | Когда данные получены |
| source | varchar | 'pipeline' (cron) или 'live_tis' (on-demand) |

UNIQUE (vehicle_id, date, shift, source)

### `analytics.track_points`
| Колонка | Тип | Описание |
|---------|-----|----------|
| session_id | uuid FK | → track_sessions.id |
| ts | timestamptz | Момент времени точки |
| lat | float8 | Широта |
| lng | float8 | Долгота |
| speed | real? | Скорость км/ч |
| heading | smallint? | 0-359 градусов |
| engine_on | boolean? | Двигатель включен |
| motion_status | varchar? | 'moving', 'idle', 'dwell' |
| dwell_sec | int? | Длительность стоянки (только для dwell) |

PRIMARY KEY (session_id, ts)

### `analytics.schema_migrations`
| Колонка | Тип | Описание |
|---------|-----|----------|
| filename | varchar PK | Имя SQL-файла |
| applied_at | timestamptz | Когда применена |

## Источники данных

1. **TIS API** (`getMonitoringStats`) — основной источник треков для ДСТ
2. **KIP БД** (`kip_vehicles.vehicles`) — реестр ТС + idMO
3. **dump_trucks БД** — треки самосвалов (будет в Сессии 3)

## Стратегия live vs DB

- Запрос `GET /api/analytics/tracks` → проверка БД
- Данные есть → return из БД
- Данных нет → fetch из TIS → simplify → dwell → cache в БД (source='live_tis') → return
- Retention: ежедневно 02:00 UTC, DELETE WHERE date < now() - 7 days (CASCADE)

## Endpoints

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/analytics/health` | Health-check (503 при деградации) |
| GET | `/api/analytics/tracks` | Трек ТС за период (?vehicle&from&to) |
| GET | `/api/analytics/groups` | Группы ТС по посещённым объектам (?from&to) |
| GET | `/api/analytics/objects` | Список крупных объектов с `dt_boundary` и рабочими DT-зонами |
| GET | `/api/analytics/sidebar-summary` | Read-model карточек сайдбара объектов за период (?from&to) |
| POST | `/api/analytics/admin/fetch` | Ручной запуск pipeline (?date&force) |

### Sidebar summary

`GET /api/analytics/sidebar-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` возвращает карточки только для крупных объектов: объект должен иметь `dt_boundary` и одну из рабочих DT-зон (`dt_loading`, `dt_unloading`, `dt_onsite`).

Источники КИП:
- самосвалы: `dump_trucks.shift_records_active.kip_pct` по `object_uid`;
- ДСТ, краны, экскаваторы: `kip_vehicles.vehicle_records.utilization_ratio`, объект определяется через попадание `longitude/latitude` в `geo.zones` с тегом `dst_zone`.

Пустые группы остаются в ответе с `vehicleCount = 0` и `kipPct = null`; общий `kipPct` объекта равен `0`, если за период нет записей с КИП больше нуля.

## Алгоритмы

### TrackSimplifier
- Последовательный проход по точкам
- Первая и последняя — всегда сохраняются
- Если time_delta < 5 мин И distance < 50м → пропуск
- Если speed > 2 км/ч → всегда сохранять (движение)
- Motion classification: speed > 2 → 'moving', иначе 'idle'

### DwellExtractor
- Кластеризация: последовательные точки в радиусе ≤50м
- Если кластер длится ≥5 мин → dwell
- Все точки кластера → одна dwell-точка с centroid (середина кластера)
- dwell_sec = общая длительность кластера

## ENV-переменные

```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD   — mstroy (PG17)
KIP_DB_HOST, KIP_DB_PORT, KIP_DB_NAME, KIP_DB_USER, KIP_DB_PASSWORD — kip_vehicles (PG16)
TIS_API_URL, TIS_API_TOKENS                         — TIS
SERVER_PORT (default 3007)
```
