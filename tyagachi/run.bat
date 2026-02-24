@echo off
REM ============================================================
REM Transport Analytics Pipeline - Launch Script (Windows)
REM ============================================================
REM
REM Использование:
REM   run.bat                      - запуск с файлами по умолчанию
REM   run.bat -r req.json          - свой файл заявок
REM   run.bat -r req.json -p pl.json -o out\  - все параметры
REM
REM ============================================================

cd /d "%~dp0"

echo ============================================================
echo Transport Analytics Pipeline
echo ============================================================
echo.

REM Проверка наличия Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ОШИБКА: Python не найден!
    echo Установите Python 3.8+ с https://www.python.org/
    echo.
    pause
    exit /b 1
)

REM Активация виртуального окружения если есть
if exist ".venv\Scripts\activate.bat" (
    echo Активация виртуального окружения...
    call .venv\Scripts\activate.bat
) else if exist "venv\Scripts\activate.bat" (
    echo Активация виртуального окружения...
    call venv\Scripts\activate.bat
)

REM Проверка зависимостей
echo Проверка зависимостей...
python -c "import pandas; import yaml" 2>nul
if %ERRORLEVEL% neq 0 (
    echo Установка зависимостей...
    python -m pip install -r requirements.txt
)

echo.

REM Запуск пайплайна с переданными аргументами
python main.py %*
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% equ 0 (
    echo Готово! Результаты в директории Data\final\
) else (
    echo Произошла ошибка. Проверьте сообщения выше.
)

echo.
pause
exit /b %EXIT_CODE%
