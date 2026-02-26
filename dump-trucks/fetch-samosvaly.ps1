# fetch-samosvaly.ps1
# Выгрузка данных самосвалов за указанный период
#
# Использование:
#   .\fetch-samosvaly.ps1 -from 2026-02-19 -to 2026-02-25
#
param(
    [Parameter(Mandatory)][string]$from,
    [Parameter(Mandatory)][string]$to
)

$start = [datetime]::ParseExact($from, "yyyy-MM-dd", $null)
$end   = [datetime]::ParseExact($to,   "yyyy-MM-dd", $null)

$dates = @()
for ($d = $start; $d -le $end; $d = $d.AddDays(1)) {
    $dates += $d.ToString("yyyy-MM-dd")
}

Write-Host "Выгрузка самосвалов с $from по $to ($($dates.Count) дней)..."

foreach ($date in $dates) {
    foreach ($shift in @("shift1","shift2")) {
        Write-Host "Fetching $date $shift ..."
        curl.exe -X POST "http://localhost:3002/api/dt/admin/fetch?date=$date&shift=$shift"
        Start-Sleep -Seconds 10
    }
}

Write-Host "Готово!"
