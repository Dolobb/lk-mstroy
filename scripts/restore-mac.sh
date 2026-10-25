#!/usr/bin/env bash
# restore-mac.sh — поднять на Маке копию прода (для съёмки кейса). Пара к scripts/export-for-mac.ps1.
#
#   scripts/restore-mac.sh [папка с .age]   без аргумента — свежие файлы из yadisk:lk-backups
#
# Обе базы кладёт в PG17 :5433 (как на проде — один инстанс). Старые mstroy/kip_vehicles на :5433
# не удаляются, а переименовываются в *_old_<stamp>; PG16 :5432 не трогается.
# По умолчанию глушит TIS, SMTP, catchup и cron: Мак не должен жрать rate-limit прода (1 запрос/30с
# на idMO, токены общие) и слать дубли писем. ALLOW_TIS=1 — не глушить TIS.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=${AGE_KEY:-$HOME/.config/lk-mstroy/age-key.txt}
PG=/opt/homebrew/opt/postgresql@17/bin
PORT=5433
SRC=${1:-$HOME/lk-handoff}
STAMP=$(date +%Y%m%d_%H%M)

command -v age >/dev/null || { echo "нет age: brew install age"; exit 1; }
[ -f "$KEY" ] || { echo "нет ключа $KEY (C:\\lk-migration\\secrets-age-key.txt с винды, chmod 600)"; exit 1; }
if nc -z localhost 3005 2>/dev/null; then echo "стек запущен (:3005) — останови npm run dev"; exit 1; fi

# --- 0. Скачать свежие файлы ---
if [ -z "${1:-}" ]; then
  mkdir -p "$SRC"
  pull() { local f; f=$(rclone lsf "$1" --include "$2" | sort | tail -1)
           [ -n "$f" ] || { echo "в $1 нет $2"; exit 1; }; rclone copy "$1/$f" "$SRC"; }
  pull yadisk:lk-backups 'mstroy-*.dump.age'
  pull yadisk:lk-backups 'kip_vehicles-*.dump.age'
  pull yadisk:lk-backups/mac-handoff 'secrets-*.tar.gz.age'
fi
latest() { ls "$SRC"/$1 | sort | tail -1; }
echo "файлы: $(basename "$(latest 'mstroy-*.age')") $(basename "$(latest 'kip_vehicles-*.age')") $(basename "$(latest 'secrets-*.age')")"

# --- 1. Секреты + tyagachi/Data (текущие Маковские — в .bak-<stamp>) ---
for f in admin/.env kip/.env frontend/.env tyagachi/config.yaml; do [ -f "$f" ] && cp "$f" "$f.bak-$STAMP"; done
[ -d tyagachi/Data ] && mv tyagachi/Data "tyagachi/Data.bak-$STAMP"
age -d -i "$KEY" "$(latest 'secrets-*.age')" | tar -xzf -
chmod 600 vehicle-status/server/creds.json 2>/dev/null || true

# --- 2. Подгонка .env под Мак ---
setenv() { [ -f "$1" ] || return 0
  if grep -q "^$2=" "$1"; then sed -i '' "s|^$2=.*|$2=$3|" "$1"; else printf '\n%s=%s\n' "$2" "$3" >> "$1"; fi; }

for f in kip/.env kip/server/.env dump-trucks/server/.env geo-admin/server/.env \
         vehicle-status/server/.env analytics-backend/server/.env; do setenv "$f" DB_PORT $PORT; done
setenv admin/.env KIP_DB_PORT $PORT
setenv admin/.env MAIN_DB_PORT $PORT
setenv analytics-backend/server/.env KIP_DB_PORT $PORT
setenv ai-reports/server/.env PG16_PORT $PORT
setenv ai-reports/server/.env PG17_PORT $PORT
setenv vehicle-status/server/.env GOOGLE_CREDS_PATH "$PWD/vehicle-status/server/creds.json"

setenv vehicle-status/server/.env CRON_DISABLED true   # остальным admin сам ставит CRON_DISABLED
setenv admin/.env CATCHUP_ENABLED false
setenv admin/.env SMTP_HOST ''
setenv admin/.env HEARTBEAT_URL ''
if [ "${ALLOW_TIS:-0}" != 1 ]; then
  for f in kip/.env kip/server/.env dump-trucks/server/.env analytics-backend/server/.env; do
    grep -q '^TIS_API_URL=' "$f" 2>/dev/null && setenv "$f" TIS_API_URL http://127.0.0.1:9
  done
  sed -i '' -E 's|^([[:space:]]*base_url:).*|\1 "http://127.0.0.1:9"|' tyagachi/config.yaml
fi
# планировщик тягачей: enabled: false внутри блока scheduler:
awk '/^scheduler:/{s=1} /^[^[:space:]#]/&&!/^scheduler:/{s=0} s&&/^[[:space:]]+enabled:/{sub(/true/,"false")} {print}' \
  tyagachi/config.yaml > tyagachi/config.yaml.tmp && mv tyagachi/config.yaml.tmp tyagachi/config.yaml

# --- 3. Базы ---
psql() { "$PG/psql" -p $PORT -v ON_ERROR_STOP=1 -X "$@"; }
psql -d postgres -qc "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres')
                      THEN CREATE ROLE postgres SUPERUSER LOGIN; END IF; END\$\$"   # .env прода ходят под postgres
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for db in mstroy kip_vehicles; do
  if [ "$(psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$db'")" = 1 ]; then
    psql -d postgres -qc "ALTER DATABASE $db RENAME TO ${db}_old_$STAMP"
    echo "$db → ${db}_old_$STAMP"
  fi
  "$PG/createdb" -p $PORT "$db"
  age -d -i "$KEY" "$(latest "$db-*.age")" > "$TMP/$db.dump"
  # не || exit: на расхождениях версий PostGIS бывают безвредные ошибки, итог проверяем ниже
  "$PG/pg_restore" -p $PORT -d "$db" --no-owner --no-privileges -j 4 "$TMP/$db.dump" || echo "⚠ pg_restore $db: были ошибки, см. выше"
  rm "$TMP/$db.dump"
done

# --- 4. Проверка ---
echo "=== данные ==="
psql -d kip_vehicles -Atc "SELECT 'КИП: '||count(*)||' смен, по '||max(report_date) FROM vehicle_records"
psql -d mstroy -Atc "SELECT 'Самосвалы: '||count(*)||' смен, по '||max(report_date) FROM dump_trucks.shift_records"
psql -d mstroy -Atc "SELECT 'Гео: '||count(*)||' объектов' FROM geo.objects"
echo "=== виндовые пути в конфигах (поправить руками, если есть) ==="
grep -nE '[A-Z]:\\|[A-Z]:/' */.env */server/.env tyagachi/config.yaml 2>/dev/null || echo "нет"
echo "Старые базы: DROP DATABASE mstroy_old_$STAMP / kip_vehicles_old_$STAMP, когда убедишься, что всё ок."
echo "Запуск: npm run dev → http://localhost:5173/?demo=1"
