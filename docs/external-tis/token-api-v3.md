# Токен-API `navi.nps-it.ru/api/v3`

## Общая форма
**POST с пустым телом, все параметры в query string.**
```
POST https://navi.nps-it.ru/api/v3?token=<TOKEN>&format=json&command=<CMD>&<params>
```
```bash
curl.exe -s -X POST "-d=" --noproxy '*' \
  --url "https://navi.nps-it.ru/api/v3?token=<TOKEN>&format=json&command=getPassports"
```

## ⚠️ Грабли: метод-гард до валидации команды
- **GET** на любую команду (даже несуществующую `totallyFakeCmd123`) → `400 "Запрос
  осуществляется только с помощью метода POST"`. Это НЕ значит, что команда существует.
- Существование команды проверять **только POST'ом**: реальная отбраковка =
  `404 "Метод, указанный в поле command, не найден"`.

## Существующие команды (проверено POST'ом)
`getPassports`, `getOrgs`, `getMonitoringStats`, `getFuelStats`, `getRequests`,
`getRouteListsByDateOut`.

**Несуществующие** (404 на POST, несмотря на упоминание в SPA-бандле — они живут в
сервлете, не в токен-API): `getSensorsData`, `getSensors`, `getMessages`,
`getTrackWithStats`, `getSensorData`, `getFuelLevel`, и т.п.

## Rate limit
**1 запрос / ~30–31 сек на пару `(token, idMO)`.** Разные `idMO` одним токеном — параллельно.
Повтор того же `idMO` раньше 31с → `429 "Слишком много запросов"`. Тяжёлые справочники
(`getPassports`) — выдерживать 31–32с между вызовами.

## getPassports — справочник техники
Поля паспорта: `idMO`, `regNumber`, `modelOrMarkOrModif`, `garageNumber`, `vin`,
`organization`, `kindType`, `registered`, `abonentTerminals`, … `idMO` — ключ для всех
остальных команд. На 2026-06: ~16 794 паспорта, 247 организаций.

## getOrgs — дерево организаций
Узел: `idOrg`, `name`, `shortName`, `parentId`, `levelTag`, `timeZone`, `inn`, `childOrgs`.
Связь паспорта с оргом: `passport.organization == org.idOrg` (рекурсивно распрямить `childOrgs`).
ДиМ-ветка: `idOrg 1152939330` / `561178839` (АО «ДиМ»). ТСМ — подветка ДиМ.

## getMonitoringStats — посменная/попериодная статистика
```
&command=getMonitoringStats&idMO=<id>&fromDate=DD.MM.YYYY HH:mm&toDate=DD.MM.YYYY HH:mm
```
Поля ответа:
- `engineTime` (сек, двигатель включён, вкл. холостой `engineIdlingTime`)
- `fuels[]` = `{unit, fuelName, rate, valueBegin, valueEnd, charges, discharges}`
  - `rate` = **суммарный расход за период** (литры, НЕ л/ч)
  - `actualConsumed = valueBegin - valueEnd + charges - discharges`
- `track[]` = `{lon, lat, direction, time(DD.MM.YYYY HH:mm:ss), speed}` — **без уровня топлива**
- `parkings[]`, `distance`, `movingTime`, `ignitionWork`, `lastActivityTime`, `moUid`,
  `orgName` (Подразделение), `nameMO` (марка/модель)

**Время трактуется в локальном поясе организации.** ДиМ-машины — Подмосковье → UTC+3
(не Екатеринбург как наш флот). Отправляешь локальные часы — получаешь их же в `track[].time`.

## getFuelStats — дневная статистика + события заправок/сливов
```
&command=getFuelStats&idMo=<id|список>&fromDate=DD.MM.YYYY&toDate=DD.MM.YYYY
```
Можно несколько ТС и до **366 дней** одним запросом (до 100 000 записей). Разбито по суткам.
```json
{"list":[{"idMO":...,"statDay":"20.05.2026","remainStart":108,"remainEnd":119,
  "charges":100,"spend":89,"engineTime":44085,"idleTime":...,"movingSpend":0,"idleSpend":89,
  "utcOffset":3,"errors":"...",
  "extData":{"tankStats":[{"tankName":"БАК","sensNum":10,"fuelType":"DT","unit":"LITRE",
     "valueBegin":108,"valueEnd":119.4,"charges":100,"discharges":0,"factRate":88.6,
     "chargeList":[{"date":"20.05.2026 16:40:10","diff":100.0}],
     "dischargeList":[],"modeRates":{"WORK":87.0,"MOVE":0.0}}]}}]}
```
`chargeList`/`dischargeList` — **события заправок/сливов с временем и объёмом** (порог по
скачку уровня). Это НЕ поточечный ряд уровня — для графика нужен сервлет (см. fuel-curve.md).

## getRequests / getRouteListsByDateOut
Существуют (заявки / путевые листы). Для топлива/датчиков не нужны.
