@echo off
rem LK Mstroy - backends launcher (admin process-manager + 8 backends via tsx watch).
rem Started by Scheduled Task "LK Mstroy backends" at system startup, as user monit.
setlocal
set "PATH=C:\Program Files\nodejs;C:\Program Files\PostgreSQL\17\bin;C:\Users\monit\AppData\Local\Programs\Python\Python314;C:\Users\monit\AppData\Local\Programs\Python\Python314\Scripts;%PATH%"
cd /d C:\lk-mstroy
echo.>> C:\lk-mstroy\logs\backends.log
echo ==== %date% %time% start-backends ====>> C:\lk-mstroy\logs\backends.log
call npm.cmd run dev --prefix admin >> C:\lk-mstroy\logs\backends.log 2>&1
