@echo off
rem LK Mstroy - Caddy launcher (reverse-proxy :80 -> frontend/dist + /api backends).
rem Started by Scheduled Task "LK Mstroy caddy" at system startup, as user monit.
rem caddy.exe is pinned in ops\bin so winget upgrades do not move it.
cd /d C:\lk-mstroy
echo.>> C:\lk-mstroy\logs\caddy-run.log
echo ==== %date% %time% start-caddy ====>> C:\lk-mstroy\logs\caddy-run.log
"C:\lk-mstroy\ops\bin\caddy.exe" run --config C:\lk-mstroy\Caddyfile >> C:\lk-mstroy\logs\caddy-run.log 2>&1
