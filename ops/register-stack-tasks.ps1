<#
  register-stack-tasks.ps1 - register LK Mstroy stack as startup Scheduled Tasks.
  Runs as user 'monit' with "run whether logged on or not" (LogonType Password).
  Windows stores the password encrypted (DPAPI) - no plaintext on disk.

  Usage (from elevated PowerShell if non-elevated reports access denied):
    powershell -ExecutionPolicy Bypass -File C:\lk-mstroy\ops\register-stack-tasks.ps1 -Password '<windows-pw>'

  Two tasks:
    "LK Mstroy backends" -> ops\start-backends.cmd (admin + 8 backends)
    "LK Mstroy caddy"    -> ops\start-caddy.cmd    (Caddy :80 -> dist + /api)
  Both: AtStartup (+20s delay so PostgreSQL service is up), unlimited runtime,
  restart-on-failure every 1 min.
#>
param(
  [string]$User = 'monit',
  [Parameter(Mandatory = $true)][string]$Password
)
$ErrorActionPreference = 'Stop'

$tasks = @(
  @{ Name = 'LK Mstroy backends'; Cmd = 'C:\lk-mstroy\ops\start-backends.cmd'; Desc = 'Admin process-manager + 8 backends (tsx watch). LK Mstroy stack.' },
  @{ Name = 'LK Mstroy caddy';    Cmd = 'C:\lk-mstroy\ops\start-caddy.cmd';    Desc = 'Caddy reverse-proxy :80 serving frontend/dist + /api. LK Mstroy stack.' }
)

foreach ($t in $tasks) {
  $action   = New-ScheduledTaskAction -Execute $t.Cmd
  $trigger  = New-ScheduledTaskTrigger -AtStartup
  $trigger.Delay = 'PT20S'
  $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -MultipleInstances IgnoreNew `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger `
      -Settings $settings -User $User -Password $Password -RunLevel Limited `
      -Description $t.Desc -Force | Out-Null
  Write-Host ("registered: " + $t.Name)
}

Get-ScheduledTask | Where-Object { $_.TaskName -like 'LK Mstroy*' } |
  Select-Object TaskName, State | Format-Table -AutoSize
