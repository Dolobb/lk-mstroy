"""
Transport Analytics Pipeline - Main Entry Point

Режимы работы:
1. Локальные файлы: python main.py (интерактивный выбор файлов)
2. Загрузка из API: python main.py --fetch --from 01.01.2026 --to 15.01.2026

Результаты:
- CSV файлы: matched.csv, requests_unmatched.csv, pl_unmatched.csv
- HTML отчёт: report.html (иерархия Заявка → ПЛ → Машины + Мониторинг)
"""

import sys
import time
import logging
import argparse
from pathlib import Path
from datetime import datetime

import yaml
import pandas as pd

from src.parsers.request_parser import RequestParser
from src.parsers.pl_parser import PLParser


def parse_args():
    """Разбор аргументов командной строки."""
    parser = argparse.ArgumentParser(
        description='Transport Analytics Pipeline - сопоставление заявок и путевых листов',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python main.py                                        # интерактивный выбор файлов
  python main.py -r req.json -p pl.json                 # указать файлы напрямую
  python main.py --fetch --from 01.01.2026 --to 15.01.2026  # загрузить из API
  python main.py --web                                  # запустить веб-сервер
  python main.py --web --port 3000                      # веб-сервер на порту 3000
        """
    )

    # Режим работы
    parser.add_argument(
        '--fetch',
        action='store_true',
        help='Загрузить данные из API (вместо локальных файлов)'
    )

    parser.add_argument(
        '--from', dest='from_date',
        type=str,
        help='Дата начала периода (ДД.ММ.ГГГГ) для режима --fetch'
    )

    parser.add_argument(
        '--to', dest='to_date',
        type=str,
        help='Дата окончания периода (ДД.ММ.ГГГГ) для режима --fetch'
    )

    # Separate periods for requests and route-lists (optional)
    parser.add_argument(
        '--from-req', dest='from_requests',
        type=str,
        help='Дата начала периода для ЗАЯВОК (ДД.ММ.ГГГГ)'
    )

    parser.add_argument(
        '--to-req', dest='to_requests',
        type=str,
        help='Дата окончания периода для ЗАЯВОК (ДД.ММ.ГГГГ)'
    )

    parser.add_argument(
        '--from-pl', dest='from_pl',
        type=str,
        help='Дата начала периода для ПУТЕВЫХ ЛИСТОВ (ДД.ММ.ГГГГ)'
    )

    parser.add_argument(
        '--to-pl', dest='to_pl',
        type=str,
        help='Дата окончания периода для ПУТЕВЫХ ЛИСТОВ (ДД.ММ.ГГГГ)'
    )

    # Локальные файлы
    parser.add_argument(
        '-r', '--requests',
        type=str,
        help='Путь к файлу заявок (JSON)'
    )

    parser.add_argument(
        '-p', '--pl',
        type=str,
        help='Путь к файлу путевых листов (JSON)'
    )

    parser.add_argument(
        '-o', '--output',
        type=str,
        help='Директория для результатов. По умолчанию Data/final/'
    )

    parser.add_argument(
        '-c', '--config',
        type=str,
        default='config.yaml',
        help='Путь к файлу конфигурации (по умолчанию: config.yaml)'
    )

    parser.add_argument(
        '--no-html',
        action='store_true',
        help='Не генерировать HTML отчёт'
    )

    parser.add_argument(
        '--html-only',
        action='store_true',
        help='Перегенерировать только HTML из существующих CSV (без парсинга/сопоставления)'
    )

    parser.add_argument(
        '--web',
        action='store_true',
        help='Запустить веб-сервер на http://0.0.0.0:8000'
    )

    parser.add_argument(
        '--port',
        type=int,
        default=8000,
        help='Порт для веб-сервера (по умолчанию: 8000)'
    )

    parser.add_argument(
        '--host',
        type=str,
        default='0.0.0.0',
        help='Хост для веб-сервера (по умолчанию: 0.0.0.0)'
    )

    return parser.parse_args()


def get_json_files(directory: str) -> list:
    """Получить список JSON файлов в директории."""
    dir_path = Path(directory)
    if not dir_path.exists():
        return []

    files = sorted(dir_path.glob('*.json'))
    return [f for f in files if f.is_file()]


def interactive_file_select(files: list, prompt: str) -> Path:
    """Интерактивный выбор файла из списка."""
    print(f"\n{prompt}")
    print("-" * 50)

    for i, f in enumerate(files, 1):
        # Показать размер файла
        size_kb = f.stat().st_size / 1024
        print(f"  {i}. {f.name} ({size_kb:.1f} KB)")

    print("-" * 50)

    while True:
        try:
            choice = input("Введите номер (или 'q' для выхода): ").strip()
            if choice.lower() == 'q':
                print("Отмена.")
                sys.exit(0)

            idx = int(choice) - 1
            if 0 <= idx < len(files):
                return files[idx]
            else:
                print(f"Введите число от 1 до {len(files)}")
        except ValueError:
            print("Введите число")


def select_files_interactive(raw_dir: str) -> tuple:
    """Интерактивный выбор файлов заявок и ПЛ."""
    files = get_json_files(raw_dir)

    if not files:
        print(f"\n❌ В папке {raw_dir} нет JSON файлов!")
        print("Положите файлы заявок и путевых листов в эту папку.")
        sys.exit(1)

    if len(files) == 1:
        print(f"\n❌ В папке {raw_dir} только один JSON файл!")
        print("Нужны минимум 2 файла: заявки и путевые листы.")
        sys.exit(1)

    print(f"\nНайдено {len(files)} JSON файлов в {raw_dir}/")

    # Выбор файла заявок
    requests_file = interactive_file_select(files, "Выберите файл ЗАЯВОК:")

    # Убираем выбранный файл из списка для ПЛ
    remaining = [f for f in files if f != requests_file]

    # Выбор файла ПЛ
    pl_file = interactive_file_select(remaining, "Выберите файл ПУТЕВЫХ ЛИСТОВ:")

    return str(requests_file), str(pl_file)


def load_config(config_path: str = "config.yaml") -> dict:
    """Загрузка конфигурации из YAML файла."""
    config_file = Path(config_path)
    if not config_file.exists():
        raise FileNotFoundError(f"Файл конфигурации не найден: {config_path}")

    with open(config_file, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def setup_logging(config: dict) -> logging.Logger:
    """Настройка логирования для main модуля."""
    log_config = config['logging']
    log_level = getattr(logging, log_config['level'])

    logger = logging.getLogger('main')
    logger.setLevel(log_level)
    logger.handlers = []

    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    if log_config['console']:
        console_handler = logging.StreamHandler()
        console_handler.setLevel(log_level)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    if log_config['file']:
        log_dir = Path(config['paths']['output']['logs'])
        log_dir.mkdir(parents=True, exist_ok=True)

        date_str = datetime.now().strftime('%Y-%m-%d')
        log_file = log_dir / log_config['file_format'].replace('{date}', date_str)

        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(log_level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger


def run_matching(config: dict, logger: logging.Logger) -> dict:
    """
    Сопоставление заявок и путевых листов.

    Returns:
        dict со статистикой матчинга
    """
    intermediate_dir = Path(config['paths']['output']['intermediate'])
    output_dir = Path(config['paths']['output']['final'])
    output_dir.mkdir(parents=True, exist_ok=True)

    # Загрузка данных
    logger.info("Загрузка промежуточных файлов...")
    requests_df = pd.read_csv(intermediate_dir / 'requests_parsed.csv')
    pl_df = pd.read_csv(intermediate_dir / 'pl_parsed.csv')

    logger.info(f"  Заявок: {len(requests_df)}")
    logger.info(f"  Записей ПЛ: {len(pl_df)}")

    # Ключи для сопоставления
    req_key = 'request_number'
    pl_key = 'extracted_request_number'

    # Множества номеров для статистики
    req_numbers = set(requests_df[req_key].dropna().astype(int))
    pl_numbers = set(pl_df[pl_key].dropna().astype(int))

    matched_numbers = req_numbers & pl_numbers
    req_only_numbers = req_numbers - pl_numbers
    pl_only_numbers = pl_numbers - req_numbers

    # 1. Matched: inner join
    logger.info("Создание matched.csv...")
    matched_df = pd.merge(
        requests_df,
        pl_df,
        left_on=req_key,
        right_on=pl_key,
        how='inner',
        suffixes=('_req', '_pl')
    )
    matched_df.to_csv(output_dir / 'matched.csv', index=False)

    # 2. Requests without PL
    logger.info("Создание requests_unmatched.csv...")
    requests_unmatched = requests_df[~requests_df[req_key].isin(pl_df[pl_key])]
    requests_unmatched.to_csv(output_dir / 'requests_unmatched.csv', index=False)

    # 3. PL without requests
    logger.info("Создание pl_unmatched.csv...")
    pl_unmatched = pl_df[~pl_df[pl_key].isin(requests_df[req_key])]
    pl_unmatched.to_csv(output_dir / 'pl_unmatched.csv', index=False)

    stats = {
        'total_requests': len(requests_df),
        'total_pl_records': len(pl_df),
        'unique_request_numbers': len(req_numbers),
        'unique_pl_numbers': len(pl_numbers),
        'matched_numbers': len(matched_numbers),
        'matched_rows': len(matched_df),
        'requests_only_numbers': len(req_only_numbers),
        'requests_unmatched_rows': len(requests_unmatched),
        'pl_only_numbers': len(pl_only_numbers),
        'pl_unmatched_rows': len(pl_unmatched),
    }

    return stats


def print_summary(stats: dict, elapsed: float):
    """Вывод итоговой статистики."""
    print("\n" + "=" * 60)
    print("ИТОГИ ОБРАБОТКИ")
    print("=" * 60)
    print(f"\nИсходные данные:")
    print(f"  Заявок:           {stats['total_requests']}")
    print(f"  Записей ПЛ:       {stats['total_pl_records']}")

    print(f"\nУникальных номеров заявок:")
    print(f"  В заявках:        {stats['unique_request_numbers']}")
    print(f"  В ПЛ:             {stats['unique_pl_numbers']}")

    print(f"\nРезультаты сопоставления:")
    print(f"  Сопоставлено номеров:     {stats['matched_numbers']}")
    print(f"  Строк в matched.csv:      {stats['matched_rows']}")
    print(f"  Заявок без ПЛ:            {stats['requests_only_numbers']} ({stats['requests_unmatched_rows']} строк)")
    print(f"  ПЛ без заявок:            {stats['pl_only_numbers']} ({stats['pl_unmatched_rows']} строк)")

    # Процент выполнения заявок
    if stats['unique_request_numbers'] > 0:
        fulfillment_rate = stats['matched_numbers'] / stats['unique_request_numbers'] * 100
        print(f"\n  Процент выполнения:       {fulfillment_rate:.1f}%")

    print(f"\nВремя выполнения: {elapsed:.2f} сек")
    print("=" * 60)


def run_fetch_mode(args, config, logger):
    """Режим загрузки данных из API."""
    from src.api.fetcher import DataFetcher, fetch_data_interactive
    from src.parsers.monitoring_parser import parse_monitoring
    from src.output.html_generator_v2 import generate_html_report, build_hierarchy

    # Support separate date ranges for requests and PL
    from_req = args.from_requests or args.from_date
    to_req = args.to_requests or args.to_date

    from_pl = args.from_pl or args.from_date
    to_pl = args.to_pl or args.to_date

    # If any required pair is missing, ask interactively for both ranges
    if not (from_req and to_req):
        print("\nВведите период для ЗАЯВОК:")
        from_req, to_req = fetch_data_interactive()

    if not (from_pl and to_pl):
        print("\nВведите период для ПУТЕВЫХ ЛИСТОВ:")
        from_pl, to_pl = fetch_data_interactive()

    print(f"\n  Период ЗАЯВОК: {from_req} — {to_req}")
    print(f"  Период ПЛ:      {from_pl} — {to_pl}")

    # Инициализация fetcher
    fetcher = DataFetcher(args.config)

    # 1. Загрузка заявок и ПЛ
    print("\n[1/4] Загрузка данных из API...")
    requests_data, pl_data = fetcher.fetch_all(
        from_requests=from_req,
        to_requests=to_req,
        from_pl=from_pl,
        to_pl=to_pl,
        save_raw=True
    )

    req_count = len(requests_data.get('list', []))
    pl_count = len(pl_data.get('list', []))
    print(f"    Загружено: {req_count} заявок, {pl_count} путевых листов")

    # 2. Парсинг
    print("\n[2/4] Парсинг данных...")

    # Сохраняем временные файлы для парсеров (имена зависят от соответствующих периодов)
    raw_dir = Path(config['paths']['input']['requests']).parent
    requests_file = raw_dir / f"Requests_{from_req.replace('.', '-')}_{to_req.replace('.', '-')}.json"
    pl_file = raw_dir / f"PL_{from_pl.replace('.', '-')}_{to_pl.replace('.', '-')}.json"

    request_parser = RequestParser(args.config)
    request_parser.input_path = str(requests_file)
    request_parser.parse()

    pl_parser = PLParser(args.config)
    pl_parser.input_path = str(pl_file)
    pl_parser.parse()

    # 3. Извлечение задач мониторинга и запросы
    print("\n[3/4] Загрузка мониторинга...")
    monitoring_tasks = fetcher.extract_monitoring_tasks(pl_data)
    print(f"    Найдено {len(monitoring_tasks)} комбинаций ПЛ+машина")

    monitoring_results = fetcher.fetch_monitoring_batch(monitoring_tasks)

    # 4. Сопоставление и генерация отчётов
    print("\n[4/4] Генерация отчётов...")

    stats = run_matching(config, logger)

    # Добавляем мониторинг к matched данным
    output_dir = Path(config['paths']['output']['final'])
    matched_df = pd.read_csv(output_dir / 'matched.csv')

    # Колонки мониторинга для CSV (плоские поля)
    monitoring_cols_csv = [
        'mon_distance', 'mon_moving_time_hours', 'mon_engine_time_hours',
        'mon_idling_time_hours', 'mon_fuel_rate', 'mon_parkings_count',
        'mon_parkings_total_hours'
    ]

    for col in monitoring_cols_csv:
        matched_df[col] = None

    # Для HTML нужны также массивы (parkings, fuels) - храним отдельно
    html_records = []
    matched_count = 0

    for idx, row in matched_df.iterrows():
        pl_id = row.get('pl_id')
        ts_id_str = str(row.get('ts_id_mo', ''))

        # Parse potentially comma-separated ts_id_mo
        ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]

        # Prepare record for HTML
        record = row.to_dict()
        mon_data_found = None

        # Try each ts_id and use first match
        for ts_id in ts_ids:
            key = (pl_id, ts_id)
            if key in monitoring_results:
                mon_data_found = monitoring_results[key]
                # Update CSV columns
                for col in monitoring_cols_csv:
                    if col in mon_data_found:
                        matched_df.at[idx, col] = mon_data_found[col]
                matched_count += 1
                break

        # Add monitoring to HTML record (including arrays)
        if mon_data_found:
            record.update(mon_data_found)
        html_records.append(record)

    print(f"    Мониторинг добавлен к {matched_count} из {len(matched_df)} строк")

    # Сохраняем CSV (без массивов)
    matched_df.to_csv(output_dir / 'matched_full.csv', index=False)

    # Генерация HTML (с полными данными включая массивы)
    if not args.no_html:
        print("  Генерация HTML отчёта...")

        hierarchy = build_hierarchy(
            html_records,
            []  # Не включаем несопоставленные заявки
        )

        html_path = output_dir / 'report.html'
        generate_html_report(
            hierarchy,
            str(html_path),
            title=f"ПЛ {from_pl} — {to_pl}"
        )
        print(f"    HTML: {html_path}")

    return stats


def run_local_mode(args, config, logger):
    """Режим работы с локальными файлами."""
    # Определяем пути к файлам
    requests_path = args.requests
    pl_path = args.pl

    # Если файлы не указаны — интерактивный выбор
    if not requests_path or not pl_path:
        raw_dir = Path(config['paths']['input']['requests']).parent
        requests_path, pl_path = select_files_interactive(str(raw_dir))

    # Сохраняем выбранные пути
    config['paths']['input']['requests'] = requests_path
    config['paths']['input']['pl'] = pl_path
    logger.info(f"Файл заявок: {requests_path}")
    logger.info(f"Файл ПЛ: {pl_path}")

    print(f"\n  Заявки: {Path(requests_path).name}")
    print(f"  ПЛ:     {Path(pl_path).name}")
    print(f"  Вывод:  {config['paths']['output']['final']}")

    # Парсинг заявок
    print("\n[1/3] Парсинг заявок...")
    request_parser = RequestParser(args.config)
    request_parser.input_path = requests_path
    request_parser.parse()
    logger.info("Парсинг заявок завершён")

    # Парсинг путевых листов
    print("[2/3] Парсинг путевых листов...")
    pl_parser = PLParser(args.config)
    pl_parser.input_path = pl_path
    pl_parser.parse()
    logger.info("Парсинг ПЛ завершён")

    # Сопоставление
    print("[3/3] Сопоставление данных...")
    stats = run_matching(config, logger)
    logger.info("Сопоставление завершено")

    # Генерация HTML (только сопоставленные заявки)
    if not args.no_html:
        try:
            from src.output.html_generator_v2 import generate_html_report, build_hierarchy

            output_dir = Path(config['paths']['output']['final'])
            # Use matched_full.csv which includes monitoring data
            matched_full_path = output_dir / 'matched_full.csv'
            if matched_full_path.exists():
                matched_df = pd.read_csv(matched_full_path)
            else:
                matched_df = pd.read_csv(output_dir / 'matched.csv')

            hierarchy = build_hierarchy(
                matched_df.to_dict('records'),
                []  # Не включаем несопоставленные заявки
            )

            html_path = output_dir / 'report.html'
            generate_html_report(hierarchy, str(html_path))
            print(f"\n  HTML отчёт: {html_path}")
        except Exception as e:
            logger.warning(f"Не удалось создать HTML: {e}")

    return stats


def run_html_only_mode(args, config, logger):
    """Режим перегенерации только HTML из существующих CSV."""
    from src.output.html_generator_v2 import generate_html_report, build_hierarchy

    output_dir = Path(config['paths']['output']['final'])

    # Используем matched_full.csv если есть (с мониторингом), иначе matched.csv
    matched_full_path = output_dir / 'matched_full.csv'
    matched_path = output_dir / 'matched.csv'

    if matched_full_path.exists():
        csv_path = matched_full_path
        logger.info(f"Используем {csv_path} (с данными мониторинга)")
    elif matched_path.exists():
        csv_path = matched_path
        logger.info(f"Используем {csv_path}")
    else:
        raise FileNotFoundError(
            f"Не найдены CSV файлы: {matched_full_path} или {matched_path}\n"
            "Сначала выполните полный запуск пайплайна."
        )

    print(f"\n  Источник: {csv_path.name}")

    # Загружаем данные
    matched_df = pd.read_csv(csv_path)
    logger.info(f"Загружено {len(matched_df)} записей")

    # Строим иерархию и генерируем HTML
    hierarchy = build_hierarchy(
        matched_df.to_dict('records'),
        []  # Не включаем несопоставленные заявки
    )

    html_path = output_dir / 'report.html'
    generate_html_report(hierarchy, str(html_path))

    print(f"  HTML отчёт: {html_path}")
    logger.info(f"HTML отчёт сгенерирован: {html_path}")

    return {
        'total_requests': len(hierarchy),
        'total_pl_records': len(matched_df),
        'unique_request_numbers': len(hierarchy),
        'unique_pl_numbers': len(set(matched_df.get('pl_id', []))),
        'matched_numbers': len(hierarchy),
        'matched_rows': len(matched_df),
        'requests_only_numbers': 0,
        'requests_unmatched_rows': 0,
        'pl_only_numbers': 0,
        'pl_unmatched_rows': 0,
    }


def run_web_server(args):
    """Запуск веб-сервера."""
    print("=" * 60)
    print("TRANSPORT ANALYTICS WEB SERVER")
    print("=" * 60)
    print(f"\nЗапуск сервера на http://{args.host}:{args.port}")
    print("Для остановки нажмите Ctrl+C\n")

    from src.web.server import run_server
    run_server(host=args.host, port=args.port)


def main():
    """Главная функция - точка входа пайплайна."""
    args = parse_args()

    # Режим веб-сервера
    if args.web:
        run_web_server(args)
        return 0

    print("=" * 60)
    print("TRANSPORT ANALYTICS PIPELINE")
    print("=" * 60)

    try:
        # Загрузка конфигурации
        config = load_config(args.config)
        logger = setup_logging(config)
        logger.info("Конфигурация загружена")

        if args.output:
            config['paths']['output']['final'] = args.output
            Path(args.output).mkdir(parents=True, exist_ok=True)

        start_time = time.time()

        # Выбор режима
        if args.html_only:
            print("\nРежим: Только HTML (из существующих CSV)")
            stats = run_html_only_mode(args, config, logger)
        elif args.fetch:
            print("\nРежим: Загрузка из API")
            stats = run_fetch_mode(args, config, logger)
        else:
            print("\nРежим: Локальные файлы")
            stats = run_local_mode(args, config, logger)

        # Итоги
        elapsed = time.time() - start_time
        print_summary(stats, elapsed)

        logger.info(f"Пайплайн завершён успешно за {elapsed:.2f} сек")

        output_dir = config['paths']['output']['final']
        print(f"\nРезультаты сохранены в: {output_dir}")

        return 0

    except FileNotFoundError as e:
        print(f"\n❌ ОШИБКА: Файл не найден - {e}")
        logging.error(f"File not found: {e}")
        return 1

    except ValueError as e:
        print(f"\n❌ ОШИБКА КОНФИГУРАЦИИ: {e}")
        logging.error(f"Config error: {e}")
        return 1

    except Exception as e:
        print(f"\n❌ КРИТИЧЕСКАЯ ОШИБКА: {e}")
        logging.exception("Pipeline failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
