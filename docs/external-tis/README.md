# Внешний TIS (НПС) — выгрузка данных и работа с системой

Документация по работе со **сторонним TIS** для сравнения/расчёта показателей техники
дивизиона «Дороги и Мосты» (ДиМ), а также по сырым датчикам топлива.

> **Секреты не в репозитории.** Токен НПС — в `_local/nps_token.txt` (gitignored) или env
> `NPS_TIS_TOKEN`; учётные данные web-логина — в `handoff-compare-KIP.md` / `.env`.
> В этих доках — только плейсхолдеры (`<TOKEN>`, `<SESS>`, `<JSESSIONID>`).

## Два TIS — не путать

| | Наш TIS | Сторонний TIS (НПС) |
|---|---|---|
| Хост | `tt.tis-online.com/tt` | `navi.nps-it.ru` |
| Организация | АО «Мостострой 11» и др. | Дивизион «Дороги и Мосты» (ДиМ) |
| Платформа | tis-online **v3.95** | tis-online **v4.1** (та же платформа!) |
| Web-фронт | классический JSP | React-SPA (`/fleet`) |
| Токен-API | да | `navi.nps-it.ru/api/v3` |

**Ключевой вывод сессии 2026-06:** оба TIS — **одна платформа tis-online**, разные версии.
У обоих есть богатый `servlet/Controller` (web-сессия) поверх ограниченного токен-API.

## Карта документа

| Файл | О чём |
|------|-------|
| [systems-and-auth.md](systems-and-auth.md) | Две системы, платформа, токен vs сессия, логин НПС |
| [token-api-v3.md](token-api-v3.md) | `navi.nps-it.ru/api/v3`: команды, грабли POST-only, лимиты, форматы |
| [controller-servlet.md](controller-servlet.md) | Сессионный `servlet/Controller`: датчики, сырой ряд топлива |
| [fuel-curve.md](fuel-curve.md) | Как построить точный график уровня топлива (3 способа) |
| [tooling.md](tooling.md) | Скрипты выгрузки/сборки, кэш `_local/`, как запускать |
| [session-log-2026-06.md](session-log-2026-06.md) | Хронология сессии: что делали, что нашли, что отдали |

## Связанные материалы
- `handoff-compare-KIP.md` (корень, gitignored) — токен, idMO-конфиги, контекст сравнения КИП.
- Vault: `02-Projects/ЛК Мстрой/Architecture/API/NPS-TIS-External.md` (канон) и `TIS-API.md` (наш).
- Память Claude: `tis-sensor-data-endpoints.md`, `nps-fuelnorm-coverage.md`, `tis_rate_limit_multitoken.md`.
