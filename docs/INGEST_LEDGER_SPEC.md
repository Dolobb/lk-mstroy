# INGEST LEDGER — спецификация (контракт для всех сервисов)

> Статус: **активная разработка 2026-06-11**. Это единственный источник правды для схемы
> `ingest`, кодов причин и API-форм. Агенты/разработчики НЕ меняют контракт без обновления
> этого файла.

## Цель

Ни одна машина не должна быть «загадочно пустой». Каждая единица работы пайплайна —
**(pipeline, машина, дата, смена)** — имеет строку в `ingest.tasks` со статусом и кодом
причины. UI показывает причину человеку; admin показывает точное покрытие без эвристик.

## Схема БД (mstroy, схема `ingest`)

Миграция: `analytics-backend/server/migrations/006_ingest_ledger.sql` (уже применена).

```sql
CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE IF NOT EXISTS ingest.tasks (
  id            bigserial PRIMARY KEY,
  pipeline      text NOT NULL,        -- см. «Пайплайны»
  unit_key      text NOT NULL,        -- см. «Форматы unit_key»
  target_date   date NOT NULL,
  shift_type    text,                 -- morning|evening (kip), shift1|shift2 (dt), full (analytics)
  vehicle_ref   text NOT NULL,        -- regNumber (kip, analytics) | idMO::text (dt)
  vehicle_label text,                 -- человекочитаемо: модель/имя ТС
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','empty','failed')),
  reason_code   text,                 -- обязателен для empty/failed; опционален для done
  attempt       int  NOT NULL DEFAULT 0,
  max_attempts  int  NOT NULL DEFAULT 5,
  last_error    text,
  result        jsonb,                -- факты для верификации: {points, engineSec, segments, ...}
  run_id        text,
  planned_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  UNIQUE (pipeline, unit_key)
);
CREATE INDEX IF NOT EXISTS idx_ingest_tasks_date ON ingest.tasks (target_date, pipeline);
CREATE INDEX IF NOT EXISTS idx_ingest_tasks_open ON ingest.tasks (status)
  WHERE status IN ('pending','failed','running');
CREATE INDEX IF NOT EXISTS idx_ingest_tasks_vehicle ON ingest.tasks (vehicle_ref, target_date);

CREATE TABLE IF NOT EXISTS ingest.task_events (
  id          bigserial PRIMARY KEY,
  task_id     bigint NOT NULL REFERENCES ingest.tasks(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL,
  reason_code text,
  error       text,
  meta        jsonb
);
CREATE INDEX IF NOT EXISTS idx_ingest_events_task ON ingest.task_events (task_id);
```

## Семантика статусов

| status | Значение | reason_code |
|---|---|---|
| `pending` | Запланировано, ещё не выгружалось | — |
| `running` | Выгрузка идёт прямо сейчас | — |
| `done` | Данные выгружены и записаны | опц. (`gap_filled_onsite`) |
| `empty` | TIS опрошен, данных легально нет — **это НЕ дыра** | обязателен |
| `failed` | Ошибка — требуется повтор | обязателен |

**Ключевое правило:** решение «выгружать или скипнуть» принимается по ledger'у
(status in done/empty при attempt-логике), а НЕ по EXISTS в таблицах данных.
`done` обязан сопровождаться `result` с фактами (points/engineSec/segments) —
запись-пустышка с status='done' является нарушением инварианта (ловит reconciler).

## Пайплайны и форматы unit_key

| pipeline | unit_key | vehicle_ref | shift_type |
|---|---|---|---|
| `kip-shift` | `REG\|YYYY-MM-DD\|morning` | regNumber UPPER | morning/evening |
| `kip-segments` | `REG\|YYYY-MM-DD\|morning` | regNumber UPPER | morning/evening |
| `dt-shift` | `IDMO\|YYYY-MM-DD\|shift1` | idMO как text | shift1/shift2 |
| `dt-segments` | `IDMO\|YYYY-MM-DD\|shift1` | idMO как text | shift1/shift2 |
| `analytics-track` | `REG\|YYYY-MM-DD\|full` | vehicle_id (regNumber) | full |

## Канонические reason_code + русские подписи (UI)

| code | RU подпись (бейдж) | статус | цвет UI |
|---|---|---|---|
| `no_monitoring` | TIS: нет данных мониторинга | empty | серый |
| `no_track` | Трек пуст (<2 GPS-точек) | empty | серый |
| `engine_below_threshold` | Двигатель работал < 45 мин | empty | серый |
| `no_object_detected` | Вне рабочих геозон | empty | серый |
| `no_segments_source` | Нет смены для сегментов | empty | серый |
| `future_date` | ПЛ выписан заранее (дата не наступила) | empty | серый |
| `gap_filled_onsite` | Восстановлено: стояла на объекте | done | синий |
| `tis_error` | Ошибка запроса к TIS | failed | красный |
| `db_error` | Ошибка записи в БД | failed | красный |
| `validation_error` | Некорректный ответ TIS | failed | красный |
| `cancelled` | Выгрузка прервана | failed | оранжевый |
| `internal_error` | Внутренняя ошибка обработки | failed | красный |
| (task отсутствует) | Нет путевого листа | — | серый, тусклый |
| `pending`/`running` | Ещё не выгружено / Выгружается… | — | оранжевый |

Бейдж «Ошибка …» дополняется `×N` (attempt) и tooltip'ом с `last_error`.

## Ledger-клиент (копия в каждом сервисе: `src/services/ledgerClient.ts`)

Контракт одинаковый. **Best-effort: ошибки ledger'а никогда не валят пайплайн** —
только `logger.warn`. Каждый mark* пишет также строку в `ingest.task_events`.

```ts
export type LedgerStatus = 'pending'|'running'|'done'|'empty'|'failed';

// upsert pending (ON CONFLICT (pipeline,unit_key) DO NOTHING + SELECT id). null при ошибке.
ensureTask(p: { pipeline: string; unitKey: string; targetDate: string;
  shiftType?: string; vehicleRef: string; vehicleLabel?: string }): Promise<number | null>;

markRunning(taskId: number, runId?: string): Promise<void>;
markDone(taskId: number, result?: Record<string, unknown>, reasonCode?: string): Promise<void>;
markEmpty(taskId: number, reasonCode: string, meta?: Record<string, unknown>): Promise<void>;
// markFailed инкрементирует attempt
markFailed(taskId: number, reasonCode: string, error: string, meta?: Record<string, unknown>): Promise<void>;
```

Подключение: pool к `mstroy` (host/port/db из env: `MAIN_DB_*` или существующий пул
сервиса, если он уже смотрит в mstroy). У КИП своего пула в mstroy нет — добавить
второй пул (по образцу analytics-backend `db.ts` с двумя пулами).

## Unified API статусов — analytics-backend (у него оба пула)

```
GET /api/analytics/data-status?from=YYYY-MM-DD&to=YYYY-MM-DD[&vehicle=REF][&pipeline=...]
```

```json
{
  "units": [
    { "pipeline": "kip-shift", "vehicleRef": "5351ОА72", "vehicleLabel": "КАМАЗ 65115",
      "date": "2026-06-10", "shift": "morning",
      "status": "failed", "reasonCode": "tis_error",
      "reasonLabel": "Ошибка запроса к TIS",
      "attempt": 3, "lastError": "timeout after 30000ms",
      "finishedAt": "2026-06-10T05:12:00Z" }
  ]
}
```

`reasonLabel` подставляет бэкенд по таблице выше. Фронт дублирует словарь
(`frontend/src/features/analytics/ledgerLabels.ts`) для офлайн-маппинга.

## Admin Coverage v2

```
GET /api/admin/coverage-v2?from=&to=
→ { days: [ { date, pipelines: { "kip-shift": {done,empty,failed,pending,running,total}, ... } } ] }

GET /api/admin/coverage-v2/units?date=YYYY-MM-DD[&pipeline=][&status=]
→ { units: [ ...как data-status... ] }
```

День зелёный ⟺ `failed + pending + running = 0` и `total > 0`.
Жёлтый ⟺ есть failed/pending. Серый ⟺ total = 0 (не планировалось).

## Write-through точки (где какой mark ставится)

### kip-shift (`kip/server/src/jobs/dailyFetchJob.ts`)
- после `interleaveTasks`: `ensureTask` на каждую единицу (это planner-lite)
- начало processOneTask → markRunning
- `!stats` → markEmpty('no_monitoring')
- успешный upsertVehicleRecord → markDone({engineSec, points: stats.track.length, kip: kpi.utilization_ratio})
- catch → markFailed('tis_error'|'internal_error', String(err))
- gapFillJob: созданная синтетика → ensureTask + markDone({synthetic:true}, 'gap_filled_onsite')

### kip-segments (`segmentDailyJob.ts` / `segmentFetchJob.ts`)
- постановка в очередь → ensureTask(pending)
- успех → markDone({segments: N}); кандидат без vehicle_records → markEmpty('no_segments_source'); ошибка → markFailed

### dt-shift (`dump-trucks/server/src/jobs/shiftFetchJob.ts`)
- после построения vehiclesMap → ensureTask на каждый idMO
- существующие audit-вердикты → ledger:
  `no_monitoring`→markEmpty('no_monitoring'); `engine_below_threshold`→markEmpty('engine_below_threshold');
  `no_object_detected`→markEmpty('no_object_detected'); `processed`→markDone({trips, kip, engineSec});
  `processing_error`→markFailed('internal_error')
- runSegmentFetch перестаёт быть невидимым: каждая единица сегментов → dt-segments task

### analytics-track (`analytics-backend/server/src/jobs/analyticsFetchJob.ts`)
- перед циклом → ensureTask по каждому vehicle
- existing && !force → НЕ трогаем ledger (статус уже корректен)
- track <2 точек → markEmpty('no_track')
- успех → markDone({points: inserted, dwells})
- catch → markFailed('tis_error'|'internal_error')
- **инвариант**: markDone ставится ТОЛЬКО если inserted > 0

## Backfill (история за 14 дней)

Скрипт `admin/scripts/ledger-backfill.mjs`: сидирует ledger из существующих данных:
- kip-shift: vehicle_records (gap_filled → done+gap_filled_onsite, иначе done {fromBackfill:true})
- dt-shift: shift_records → done
- analytics-track: track_sessions JOIN count(points) → done(points) / failed('internal_error') при 0
- ON CONFLICT DO NOTHING — безопасен при повторном запуске
