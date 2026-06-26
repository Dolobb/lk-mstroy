<#
  register-backup-task.ps1 — регистрирует ежедневный бэкап в Планировщике задач Windows.
  Запускать ОДИН раз. Контекст — текущий пользователь (monit), интерактивно (как на старой машине).

  Расписание: ежедневно 19:30 (после ежедневного дампа старой машины в 19:00 — на время параллельного прогона).

  ПРИМЕЧАНИЕ: эта задача срабатывает, когда monit залогинен (Interactive). Для unattended-режима
  (работа при разлогиненном пользователе) пересоздать с "-LogonType Password" + пароль + из-под админа — PLACEHOLDER.
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'LK Mstroy daily backup'
$Script   = 'C:\lk-mstroy\scripts\backup.ps1'

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 19:30
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Output "Задача '$TaskName' зарегистрирована (ежедневно 19:30, контекст $env:USERNAME)."
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
(Get-ScheduledTaskInfo -TaskName $TaskName).NextRunTime
