#!/usr/bin/env python3
"""
Шаг 1: Получить все ТС из TIS API (getPassports)
Шаг 2: Смэтчить госномера с Excel "Самосвалы объёмы.xlsx"
Шаг 3: Создать dump-trucks-registry.json с idMo + gruzopod'yomnost'
"""

import json
import re
import sys
import os
import requests
import openpyxl

# --- Конфиг ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, 'server', '.env')
EXCEL_PATH = os.path.join(os.path.dirname(BASE_DIR), 'Самосвалы объёмы.xlsx')
REGISTRY_PATH = os.path.join(BASE_DIR, 'config', 'dump-trucks-registry.json')

def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

def normalize_reg(reg: str) -> str:
    """Нормализация госномера: убрать пробелы, привести к верхнему регистру."""
    if not reg:
        return ''
    return reg.strip().upper().replace(' ', '')

def load_excel_vehicles(path: str) -> list:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    vehicles = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[1]:
            continue
        vehicles.append({
            'model':     str(row[0]).strip() if row[0] else '',
            'regNumber': normalize_reg(str(row[1])),
            'branch':    str(row[2]).strip() if row[2] else '',
            'volumeM3':  float(row[3]) if row[3] else None,
            'weightT':   float(row[4]) if row[4] else None,
        })
    return vehicles

def get_passports(base_url: str, token: str) -> list:
    """getPassports — без доп. параметров, возвращает список всех ТС."""
    url = f"{base_url}?token={token}&format=json&command=getPassports"
    print(f"  POST {url[:80]}...")
    resp = requests.post(url, data=None, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    # Ответ: { passports: [...] }
    if isinstance(data, dict):
        return data.get('passports', data.get('list', data.get('data', [])))
    if isinstance(data, list):
        return data
    return []

def main():
    # --- Загрузка конфига ---
    env = load_env(ENV_PATH)
    base_url = env.get('TIS_API_URL', '')
    tokens = [t.strip() for t in env.get('TIS_API_TOKENS', '').split(',') if t.strip()]
    if not base_url or not tokens:
        print("ERROR: TIS_API_URL или TIS_API_TOKENS не заданы в .env")
        sys.exit(1)

    # --- Загрузка Excel ---
    print(f"Читаю Excel: {EXCEL_PATH}")
    excel_vehicles = load_excel_vehicles(EXCEL_PATH)
    print(f"  Загружено {len(excel_vehicles)} машин из Excel")
    excel_by_reg = {v['regNumber']: v for v in excel_vehicles}

    # --- getPassports ---
    print("\nПолучаю список ТС из TIS API (getPassports)...")
    token = tokens[0]  # первый токен, без rate limit (нет idMO)
    try:
        passports = get_passports(base_url, token)
    except Exception as e:
        print(f"ERROR: getPassports failed: {e}")
        sys.exit(1)

    print(f"  Получено {len(passports)} ТС из TIS")

    if passports:
        # Покажем структуру первого элемента
        print(f"  Пример элемента: {json.dumps(passports[0], ensure_ascii=False, indent=2)[:500]}")

    # --- Матчинг ---
    print("\nМатчинг gosنومеров...")
    matched = []
    unmatched_excel = []
    tis_by_reg = {}

    for p in passports:
        reg_raw = p.get('regNumber') or p.get('regNum') or p.get('reg_number') or ''
        id_mo   = p.get('idMO') or p.get('id') or p.get('moId')
        # Паспорт хранит модель в modelOrMarkOrModif
        name_mo = p.get('modelOrMarkOrModif') or p.get('nameMO') or p.get('name') or ''
        reg = normalize_reg(str(reg_raw))
        if reg:
            tis_by_reg[reg] = {'idMo': id_mo, 'nameMO': name_mo, 'reg': reg, 'raw': p}

    for reg, excel_v in excel_by_reg.items():
        if reg in tis_by_reg:
            tis = tis_by_reg[reg]
            matched.append({
                'idMo':      tis['idMo'],
                'regNumber': reg,
                'model':     excel_v['model'],
                'branch':    excel_v['branch'],
                'volumeM3':  excel_v['volumeM3'],
                'weightT':   excel_v['weightT'],
                'nameMO':    tis['nameMO'],
            })
        else:
            unmatched_excel.append(reg)

    print(f"\n✅ Смэтчено: {len(matched)} из {len(excel_vehicles)}")
    print(f"❌ Не найдено в TIS: {len(unmatched_excel)}")
    if unmatched_excel:
        print("  Не найденные:")
        for r in unmatched_excel:
            print(f"    {r}")

    # --- Сохраняем реестр ---
    matched_sorted = sorted(matched, key=lambda x: (x.get('regNumber', '') or ''))
    registry = {"vehicles": matched_sorted}

    with open(REGISTRY_PATH, 'w', encoding='utf-8') as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)
    print(f"\nРеестр сохранён: {REGISTRY_PATH}")
    print(f"Итого машин в реестре: {len(matched_sorted)}")

    # --- Краткая сводка ---
    print("\n--- Смэтченные машины ---")
    for v in matched_sorted:
        print(f"  idMo={v['idMo']:5}  {v['regNumber']:12}  {v['model'][:40]}  vol={v['volumeM3']}м3")

    # --- Сохраняем полный дамп TIS пассортов (для отладки) ---
    dump_path = os.path.join(os.path.dirname(REGISTRY_PATH), 'passports_dump.json')
    with open(dump_path, 'w', encoding='utf-8') as f:
        json.dump(passports, f, ensure_ascii=False, indent=2)
    print(f"\nПолный дамп TIS сохранён: {dump_path}")

if __name__ == '__main__':
    main()
