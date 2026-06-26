# ops/bin — запиненные бинарники (НЕ в git)

Здесь лежит `caddy.exe`, который запускает служба фронта (`ops\start-caddy.cmd` →
задача Планировщика «LK Mstroy caddy»). Сам бинарник в git не хранится (48 МБ), но путь
к нему зафиксирован, чтобы winget-апгрейды не сдвигали Caddy.

## Восстановить `caddy.exe` (на новой/чистой машине)

Caddy ставится через winget, потом копируем exe сюда:

```powershell
winget install CaddyServer.Caddy
copy "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe" "C:\lk-mstroy\ops\bin\caddy.exe"
```

Проверка: `C:\lk-mstroy\ops\bin\caddy.exe version` (должна быть v2.11.x).
Версия на проде на 2026-06-26: **v2.11.4**.
