<#
  export-for-mac.ps1 — разовый экспорт прода для Мака (съёмка кейса).
  Пара к scripts/restore-mac.sh.

  Делает:
    0. Показывает git status / stash — чтобы ничего не осталось только на этой машине.
    1. Свежие дампы обеих баз штатным backup.ps1 (он же шифрует и льёт в gdrive:lk-backups/).
    2. Секреты + SQLite тягачей (tyagachi/Data) → tar → age → gdrive:lk-backups/mac-handoff/.

  Ключ secrets-age-key.txt сюда НЕ попадает — его переносить отдельно (менеджер паролей / флешка).

  Запуск:  powershell -NoProfile -ExecutionPolicy Bypass -File C:\lk-mstroy\scripts\export-for-mac.ps1
#>
$ErrorActionPreference = 'Stop'

$Repo         = 'C:\lk-mstroy'
$Age          = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'age.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$Rclone       = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'rclone.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$AgeRecipient = 'age1a3yaymw3rpr98fg5yfycqxazh0prq96ndayhcp6f5q0354re2p3swfdd79'  # тот же, что в backup.ps1
$OutDir       = 'C:\lk-backups\mac-handoff'
$ts           = Get-Date -Format 'yyyyMMdd-HHmmss'

# --- 0. Хвосты в git ---
Write-Output '=== git status (всё, что здесь, должно уйти в коммит/push до удаления Claude) ==='
git -C $Repo status --short --branch
git -C $Repo stash list
git -C $Repo log --branches --not --remotes --oneline   # незапушенные коммиты

# --- 1. Свежие дампы ---
Write-Output '=== backup.ps1 ==='
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Repo\scripts\backup.ps1"
if ($LASTEXITCODE -ne 0) { throw "backup.ps1 упал — см. C:\lk-backups\LAST_FAILURE.txt" }

# --- 2. Секреты + данные тягачей ---
$items = @(
  'admin/.env', 'kip/.env', 'kip/server/.env', 'frontend/.env',
  'dump-trucks/server/.env', 'geo-admin/server/.env', 'vehicle-status/server/.env',
  'vehicle-status/server/creds.json', 'ai-reports/server/.env', 'analytics-backend/server/.env',
  'tyagachi/config.yaml', 'tyagachi/.security-key', 'tyagachi/Data'
) | Where-Object { Test-Path (Join-Path $Repo $_) }
Write-Output "=== в бандл: $($items -join ', ') ==="

New-Item -ItemType Directory -Force $OutDir | Out-Null
$tar = Join-Path $env:TEMP "secrets-$ts.tar.gz"
$enc = Join-Path $OutDir "secrets-$ts.tar.gz.age"
tar -C $Repo -czf $tar @items
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
& $Age -r $AgeRecipient -o $enc $tar
if ($LASTEXITCODE -ne 0) { throw 'age encrypt failed' }
Remove-Item $tar -Force   # незашифрованные секреты не оставляем

# Google — через прокси Happ (как в backup.ps1)
$env:HTTP_PROXY='http://127.0.0.1:10808'; $env:HTTPS_PROXY='http://127.0.0.1:10808'; $env:NO_PROXY='localhost,127.0.0.1'
& $Rclone copy $enc 'gdrive:lk-backups/mac-handoff/' --no-traverse
if ($LASTEXITCODE -ne 0) { throw 'rclone upload failed' }

Write-Output "=== готово: $enc → gdrive:lk-backups/mac-handoff/ ==="
Write-Output 'Дальше на Маке: scripts/restore-mac.sh (нужен ключ C:\lk-migration\secrets-age-key.txt)'
