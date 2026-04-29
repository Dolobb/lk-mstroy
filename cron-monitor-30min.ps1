$startTime = Get-Date
$endTime = $startTime.AddMinutes(30)
$logFile = "C:\Users\user_ogtr1\Documents\пмворкк\lk-mstroy\lk-mstroy\cron-watch-$(Get-Date -Format 'yyyyMMdd-HHmm').log"
$adminLogsDir = "C:\Users\user_ogtr1\Documents\пмворкк\lk-mstroy\lk-mstroy\admin\logs"
$services = @(
    @{Name="kip"; Url="http://localhost:3001/api/kip/health"},
    @{Name="dump-trucks"; Url="http://localhost:3002/api/dt/health"},
    @{Name="geo-admin"; Url="http://localhost:3003/api/geo/health"},
    @{Name="vehicle-status"; Url="http://localhost:3004/api/vs/health"},
    @{Name="admin"; Url="http://localhost:3005/api/admin/health"},
    @{Name="ai-reports"; Url="http://localhost:3006/api/reports/health"},
    @{Name="tyagachi"; Url="http://localhost:8000/api/tyagachi/health"}
)

function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

Log "=== 30-MINUTE CRON MONITOR STARTED at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "End time: $(Get-Date $endTime -Format 'yyyy-MM-dd HH:mm:ss')"

$prevLogSizes = @{}
foreach ($svc in @("kip","dump-trucks","geo-admin","vehicle-status","tyagachi","ai-reports")) {
    $f = Join-Path $adminLogsDir "$svc.log"
    if (Test-Path $f) { $prevLogSizes[$svc] = (Get-Item $f).Length }
    else { $prevLogSizes[$svc] = 0 }
}

$iteration = 0
while ((Get-Date) -lt $endTime) {
    $iteration++
    $now = Get-Date
    Log "--- PASS #$iteration at $(Get-Date -Format 'HH:mm:ss') ---"

    # 1. Check HTTP endpoints
    foreach ($svc in $services) {
        try {
            $resp = Invoke-WebRequest -Uri $svc.Url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            Log "HTTP $($svc.Name) $($svc.Url) => $($resp.StatusCode) len=$($resp.Content.Length)"
        } catch {
            Log "HTTP $($svc.Name) $($svc.Url) => ERROR: $($_.Exception.Message)"
        }
    }

    # 2. Check admin log file sizes and capture new content
    foreach ($svc in @("kip","dump-trucks","geo-admin","vehicle-status","tyagachi","ai-reports")) {
        $f = Join-Path $adminLogsDir "$svc.log"
        if (Test-Path $f) {
            $curSize = (Get-Item $f).Length
            $prevSize = $prevLogSizes[$svc]
            if ($curSize -ne $prevSize) {
                $diff = $curSize - $prevSize
                Log "LOG-CHANGE $svc.log: was $prevSize now $curSize (delta=$diff)"
                if ($diff -gt 0 -and $diff -lt 50000) {
                    try {
                        $stream = [System.IO.File]::OpenRead($f)
                        $reader = New-Object System.IO.StreamReader($stream)
                        $null = $reader.BaseStream.Seek($prevSize, [System.IO.SeekOrigin]::Begin)
                        $newContent = $reader.ReadToEnd()
                        $reader.Close()
                        $stream.Close()
                        $lines = $newContent -split "`n" | Select-Object -Last 30
                        foreach ($line in $lines) {
                            $trimmed = $line.Trim()
                            if ($trimmed) { Log "  $($svc): $trimmed" }
                        }
                    } catch {
                        Log "  $($svc): [error reading new content: $($_.Exception.Message)]"
                    }
                } elseif ($diff -ge 50000) {
                    Log "  $($svc): [delta too large=$diff, skipping content capture]"
                }
                $prevLogSizes[$svc] = $curSize
            }
        }
    }

    # 3. Check tyagachi pipeline logs (new files?)
    $tyagLogs = "C:\Users\user_ogtr1\Documents\пмворкк\lk-mstroy\lk-mstroy\tyagachi\Data\logs"
    if (Test-Path $tyagLogs) {
        $todayLog = Join-Path $tyagLogs "pipeline_$(Get-Date -Format 'yyyy-MM-dd').log"
        if (Test-Path $todayLog) {
            $sz = (Get-Item $todayLog).Length
            Log "TYAGACHI-PIPELINE today file exists: $sz bytes"
        } else {
            Log "TYAGACHI-PIPELINE no today log file yet"
        }
    }

    # 4. Database snapshots - row counts for key tables
    $env:PGPASSWORD = "max"
    try {
        $kipCount = & psql -h localhost -p 5432 -U max -d kip_vehicles -t -A -c "SELECT 'kip_stays=' || COUNT(*) FROM stays; SELECT 'kip_vehicles=' || COUNT(*) FROM vehicles; SELECT 'kip_latest=' || MAX(date) FROM stays;" 2>&1
        Log "DB-KIP: $kipCount"
    } catch {
        Log "DB-KIP: error - $($_.Exception.Message)"
    }
    try {
        $mstroyCount = & psql -h localhost -p 5432 -U max -d mstroy -t -A -c "SELECT 'dt_trips=' || COUNT(*) FROM dump_trucks.trips; SELECT 'vs_records=' || COUNT(*) FROM vehicle_status.records; SELECT 'dt_latest=' || MAX(date)::text FROM dump_trucks.trips;" 2>&1
        Log "DB-MSTROY: $mstroyCount"
    } catch {
        Log "DB-MSTROY: error - $($_.Exception.Message)"
    }

    # 5. Check running processes (quick snapshot)
    $nodeCount = (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count
    $pythonCount = (Get-Process python -ErrorAction SilentlyContinue | Measure-Object).Count
    Log "PROCESSES: node=$nodeCount python=$pythonCount"

    # 6. Check listening ports
    $ports = netstat -ano | findstr "LISTENING" | findstr "3001 3002 3003 3004 3005 3006 8000"
    $portList = ($ports -split "`n" | ForEach-Object { if ($_ -match ':(\d+)\s') { $matches[1] } }) -join ","
    Log "PORTS: $portList"

    # 7. Try hitting cron/admin endpoints that might trigger fetches
    foreach ($ep in @(
        "http://localhost:3005/api/admin/status",
        "http://localhost:3005/api/admin/cron-status"
    )) {
        try {
            $resp = Invoke-WebRequest -Uri $ep -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            $body = $resp.Content
            if ($body.Length -gt 500) { $body = $body.Substring(0, 500) }
            Log "ADMIN-EP $ep => $($resp.StatusCode): $body"
        } catch {
            Log "ADMIN-EP $ep => ERROR: $($_.Exception.Message)"
        }
    }

    # Wait 30 seconds
    Log "--- sleeping 30s until next pass ---"
    Start-Sleep -Seconds 30
}

Log "=== 30-MINUTE CRON MONITOR ENDED at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log "Total passes: $iteration"
