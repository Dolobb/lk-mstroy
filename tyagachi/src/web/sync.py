"""
Vehicle data synchronization logic.

Fetches PL + requests from API, matches them, and upserts into
Vehicle / TrackedRequest / PLRecord tables.
Stable requests (SUCCESSFULLY_COMPLETED) are not re-fetched.
"""

import logging
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Callable

import pandas as pd
import yaml

from src.api.fetcher import DataFetcher
from src.parsers.request_parser import RequestParser
from src.parsers.pl_parser import PLParser
from src.web.models import Database, TrackedRequest

logger = logging.getLogger('sync')

BASE_DIR = Path(__file__).parent.parent.parent


def sync_vehicle_data(
    period_from_pl: str,
    period_to_pl: str,
    db: Database,
    progress_callback: Optional[Callable[[str], None]] = None,
    mon_progress_callback: Optional[Callable[[int, int], None]] = None,
) -> dict:
    """
    Main sync flow.

    Args:
        period_from_pl: PL start date DD.MM.YYYY
        period_to_pl: PL end date DD.MM.YYYY
        db: Database instance
        progress_callback: optional fn(message) to report progress
        mon_progress_callback: optional fn(current, total) for monitoring progress

    Returns:
        dict with sync stats
    """
    def progress(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    config_path = str(BASE_DIR / 'config.yaml')

    with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    # 1. Determine request date range (PL start minus 2 months)
    from_pl_dt = datetime.strptime(period_from_pl, '%d.%m.%Y')
    period_from_req = (from_pl_dt - timedelta(days=60)).strftime('%d.%m.%Y')
    period_to_req = period_to_pl

    progress(f'Загрузка ПЛ ({period_from_pl} — {period_to_pl})...')

    # 2. Fetch PL from API
    fetcher = DataFetcher(config_path)
    requests_data, pl_data = fetcher.fetch_all(
        from_requests=period_from_req,
        to_requests=period_to_req,
        from_pl=period_from_pl,
        to_pl=period_to_pl,
        save_raw=True,
        use_legacy_pl_method=False,
    )

    req_count = len(requests_data.get('list', []))
    pl_count = len(pl_data.get('list', []))
    progress(f'Загружено: {req_count} заявок, {pl_count} ПЛ. Парсинг...')

    # 3. Parse via existing parsers (they write to intermediate CSVs)
    raw_dir = Path(config['paths']['input']['requests']).parent
    requests_file = raw_dir / f"Requests_{period_from_req.replace('.', '-')}_{period_to_req.replace('.', '-')}.json"
    pl_file = raw_dir / f"PL_{period_from_pl.replace('.', '-')}_{period_to_pl.replace('.', '-')}.json"

    request_parser = RequestParser(config_path)
    request_parser.input_path = str(requests_file)
    request_parser.parse()

    pl_parser = PLParser(config_path)
    pl_parser.input_path = str(pl_file)
    pl_parser.parse()

    # 4. Read parsed CSVs and match
    intermediate_dir = Path(config['paths']['output']['intermediate'])
    requests_df = pd.read_csv(intermediate_dir / 'requests_parsed.csv')
    pl_df = pd.read_csv(intermediate_dir / 'pl_parsed.csv')

    # --- ФИЛЬТР СТАТУСОВ ПЛ (изменить здесь при необходимости) ---
    # Исключаем ПЛ со статусами, не представляющими реальную работу.
    # Все статусы: PRINTING, CLOSED, GIVED_BACK, NOTUSED, CREATE
    PL_EXCLUDE_STATUSES = ['NOTUSED', 'GIVED_BACK']
    pl_df = pl_df[~pl_df['pl_status'].isin(PL_EXCLUDE_STATUSES)]
    # --- КОНЕЦ ФИЛЬТРА ---

    matched_df = pd.merge(
        requests_df,
        pl_df,
        left_on='request_number',
        right_on='extracted_request_number',
        how='inner',
        suffixes=('_req', '_pl')
    )

    progress(f'Сопоставлено: {len(matched_df)} записей. Сохранение в БД...')

    # 5. Upsert into DB
    vehicles_seen = set()
    requests_seen = {}  # request_number -> list of matched records
    stable_count = 0
    in_progress_count = 0
    requests_added = 0
    requests_updated = 0
    requests_upserted_nums = set()  # track per request_number (not per row)

    for _, row in matched_df.iterrows():
        record = row.to_dict()

        # -- Vehicle upsert --
        ts_id_str = str(record.get('ts_id_mo', ''))
        ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]
        ts_reg = record.get('ts_reg_number', '')
        ts_name = record.get('ts_name_mo', '')

        vehicle_id = None
        for ts_id in ts_ids:
            vehicle_id = db.upsert_vehicle(
                ts_id_mo=ts_id,
                ts_reg_number=ts_reg,
                ts_name_mo=ts_name,
            )
            vehicles_seen.add(ts_id)

        # -- Request upsert --
        req_num = record.get('request_number')
        if req_num and not pd.isna(req_num):
            req_num = int(req_num)
            req_status = record.get('request_status', '')
            stability = 'stable' if req_status == 'SUCCESSFULLY_COMPLETED' else 'in_progress'

            if req_num not in requests_seen:
                requests_seen[req_num] = []
            requests_seen[req_num].append(record)

            upsert_result = db.upsert_tracked_request({
                'request_number': req_num,
                'request_status': req_status,
                'stability_status': stability,
                'route_start_address': record.get('route_start_address'),
                'route_end_address': record.get('route_end_address'),
                'route_start_date': record.get('route_start_date'),
                'route_end_date': record.get('route_end_date'),
                'route_distance': str(record.get('route_distance', '')) if record.get('route_distance') else None,
                'object_expend_code': record.get('object_expend_code'),
                'object_expend_name': record.get('object_expend_name'),
                'order_name_cargo': record.get('order_name_cargo'),
            })

            # Count added/updated per unique request_number (not per row)
            if req_num not in requests_upserted_nums:
                requests_upserted_nums.add(req_num)
                if upsert_result == 'added':
                    requests_added += 1
                elif upsert_result == 'updated':
                    requests_updated += 1

            if stability == 'stable':
                stable_count += 1
            else:
                in_progress_count += 1

        # -- PLRecord upsert --
        pl_id = record.get('pl_id')
        if pl_id and vehicle_id:
            db.upsert_pl_record({
                'pl_id': pl_id,
                'vehicle_id': vehicle_id,
                'request_number': req_num if req_num and not pd.isna(req_num) else None,
                'pl_ts_number': record.get('pl_ts_number'),
                'pl_date_out': record.get('pl_date_out'),
                'pl_date_out_plan': record.get('pl_date_out_plan'),
                'pl_date_in_plan': record.get('pl_date_in_plan'),
                'pl_status': record.get('pl_status'),
                'pl_close_list': record.get('pl_close_list'),
                # НЕ передаём has_monitoring — иначе сбросит флаг при повторной синхронизации
            })

    # Store matched_data_json for each request
    for req_num, records in requests_seen.items():
        # Serialize matched records (convert NaN to None)
        clean_records = []
        for rec in records:
            clean = {}
            for k, v in rec.items():
                if pd.isna(v) if isinstance(v, float) else False:
                    clean[k] = None
                else:
                    clean[k] = v
            clean_records.append(clean)

        session = db.get_session()
        try:
            tr = session.query(TrackedRequest).filter_by(request_number=req_num).first()
            if tr and not tr.matched_data_json:
                tr.matched_data_json = json.dumps(clean_records, ensure_ascii=False, default=str)
                session.commit()
            elif tr and tr.stability_status != 'stable':
                tr.matched_data_json = json.dumps(clean_records, ensure_ascii=False, default=str)
                session.commit()
        finally:
            session.close()

    # Deduplicate stable/in_progress counts (we counted per matched row, not per request)
    unique_stable = len([rn for rn in requests_seen if any(
        r.get('request_status') == 'SUCCESSFULLY_COMPLETED' for r in requests_seen[rn]
    )])
    unique_in_progress = len(requests_seen) - unique_stable

    # 6. Load monitoring for PLs that need it
    from src.web.models import PLRecord as PLR

    # Collect pl_ids by stability
    stable_pl_ids = set()
    unstable_pl_ids = set()
    for req_num, records in requests_seen.items():
        is_stable = any(r.get('request_status') == 'SUCCESSFULLY_COMPLETED' for r in records)
        for rec in records:
            pl_id = rec.get('pl_id')
            if pl_id:
                if is_stable:
                    stable_pl_ids.add(pl_id)
                else:
                    unstable_pl_ids.add(pl_id)

    # For unstable PLs: reset has_monitoring so monitoring is re-loaded
    session = db.get_session()
    try:
        for plr in session.query(PLR).filter(PLR.pl_id.in_(unstable_pl_ids)).all():
            plr.has_monitoring = False
        session.commit()
    finally:
        session.close()

    # Skip only stable PLs that already have monitoring
    all_sync_pl_ids = stable_pl_ids | unstable_pl_ids
    session = db.get_session()
    try:
        already_monitored = set()
        for plr in session.query(PLR).filter(PLR.has_monitoring == True).all():
            already_monitored.add(plr.pl_id)
    finally:
        session.close()

    # Extract monitoring tasks, filter to only PLs from this sync without monitoring
    all_mon_tasks = fetcher.extract_monitoring_tasks(pl_data)
    mon_tasks = [t for t in all_mon_tasks
                 if t['pl_id'] in all_sync_pl_ids and t['pl_id'] not in already_monitored]

    if mon_tasks:
        progress(f'Загрузка мониторинга: {len(mon_tasks)} ПЛ без данных (уже загружено: {len(already_monitored)})...')

        def mon_progress(current, total):
            progress(f'Мониторинг: {current}/{total}...')
            if mon_progress_callback:
                mon_progress_callback(current, total)

        monitoring_results = fetcher.fetch_monitoring_batch(mon_tasks, progress_callback=mon_progress)

        # Merge monitoring into matched records and update matched_data_json
        mon_count = 0
        for req_num, records in requests_seen.items():
            updated = False
            for rec in records:
                pl_id = rec.get('pl_id')
                ts_id_str = str(rec.get('ts_id_mo', ''))
                ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]
                for ts_id in ts_ids:
                    key = (pl_id, ts_id)
                    if key in monitoring_results:
                        rec.update(monitoring_results[key])
                        updated = True
                        mon_count += 1
                        break

            if updated:
                # Re-save matched_data_json with monitoring data
                clean_records = []
                for rec in records:
                    clean = {}
                    for k, v in rec.items():
                        if isinstance(v, float) and pd.isna(v):
                            clean[k] = None
                        else:
                            clean[k] = v
                    clean_records.append(clean)

                session = db.get_session()
                try:
                    tr = session.query(TrackedRequest).filter_by(request_number=req_num).first()
                    if tr:
                        tr.matched_data_json = json.dumps(clean_records, ensure_ascii=False, default=str)
                        session.commit()
                finally:
                    session.close()

        # Mark PLRecords as having monitoring
        session = db.get_session()
        try:
            for task in mon_tasks:
                plr = session.query(PLR).filter_by(pl_id=task['pl_id']).first()
                if plr:
                    plr.has_monitoring = True
            session.commit()
        finally:
            session.close()

        progress(f'Мониторинг загружен: {mon_count} записей')
    else:
        progress(f'Мониторинг: все {len(already_monitored)} ПЛ уже загружены, пропуск')

    # 6b. Load monitoring for "orphan" PLs in DB that were synced previously
    #     but missed monitoring (e.g. their date range fell outside later syncs).
    session = db.get_session()
    try:
        from src.web.models import Vehicle as VehicleModel
        orphan_pls = session.query(PLR).filter(
            PLR.has_monitoring == False,
            PLR.pl_date_out_plan.isnot(None),
            PLR.pl_date_in_plan.isnot(None),
        ).all()

        # Exclude PLs already handled above in step 6
        handled_pl_ids = all_sync_pl_ids | already_monitored
        orphan_tasks = []
        for plr in orphan_pls:
            if plr.pl_id in handled_pl_ids:
                continue
            vehicle = session.query(VehicleModel).filter_by(id=plr.vehicle_id).first()
            if not vehicle:
                continue
            # Apply same filter as extract_monitoring_tasks: only "тягач"
            ts_name = (vehicle.ts_name_mo or '').lower()
            if 'тягач' not in ts_name:
                continue
            orphan_tasks.append({
                'pl_id': plr.pl_id,
                'ts_id_mo': vehicle.ts_id_mo,
                'ts_reg_number': vehicle.ts_reg_number,
                'ts_name_mo': vehicle.ts_name_mo,
                'from_date': plr.pl_date_out_plan,
                'to_date': plr.pl_date_in_plan,
            })
    finally:
        session.close()

    if orphan_tasks:
        progress(f'Догрузка мониторинга для {len(orphan_tasks)} ранее пропущенных ПЛ...')

        def orphan_mon_progress(current, total):
            progress(f'Догрузка мониторинга: {current}/{total}...')
            if mon_progress_callback:
                mon_progress_callback(current, total)

        orphan_results = fetcher.fetch_monitoring_batch(orphan_tasks, progress_callback=orphan_mon_progress)

        # Update matched_data_json for affected requests
        orphan_mon_count = 0
        # Group orphan PLs by request_number
        session = db.get_session()
        try:
            orphan_req_pls = {}  # req_num -> [(pl_id, ts_id_mo)]
            for task in orphan_tasks:
                plr = session.query(PLR).filter_by(pl_id=task['pl_id']).first()
                if plr and plr.request_number:
                    if plr.request_number not in orphan_req_pls:
                        orphan_req_pls[plr.request_number] = []
                    orphan_req_pls[plr.request_number].append((task['pl_id'], task['ts_id_mo']))
        finally:
            session.close()

        for req_num, pl_ts_pairs in orphan_req_pls.items():
            session = db.get_session()
            try:
                tr = session.query(TrackedRequest).filter_by(request_number=req_num).first()
                if not tr or not tr.matched_data_json:
                    continue
                records = json.loads(tr.matched_data_json)
                updated = False
                for rec in records:
                    rec_pl_id = rec.get('pl_id')
                    ts_id_str = str(rec.get('ts_id_mo', ''))
                    ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]
                    for ts_id in ts_ids:
                        key = (rec_pl_id, ts_id)
                        if key in orphan_results:
                            rec.update(orphan_results[key])
                            updated = True
                            orphan_mon_count += 1
                            break
                if updated:
                    tr.matched_data_json = json.dumps(records, ensure_ascii=False, default=str)
                    session.commit()
            finally:
                session.close()

        # Mark orphan PLs as having monitoring
        session = db.get_session()
        try:
            for task in orphan_tasks:
                plr = session.query(PLR).filter_by(pl_id=task['pl_id']).first()
                if plr:
                    plr.has_monitoring = True
            session.commit()
        finally:
            session.close()

        progress(f'Догружено мониторинга: {orphan_mon_count} записей для {len(orphan_tasks)} ПЛ')

    # 7. Write SyncLog
    progress('Запись лога синхронизации...')
    sync_log = db.create_sync_log({
        'period_from_pl': period_from_pl,
        'period_to_pl': period_to_pl,
        'period_from_req': period_from_req,
        'period_to_req': period_to_req,
        'vehicles_count': len(vehicles_seen),
        'requests_total': len(requests_seen),
        'requests_stable': unique_stable,
        'requests_in_progress': unique_in_progress,
        'status': 'success',
    })

    # 8. Cleanup old data (rotation)
    progress('Ротация: удаление старых данных...')
    cleanup = db.cleanup_old_data(max_age_days=60)
    cleanup_total = sum(cleanup.values())
    if cleanup_total > 0:
        progress(f'Ротация: удалено {cleanup["deleted_pls"]} ПЛ, '
                 f'{cleanup["deleted_requests"]} заявок, '
                 f'{cleanup["deleted_vehicles"]} машин, '
                 f'{cleanup["deleted_sync_logs"]} логов старше 60 дней')
    else:
        progress('Ротация: нет данных старше 60 дней')

    # Get cumulative DB totals for the summary
    db_summary = db.get_dashboard_summary()

    progress(f'Синхронизация завершена. '
             f'Этот sync: {len(requests_seen)} заявок ({unique_stable} стаб., {unique_in_progress} в работе). '
             f'Всего в БД: {db_summary["requests_total"]} заявок '
             f'({db_summary["requests_stable"]} стаб., {db_summary["requests_in_progress"]} в работе)')

    return {
        'vehicles_count': len(vehicles_seen),
        'requests_total': len(requests_seen),
        'requests_stable': unique_stable,
        'requests_in_progress': unique_in_progress,
        'requests_added': requests_added,
        'requests_updated': requests_updated,
        'sync_log_id': sync_log.id,
    }
