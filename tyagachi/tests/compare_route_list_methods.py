"""
Тест сравнения методов API для выгрузки путевых листов:
- getRouteLists (текущий метод)
- getRouteListsByDateOut (альтернативный метод)

Цель: понять разницу в выгруженных данных и когда какой метод использовать.
"""

import sys
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from api.client import APIClient


def add_route_lists_by_date_out(client: APIClient):
    """Добавляем метод getRouteListsByDateOut к клиенту."""
    def get_route_lists_by_date_out(from_date: str, to_date: str):
        client.logger.info(f"Fetching route lists by DateOut: {from_date} - {to_date}")
        params = {
            'fromDate': from_date,
            'toDate': to_date
        }
        data = client._make_request('getRouteListsByDateOut', params)
        count = len(data.get('list', []))
        client.logger.info(f"Fetched {count} route lists (by DateOut)")
        return data

    return get_route_lists_by_date_out


def analyze_route_lists(data: dict, method_name: str) -> dict:
    """Анализ выгруженных путевых листов."""
    items = data.get('list', [])

    analysis = {
        'method': method_name,
        'total_count': len(items),
        'ids': set(),
        'statuses': defaultdict(int),
        'date_out_range': {'min': None, 'max': None},
        'close_list_range': {'min': None, 'max': None},
        'ch_time_range': {'min': None, 'max': None},
        'ts_types': defaultdict(int),
        'sample_fields': set(),
    }

    if not items:
        return analysis

    # Собираем все поля из первой записи
    analysis['sample_fields'] = set(items[0].keys())

    for item in items:
        analysis['ids'].add(item.get('id'))
        analysis['statuses'][item.get('status', 'UNKNOWN')] += 1
        analysis['ts_types'][item.get('tsType', 'UNKNOWN')] += 1

        # Даты
        date_out = item.get('dateOut')
        close_list = item.get('closeList')
        ch_time = item.get('chTime')

        if date_out:
            if analysis['date_out_range']['min'] is None or date_out < analysis['date_out_range']['min']:
                analysis['date_out_range']['min'] = date_out
            if analysis['date_out_range']['max'] is None or date_out > analysis['date_out_range']['max']:
                analysis['date_out_range']['max'] = date_out

        if close_list:
            if analysis['close_list_range']['min'] is None or close_list < analysis['close_list_range']['min']:
                analysis['close_list_range']['min'] = close_list
            if analysis['close_list_range']['max'] is None or close_list > analysis['close_list_range']['max']:
                analysis['close_list_range']['max'] = close_list

        if ch_time:
            if analysis['ch_time_range']['min'] is None or ch_time < analysis['ch_time_range']['min']:
                analysis['ch_time_range']['min'] = ch_time
            if analysis['ch_time_range']['max'] is None or ch_time > analysis['ch_time_range']['max']:
                analysis['ch_time_range']['max'] = ch_time

    return analysis


def compare_methods(data1: dict, data2: dict, method1_name: str, method2_name: str) -> dict:
    """Сравнение результатов двух методов."""
    ids1 = {item.get('id') for item in data1.get('list', [])}
    ids2 = {item.get('id') for item in data2.get('list', [])}

    only_in_1 = ids1 - ids2
    only_in_2 = ids2 - ids1
    common = ids1 & ids2

    # Детальный анализ записей, которые есть только в одном из методов
    only_in_1_details = []
    only_in_2_details = []

    for item in data1.get('list', []):
        if item.get('id') in only_in_1:
            only_in_1_details.append({
                'id': item.get('id'),
                'dateOut': item.get('dateOut'),
                'closeList': item.get('closeList'),
                'chTime': item.get('chTime'),
                'status': item.get('status'),
                'tsType': item.get('tsType'),
            })

    for item in data2.get('list', []):
        if item.get('id') in only_in_2:
            only_in_2_details.append({
                'id': item.get('id'),
                'dateOut': item.get('dateOut'),
                'closeList': item.get('closeList'),
                'chTime': item.get('chTime'),
                'status': item.get('status'),
                'tsType': item.get('tsType'),
            })

    # Сравнение структуры (поля)
    fields1 = set(data1.get('list', [{}])[0].keys()) if data1.get('list') else set()
    fields2 = set(data2.get('list', [{}])[0].keys()) if data2.get('list') else set()

    return {
        'count_method1': len(ids1),
        'count_method2': len(ids2),
        'common_count': len(common),
        'only_in_method1_count': len(only_in_1),
        'only_in_method2_count': len(only_in_2),
        'only_in_method1': sorted(list(only_in_1)),
        'only_in_method2': sorted(list(only_in_2)),
        'only_in_method1_details': sorted(only_in_1_details, key=lambda x: x['id']),
        'only_in_method2_details': sorted(only_in_2_details, key=lambda x: x['id']),
        'fields_only_in_method1': list(fields1 - fields2),
        'fields_only_in_method2': list(fields2 - fields1),
        'common_fields': list(fields1 & fields2),
    }


def run_test(client, from_date: str, to_date: str, output_dir: Path):
    """Запуск теста для указанного периода."""
    print(f"\n{'='*60}")
    print(f"ТЕСТ ДЛЯ ПЕРИОДА: {from_date} - {to_date}")
    print(f"{'='*60}")

    # Создаём функцию для второго метода
    get_by_date_out = add_route_lists_by_date_out(client)

    # Выгрузка через getRouteLists
    print("\n[1] Выгрузка через getRouteLists...")
    data_route_lists = client.get_route_lists(from_date, to_date)

    # Выгрузка через getRouteListsByDateOut
    print("[2] Выгрузка через getRouteListsByDateOut...")
    data_by_date_out = get_by_date_out(from_date, to_date)

    # Анализ каждого метода
    print("\n[3] Анализ результатов...")
    analysis1 = analyze_route_lists(data_route_lists, 'getRouteLists')
    analysis2 = analyze_route_lists(data_by_date_out, 'getRouteListsByDateOut')

    # Сравнение
    comparison = compare_methods(
        data_route_lists, data_by_date_out,
        'getRouteLists', 'getRouteListsByDateOut'
    )

    # Вывод результатов
    print(f"\n--- РЕЗУЛЬТАТЫ getRouteLists ---")
    print(f"Количество записей: {analysis1['total_count']}")
    print(f"Статусы: {dict(analysis1['statuses'])}")
    print(f"Типы ТС: {dict(analysis1['ts_types'])}")
    print(f"Диапазон dateOut: {analysis1['date_out_range']}")
    print(f"Диапазон closeList: {analysis1['close_list_range']}")
    print(f"Диапазон chTime: {analysis1['ch_time_range']}")

    print(f"\n--- РЕЗУЛЬТАТЫ getRouteListsByDateOut ---")
    print(f"Количество записей: {analysis2['total_count']}")
    print(f"Статусы: {dict(analysis2['statuses'])}")
    print(f"Типы ТС: {dict(analysis2['ts_types'])}")
    print(f"Диапазон dateOut: {analysis2['date_out_range']}")
    print(f"Диапазон closeList: {analysis2['close_list_range']}")
    print(f"Диапазон chTime: {analysis2['ch_time_range']}")

    print(f"\n--- СРАВНЕНИЕ ---")
    print(f"Общих записей: {comparison['common_count']}")
    print(f"Только в getRouteLists: {comparison['only_in_method1_count']}")
    print(f"Только в getRouteListsByDateOut: {comparison['only_in_method2_count']}")

    if comparison['only_in_method1_details']:
        print(f"\n--- ЗАПИСИ ТОЛЬКО В getRouteLists (первые 10) ---")
        for item in comparison['only_in_method1_details'][:10]:
            print(f"  ID={item['id']}, dateOut={item['dateOut']}, closeList={item['closeList']}, status={item['status']}")

    if comparison['only_in_method2_details']:
        print(f"\n--- ЗАПИСИ ТОЛЬКО В getRouteListsByDateOut (первые 10) ---")
        for item in comparison['only_in_method2_details'][:10]:
            print(f"  ID={item['id']}, dateOut={item['dateOut']}, closeList={item['closeList']}, status={item['status']}")

    if comparison['fields_only_in_method1']:
        print(f"\nПоля только в getRouteLists: {comparison['fields_only_in_method1']}")
    if comparison['fields_only_in_method2']:
        print(f"Поля только в getRouteListsByDateOut: {comparison['fields_only_in_method2']}")

    # Сохранение данных
    period_str = f"{from_date.replace('.', '-')}_{to_date.replace('.', '-')}"
    output_dir.mkdir(parents=True, exist_ok=True)

    with open(output_dir / f"getRouteLists_{period_str}.json", 'w', encoding='utf-8') as f:
        json.dump(data_route_lists, f, ensure_ascii=False, indent=2)

    with open(output_dir / f"getRouteListsByDateOut_{period_str}.json", 'w', encoding='utf-8') as f:
        json.dump(data_by_date_out, f, ensure_ascii=False, indent=2)

    # Сохранение отчёта сравнения
    report = {
        'period': {'from': from_date, 'to': to_date},
        'analysis_getRouteLists': {
            'total_count': analysis1['total_count'],
            'statuses': dict(analysis1['statuses']),
            'ts_types': dict(analysis1['ts_types']),
            'date_out_range': analysis1['date_out_range'],
            'close_list_range': analysis1['close_list_range'],
            'ch_time_range': analysis1['ch_time_range'],
        },
        'analysis_getRouteListsByDateOut': {
            'total_count': analysis2['total_count'],
            'statuses': dict(analysis2['statuses']),
            'ts_types': dict(analysis2['ts_types']),
            'date_out_range': analysis2['date_out_range'],
            'close_list_range': analysis2['close_list_range'],
            'ch_time_range': analysis2['ch_time_range'],
        },
        'comparison': {
            'common_count': comparison['common_count'],
            'only_in_getRouteLists_count': comparison['only_in_method1_count'],
            'only_in_getRouteListsByDateOut_count': comparison['only_in_method2_count'],
            'only_in_getRouteLists_details': comparison['only_in_method1_details'],
            'only_in_getRouteListsByDateOut_details': comparison['only_in_method2_details'],
            'fields_diff': {
                'only_in_getRouteLists': comparison['fields_only_in_method1'],
                'only_in_getRouteListsByDateOut': comparison['fields_only_in_method2'],
            }
        }
    }

    with open(output_dir / f"comparison_report_{period_str}.json", 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n[4] Данные сохранены в {output_dir}")

    return report


def main():
    # Инициализация клиента
    project_root = Path(__file__).parent.parent
    config_path = project_root / "config.yaml"

    client = APIClient(str(config_path))

    output_dir = project_root / "Data" / "test_comparison"

    # Тест 1: 30.01 - 04.02
    report1 = run_test(client, "30.01.2026", "04.02.2026", output_dir)

    # Тест 2: 20.01 - 25.01
    report2 = run_test(client, "20.01.2026", "25.01.2026", output_dir)

    # Итоговый анализ
    print(f"\n{'='*60}")
    print("ИТОГОВЫЙ АНАЛИЗ")
    print(f"{'='*60}")

    print("""
ГИПОТЕЗА О РАЗНИЦЕ МЕТОДОВ:

1. getRouteLists - вероятно фильтрует по дате ЗАКРЫТИЯ путевого листа (closeList)
   или по дате последнего изменения (chTime)

2. getRouteListsByDateOut - фильтрует по дате ВЫЕЗДА (dateOut)

КОГДА КАКОЙ ИСПОЛЬЗОВАТЬ:

- getRouteListsByDateOut: когда нужны ПЛ по дате выезда (планирование, анализ по дням)
- getRouteLists: когда нужны ПЛ по дате закрытия (отчётность, бухгалтерия)

Проверьте отчёты в папке {output_dir} для деталей.
""")


if __name__ == "__main__":
    main()
