# Скрипты и рабочий процесс

Все скрипты лежат в корне репозитория, запускаются из корня (`cwd` = корень).
Питон 3 + `openpyxl`. Токен берётся из env `NPS_TIS_TOKEN` или `_local/nps_token.txt`.

## Локальное хранилище `_local/` (gitignored)
```
_local/
  nps_token.txt                  # токен НПС (НЕ в git)
  nps_cookies.txt                # cookie web-сессии (НЕ в git)
  comparison-cache/<reg>/<YYYY-MM-DD>_<morning|evening>.json   # сырьё getMonitoringStats
  nps-tis-dim-vehicles.json      # дамп ДиМ-машин (idMO/regNumber/model/org)
  nps-tis-tsm-vehicles.json      # дамп ТСМ
  fetch_nps.log
```
Готовые xlsx-отчёты лежат **в корне** (под рукой), но gitignored. См. `.gitignore`
раздел «Локальная аналитика TIS».

## fetch_nps.py — выгрузка getMonitoringStats (resumable)
Тянет посменно `getMonitoringStats` по списку машин за период, кладёт сырой JSON в
`_local/comparison-cache/`. Возобновляемо (пропускает готовые файлы), уважает лимит
1 запрос/31с на `idMO` (гейт по времени последнего запроса каждого idMO, ретрай 429).
Параметры в коде: `VEHICLES` (reg, idMO, подразделение, модель), `START`, `END`.
Смены: 1-я 07:30–19:30, 2-я 19:30–07:30 след. дня; `report_date` = дата старта.

Запуск для другого набора/периода (без правки файла):
```python
python -c "import fetch_nps as f, datetime as dt; \
  f.VEHICLES=[('В204РВ790',20824,'МО-90',''), ...]; \
  f.START=dt.date(2026,6,21); f.END=dt.date(2026,6,23); f.main()"
```

## build_nps_xlsx.py — таблица «работа двигателя + расход» по сменам
Читает кэш, строит xlsx по шаблону `шаблон.xlsx`: на смену — время работы двигателя (чч:мм)
и расход (л). Лист «КИП ДСТ» + «Описание».

## build_kip_dim.py — таблица КИП % / Под нагрузкой %
Читает кэш, считает по формулам `kip/server/src/services/kpiCalculator.ts`:
- Под нагрузкой = `(расход/engine_h)/норма×100`, кламп 0–100;
- КИП = `min(engine_h/12ч,1)×100` (для машин ВНЕ наших геозон `total_stay_time=12ч`);
- условие 1 (rate=0 при engine>0): восстановление по баку / ветка ignitionOffInWeek.
Формат — точно по `kip-dim-2026-05-20--2026-06-20.xlsx`. Переопределяемые в коде:
`VEHICLES` (+нормы), `START`, `END`, `OUT`. Split-вариант: каждая смена = 2 столбца
(КИП | Под нагрузкой) с третьей строкой заголовка.

## demo_fuel_window.py — демо «скользящего окна» (способ 3, fuel-curve.md)
Проходит несколькими мелкими окнами getMonitoringStats и печатает valueBegin/valueEnd —
показывает, что границы окон стыкуются (реальные показания уровня).

## Карта idMO ↔ госномер
В `_local/nps-tis-dim-vehicles.json` (ключ `vehicles[]`: `idMO`, `regNumber`, `model`,
`organizationName`). Сопоставление по нормализованному госномеру (upper, убрать всё кроме
`[0-9A-Za-zА-Яа-я]`). 9 машин ДиМ из «Для расчёта показателей» → idMO см.
[session-log-2026-06.md](session-log-2026-06.md).
