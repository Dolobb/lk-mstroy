# Системы и авторизация

## Одна платформа, два инстанса

Наш `tt.tis-online.com` и сторонний `navi.nps-it.ru` — **один и тот же продукт tis-online**,
разные версии (наш 3.95 от 14.01.2026, НПС 4.1 от 29.05.2026). Отсюда:
- одинаковый бэкенд-сервлет `servlet/Controller?action=...`;
- разные имена части экшенов между версиями (см. ниже датчики топлива);
- у НПС современный React-SPA `/fleet` поверх того же сервлета.

Подтверждение для НПС — из бандла `navi.nps-it.ru/fleet/main.<hash>.js`: вызовы вида
`ajax({action:"GET_MO_SENSORS", data:{act:"getSensorsData", ...}})` и
`fetch("../servlet/Controller?action=GET_MESSAGES&sess="+window.sessId)`.

## Два уровня доступа

### 1. Токен-API (`/api/v3`) — ограниченный, без логина
- Авторизация: `token=<TOKEN>` в query.
- Только агрегаты: паспорта, оргструктура, помесячная/посменная статистика, заправки-события.
- **Сырых датчиков НЕ даёт.** Подробно → [token-api-v3.md](token-api-v3.md).

### 2. Controller servlet — полный web-API, по сессии
- Авторизация: `sess=<UUID>` в query + cookie `JSESSIONID`.
- Даёт сырые ряды датчиков (уровень топлива по точкам), сообщения, треки.
- Подробно → [controller-servlet.md](controller-servlet.md).

## Топология URL НПС (важные грабли)

| URL | Ответ | Смысл |
|-----|-------|-------|
| `navi.nps-it.ru/` | 301 → `/fleet/auth` | редирект на логин |
| `navi.nps-it.ru/api/v3` | JSON | токен-API |
| `navi.nps-it.ru/servlet/Controller` | 302 (без сессии) | **настоящий сервлет** |
| `navi.nps-it.ru/fleet/servlet/Controller` | 200 (HTML `fr-app`) | **catch-all SPA-оболочка, НЕ сервлет** |

→ Сервлет дёргать по `/servlet/Controller` (без `/fleet`). 200 от `/fleet/servlet/...` —
это просто `index.html` SPA, легко принять за рабочий эндпоинт по ошибке.

## Логин НПС (получение сессии)

Форма SPA постит на `PASSWORD_MANAGE&act=checkUser`. **2FA при пароле не требуется**
(в бандле есть OTP-компонент и `loginType` EMAIL/PHONE, но `loginType=LOGIN` с паролем
проходит напрямую).

```bash
curl -s -X POST 'https://navi.nps-it.ru/servlet/Controller?action=PASSWORD_MANAGE&act=checkUser' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -c cookies.txt \
  --data 'username=<ACCOUNT>&password=<PASSWORD>&loginType=LOGIN&bw=&os=&ss='
```

Ответ:
```json
{"success":true,"urlTag":"MONITORING","sessId":"019ef7d1-e5b2-7b18-938a-327b08599bbc",
 "systemUrl":"https://navi.nps-it.ru/","currentOrgId":...,"user":{...}}
```
+ заголовок `Set-Cookie: JSESSIONID=<...>`.

Дальше во всех сервлет-запросах: `sess=<sessId>` в query **и** cookie `JSESSIONID`,
заголовок `X-Requested-With: XMLHttpRequest`. Сессия и кука истекают — при истечении
повторить логин.

> Учётные данные (`<ACCOUNT>` / `<PASSWORD>`) — НЕ в репозитории. Хранятся у владельца /
> в `.env`. В скриптах логин не зашит; cookie кладётся в `_local/nps_cookies.txt`.

## Сеть этой машины
Все curl к внешним TIS — с `--noproxy '*'` (прокси-MITM машины иначе ломает TLS).
`curl.exe` (нативный Windows) не понимает путь `/tmp` — писать `-o` в рабочую папку.
