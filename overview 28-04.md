# Сводка сессии — фикс auto-fetch блока admin (28.04.2026)

## Контекст и фон

Пользователь много дней борется с тем, что ежедневный auto-fetch (cron-cycle DT/KIP) даёт сбои, а админка показывает пачку "ошибок", которые на самом деле — статистический шум или последствия одной реальной проблемы, размноженной механизмом ретраев. Прошлые сессии добавляли диагностику (pipeline_runs, reconcile, per-pipeline thresholds, PipelineErrorsPanel) — корень не правился. В этой сессии задача стояла **жёстко**: «никаких phantom-фиксов, найди причины, почини».

## Архитектура (важные факты для нового агента)

- Монорепо, **Windows**. PostgreSQL — **один инстанс на :5432**, БД `mstroy` и `kip_vehicles`, user=postgres, password=888.
- Сервисы: kip(:3001), tyagachi(:8000), dump-trucks(:3002), vehicle-status(:3004), geo-admin(:3003), admin(:3005), ai-reports(:3006), frontend(:5173).
- Запуск: `npm run dev` из корня → admin спавнит все 5 бэкендов как child-процессы и сам же управляет cron'ом через pg-boss (children получают `CRON_DISABLED=true`, чтобы не дублировать расписание).
- pg-boss v12 в схеме `pgboss` той же БД `mstroy`. Расписания в `pgboss.schedule`, очереди задач в `pgboss.job`. Записи о выполнении пайплайнов — в `public.pipeline_runs` (status running/completed/failed/partial, errors jsonb).
- Cron firings: KIP — раз в день в 08:30 локального TZ (yekaterinburg + irkutsk); DT — 10 раз в сутки (08:00, 10:00, 12:00, 15:00, 17:00, 20:00, 22:00, 00:00, 03:00, 05:00 YEKB) — каждое срабатывание ставит fetch-dt-shift для shift1+shift2.
- `admin/.env`: KIP_DB_*/MAIN_DB_* всё на :5432, postgres/888 — корректно.
- Локализация UI — русская. Колонка в `dump_trucks.shift_records` называется `vehicle_id` (НЕ `id_mo`); в KIP `monitoring_raw` — есть и `vehicle_id`, и `id_mo` (целочисленный). Это часто путается.

## Доказательная база, собранная в этой сессии

Я прочёл **до** правок:
1. **`cron-watch-20260427-1456.log`** — пользовательский 30-минутный пассивный capture с прошлой сессии. Зафиксировал: cron-firing dt_daily в 15:00:31 YEKB → pipeline_runs row висит `running` с `tot=0, ok=0` 16+ минут, в admin/logs/dump-trucks.log за этот период **ничего**, в 15:10:25 admin перезапускает DT (Ctrl+Break), всплывает классический Windows BAT-prompt `Прервать выполнение пакетного файла? [Y/N]` (в OEM-866 — отсюда garbled cyrillic).
2. **`admin/logs/kip.log` и `dump-trucks.log`** — `EADDRINUSE :::3001`/`:::3002` повторяется 8 раз подряд 27.04 утром (09:01-09:07). После каждого падения tsx watch снова пытается слушать порт, ловит EADDRINUSE, вылетает.
3. **`pipeline_runs` за 36ч** через psql — обнаружилось **3×shift1+3×shift2 failed «fetch failed»** в окне 8 секунд (16:09-16:10) после рестарта admin'а: pg-boss нaкопил очередь cron-firings пока admin был мёртв, при старте проиграл все одновременно → каждое падало, потому что DT ещё не поднялся.
4. **Все «partial» записи** оказались с note `processed=3 < 50% от 14-дневной медианы (33)` или `in-progress refresh: смена ещё активна, processed=0, expected≈22`. Реальная DT-обработка отрабатывает за 25-30 секунд, completed=0 errors. Это **не ошибки** — данные приходят корректно, просто проект свёрнут (2-3 ТС вместо 22-33 за смену), а классификатор сравнивает с 14-дневной медианой включающей высокоактивные дни.

## Три структурных бага (root causes)

### RC1 — Windows spawn/kill leaks port-holding orphans
`startService` (был `function`, синхронный) использовал `spawn(cmd, [], { shell: true })` (cmd.exe → npm.cmd → node). `stopService` запускал `taskkill /F /T /PID childpid`, потом через 1 сек `netstat | findstr :PORT`. Сам restart-route ждал `setTimeout(..., 1500)`. **Реальность**: cmd.exe убивается, BAT-script выводит prompt «Прервать?», node живёт ещё 1-3 сек, держит порт. Следующий `startService` → EADDRINUSE → child crash → admin'овский handler упирается в ECONNREFUSED при следующем cron firing → строка `pipeline_runs` помечается «fetch failed».

### RC2 — pg-boss replays queued cron jobs пачкой при рестарте
`pgboss.schedule` продолжает срабатывать пока admin лежит. Job'ы с `state='created'` копятся. На старте **все** мгновенно отдаются worker'ам. Workers в `registerWorkers()` `retryLimit` не ставили — pg-boss дефолт ретраил. Отсюда 6 строк в `pipeline_runs` с шагом 2 секунды.

### RC3 — «partial» классификатор флагает здоровые runs как ошибки
В `dtShiftFetchHandler`:
```ts
} else if (!inProgress && expected > 0 && processed < Math.ceil(expected * 0.5)) {
  status = 'partial';
  notes.push(`processed=${processed} < 50% от 14-дневной медианы (${expected})`);
}
```
Плюс ветка `else if (inProgress)` пишет note `in-progress refresh: смена ещё активна, processed=N, expected≈M` в `errors[]` jsonb даже на успешном запуске. UI panel `pipeline-errors` фильтровал только `reconcile:` notes — эти проходили.

### Бонус-баг RC4 (всплыл уже после правок 1-9)
`getDumpTrucksDates` (admin/server.ts:1063) использовал `COUNT(DISTINCT id_mo)` по `dump_trucks.shift_records`. Колонка там называется `vehicle_id`. SQL throws → catch возвращает `{ dates: [], partial: [], error }` → разные caller'ы трактуют пустые массивы по-разному (где-то «нет данных», где-то «всё покрыто»). Пользователь видел красную строку `Самосвалы БД (localhost:5432/mstroy user=postgres): error: столбец "id_mo" не существует` и одновременно «полное покрытие» в карточках.

## Что пофикшено в этой сессии — 10 правок

Все правки в `admin/server.ts` + один новый файл `admin/src/logger.ts` + правки в `frontend/src/features/admin/AdminPage.tsx`.

| #                       | Файл                                                     | Что изменено                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edit 1**              | `admin/server.ts` startService/stopService/restart-route | Добавлены `waitPortFree(port, ms)` и `killListenerOnPort(port)`. `startService` теперь `async`: ждёт освобождения порта до 8с, при таймауте — taskkill leftover PID + ещё 3с. `stopService` после taskkill ждёт порт 5с и добивает. Restart-route: `setTimeout(..., 1500)` заменён на `await waitPortFree(cfg.port, 6000); await startService(cfg)`. Auto-start при boot — последовательный с интервалом 200мс.  |
| **Edit 2**              | `admin/server.ts` `reconcileOnStart` — третья секция     | Добавлен DELETE из `pgboss.job` где `name IN (известные fetch-очереди) AND state IN ('created','retry') AND created_on < now() - interval '1 hour'`. Закрывает «backlog cron firings»-пробку.                                                                                                                                                                                                                    |
| **Edit 4**              | `admin/server.ts` `dtShiftFetchHandler`                  | **Удалена** ветка `processed < Math.ceil(expected * 0.5)` целиком. **Удалена** ветка `else if (inProgress)` с записью note. Запрос `expected` (median) тоже удалён — больше не нужен. Реальные сигналы остались: `processed===0 && preCount>0 && !inProgress` → partial; `perVehicleErrors.length>0` → partial.                                                                                                  |
| **Edit 5**              | `admin/server.ts` `/api/admin/pipeline-errors`           | В фильтре per-row добавлены: `isInProgressNote = /^in-progress refresh:/.test(note)`, `isMedianNote = /^processed=\d+ < \d+% от/.test(note)` — backstop для исторических строк (живут 7 дней).                                                                                                                                                                                                                   |
| **Edit 6 (новый файл)** | `admin/src/logger.ts`                                    | Структурированный JSONL-логгер, fail-safe. Пишет в `admin/logs/admin.jsonl` (для API) + `admin/logs/admin.log` (human-readable). Ротация при 20MB → `.1`. Категории: `spawn / cron / handler / http / reconcile / pipeline / boss / admin`. Уровни: `debug / info / warn / error`. Поля: `service / runId / pipeline / date / shift / msg / fields`. **Не блокирующий** — все exception'ы внутри проглатываются. |
| **Edit 7**              | `admin/server.ts` инструментирование                     | Добавлены `log.info/warn/error` вызовы в: spawn lifecycle (старт/exit/EADDRINUSE/kill leftover), reconcile (3 секции), все 4 pipeline handler'а (kipFetchHandler, dtShiftFetchHandler, kipRecalcHandler, dtRecalcHandler) на «run started/completed/failed», 4 точки HTTP egress на localhost:3001/3002 (status, ms, fetch-error → ECONNREFUSED). dtFetchDateHandler логирует fan-out.                           |
| **Edit 8**              | `admin/server.ts` `GET /api/admin/logs`                  | Tail-first reader `admin.jsonl`. Параметры: `since`, `category` (csv), `level` (csv), `service`, `runId`, `pipeline`, `limit` (default 500, max 2000). Если файла нет — возвращает []. Время ответа — миллисекунды даже на 200MB.                                                                                                                                                                                |
| **Edit 9**              | `frontend/src/features/admin/AdminPage.tsx`              | Добавлены: тип `LogEvent`, `fetchAdminLogs(params)` API helper, компонент `LogsPanel` (~150 строк) с category chips, level chips, time-window chips (1/6/24/72ч), runId-фильтр (клик по run=XXXXXXXX в строке), expandable JSON `fields` (▸/▾), polling каждые 10с. Вставлен в layout между `<PipelineErrorsPanel/>` и `<CronStatusPanel/>` под заголовком «Журнал событий».                                     |
| **Edit 10**             | `admin/server.ts` `getDumpTrucksDates` + `getKipDates`   | Колонка `id_mo` → `vehicle_id` в обоих запросах `getDumpTrucksDates` (range scan + 14-day baseline). Catch блоки в обеих функциях теперь вызывают `log.error({ category: 'admin', service: 'dump-trucks'\|'kip', msg: 'getXxxDates query failed' })`.                                                                                                                                                            |
| **fix tsconfig**        | `admin/tsconfig.json`                                    | Кто-то снаружи поменял `moduleResolution` на `bundler` (несовместимо с `module: CommonJS`) — вернул на `node`. Также удалён мусорный пустой файл `admin/Just want to end this` (создался из-за неудачной bash-команды с `&`).                                                                                                                                                                                    |

## Что точно проверено

- `cd admin && npx tsc --noEmit` → exit 0
- `cd frontend && npx tsc --noEmit` → только pre-existing ошибки в `analytics/` и `samosvaly/`, мои изменения чистые
- БД-схема `dump_trucks.shift_records` подтверждена: `vehicle_id integer not null`, **никакого `id_mo`**
- БД-схема `monitoring_raw` (kip_vehicles): и `vehicle_id varchar(20)`, и `id_mo integer not null` — поэтому query на line 2580 в admin/server.ts с `id_mo` оставлен как был, он корректен

## Что НЕ сделано в этой сессии (важно для нового агента)

- **Хэнг pipeline_runs row при cron-firing когда DT/KIP мертв** — должно решиться Edit 1+2, но не верифицировано на живом cron'е (пользователь не дождался следующего срабатывания после правок).
- **Хэнг при «перевыгрузке» (processes зависают, не отменяются)** — пользователь жаловался отдельно. Корень: `dtShiftFetchHandler` polling loop делает 200 запросов к `:3002/api/dt/admin/fetch/status` на протяжении 50 минут; если DT возвращает успешный 200 на старт, но фактически работа не запускается (или статус-эндпоинт никогда не переключается в `done`/`error`), polling крутится все 50 минут и не отменяется. Cancel route (`/api/admin/fetch/cancel`) есть, но он останавливает только in-memory `fetchProgress`, не дёргает уже-в-полёте pg-boss handler. **Фикс не написан**.
- **Тестов нет.** Пользователь явно сказал «не нужно».
- **Spawn через npm.cmd не переписан на прямой `node` с `tsx`-loader'ом.** Edit 1 (waitPortFree) считается достаточной защитой; полный bypass — out of scope. Если EADDRINUSE возродится — это следующий шаг.
- **Crontab времена не верифицированы**. В DB видно `pgboss.schedule.last_run = 2026-04-27 16:06:26` для всех 12 расписаний — это timestamp последнего admin-restart-а (admin перерегистрирует расписания на старте), НЕ время последнего firing'а. Реальное время firing'ов нужно смотреть в `admin.jsonl` после рестарта.
- **«КИП отпал»** — пользователь видел это в UI. Реальное состояние: kip_daily completed успешно в последний раз `04-28 05:30`. Сервис на :3001 жив (netstat подтверждает). Это могло быть UI-glitch из-за того же RC4 (id_mo error) — KIP-карточка возможно тоже тащила coverage от `getDumpTrucksDates`.

## Грабли — на что НЕ наступать новому агенту

1. **НИКОГДА не предлагать пользователю curl/CLI команды для управления данными.** Всё — через Admin UI на http://localhost:5173/admin. Пользователь специально строил admin panel чтобы не возвращаться к командам и чтобы сотрудники могли управлять системой. Это в memory зафиксировано.
2. **Pre-existing TS-ошибки в `frontend/src/features/analytics/` и `frontend/src/features/samosvaly/`** — не трогать. К моим правкам не относятся, тратить на них контекст бесполезно.
3. **psql.exe лежит в `C:\Program Files\PostgreSQL\16\bin\psql.exe`** — путь стабильный. На `\Program Files\PostgreSQL\17\` его НЕТ, не пытаться. На Windows-машине только PG16, на :5432.
4. **shell в этой среде — bash (Git Bash), а не PowerShell** по умолчанию. Используй Unix-стиль (`/dev/null`, прямые слеши, `echo` через quote'ы).
5. **DB session timezone у psql.exe — Asia/Yekaterinburg (+05).** При `to_char(started_at, ...)` без явного `at time zone` цифры выходят в YEKB. Это сбивает с толку при сопоставлении с UTC-меткой в логах сервисов (`Z`-суффикс).
6. **Cron в pg-boss schedule показывает `30 3 * * *` UTC, но в data — `{"timezone": "Asia/Yekaterinburg"}`.** pg-boss применяет timezone option к cron-выражению — фактически срабатывает в 03:30 YEKB = 22:30 UTC прошлого дня. Не путать.
7. **Pipeline run rows создаются handler'ом admin'а, не сервисом DT/KIP.** Сервисы про `pipeline_runs` ничего не знают. Если row висит `running`, а в логе сервиса всё успешно — значит admin'овский handler не дошёл до `completeRun()` (вылетел / был убит / polling не получил final state).
8. **`appendLog(serviceId, line)` — это старая система** (admin/logs/<service>.log). Логгер Edit 6 пишет в admin.jsonl/admin.log — это **независимая** система. appendLog оставлен как есть для обратной совместимости (UI «Сервисы → Логи» читает старые файлы).
9. **`spawn('taskkill', ['/F', '/T', '/PID', pid], { shell: false })` асинхронен** — taskkill сам возвращается мгновенно, но процесс умирает с лагом 0.3-2с. Не считать что после `taskkill` порт сразу свободен. Edit 1 именно про это.
10. **DT processes vehicles=0 — это норма, не ошибка.** Большинство ТС работают вне 29 dt_*-зон, в логах `[ShiftFetch] idMO=XXXX: 0 zone events → no object detected, skipping`. Не флагать это как партиал.

## После рестарта что наблюдать

Пользователь должен сделать `npm run dev` из корня и:
1. В `admin/logs/dump-trucks.log` после restart DT — **не должно** быть `EADDRINUSE`.
2. После следующего cron-firing (~ближайший час по DT-расписанию) — новая строка в `pipeline_runs` со `status=completed, errors=[]`.
3. В UI «Реальные ошибки за 7д» — счётчик должен резко упасть (исторические партиалы остаются в БД, но `Edit 5` их фильтрует).
4. Открыть «Журнал событий», поставить `category=pipeline,http`, увидеть полный trace одного run: `pipeline run started → http POST :3002 → http GET :3002/status → pipeline run completed`. Клик по `run=XXXXXXXX` → все события этого runId.
5. Если новый сбой — фильтр `level=warn,error` покажет точку поломки.

## Если новый агент хочет глубже

- Read план `C:\Users\user_ogtr1\.claude\plans\rippling-humming-sun.md` — там та же информация что выше плюс конкретные code-snippets правок (полный план который пользователь approve-нул).
- Read `admin/server.ts:374-580` — секция reconcile + worker registration.
- Read `admin/server.ts:1063-1110` — get*Dates с фиксом колонки.
- Read `admin/server.ts:600-820` — все 4 pipeline handler'а с инструментированием.
- Прошлая сессия записана в `SESSION-SUMMARY-2026-04-17.md` (corner-of-context, в gitstatus как untracked) — там предыдущий слой фиксов (CRON_DISABLED для children, 003_zone_min_duration migration, fetch/cancel routing-bug). Не повторять то что там уже сделано.

## Состояние на конец сессии

- Код: все 10 правок применены, tsc clean.
- Не закоммичено. `git status` показывает `M admin/server.ts`, `M admin/tsconfig.json`, `M frontend/src/features/admin/AdminPage.tsx`, новый `admin/src/logger.ts` (untracked).
- admin не перезапущен — пользователь сделает `npm run dev` сам.
- Пользователь физически и эмоционально устал, ничего больше не делать без явного запроса. Если новый бaг возникнет — сначала открыть Журнал, потом гипотезы, потом править.