@echo off
rem LK Mstroy - Caddy launcher (reverse-proxy :80 -> frontend/dist + /api backends).
rem Started by Scheduled Task "LK Mstroy caddy" at system startup, as user monit.
rem caddy.exe is pinned in ops\bin so winget upgrades do not move it.
cd /d C:\lk-mstroy
rem Fuel bearer token for Caddyfile {$FUEL_ADMIN_TOKEN} - kept in frontend\.env (not committed).
for /f "usebackq tokens=1,* delims==" %%A in ("C:\lk-mstroy\frontend\.env") do if "%%A"=="FUEL_ADMIN_TOKEN" set "FUEL_ADMIN_TOKEN=%%B"
echo.>> C:\lk-mstroy\logs\caddy-run.log
echo ==== %date% %time% start-caddy ====>> C:\lk-mstroy\logs\caddy-run.log
"C:\lk-mstroy\ops\bin\caddy.exe" run --config C:\lk-mstroy\Caddyfile >> C:\lk-mstroy\logs\caddy-run.log 2>&1
