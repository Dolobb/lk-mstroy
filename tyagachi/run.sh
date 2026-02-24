#!/bin/bash
# ============================================================
# Transport Analytics Pipeline - Launch Script (Mac/Linux)
# ============================================================
#
# Использование:
#   ./run.sh                      - интерактивный выбор файлов
#   ./run.sh -r req.json -p pl.json  - указать файлы напрямую
#
# ============================================================

# Определяем директорию скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Проверка наличия Python
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "ОШИБКА: Python не найден!"
        echo "Установите Python 3.8+ с https://www.python.org/"
        exit 1
    fi
    PYTHON_CMD="python"
else
    PYTHON_CMD="python3"
fi

# Активация виртуального окружения если есть
if [ -d ".venv" ]; then
    source .venv/bin/activate 2>/dev/null
elif [ -d "venv" ]; then
    source venv/bin/activate 2>/dev/null
fi

# Проверка зависимостей (тихо)
$PYTHON_CMD -c "import pandas; import yaml" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Установка зависимостей..."
    $PYTHON_CMD -m pip install -r requirements.txt -q
fi

# Запуск пайплайна с переданными аргументами
$PYTHON_CMD main.py "$@"
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "Готово! Результаты в директории Data/final/"
else
    echo "Произошла ошибка. Проверьте сообщения выше."
fi

exit $EXIT_CODE
