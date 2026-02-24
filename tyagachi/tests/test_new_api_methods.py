"""
Быстрый тест новых методов API для путевых листов.
"""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from api.client import APIClient


def test_api_methods():
    """Тестирование всех методов API."""
    print("=" * 60)
    print("ТЕСТ МЕТОДОВ API ДЛЯ ПУТЕВЫХ ЛИСТОВ")
    print("=" * 60)

    # Инициализация клиента
    config_path = Path(__file__).parent.parent / "config.yaml"
    client = APIClient(str(config_path))

    test_from = "01.02.2026"
    test_to = "02.02.2026"

    print(f"\nПериод тестирования: {test_from} - {test_to}")
    print("-" * 60)

    # Тест 1: Новый метод (по умолчанию)
    print("\n[1] Тест get_route_lists() (по умолчанию - новый метод)")
    try:
        data1 = client.get_route_lists(test_from, test_to)
        count1 = len(data1.get('list', []))
        print(f"✅ Успешно: {count1} записей")

        # Проверка статусов
        statuses = {}
        for item in data1.get('list', [])[:5]:
            status = item.get('status', 'UNKNOWN')
            statuses[status] = statuses.get(status, 0) + 1
        print(f"   Статусы (первые 5): {statuses}")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

    # Тест 2: Новый метод (явный вызов)
    print("\n[2] Тест get_route_lists_by_date_out()")
    try:
        data2 = client.get_route_lists_by_date_out(test_from, test_to)
        count2 = len(data2.get('list', []))
        print(f"✅ Успешно: {count2} записей")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

    # Тест 3: Старый метод (legacy)
    print("\n[3] Тест get_route_lists_legacy()")
    try:
        data3 = client.get_route_lists_legacy(test_from, test_to)
        count3 = len(data3.get('list', []))
        print(f"✅ Успешно: {count3} записей")

        # Проверка наличия glonassData
        if count3 > 0:
            has_glonass = 'glonassData' in data3['list'][0]
            print(f"   Поле glonassData: {'✅ присутствует' if has_glonass else '❌ отсутствует'}")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

    # Тест 4: Универсальный метод с параметром use_legacy
    print("\n[4] Тест get_route_lists(use_legacy=True)")
    try:
        data4 = client.get_route_lists(test_from, test_to, use_legacy=True)
        count4 = len(data4.get('list', []))
        print(f"✅ Успешно: {count4} записей")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

    # Сравнение
    print("\n" + "=" * 60)
    print("ИТОГИ")
    print("=" * 60)
    print(f"Новый метод (default):  {count1} записей")
    print(f"Новый метод (явный):    {count2} записей")
    print(f"Старый метод (legacy):  {count3} записей")
    print(f"Universal (use_legacy): {count4} записей")

    if count1 == count2:
        print("\n✅ Методы 1 и 2 возвращают одинаковое количество (OK)")
    else:
        print("\n⚠️  Методы 1 и 2 возвращают разное количество")

    if count3 == count4:
        print("✅ Методы 3 и 4 возвращают одинаковое количество (OK)")
    else:
        print("⚠️  Методы 3 и 4 возвращают разное количество")

    print("\n" + "=" * 60)
    print("Тест завершён успешно!")
    print("=" * 60)


if __name__ == "__main__":
    test_api_methods()
