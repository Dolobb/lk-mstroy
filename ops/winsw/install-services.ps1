<#
  install-services.ps1 — регистрация Windows-служб ЛК Мстрой через WinSW.
  ТРЕБУЕТ ЗАПУСКА ОТ АДМИНИСТРАТОРА (PLACEHOLDER: выполнить вручную, когда будете готовы перейти
  с ручного `npm run dev` на службы).

  Что делает:
    1. Качает WinSW (если нет) рядом с каждым xml как <id>.exe.
    2. Ставит и стартует службы lk-admin и lk-caddy.
  PostgreSQL уже служба (postgresql-x64-17), её ставить не нужно.

  ВНИМАНИЕ:
    - Перед установкой lk-admin остановить ручной `npm run dev` (конфликт портов).
    - lk-admin (интерим) гоняет dev-watcher'ы — см. примечание в lk-admin.xml.
    - Прокси: службы наследуют системное окружение; убедиться, что NO_PROXY покрывает localhost.
#>
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$winswUrl = 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe'  # проверить актуальную версию

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrator')) {
  Write-Error 'Запустите из PowerShell от администратора.'; exit 1
}

foreach ($id in 'lk-admin','lk-caddy') {
  $xml = Join-Path $dir "$id.xml"
  $exe = Join-Path $dir "$id.exe"
  if (-not (Test-Path $exe)) {
    Write-Host "Скачиваю WinSW для $id ..."
    curl.exe -fL --noproxy '' -o $exe $winswUrl   # при необходимости через --proxy
  }
  & $exe install $xml
  & $exe start   $xml
  Write-Host "$id установлен и запущен."
}
Get-Service lk-admin, lk-caddy | Select-Object Name, Status, StartType
