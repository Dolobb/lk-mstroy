"""
Request Parser Module

Parses Requests_raw.json to extract required fields and output requests_parsed.csv.
Follows fail-soft principle: missing fields result in null values, not crashes.
"""

import csv
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import yaml


class RequestParser:
    """
    Parser for transport request data.

    Loads configuration from config.yaml and parses Requests_raw.json
    to extract required fields into a flat CSV format.
    """

    def __init__(self, config_path: str = "config.yaml"):
        """
        Initialize RequestParser with configuration.

        Args:
            config_path: Path to YAML configuration file (default: config.yaml)
        """
        self.config = self._load_config(config_path)
        self._setup_logging()

        # Store paths from config
        self.input_path = self.config['paths']['input']['requests']
        self.output_path = Path(self.config['paths']['output']['intermediate']) / 'requests_parsed.csv'

        # Store parsing settings
        self.fail_on_missing = self.config['parsing']['fail_on_missing_fields']
        self.log_warnings = self.config['parsing']['log_warnings']

        self.logger.info(f"RequestParser initialized with config from {config_path}")

    def _load_config(self, config_path: str) -> Dict[str, Any]:
        """
        Load YAML configuration file.

        Args:
            config_path: Path to YAML configuration file

        Returns:
            Dictionary containing configuration

        Raises:
            FileNotFoundError: If config file doesn't exist
            yaml.YAMLError: If config file is invalid
        """
        config_file = Path(config_path)
        if not config_file.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        with open(config_file, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        return config

    def _setup_logging(self):
        """
        Configure logging based on config settings.
        """
        log_config = self.config['logging']
        log_level = getattr(logging, log_config['level'])

        # Create logger
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(log_level)

        # Clear any existing handlers
        self.logger.handlers = []

        # Console handler
        if log_config['console']:
            console_handler = logging.StreamHandler()
            console_handler.setLevel(log_level)
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            console_handler.setFormatter(formatter)
            self.logger.addHandler(console_handler)

        # File handler
        if log_config['file']:
            log_dir = Path(self.config['paths']['output']['logs'])
            log_dir.mkdir(parents=True, exist_ok=True)

            from datetime import datetime
            date_str = datetime.now().strftime('%Y-%m-%d')
            log_file = log_dir / log_config['file_format'].replace('{date}', date_str)

            file_handler = logging.FileHandler(log_file, encoding='utf-8')
            file_handler.setLevel(log_level)
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)

    def load_requests(self) -> Dict[str, Any]:
        """
        Load and parse Requests_raw.json file.

        Returns:
            Dictionary containing the parsed JSON data with a 'list' key

        Raises:
            FileNotFoundError: If input file doesn't exist
            json.JSONDecodeError: If input file is not valid JSON
            KeyError: If JSON doesn't contain required 'list' key
        """
        input_file = Path(self.input_path)

        # Check file exists
        if not input_file.exists():
            self.logger.error(f"Input file not found: {self.input_path}")
            raise FileNotFoundError(f"Input file not found: {self.input_path}")

        self.logger.info(f"Loading requests from {self.input_path}")

        try:
            # Load JSON file
            with open(input_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Validate structure
            if 'list' not in data:
                self.logger.error("JSON file does not contain required 'list' key")
                raise KeyError("JSON file does not contain required 'list' key")

            if not isinstance(data['list'], list):
                self.logger.error("'list' key does not contain an array")
                raise ValueError("'list' key does not contain an array")

            request_count = len(data['list'])
            self.logger.info(f"Successfully loaded {request_count} requests")

            return data

        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid JSON in file {self.input_path}: {e}")
            raise
        except Exception as e:
            self.logger.error(f"Error loading requests: {e}")
            raise

    def _safe_get(self, data: Dict[str, Any], *keys: str, default: Any = None) -> Any:
        """
        Safely navigate nested dictionary structure.

        Args:
            data: Dictionary to navigate
            *keys: Sequence of keys to traverse
            default: Value to return if path not found (default: None)

        Returns:
            Value at the end of the path, or default if not found
        """
        current = data
        for key in keys:
            if not isinstance(current, dict):
                return default
            current = current.get(key)
            if current is None:
                return default
        return current

    def _extract_fields(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract all required fields from a single request object.

        Implements fail-soft extraction: missing fields result in None values.
        If any unexpected error occurs during extraction, returns a record with
        all fields set to None (except request_number if available).

        Args:
            request: Single request dictionary from the 'list' array

        Returns:
            Dictionary with extracted fields matching the output schema
        """
        # Default empty record structure
        empty_record = {
            'request_number': None,
            'request_status': None,
            'request_date_processed': None,
            'order_name_cargo': None,
            'order_weight_cargo': None,
            'order_volume_cargo': None,
            'order_count_ts': None,
            'order_cnt_trip': None,
            'route_start_address': None,
            'route_start_date': None,
            'route_end_address': None,
            'route_end_date': None,
            'route_distance': None,
            'route_time': None,
            'route_time_zone_tag': None,
            'object_expend_code': None,
            'object_expend_name': None,
            'route_polyline': None,
            'route_points_json': None,
        }

        try:
            # Validate input is a dictionary
            if not isinstance(request, dict):
                if self.log_warnings:
                    self.logger.warning("Request object is not a dictionary")
                return empty_record

            # Extract top-level fields
            request_number = request.get('number')
            request_status = request.get('status')
            request_date_processed = request.get('dateProcessed')

            # Get first order (orders[0])
            orders = request.get('orders', [])
            if not isinstance(orders, list) or len(orders) == 0:
                if self.log_warnings:
                    self.logger.warning(
                        f"Request {request_number}: missing or empty 'orders' array"
                    )
                # Return record with only top-level fields
                result = empty_record.copy()
                result['request_number'] = request_number
                result['request_status'] = request_status
                result['request_date_processed'] = request_date_processed
                return result

            order = orders[0]

            # Validate order is a dictionary
            if not isinstance(order, dict):
                if self.log_warnings:
                    self.logger.warning(
                        f"Request {request_number}: order is not a dictionary"
                    )
                result = empty_record.copy()
                result['request_number'] = request_number
                result['request_status'] = request_status
                result['request_date_processed'] = request_date_processed
                return result

            # Extract order-level fields
            order_name_cargo = order.get('nameCargo')
            order_weight_cargo = order.get('weightCargo')
            order_volume_cargo = order.get('volumeCargo')
            order_count_ts = order.get('countTs')
            order_cnt_trip = order.get('cntTrip')

            # Extract route fields
            route = order.get('route', {})
            if not isinstance(route, dict):
                route = {}
                if self.log_warnings:
                    self.logger.warning(
                        f"Request {request_number}: 'route' is not a dictionary"
                    )

            route_distance = route.get('distance')
            route_time = route.get('time')
            route_time_zone_tag = route.get('timeZoneTag')
            route_polyline = route.get('polyline')

            # Extract route points (start and end addresses + dates)
            points = route.get('points', [])
            route_start_address = None
            route_start_date = None
            route_end_address = None
            route_end_date = None
            route_points_json = None

            if isinstance(points, list) and len(points) > 0:
                # First point
                if isinstance(points[0], dict):
                    route_start_address = points[0].get('address')
                    route_start_date = points[0].get('date')

                # Last point
                if isinstance(points[-1], dict):
                    route_end_address = points[-1].get('address')
                    route_end_date = points[-1].get('date')

                # Extract all points with coordinates for map
                route_points_list = []
                for pt in points:
                    if isinstance(pt, dict):
                        lat_lon = pt.get('latLon', {})
                        if isinstance(lat_lon, dict) and lat_lon.get('lat') and lat_lon.get('lng'):
                            route_points_list.append({
                                'lat': lat_lon.get('lat'),
                                'lng': lat_lon.get('lng'),
                                'address': pt.get('address', ''),
                                'date': pt.get('date', ''),
                                'time': pt.get('time', ''),
                            })
                if route_points_list:
                    route_points_json = json.dumps(route_points_list, ensure_ascii=False)

            elif self.log_warnings and route:
                self.logger.warning(
                    f"Request {request_number}: missing or empty 'route.points' array"
                )

            # Extract objectExpend fields
            object_expend = order.get('objectExpend', {})
            if not isinstance(object_expend, dict):
                object_expend = {}
                if self.log_warnings:
                    self.logger.warning(
                        f"Request {request_number}: 'objectExpend' is not a dictionary"
                    )

            object_expend_code = object_expend.get('code')
            object_expend_name = object_expend.get('name')

            return {
                'request_number': request_number,
                'request_status': request_status,
                'request_date_processed': request_date_processed,
                'order_name_cargo': order_name_cargo,
                'order_weight_cargo': order_weight_cargo,
                'order_volume_cargo': order_volume_cargo,
                'order_count_ts': order_count_ts,
                'order_cnt_trip': order_cnt_trip,
                'route_start_address': route_start_address,
                'route_start_date': route_start_date,
                'route_end_address': route_end_address,
                'route_end_date': route_end_date,
                'route_distance': route_distance,
                'route_time': route_time,
                'route_time_zone_tag': route_time_zone_tag,
                'object_expend_code': object_expend_code,
                'object_expend_name': object_expend_name,
                'route_polyline': route_polyline,
                'route_points_json': route_points_json,
            }

        except Exception as e:
            # Fail-soft: catch any unexpected errors during extraction
            request_number = None
            try:
                # Try to get request_number for logging
                if isinstance(request, dict):
                    request_number = request.get('number')
            except Exception:
                pass

            if self.log_warnings:
                self.logger.warning(
                    f"Request {request_number}: unexpected error during field extraction: {e}"
                )

            # Return empty record with request_number if we got it
            result = empty_record.copy()
            result['request_number'] = request_number
            return result

    def parse(self) -> None:
        """
        Main parsing method: loads requests, extracts fields, and writes CSV output.

        This method orchestrates the entire parsing process:
        1. Loads Requests_raw.json
        2. Extracts fields from each request
        3. Writes results to requests_parsed.csv

        Raises:
            Exception: If any critical error occurs during parsing
        """
        self.logger.info("Starting request parsing")

        try:
            # Load requests from JSON
            data = self.load_requests()
            requests_list = data['list']

            # Extract fields from all requests
            self.logger.info(f"Extracting fields from {len(requests_list)} requests")
            extracted_records = []

            for idx, request in enumerate(requests_list):
                try:
                    record = self._extract_fields(request)
                    extracted_records.append(record)
                except Exception as e:
                    # Fail-soft: log error but continue processing
                    self.logger.error(f"Error extracting fields from request at index {idx}: {e}")
                    # Add empty record to maintain count
                    extracted_records.append({
                        'request_number': None,
                        'request_status': None,
                        'request_date_processed': None,
                        'order_name_cargo': None,
                        'order_weight_cargo': None,
                        'order_volume_cargo': None,
                        'order_count_ts': None,
                        'order_cnt_trip': None,
                        'route_start_address': None,
                        'route_start_date': None,
                        'route_end_address': None,
                        'route_end_date': None,
                        'route_distance': None,
                        'route_time': None,
                        'route_time_zone_tag': None,
                        'object_expend_code': None,
                        'object_expend_name': None,
                        'route_polyline': None,
                        'route_points_json': None,
                    })

            self.logger.info(f"Successfully extracted {len(extracted_records)} records")

            # Ensure output directory exists
            self.output_path.parent.mkdir(parents=True, exist_ok=True)

            # Write to CSV
            self.logger.info(f"Writing output to {self.output_path}")

            # Define column order
            fieldnames = [
                'request_number',
                'request_status',
                'request_date_processed',
                'order_name_cargo',
                'order_weight_cargo',
                'order_volume_cargo',
                'order_count_ts',
                'order_cnt_trip',
                'route_start_address',
                'route_start_date',
                'route_end_address',
                'route_end_date',
                'route_distance',
                'route_time',
                'route_time_zone_tag',
                'object_expend_code',
                'object_expend_name',
                'route_polyline',
                'route_points_json',
            ]

            with open(self.output_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(extracted_records)

            self.logger.info(f"Successfully wrote {len(extracted_records)} records to {self.output_path}")
            self.logger.info("Request parsing completed successfully")

        except Exception as e:
            self.logger.error(f"Critical error during parsing: {e}")
            raise


if __name__ == "__main__":
    """
    Main execution block for running the parser as a standalone script.
    """
    try:
        parser = RequestParser()
        parser.parse()
    except Exception as e:
        # Use basic logging if parser failed to initialize
        import sys
        logging.basicConfig(level=logging.ERROR)
        logging.error(f"Failed to run parser: {e}")
        sys.exit(1)
