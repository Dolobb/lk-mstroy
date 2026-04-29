$ErrorActionPreference = "SilentlyContinue"
$startTime = Get-Date
$endTime = $startTime.AddMinutes(30)
$logFile = "C:\Users\user_ogtr1\Documents\пмворкк\lk-mstroy\lk-mstroy\cron-watch-30min.log"
$adminDir = "C:\Users\user_ogtr1\Documents\пмворкк\lk-mstroy\lk-mstroy\admin\logs"

function WL($m) {
    try {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $logFile -Value "[$ts] $m" -Encoding UTF8
    } catch {}
}

WL "===== MONITOR START ====="
WL "Start: $startTime End: $endTime"

$sizes = @{}
"kip","dump-trucks","geo-admin","vehicle-status","tyagachi","ai-reports" | ForEach-Object {
    $fn = "$adminDir\$_.log"
    if (Test-Path $fn) { $sizes[$_] = (Get-Item $fn).Length } else { $sizes[$_] = 0 }
}

$iter = 0
while ((Get-Date) -lt $endTime) {
    $iter++
    WL "--- PASS $iter ---"

    # HTTP checks
    @(
        @("kip","http://localhost:3001/api/kip/health"),
        @("dt","http://localhost:3002/api/dt/health"),
        @("geo","http://localhost:3003/api/geo/health"),
        @("vs","http://localhost:3004/api/vs/health"),
        @("admin","http://localhost:3005/api/admin/status"),
        @("reports","http://localhost:3006/api/reports/health"),
        @("tyag","http://localhost:8000/api/tyagachi/health")
    ) | ForEach-Object {
        $n = $_[0]; $u = $_[1]
        try {
            $r = Invoke-WebRequest -Uri $u -TimeoutSec 5 -UseBasicParsing
            WL "HTTP $n => $($r.StatusCode) len=$($r.Content.Length)"
            if ($r.Content.Length -lt 2000) { WL "  BODY: $($r.Content)" }
        } catch {
            WL "HTTP $n => ERR: $($_.Exception.Message.Substring(0,[Math]::Min(200,$_.Exception.Message.Length)))"
        }
    }

    # Admin log changes
    "kip","dump-trucks","geo-admin","vehicle-status","tyagachi","ai-reports" | ForEach-Object {
        $fn = "$adminDir\$_.log"
        if (Test-Path $fn) {
            $cur = (Get-Item $fn).Length
            $prev = $sizes[$_]
            if ($cur -ne $prev) {
                WL "LOG $_ delta=$($cur-$prev) was=$prev now=$cur"
                if ($cur -gt $prev -and ($cur-$prev) -lt 30000) {
                    try {
                        $bytes = [System.IO.File]::ReadAllBytes($fn)
                        $txt = [System.Text.Encoding]::UTF8.GetString($bytes, $prev, [Math]::Min($cur-$prev, 5000))
                        $txt -split "`n" | Select-Object -Last 20 | ForEach-Object {
                            $t = $_.Trim()
                            if ($t) { WL "  $_ | $t" }
                        }
                    } catch { WL "  read-err" }
                }
                $sizes[$_] = $cur
            }
        }
    }

    # DB quick check
    try {
        $env:PGPASSWORD = "max"
        $r1 = & psql -h localhost -p 5432 -U max -d kip_vehicles -t -A -c "SELECT COUNT(*) FROM stays;" 2>&1
        $r2 = & psql -h localhost -p 5432 -U max -d mstroy -t -A -c "SELECT COUNT(*) FROM dump_trucks.trips;" 2>&1
        $r3 = & psql -h localhost -p 5432 -U max -d mstroy -t -A -c "SELECT COUNT(*) FROM vehicle_status.records;" 2>&1
        WL "DB kip_stays=$r1 dt_trips=$r2 vs_records=$r3"
    } catch { WL "DB-ERR" }

    # Processes
    $nc = (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count
    $pc = (Get-Process python -ErrorAction SilentlyContinue | Measure-Object).Count
    WL "PROC node=$nc python=$pc"

    WL "sleep 30s"
    Start-Sleep -Seconds 30
}

WL "===== MONITOR END after $iter passes ====="
