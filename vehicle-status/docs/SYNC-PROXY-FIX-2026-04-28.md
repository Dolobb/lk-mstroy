# Fix: vehicle-status sync — таймаут при скачивании xlsx из Google Drive

**Дата:** 2026-04-28
**Файл:** `vehicle-status/server/src/services/sheetsSyncService.ts`

## Симптом
`POST /api/vs/sync` зависал на 60с с ошибкой `Failed to download file: ... timeout`. JWT-авторизация проходила, но сам download `drive.files.get(alt=media)` не завершался.

## Корень проблемы (двухслойный, специфика рабочей машины)

1. **На этой Win-машине прямой HTTPS к `www.googleapis.com` не работает** — обязателен локальный прокси `http://127.0.0.1:12334`. Без него даже системный curl зависает (000 за 30с). При этом `oauth2.googleapis.com` доступен напрямую — поэтому JWT-токен получался, а download висел.
2. **Node-OpenSSL через этот прокси несовместим с авторизованными запросами**: TLS встаёт, h2-стрим открывается, ответ от сервера никогда не приходит. Воспроизводится для всех клиентов: `gaxios` (googleapis), native `fetch` (undici), `node:http2`. Curl через тот же прокси (Schannel) — работает за <1с.

Дополнительная ловушка: `process.env.NO_PROXY = '*'` (которое мы поставили на ранних попытках) заставляет subprocess-curl **игнорировать `-x`** и идти напрямую → опять таймаут.

## Решение

`downloadXlsx` теперь shell-аут на `curl`:

```ts
const proxy = process.env.SYNC_HTTPS_PROXY || 'http://127.0.0.1:12334';
const args = ['-sS','-L','--fail-with-body','--max-time','60','-x',proxy,
              '-H',`Authorization: Bearer ${token}`,'-o','-',url];
const env = { ...process.env, NO_PROXY: '', no_proxy: '' };
spawn('curl', args, { windowsHide: true, env });
```

Override через `.env`: `SYNC_HTTPS_PROXY=http://...`.

## Хронология того, что НЕ помогло

| Попытка | Результат |
|---|---|
| timeout 60s в gaxios | таймаут |
| `await auth.authorize()` | JWT ок, download виснет |
| native `fetch` вместо gaxios | таймаут |
| удаление `HTTP(S)_PROXY` из env | без эффекта (как раз убрало нужный прокси) |
| `node:http2` напрямую | TLS+h2 коннект встаёт, ответ не приходит |
| curl без `-x` (NO_PROXY=*) | direct → таймаут |

## Что запомнено в auto-memory

`~/.claude/projects/.../memory/machine_googleapis_quirk.md` (project) — полное описание квирка, чтобы в будущих сессиях не повторять расследование. В `MEMORY.md` — ссылка в разделе «Среда машины».

## Что НЕ откатывалось (можно почистить позже)

- Console-логи `[Sync] ...` в `runSync` — оставлены для прозрачности sync.
- Глобальный 120с-таймаут в `index.ts` (защита от зависших sync).
- `await auth.authorize()` в `runDiagnostic`/`debugRawRows` — безвреден.
