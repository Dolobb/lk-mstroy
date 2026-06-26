<#
  backup.ps1 — ежедневный бэкап ЛК Мстрой (новая прод-машина).
  Шаг 6 плана миграции ([[06-Backup-and-DR]]).

  Делает:
    1. pg_dump обеих баз (mstroy + kip_vehicles), custom-формат, с таймстампом → локально (C:\lk-backups\db).
    2. Шифрует копии для облака через age (recipient = публичный ключ из secrets-age-key.txt).
    3. Заливает зашифрованные дампы в Яндекс.Диск (RU) — yadisk:lk-backups/ (прокси Hiddify обходится).
    4. Ротация: локально храним $KeepDaysLocal дней, в облаке — $KeepDaysCloud.
    5. Лог + маркер-файл последнего успеха (для сигнала «бэкап устарел»).

  Локальные дампы — НЕзашифрованы (быстрый откат в доверенной среде).
  Облачные — зашифрованы (age). Расшифровать: age -d -i secrets-age-key.txt FILE.age > FILE

  Запуск вручную:  powershell -NoProfile -ExecutionPolicy Bypass -File C:\lk-mstroy\scripts\backup.ps1
  Планировщик:     задача "LK Mstroy daily backup", ежедневно (см. scripts\register-backup-task.ps1).
#>
$ErrorActionPreference = 'Stop'

# --- Конфиг ---
$PgBin        = 'C:\Program Files\PostgreSQL\17\bin'
$Age          = 'C:\Users\monit\AppData\Local\Microsoft\WinGet\Packages\FiloSottile.age_Microsoft.Winget.Source_8wekyb3d8bbwe\age\age.exe'
$Rclone       = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'rclone.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
$AgeRecipient = 'age1a3yaymw3rpr98fg5yfycqxazh0prq96ndayhcp6f5q0354re2p3swfdd79'  # публичный ключ из secrets-age-key.txt
$BackupRoot   = 'C:\lk-backups'                 # TODO: при установке HDD 2TB перенести на второй диск
$DbDir        = Join-Path $BackupRoot 'db'
$EncDir       = Join-Path $BackupRoot 'enc'
$LogDir       = Join-Path $BackupRoot 'logs'
$RemoteDir    = 'yadisk:lk-backups'
$Databases    = @('mstroy','kip_vehicles')
$KeepDaysLocal = 14
$KeepDaysCloud = 30
$env:PGPASSWORD = '888'

# --- Подготовка ---
foreach ($d in $DbDir,$EncDir,$LogDir) { New-Item -ItemType Directory -Force $d | Out-Null }
$ts  = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $LogDir "backup-$ts.log"
$marker = Join-Path $BackupRoot 'LAST_SUCCESS.txt'
function Log($m){ $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; $line | Tee-Object -FilePath $log -Append | Out-Null; Write-Output $line }

# Яндекс — RU-инфра, прокси Hiddify надо обойти
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:NO_PROXY='*'

$ok = $true
try {
  Log "=== backup start $ts ==="
  foreach ($db in $Databases) {
    $dump = Join-Path $DbDir "$db-$ts.dump"
    Log "pg_dump $db -> $dump"
    & "$PgBin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -Fc -d $db -f $dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump $db failed ($LASTEXITCODE)" }
    $mb = [math]::Round((Get-Item $dump).Length/1MB,1); Log "  ok, ${mb}MB"

    # шифруем для облака
    $enc = Join-Path $EncDir "$db-$ts.dump.age"
    & $Age -r $AgeRecipient -o $enc $dump
    if ($LASTEXITCODE -ne 0) { throw "age encrypt $db failed ($LASTEXITCODE)" }
    Log "  encrypted -> $enc"

    # заливаем в облако
    if ($Rclone) {
      & $Rclone copy $enc "$RemoteDir/" --no-traverse 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "rclone upload $db failed ($LASTEXITCODE)" }
      Log "  uploaded -> $RemoteDir/"
    } else { Log "  WARN: rclone не найден — облачная заливка пропущена" }
  }

  # --- Ротация локально ---
  $cutLocal = (Get-Date).AddDays(-$KeepDaysLocal)
  Get-ChildItem $DbDir,$EncDir -File | Where-Object { $_.LastWriteTime -lt $cutLocal } | ForEach-Object { Log "rotate local: rm $($_.Name)"; Remove-Item $_.FullName -Force }

  # --- Ротация в облаке ---
  if ($Rclone) { & $Rclone delete "$RemoteDir/" --min-age "${KeepDaysCloud}d" 2>&1 | Out-Null }

  "$ts" | Set-Content $marker
  Log "=== backup OK $ts ==="
}
catch {
  $ok = $false
  Log "!!! backup FAILED: $($_.Exception.Message)"
  # TODO(alert): отправить письмо о провале (нужны SMTP-креды). Пока — маркер + ненулевой exit.
  "$ts FAILED: $($_.Exception.Message)" | Set-Content (Join-Path $BackupRoot 'LAST_FAILURE.txt')
}
finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }

if (-not $ok) { exit 1 }
