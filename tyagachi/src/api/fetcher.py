"""
Data Fetcher - orchestrates API requests and builds hierarchy.

Workflow:
1. Fetch requests for period
2. Fetch route lists for period
3. For each PL, for each vehicle (ts_id_mo), fetch monitoring for PL period
4. Build hierarchical structure: Request → PL → Vehicle + Monitoring

Supports multiple API tokens for parallel requests.
"""

import logging
import time
import yaml
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from src.api.client import APIClient, NotFoundError
from src.parsers.monitoring_parser import parse_monitoring


class DataFetcher:
    """
    Orchestrates data fetching from API and builds data hierarchy.
    Supports multiple tokens for parallel monitoring requests.
    """

    def __init__(self, config_path: str = "config.yaml"):
        """Initialize fetcher with API client(s)."""
        self.config_path = config_path
        self.client = APIClient(config_path)
        self.logger = logging.getLogger('api.fetcher')
        self.logger.setLevel(logging.INFO)

        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            ))
            self.logger.addHandler(handler)

        # Load additional tokens for parallel requests
        self.tokens = self._load_tokens(config_path)
        self.logger.info(f"Loaded {len(self.tokens)} API token(s)")

    def _load_tokens(self, config_path: str) -> List[str]:
        """Load list of API tokens from config."""
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        api_config = config.get('api', {})

        # Try tokens list first, fallback to single token
        tokens = api_config.get('tokens', [])
        if not tokens:
            single_token = api_config.get('token', '')
            if single_token:
                tokens = [single_token]

        # Filter out empty/placeholder tokens
        return [t for t in tokens if t and not t.startswith('SECOND') and not t.startswith('THIRD')]

    def fetch_all(
        self,
        from_requests: str,
        to_requests: str,
        from_pl: str,
        to_pl: str,
        save_raw: bool = True,
        use_legacy_pl_method: bool = False,
    ) -> Tuple[Dict, Dict]:
        """
        Fetch requests and route-lists using separate date ranges.

        Args:
            from_requests: Start date for requests (DD.MM.YYYY)
            to_requests: End date for requests (DD.MM.YYYY)
            from_pl: Start date for route-lists (DD.MM.YYYY)
            to_pl: End date for route-lists (DD.MM.YYYY)
            save_raw: Whether to save raw JSON files
            use_legacy_pl_method: Use legacy getRouteLists (by closeList) instead of getRouteListsByDateOut (default: False)

        Returns:
            Tuple of (requests_data, route_lists_data)
        """
        # Fetch requests
        print(f"  Загрузка заявок...")
        requests_data = self.client.get_requests(from_requests, to_requests)

        if save_raw:
            filename = f"Data/raw/Requests_{from_requests.replace('.', '-')}_{to_requests.replace('.', '-')}.json"
            self.client.save_json(requests_data, filename)

        # Fetch route lists
        method_name = "legacy" if use_legacy_pl_method else "DateOut"
        print(f"  Загрузка путевых листов (метод: {method_name})...")
        pl_data = self.client.get_route_lists(from_pl, to_pl, use_legacy=use_legacy_pl_method)

        if save_raw:
            suffix = "_legacy" if use_legacy_pl_method else ""
            filename = f"Data/raw/PL_{from_pl.replace('.', '-')}_{to_pl.replace('.', '-')}{suffix}.json"
            self.client.save_json(pl_data, filename)

        return requests_data, pl_data

    def extract_monitoring_tasks(self, pl_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract monitoring tasks from route lists.

        For each PL, for each vehicle (ts), create a monitoring task
        with vehicle ID and PL period (dateOutPlan - dateInPlan).

        Args:
            pl_data: Route lists JSON data

        Returns:
            List of monitoring tasks: [{pl_id, ts_id_mo, ts_reg_number, from_date, to_date}, ...]
        """
        tasks = []

        for pl in pl_data.get('list', []):
            pl_id = f"{pl.get('tsNumber')}_{pl.get('dateOut')}"
            date_out_plan = pl.get('dateOutPlan', '')
            date_in_plan = pl.get('dateInPlan', '')

            # Skip if no dates
            if not date_out_plan or not date_in_plan:
                continue

            # Get vehicles from ts array
            ts_list = pl.get('ts', [])
            if not ts_list:
                continue

            for ts in ts_list:
                if not isinstance(ts, dict):
                    continue

                ts_id_mo = ts.get('idMO')
                if not ts_id_mo:
                    continue

                # Filter: only vehicles with "Самосвал" or "тягач" in ts_name_mo
                ts_name = str(ts.get('nameMO', '')).lower()
                if 'тягач' not in ts_name:
                    continue
#'самосвал' not in ts_name and 
                tasks.append({
                    'pl_id': pl_id,
                    'ts_id_mo': ts_id_mo,
                    'ts_reg_number': ts.get('regNumber'),
                    'ts_name_mo': ts.get('nameMO'),
                    'from_date': date_out_plan,
                    'to_date': date_in_plan,
                })

        return tasks

    def fetch_monitoring_batch(self, tasks: List[Dict[str, Any]], progress_callback=None) -> Dict[str, Dict]:
        """
        Fetch monitoring data for all tasks.
        Uses multiple tokens in parallel if available.

        Args:
            tasks: List of monitoring tasks from extract_monitoring_tasks()
            progress_callback: Optional callback(current, total) for progress

        Returns:
            Dictionary: {(pl_id, ts_id_mo): monitoring_data}
        """
        total = len(tasks)

        # Use parallel fetching if multiple tokens available
        if len(self.tokens) > 1:
            print(f"  Загрузка мониторинга ({total} запросов) через {len(self.tokens)} токенов...")
            return self._fetch_monitoring_parallel(tasks, progress_callback)

        # Single token - use sequential fetching
        print(f"  Загрузка мониторинга ({total} запросов)...")
        return self._fetch_monitoring_sequential(tasks, progress_callback)

    def _fetch_monitoring_sequential(self, tasks: List[Dict[str, Any]], progress_callback=None) -> Dict[str, Dict]:
        """Sequential fetching with single token (original logic)."""
        results = {}
        total = len(tasks)

        # Track last request time per vehicle (API limit: 1 request per 30s per vehicle)
        last_request_time: Dict[int, float] = {}
        RATE_LIMIT_SECONDS = 30

        # Reorder tasks to minimize waiting: spread same vehicles apart
        tasks_sorted = self._reorder_tasks_for_rate_limit(tasks)

        for i, task in enumerate(tasks_sorted):
            key = (task['pl_id'], task['ts_id_mo'])
            ts_id = task['ts_id_mo']

            # Check if we need to wait for this vehicle
            if ts_id in last_request_time:
                elapsed = time.time() - last_request_time[ts_id]
                if elapsed < RATE_LIMIT_SECONDS:
                    wait_time = RATE_LIMIT_SECONDS - elapsed
                    self.logger.debug(f"Waiting {wait_time:.1f}s for vehicle {ts_id}")
                    time.sleep(wait_time)

            try:
                raw_data = self.client.get_monitoring_stats(
                    id_mo=ts_id,
                    from_date=task['from_date'],
                    to_date=task['to_date']
                )

                # Record request time
                last_request_time[ts_id] = time.time()

                # Parse immediately, don't store raw
                parsed = parse_monitoring(raw_data)
                results[key] = parsed

            except NotFoundError:
                # Vehicle not registered in monitoring system - skip silently
                last_request_time[ts_id] = time.time()
                results[key] = parse_monitoring({})
            except Exception as e:
                self.logger.warning(f"Failed to fetch monitoring for {key}: {e}")
                last_request_time[ts_id] = time.time()
                results[key] = parse_monitoring({})

            # Progress
            if progress_callback:
                progress_callback(i + 1, total)
            elif (i + 1) % 10 == 0 or i + 1 == total:
                print(f"    [{i + 1}/{total}]")

        return results

    def _fetch_monitoring_parallel(self, tasks: List[Dict[str, Any]], progress_callback=None) -> Dict[str, Dict]:
        """
        Parallel fetching using multiple tokens.
        Each token gets its own thread and rate-limit tracking.
        """
        results = {}
        total = len(tasks)
        completed = [0]  # Use list for mutable counter in threads
        lock = threading.Lock()

        # Create API client for each token
        clients = []
        for token in self.tokens:
            client = APIClient.__new__(APIClient)
            client.base_url = self.client.base_url
            client.token = token
            client.format = self.client.format
            client.timeout = self.client.timeout
            client.retry_count = self.client.retry_count
            client.logger = self.client.logger
            clients.append(client)

        # Distribute tasks across tokens (round-robin)
        task_queues = [[] for _ in clients]
        for i, task in enumerate(tasks):
            task_queues[i % len(clients)].append(task)

        def worker(client_idx: int, client: APIClient, task_list: List[Dict]):
            """Worker function for each token."""
            local_results = {}
            last_request_time: Dict[int, float] = {}
            RATE_LIMIT_SECONDS = 30

            for task in task_list:
                key = (task['pl_id'], task['ts_id_mo'])
                ts_id = task['ts_id_mo']

                # Rate limit per vehicle per token
                if ts_id in last_request_time:
                    elapsed = time.time() - last_request_time[ts_id]
                    if elapsed < RATE_LIMIT_SECONDS:
                        time.sleep(RATE_LIMIT_SECONDS - elapsed)

                try:
                    raw_data = client.get_monitoring_stats(
                        id_mo=ts_id,
                        from_date=task['from_date'],
                        to_date=task['to_date']
                    )
                    last_request_time[ts_id] = time.time()
                    local_results[key] = parse_monitoring(raw_data)

                except NotFoundError:
                    last_request_time[ts_id] = time.time()
                    local_results[key] = parse_monitoring({})
                except Exception as e:
                    self.logger.warning(f"Token {client_idx}: Failed for {key}: {e}")
                    last_request_time[ts_id] = time.time()
                    local_results[key] = parse_monitoring({})

                # Update progress
                with lock:
                    completed[0] += 1
                    if completed[0] % 10 == 0 or completed[0] == total:
                        print(f"    [{completed[0]}/{total}]")

            return local_results

        # Run workers in parallel
        with ThreadPoolExecutor(max_workers=len(clients)) as executor:
            futures = [
                executor.submit(worker, i, clients[i], task_queues[i])
                for i in range(len(clients))
            ]

            for future in as_completed(futures):
                try:
                    local_results = future.result()
                    results.update(local_results)
                except Exception as e:
                    self.logger.error(f"Worker failed: {e}")

        return results

    def _reorder_tasks_for_rate_limit(self, tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Reorder tasks to spread requests for same vehicle apart.

        This minimizes waiting time by ensuring we don't request the same
        vehicle twice in a row.
        """
        if not tasks:
            return tasks

        # Group tasks by vehicle ID
        by_vehicle: Dict[int, List[Dict]] = {}
        for task in tasks:
            ts_id = task['ts_id_mo']
            if ts_id not in by_vehicle:
                by_vehicle[ts_id] = []
            by_vehicle[ts_id].append(task)

        # Interleave: take one from each vehicle in round-robin
        result = []
        vehicle_ids = list(by_vehicle.keys())

        while any(by_vehicle.values()):
            for vid in vehicle_ids:
                if by_vehicle[vid]:
                    result.append(by_vehicle[vid].pop(0))

        return result


def fetch_data_interactive(config_path: str = "config.yaml") -> Tuple[str, str]:
    """
    Interactive prompt for date range.

    Returns:
        Tuple of (from_date, to_date) in DD.MM.YYYY format
    """
    print("\nВведите период для загрузки данных:")

    while True:
        from_date = input("  Дата начала (ДД.ММ.ГГГГ): ").strip()
        if _validate_date(from_date):
            break
        print("  Неверный формат. Используйте ДД.ММ.ГГГГ")

    while True:
        to_date = input("  Дата окончания (ДД.ММ.ГГГГ): ").strip()
        if _validate_date(to_date):
            break
        print("  Неверный формат. Используйте ДД.ММ.ГГГГ")

    return from_date, to_date


def _validate_date(date_str: str) -> bool:
    """Validate date format DD.MM.YYYY."""
    try:
        datetime.strptime(date_str, '%d.%m.%Y')
        return True
    except ValueError:
        return False