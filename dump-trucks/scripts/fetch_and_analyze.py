#!/usr/bin/env python3
"""
Шаг 2-5: Выгрузка ПЛ + заявки + мониторинг → анализ треков → CSV таблицы

Шаг 2: ПЛ за 7 дней + заявки за 2 месяца → матчинг
Шаг 3: Фильтр ПЛ — только наши самосвалы (по idMO из реестра)
Шаг 4: Мониторинг по дате начала/окончания ПЛ (как в тягачах)
Шаг 5: CSV: trips_raw.csv (промежуточная) + summary.csv (финальная)
"""

import json
import os
import re
import sys
import time
import csv
import requests
from datetime import datetime, timedelta

# --- Пути ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, 'server', '.env')
REGISTRY_PATH = os.path.join(BASE_DIR, 'config', 'dump-trucks-registry.json')
OUTPUT_DIR = os.path.join(BASE_DIR, 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- Конфиг ---
PL_DAYS_BACK = 7
REQ_DAYS_BACK = 60
RATE_LIMIT_SEC = 31  # между запросами мониторинга для одного idMO

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def load_registry(path):
    with open(path) as f:
        data = json.load(f)
    by_id = {v['idMo']: v for v in data['vehicles']}
    return by_id

def parse_date(s):
    """DD.MM.YYYY или DD.MM.YYYY HH:mm:ss или DD.MM.YYYY HH:mm"""
    for fmt in ('%d.%m.%Y %H:%M:%S', '%d.%m.%Y %H:%M', '%d.%m.%Y'):
        try:
            return datetime.strptime(s, fmt)
        except:
            pass
    return None

def fmt_date(dt):
    return dt.strftime('%d.%m.%Y')

def fmt_datetime(dt):
    return dt.strftime('%d.%m.%Y %H:%M')

def extract_request_number(order_descr):
    """Номер заявки из orderDescr: ведущий ^ (\d+)"""
    if not order_descr:
        return None
    cleaned = order_descr.lstrip('№').lstrip()
    m = re.match(r'^(\d+)', cleaned)
    return int(m.group(1)) if m else None

# --- TIS API ---
class TisClient:
    def __init__(self, base_url, tokens):
        self.base_url = base_url
        self.tokens = tokens
        self.token_idx = 0
        self.last_call = {}  # idMO → timestamp

    def _next_token(self):
        t = self.tokens[self.token_idx % len(self.tokens)]
        self.token_idx += 1
        return t

    def _post(self, command, params, timeout=60):
        token = self._next_token()
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        url = f"{self.base_url}?token={token}&format=json&command={command}&{qs}"
        for attempt in range(3):
            try:
                resp = requests.post(url, timeout=timeout)
                if resp.status_code == 429:
                    print(f"  429 rate limit, wait 10s...")
                    time.sleep(10)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.Timeout:
                print(f"  Timeout, retry {attempt+1}/3")
                time.sleep(2 ** attempt)
            except Exception as e:
                print(f"  Error: {e}")
                return None
        return None

    def get_route_lists(self, from_date, to_date):
        data = self._post('getRouteListsByDateOut', {
            'fromDate': fmt_date(from_date),
            'toDate':   fmt_date(to_date),
        })
        return data.get('list', []) if data else []

    def get_requests(self, from_date, to_date):
        data = self._post('getRequests', {
            'fromDate': fmt_date(from_date),
            'toDate':   fmt_date(to_date),
        })
        return data.get('list', []) if data else []

    def get_monitoring(self, id_mo, from_dt, to_dt):
        # Rate limit: 30 сек между запросами для одного idMO
        now = time.time()
        last = self.last_call.get(id_mo, 0)
        wait = RATE_LIMIT_SEC - (now - last)
        if wait > 0:
            print(f"  Rate limit: ждём {wait:.1f}с для idMO={id_mo}...")
            time.sleep(wait)
        self.last_call[id_mo] = time.time()

        data = self._post('getMonitoringStats', {
            'idMO':     id_mo,
            'fromDate': fmt_datetime(from_dt),
            'toDate':   fmt_datetime(to_dt),
        }, timeout=30)
        return data

# --- Анализ трека (упрощённый, без геозон — только подсчёт рейсов) ---
def analyze_track_simple(monitoring):
    """
    Простой анализ: считаем остановки как потенциальные рейсы.
    Полноценный анализ с геозонами — в Node.js pipeline.
    Здесь: даём сырые данные для ручной верификации.
    """
    if not monitoring:
        return {
            'engine_time_h': 0,
            'moving_time_h': 0,
            'distance_km': 0,
            'parkings_count': 0,
            'track_points': 0,
        }
    engine = monitoring.get('engineTime', 0) or 0
    moving = monitoring.get('movingTime', 0) or 0
    dist   = monitoring.get('distance', 0) or 0
    parkings = monitoring.get('parkings', []) or []
    track    = monitoring.get('track', []) or []
    return {
        'engine_time_h':  round(engine / 3600, 2),
        'moving_time_h':  round(moving / 3600, 2),
        'distance_km':    round(float(dist), 1),
        'parkings_count': len(parkings),
        'track_points':   len(track),
    }

def main():
    # --- Загрузка ---
    env = load_env(ENV_PATH)
    base_url = env.get('TIS_API_URL', '')
    tokens = [t.strip() for t in env.get('TIS_API_TOKENS', '').split(',') if t.strip()]
    registry = load_registry(REGISTRY_PATH)
    our_ids = set(registry.keys())
    print(f"Реестр: {len(our_ids)} самосвалов")
    print(f"Токены: {len(tokens)}")

    tis = TisClient(base_url, tokens)

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # --- Шаг 2: ПЛ за 7 дней ---
    pl_from = today - timedelta(days=PL_DAYS_BACK)
    pl_to   = today
    print(f"\n[Шаг 2] Загрузка ПЛ: {fmt_date(pl_from)} – {fmt_date(pl_to)}")
    route_lists = tis.get_route_lists(pl_from, pl_to)
    print(f"  Получено ПЛ: {len(route_lists)}")

    # --- Шаг 2: Заявки за 2 месяца ---
    req_from = today - timedelta(days=REQ_DAYS_BACK)
    print(f"\n[Шаг 2] Загрузка заявок: {fmt_date(req_from)} – {fmt_date(today)}")
    requests_list = tis.get_requests(req_from, today)
    print(f"  Получено заявок: {len(requests_list)}")

    # Индекс заявок по номеру
    req_by_number = {}
    for r in requests_list:
        num = r.get('number')
        if num:
            req_by_number[int(num)] = r

    # --- Шаг 3: Фильтр ПЛ по нашим самосвалам ---
    print(f"\n[Шаг 3] Фильтрация ПЛ по нашим самосвалам...")
    our_pls = []
    for pl in route_lists:
        ts_list = pl.get('ts', [])
        for ts in ts_list:
            id_mo = ts.get('idMO')
            if id_mo in our_ids:
                # Парсим даты
                date_out_plan = parse_date(pl.get('dateOutPlan', ''))
                date_in_plan  = parse_date(pl.get('dateInPlan', ''))
                if not date_out_plan or not date_in_plan:
                    continue

                # Номера заявок из calcs
                request_numbers = []
                object_expends  = []
                for calc in pl.get('calcs', []):
                    num = extract_request_number(calc.get('orderDescr', ''))
                    if num and num not in request_numbers:
                        request_numbers.append(num)
                    obj = calc.get('objectExpend', '')
                    if obj and obj not in object_expends:
                        object_expends.append(obj)

                # Матчинг с заявками
                matched_requests = []
                for rnum in request_numbers:
                    req = req_by_number.get(rnum)
                    if req:
                        matched_requests.append({
                            'number':       rnum,
                            'status':       req.get('status', ''),
                            'contactPerson': req.get('contactPerson', ''),
                        })

                vehicle_info = registry[id_mo]
                our_pls.append({
                    'pl_id':           pl.get('id'),
                    'ts_number':       pl.get('tsNumber'),
                    'pl_status':       pl.get('status'),
                    'id_mo':           id_mo,
                    'reg_number':      ts.get('regNumber', vehicle_info.get('regNumber', '')),
                    'name_mo':         ts.get('nameMO', ''),
                    'model':           vehicle_info.get('model', ''),
                    'branch':          vehicle_info.get('branch', ''),
                    'volume_m3':       vehicle_info.get('volumeM3'),
                    'weight_t':        vehicle_info.get('weightT'),
                    'date_out_plan':   date_out_plan,
                    'date_in_plan':    date_in_plan,
                    'date_out':        pl.get('dateOut', ''),
                    'request_numbers': request_numbers,
                    'object_expends':  object_expends,
                    'requests':        matched_requests,
                })

    print(f"  Наших ПЛ: {len(our_pls)}")

    # Группировка по машинам
    by_vehicle = {}
    for pl in our_pls:
        idmo = pl['id_mo']
        by_vehicle.setdefault(idmo, []).append(pl)
    print(f"  Уникальных машин с ПЛ: {len(by_vehicle)}")
    for idmo, pls in sorted(by_vehicle.items()):
        r = pls[0]
        print(f"    idMO={idmo}  {r['reg_number']:12}  {len(pls)} ПЛ")

    # --- Сохраняем структуру ПЛ для просмотра ---
    pls_dump = []
    for pl in our_pls:
        pls_dump.append({**pl,
            'date_out_plan': pl['date_out_plan'].strftime('%d.%m.%Y %H:%M'),
            'date_in_plan':  pl['date_in_plan'].strftime('%d.%m.%Y %H:%M'),
        })
    with open(os.path.join(OUTPUT_DIR, 'our_pls.json'), 'w', encoding='utf-8') as f:
        json.dump(pls_dump, f, ensure_ascii=False, indent=2)
    print(f"\n  ПЛ сохранены: output/our_pls.json")

    # --- Шаг 4: Мониторинг ---
    print(f"\n[Шаг 4] Загрузка мониторинга...")
    print(f"  Машин для обработки: {len(by_vehicle)}")
    print(f"  Ориентировочное время: {len(by_vehicle) * RATE_LIMIT_SEC // 60} мин (rate limit)")

    trips_rows = []    # промежуточная таблица
    summary_rows = []  # финальная таблица

    vehicle_count = 0
    for idmo, pls in sorted(by_vehicle.items()):
        vehicle_count += 1
        pl = pls[0]  # берём первый ПЛ (или объединяем)
        reg = pl['reg_number']
        model = pl['model']
        print(f"\n  [{vehicle_count}/{len(by_vehicle)}] idMO={idmo} {reg} ({model})")

        # Используем период от начала первого ПЛ до конца последнего
        all_starts = [p['date_out_plan'] for p in pls]
        all_ends   = [p['date_in_plan']  for p in pls]
        mon_from = min(all_starts)
        mon_to   = max(all_ends)
        print(f"    Период: {fmt_datetime(mon_from)} – {fmt_datetime(mon_to)}")

        monitoring = tis.get_monitoring(idmo, mon_from, mon_to)
        stats = analyze_track_simple(monitoring)
        print(f"    Трек: {stats['track_points']} точек, {stats['engine_time_h']}ч, {stats['distance_km']}км, {stats['parkings_count']} остановок")

        # Рейсы = остановки (parkings)
        parkings = (monitoring or {}).get('parkings', []) or []
        for i, park in enumerate(parkings, 1):
            begin_dt = parse_date(park.get('begin', ''))
            end_dt   = parse_date(park.get('end', ''))
            dur_min  = round((end_dt - begin_dt).total_seconds() / 60) if begin_dt and end_dt else None
            trips_rows.append({
                'id_mo':           idmo,
                'reg_number':      reg,
                'model':           model,
                'branch':          pl['branch'],
                'volume_m3':       pl['volume_m3'],
                'pl_date':         pl['date_out'],
                'pl_status':       pl['pl_status'],
                'request_numbers': '; '.join(str(n) for n in pl['request_numbers']),
                'object_expend':   '; '.join(pl['object_expends']),
                'parking_num':     i,
                'parking_begin':   park.get('begin', ''),
                'parking_end':     park.get('end', ''),
                'parking_dur_min': dur_min,
                'parking_address': park.get('address', ''),
                'parking_lat':     park.get('lat', ''),
                'parking_lon':     park.get('lon', ''),
            })

        # Все заявки через ПЛ
        all_requests = []
        all_req_nums = []
        all_objects  = []
        for p in pls:
            all_req_nums.extend(p['request_numbers'])
            all_objects.extend(p['object_expends'])
            all_requests.extend(p['requests'])
        all_req_nums = list(dict.fromkeys(all_req_nums))
        all_objects  = list(dict.fromkeys(all_objects))

        # KIP%
        pl_duration_h = sum(
            (p['date_in_plan'] - p['date_out_plan']).total_seconds() / 3600
            for p in pls
        )
        kip_pct = round(stats['engine_time_h'] / pl_duration_h * 100, 1) if pl_duration_h > 0 else 0

        summary_rows.append({
            'id_mo':           idmo,
            'reg_number':      reg,
            'model':           model,
            'branch':          pl['branch'],
            'volume_m3':       pl['volume_m3'],
            'weight_t':        pl['weight_t'],
            'pl_count':        len(pls),
            'pl_date_from':    fmt_date(min(all_starts)),
            'pl_date_to':      fmt_date(max(all_ends)),
            'pl_duration_h':   round(pl_duration_h, 1),
            'engine_time_h':   stats['engine_time_h'],
            'moving_time_h':   stats['moving_time_h'],
            'distance_km':     stats['distance_km'],
            'parkings_count':  stats['parkings_count'],
            'kip_pct':         kip_pct,
            'request_numbers': '; '.join(str(n) for n in all_req_nums),
            'object_expend':   '; '.join(all_objects),
        })

    # --- Шаг 5: Запись CSV ---
    trips_csv = os.path.join(OUTPUT_DIR, 'trips_raw.csv')
    summary_csv = os.path.join(OUTPUT_DIR, 'summary.csv')

    if trips_rows:
        with open(trips_csv, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=trips_rows[0].keys())
            w.writeheader()
            w.writerows(trips_rows)
        print(f"\n✅ trips_raw.csv: {len(trips_rows)} строк → {trips_csv}")

    if summary_rows:
        with open(summary_csv, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=summary_rows[0].keys())
            w.writeheader()
            w.writerows(summary_rows)
        print(f"✅ summary.csv: {len(summary_rows)} строк → {summary_csv}")

    print(f"\n=== Готово ===")
    print(f"Машин обработано: {len(summary_rows)}")
    print(f"Всего остановок (потенц. рейсов): {len(trips_rows)}")

if __name__ == '__main__':
    main()
