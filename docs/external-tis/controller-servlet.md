# Controller servlet (web-сессия) — сырые датчики

Полный web-API платформы tis-online. Авторизация: `sess=<UUID>` (query) + cookie
`JSESSIONID`, заголовок `X-Requested-With: XMLHttpRequest`. Логин → [systems-and-auth.md](systems-and-auth.md).

База: НПС `https://navi.nps-it.ru/servlet/Controller`, наш `https://tt.tis-online.com/tt/servlet/Controller`.

## Имена экшенов отличаются по версии платформы!
| Данные | tt-online (v3.95) | НПС (v4.1) |
|--------|-------------------|------------|
| Список датчиков ТС | (профили) | `GET_MO_SENSORS&act=getSensors` |
| Сырой ряд уровня | `GET_SENSOR_DATA` | `GET_MO_SENSORS&act=getSensorsData` |

## НПС — список датчиков машины
```
GET .../servlet/Controller?action=GET_MO_SENSORS&act=getSensors
    &idMO=<id>&fromDate=DD.MM.YYYY+HH:mm&toDate=DD.MM.YYYY+HH:mm&sess=<SESS>
```
Ответ — словарь групп датчиков; топливный бак:
```json
{"БАК: Датчик топлива":[{"num":10,"atCode":"863151074303659 (основной)",
                         "description":"Бак","key":"113629_20093_0"}],
 "Зажигание":[{"key":"113627_20093_0", ...}], "Скорость (трек)":[...], ...}
```
Нужен `key` бака (вид `113629_20093_0`) для следующего запроса.

## НПС — сырой ряд уровня топлива (для графика)
```
GET .../servlet/Controller?action=GET_MO_SENSORS&act=getSensorsData
    &keysSensors=["113629_20093_0"]&smooth=false
    &from=DD.MM.YYYY+HH:mm&to=DD.MM.YYYY+HH:mm&sess=<SESS>
```
`keysSensors` — JSON-массив ключей (URL-энкод). `smooth=false` = галка «Сглаживание» снята.
Ответ:
```json
{"113629_20093_0":[{"value":"115.435","time":"20.05.2026 00:59:53"},
                   {"value":"114.855","time":"20.05.2026 01:04:56"}, ...]}
```
- Плотность НПС: **~135 точек/день, шаг ~5 мин** (частота трекера ДиМ).
- `value` = литры. Многодневный диапазон одним запросом **работает** (проверено 3 дня →
  423 точки). Т.е. весь месяц = 1 запрос на машину.

## Наш tt-online — сырой ряд (для сравнения)
```
GET /tt/servlet/Controller?action=GET_SENSOR_DATA&sess=<SESS>&profile=0
    &idSensor=<id>&idAt=<id>&from=DD.MM.YYYY+HH:mm&to=...&smooth=false
```
Ответ `{"rows":[{"value":"306.782","time":"22.06.2026 00:00:47"}, ...]}`.
**~6000 точек/день, шаг ~5 сек** (наши трекеры частят сильнее ДиМ). `idMo` — в cookie.

## Прочие экшены сервлета (из бандла НПС, не проверены детально)
`GET_TRACK_WITH_STATS` (трек+статы, ~160 КБ/день), `GET_MESSAGES` (сырые сообщения),
`GET_FUEL_CARDS`, `GET_MONITORING_OBJ_INFO`, `GET_MO_POS`, `GET_CUR_MO_POS`,
`GET_LOCALIZED_ORG_TREE`. Все — тот же паттерн `action=...&sess=...` + JSESSIONID.
