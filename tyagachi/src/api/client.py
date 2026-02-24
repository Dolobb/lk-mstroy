"""
API Client for TIS Online Transport Management System.

Provides methods to fetch requests, route lists, and monitoring data.
"""

import json
import time
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

import requests
import yaml


class NotFoundError(Exception):
    """Raised when API returns 404 - resource not found (e.g., vehicle not in monitoring)."""
    pass


class APIClient:
    """
    Client for TIS Online API.

    Endpoints:
    - getRequests: Transport requests
    - getRouteLists: Route lists (PL)
    - getMonitoringStats: Vehicle monitoring data
    """

    def __init__(self, config_path: str = "config.yaml"):
        """Initialize API client with configuration."""
        self.config = self._load_config(config_path)
        self._setup_logging()

        api_config = self.config.get('api', {})
        self.base_url = api_config.get('base_url', 'https://tt.tis-online.com/tt/api/v3')
        self.token = api_config.get('token', '')
        self.format = api_config.get('format', 'json')
        self.timeout = api_config.get('timeout', 30)
        self.retry_count = api_config.get('retry_count', 3)

        if not self.token:
            raise ValueError("API token not configured. Add 'api.token' to config.yaml")

        self.logger.info("APIClient initialized")

    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """Load YAML configuration file."""
        config_file = Path(config_path)
        if not config_file.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        with open(config_file, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)

    def _setup_logging(self):
        """Configure logging."""
        self.logger = logging.getLogger('api.client')
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            ))
            self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)

    def _make_request(self, command: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Make POST request to API.

        Args:
            command: API command (getRequests, getRouteLists, getMonitoringStats)
            params: Additional parameters for the command

        Returns:
            JSON response as dictionary
        """
        url_params = {
            'token': self.token,
            'format': self.format,
            'command': command,
            **params
        }

        # Build URL with query parameters
        param_str = '&'.join(f"{k}={v}" for k, v in url_params.items())
        full_url = f"{self.base_url}?{param_str}"

        last_error = None
        attempt = 0
        rate_limit_retries = 0
        max_rate_limit_retries = 5

        while attempt < self.retry_count:
            try:
                self.logger.debug(f"Request attempt {attempt + 1}: {command}")
                response = requests.post(full_url, timeout=self.timeout)
                response.raise_for_status()

                data = response.json()
                return data

            except requests.exceptions.HTTPError as e:
                # 404 = vehicle not in monitoring system, skip immediately
                if e.response is not None and e.response.status_code == 404:
                    raise NotFoundError(f"Resource not found: {command}")
                # 429 = rate limited, wait and retry (doesn't count as attempt)
                if e.response is not None and e.response.status_code == 429:
                    rate_limit_retries += 1
                    if rate_limit_retries > max_rate_limit_retries:
                        raise RuntimeError(f"Rate limited too many times for {command}")
                    wait_time = 10 * rate_limit_retries
                    self.logger.warning(f"Rate limited, waiting {wait_time}s (retry {rate_limit_retries}/{max_rate_limit_retries})...")
                    time.sleep(wait_time)
                    continue
                last_error = str(e)
                self.logger.warning(f"HTTP error on attempt {attempt + 1}: {e}")
            except requests.exceptions.Timeout:
                last_error = "Request timeout"
                self.logger.warning(f"Timeout on attempt {attempt + 1}")
            except requests.exceptions.RequestException as e:
                last_error = str(e)
                self.logger.warning(f"Request error on attempt {attempt + 1}: {e}")
            except json.JSONDecodeError as e:
                last_error = f"Invalid JSON response: {e}"
                self.logger.error(last_error)
                break

            attempt += 1
            if attempt < self.retry_count:
                time.sleep(2 ** (attempt - 1))  # Exponential backoff

        raise RuntimeError(f"API request failed after {self.retry_count} attempts: {last_error}")

    def get_requests(self, from_date: str, to_date: str) -> Dict[str, Any]:
        """
        Fetch transport requests for a date range.

        Args:
            from_date: Start date (DD.MM.YYYY)
            to_date: End date (DD.MM.YYYY)

        Returns:
            JSON response with 'list' array of requests
        """
        self.logger.info(f"Fetching requests: {from_date} - {to_date}")

        params = {
            'fromDate': from_date,
            'toDate': to_date
        }

        data = self._make_request('getRequests', params)

        count = len(data.get('list', []))
        self.logger.info(f"Fetched {count} requests")

        return data

    def get_route_lists(self, from_date: str, to_date: str, use_legacy: bool = False) -> Dict[str, Any]:
        """
        Fetch route lists (PL) for a date range.

        By default uses getRouteListsByDateOut (filters by departure date).
        Set use_legacy=True to use old method (filters by close date).

        Args:
            from_date: Start date (DD.MM.YYYY)
            to_date: End date (DD.MM.YYYY)
            use_legacy: Use old getRouteLists method (default: False)

        Returns:
            JSON response with 'list' array of route lists
        """
        if use_legacy:
            return self.get_route_lists_legacy(from_date, to_date)
        else:
            return self.get_route_lists_by_date_out(from_date, to_date)

    def get_route_lists_by_date_out(self, from_date: str, to_date: str) -> Dict[str, Any]:
        """
        Fetch route lists filtered by departure date (dateOut).

        This method returns ALL route lists with dateOut in the specified period,
        regardless of their status (CLOSED, PRINTING, NOTUSED, etc.).

        Use this method when you need:
        - Route lists by departure date
        - All statuses (not just closed)
        - Planning and daily analysis

        Args:
            from_date: Start date (DD.MM.YYYY)
            to_date: End date (DD.MM.YYYY)

        Returns:
            JSON response with 'list' array of route lists
        """
        self.logger.info(f"Fetching route lists by DateOut: {from_date} - {to_date}")

        params = {
            'fromDate': from_date,
            'toDate': to_date
        }

        data = self._make_request('getRouteListsByDateOut', params)

        count = len(data.get('list', []))
        self.logger.info(f"Fetched {count} route lists (by DateOut)")

        return data

    def get_route_lists_legacy(self, from_date: str, to_date: str) -> Dict[str, Any]:
        """
        [LEGACY] Fetch route lists filtered by close date (closeList).

        This method returns only CLOSED route lists where closeList is in the period.
        Includes glonassData field.

        Use this method when you need:
        - Only closed route lists
        - Accounting/financial reports
        - GLONASS data (glonassData field)

        Args:
            from_date: Start date (DD.MM.YYYY)
            to_date: End date (DD.MM.YYYY)

        Returns:
            JSON response with 'list' array of route lists
        """
        self.logger.info(f"Fetching route lists (legacy): {from_date} - {to_date}")

        params = {
            'fromDate': from_date,
            'toDate': to_date
        }

        data = self._make_request('getRouteLists', params)

        count = len(data.get('list', []))
        self.logger.info(f"Fetched {count} route lists (legacy method)")

        return data

    def get_monitoring_stats(self, id_mo: int, from_date: str, to_date: str) -> Dict[str, Any]:
        """
        Fetch monitoring statistics for a vehicle.

        Args:
            id_mo: Monitoring object ID (vehicle ID)
            from_date: Start date/time (DD.MM.YYYY HH:MM)
            to_date: End date/time (DD.MM.YYYY HH:MM)

        Returns:
            JSON response with monitoring data (distance, time, fuel, etc.)
        """
        self.logger.debug(f"Fetching monitoring for MO {id_mo}: {from_date} - {to_date}")

        params = {
            'idMO': id_mo,
            'fromDate': from_date,
            'toDate': to_date
        }

        data = self._make_request('getMonitoringStats', params)

        return data

    def save_json(self, data: Dict[str, Any], filepath: str) -> None:
        """Save JSON data to file."""
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)

        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        self.logger.info(f"Saved: {filepath}")
