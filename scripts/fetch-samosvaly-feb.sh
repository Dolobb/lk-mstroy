#!/bin/bash
# Загрузка данных самосвалов за февраль 2026
# Требует запущенного dump-trucks сервера на :3002
# Запуск: bash scripts/fetch-samosvaly-feb.sh

set -e

BASE_URL="http://localhost:3002/api/dt/admin/fetch"

for day in $(seq -f "%02g" 1 25); do
  DATE="2026-02-${day}"
  echo "--- Fetching ${DATE} shift1..."
  curl -s -X POST "${BASE_URL}?date=${DATE}&shift=shift1" | python3 -m json.tool 2>/dev/null || echo "(no output)"
  sleep 3

  echo "--- Fetching ${DATE} shift2..."
  curl -s -X POST "${BASE_URL}?date=${DATE}&shift=shift2" | python3 -m json.tool 2>/dev/null || echo "(no output)"
  sleep 3
done

echo ""
echo "Done! Загрузка февраля завершена."
