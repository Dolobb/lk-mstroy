@echo off
REM Запускает PostgreSQL 16 с авто-UAC. Двойной клик → "Да" в UAC → готово.

net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo === Running as administrator ===
sc config postgresql-x64-16 start= auto
net start postgresql-x64-16
sc query postgresql-x64-16 | findstr STATE
echo.
echo Done. Press any key to close.
pause >nul
