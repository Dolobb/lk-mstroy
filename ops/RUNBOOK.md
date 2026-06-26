# RUNBOOK — ЛК Мстрой (прод, новая Windows-машина)

Короткая шпаргалка для эксплуатации соло по RDP. Подробности миграции — в Obsidian vault
`02-Projects/ЛК Мстрой/Миграция сервера/`.

## Базовое окружение
- Репо: `C:\lk-mstroy`
- PostgreSQL 17: служба `postgresql-x64-17` (автозапуск), порт **5432**, базы `mstroy` + `kip_vehicles`, юзер `postgres` / пароль `888`.
- Node **24.18.0 LTS** (`C:\Program Files\nodejs`).
- Python **3.14** (`C:\Users\monit\AppData\Local\Programs\Python\Python314`) — для tyagachi.
- Бэкапы: `C:\lk-backups\` (+ облако `yadisk:lk-backups/`, зашифровано age).

> ⚠️ Любой `.ps1` с кириллицей сохранять в **UTF-8 с BOM**, иначе PowerShell 5.1 ломает парсинг.
> ⚠️ `curl` к localhost — всегда с `--noproxy '*'` (прокси Hiddify перехватывает localhost).

---

## 1. Стек как службы (АВТОЗАПУСК при включении ПК)
Прод-стек поднимается **двумя задачами Планировщика** под юзером `monit` (At startup, +20с задержка):
- **«LK Mstroy backends»** → `ops\start-backends.cmd` → admin (:3005) + 7 бэков (kip:3001, dt:3002,
  geo:3003, vs:3004, tyagachi:8000, reports:3006, analytics:3007). Без Vite.
- **«LK Mstroy caddy»** → `ops\start-caddy.cmd` → Caddy на **:80** отдаёт `frontend/dist` + проксирует `/api`.

**Клиенты заходят на `http://<IP-сервера>/`** (порт 80), НЕ на :5173. UI управления: `http://<IP>/admin`.

Ручное управление стеком:
```powershell
Start-ScheduledTask -TaskName 'LK Mstroy backends'   # старт
Stop-ScheduledTask  -TaskName 'LK Mstroy backends'   # стоп (caddy — аналогично)
# рестарт = стоп + старт (Restart-ScheduledTask в PS 5.1 НЕТ):
Stop-ScheduledTask 'LK Mstroy backends'; Start-Sleep 3; Start-ScheduledTask 'LK Mstroy backends'
Get-ScheduledTask 'LK Mstroy*' | Select TaskName,State
```
Логи: `C:\lk-mstroy\logs\backends.log`, `caddy-run.log`. Перерегистрировать задачи:
`ops\register-stack-tasks.ps1 -Password <win-pw>` (от админа).

> **Режим разработки (HMR/Vite):** сначала останови задачу backends (`Stop-ScheduledTask`), потом
> `cd C:\lk-mstroy; npm run dev` — поднимет admin+бэки **и** Vite :5173. Иначе конфликт портов.
> После правок фронта для прод-:80 нужен `npm run build --prefix frontend` (Caddy отдаёт `dist`, не HMR).

## 2. Рестарт одного сервиса (без перезапуска всего)
```powershell
curl.exe --noproxy '*' -X POST http://127.0.0.1:3005/api/admin/services/<id>/restart
# <id>: kip | dump-trucks | geo-admin | vehicle-status | tyagachi | ai-reports | analytics
```

## 3. Логи / здоровье
```powershell
curl.exe --noproxy '*' http://127.0.0.1:3005/api/admin/services   # статус всех бэков (running/portOpen)
# Дашборд покрытия и управление — http://localhost:5173/admin
```

## 4. Бэкап вручную + проверка
```powershell
powershell -ExecutionPolicy Bypass -File C:\lk-mstroy\scripts\backup.ps1
type C:\lk-backups\LAST_SUCCESS.txt        # таймстамп последнего успешного
```
Расписание: задача Планировщика «LK Mstroy daily backup», ежедневно 19:30.

## 5. Восстановление БД из дампа (restore-drill / DR)
```powershell
$env:Path = 'C:\Program Files\PostgreSQL\17\bin;' + $env:Path
$env:PGPASSWORD = '888'
# локальный дамп (незашифрован):
$d = (Get-ChildItem C:\lk-backups\db\mstroy-*.dump | Sort LastWriteTime -desc | Select -First 1).FullName
dropdb -U postgres mstroy; createdb -U postgres mstroy
pg_restore -U postgres -d mstroy --no-owner --no-privileges -j 4 $d
# облачный (зашифрован age): age -d -i C:\lk-migration\secrets-age-key.txt FILE.age > FILE.dump
```
PostGIS должен быть установлен (он есть в PG17). Аналогично для `kip_vehicles`.

## Деплой обновления
```powershell
cd C:\lk-mstroy
git pull
npm ci --prefix frontend; npm run build --prefix frontend   # фронт (legacy-peer-deps в .npmrc) -> dist
# рестарт бэков (подхватить изменения):
Stop-ScheduledTask 'LK Mstroy backends'; Start-Sleep 3; Start-ScheduledTask 'LK Mstroy backends'
# если менялся Caddyfile/dist — рестарт caddy:
Stop-ScheduledTask 'LK Mstroy caddy'; Start-Sleep 2; Start-ScheduledTask 'LK Mstroy caddy'
# либо точечно один бэк через admin (п.2)
```

## Развернуть с нуля (новая/чистая машина)
1. Бутстрап + зависимости (Node 24 LTS, PG17, PostGIS-бандл, Caddy, age, rclone, Python) — см. vault `01`/`02`.
2. Восстановить секреты (age-бандл) — см. vault `03`.
3. Восстановить БД из дампа (п.5).
4. `npm install` по подпроектам (`scripts\install-deps.ps1` в `C:\lk-migration\`), `npm run dev`.
