"""
PL Parser Module

Parses PL_raw.json to extract route list data and flatten the nested calcs array.
Each calc becomes a separate row in pl_parsed.csv.
Follows fail-soft principle: missing fields result in null values, not crashes.
"""

import csv
import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
import yaml


def extract_request_number(order_descr: str) -> Optional[int]:
    """
    Extract request number from orderDescr string.

    Rule: all digits after start until "/" or space.

    Examples:
        "№120360/1 от 31.12.2025..." → 120360
        "120360/1" → 120360
        "№ 120360/1" → 120360
        "Без номера" → None
        "" → None
        None → None
    """
    if not order_descr:
        return None

    # Remove № symbol and leading spaces
    cleaned = order_descr.lstrip('№').lstrip()

    # Find sequence of digits until "/" or space
    match = re.match(r'^(\d+)', cleaned)

    if match:
        return int(match.group(1))

    return None


class PLParser:
    """
    Parser for route list (PL) data.

    Loads configuration from config.yaml and parses PL_raw.json
    to extract required fields into a flat CSV format with one row per calc.
    """

    def __init__(self, config_path: str = "config.yaml"):
        """
        Initialize PLParser with configuration.

        Args:
            config_path: Path to YAML configuration file (default: config.yaml)
        """
        self.config = self._load_config(config_path)
        self._setup_logging()

        # Store paths from config
        self.input_path = self.config['paths']['input']['pl']
        self.output_path = Path(self.config['paths']['output']['intermediate']) / 'pl_parsed.csv'

        # Store parsing settings
        self.fail_on_missing = self.config['parsing']['fail_on_missing_fields']
        self.log_warnings = self.config['parsing']['log_warnings']

        self.logger.info(f"PLParser initialized with config from {config_path}")

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

    def load_route_lists(self) -> Dict[str, Any]:
        """
        Load and parse PL_raw.json file.

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

        self.logger.info(f"Loading route lists from {self.input_path}")

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

            route_list_count = len(data['list'])
            self.logger.info(f"Successfully loaded {route_list_count} route lists")

            return data

        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid JSON in file {self.input_path}: {e}")
            raise
        except Exception as e:
            self.logger.error(f"Error loading route lists: {e}")
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

    def _extract_fields(self, route_list: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract all required fields from a single route list object.

        Implements fail-soft extraction: missing fields result in None values.
        Flattens the calcs array so each calc becomes a separate row.
        If any unexpected error occurs during extraction, returns empty list.

        Args:
            route_list: Single route list dictionary from the 'list' array

        Returns:
            List of dictionaries, one per calc, with extracted fields matching the output schema
        """
        extracted_rows = []

        try:
            # Validate input is a dictionary
            if not isinstance(route_list, dict):
                if self.log_warnings:
                    self.logger.warning("Route list object is not a dictionary")
                return []

            # Extract top-level PL fields
            pl_ts_number = route_list.get('tsNumber')
            pl_date_out = route_list.get('dateOut')
            pl_date_out_plan = route_list.get('dateOutPlan')
            pl_date_in_plan = route_list.get('dateInPlan')
            pl_status = route_list.get('status')
            pl_close_list = route_list.get('closeList')

            # Generate pl_id from tsNumber + dateOut
            pl_id = None
            if pl_ts_number and pl_date_out:
                pl_id = f"{pl_ts_number}_{pl_date_out}"

            # Extract glonass fields (field is named 'glonassData' in source JSON)
            glonass = route_list.get('glonassData', {})
            if not isinstance(glonass, dict):
                glonass = {}
                if self.log_warnings:
                    self.logger.warning(
                        f"Route list {pl_id}: 'glonassData' is not a dictionary"
                    )

            glonass_distance = glonass.get('distance')
            glonass_engine_time = glonass.get('engineTime')

            # Extract ts (transport) fields - filter by vehicle type
            ts_list = route_list.get('ts', [])
            if not isinstance(ts_list, list):
                ts_list = []
                if self.log_warnings:
                    self.logger.warning(
                        f"Route list {pl_id}: 'ts' is not an array"
                    )

            # Filter: only vehicles with "Самосвал" or "тягач" in ts_name_mo
            def is_target_vehicle(t: dict) -> bool:
                if not isinstance(t, dict):
                    return False
                name = str(t.get('nameMO', '')).lower()
                return 'тягач' in name 
#самосвал in name or
            filtered_ts = [t for t in ts_list if is_target_vehicle(t)]

            # If no target vehicles in this PL, skip entirely
            if not filtered_ts:
                return []

            ts_id_mo = ', '.join(str(t.get('idMO', '')) for t in filtered_ts if t.get('idMO')) or None
            ts_reg_number = ', '.join(str(t.get('regNumber', '')) for t in filtered_ts if t.get('regNumber')) or None
            ts_name_mo = ', '.join(str(t.get('nameMO', '')) for t in filtered_ts if t.get('nameMO')) or None

            # Get calcs array
            calcs = route_list.get('calcs', [])
            if not isinstance(calcs, list):
                if self.log_warnings:
                    self.logger.warning(
                        f"Route list {pl_id}: 'calcs' is not an array"
                    )
                calcs = []

            # If no calcs, return empty list (this PL contributes no rows)
            if len(calcs) == 0:
                if self.log_warnings:
                    self.logger.warning(
                        f"Route list {pl_id}: empty 'calcs' array"
                    )
                return []

            # Process each calc
            for calc_idx, calc in enumerate(calcs):
                if not isinstance(calc, dict):
                    if self.log_warnings:
                        self.logger.warning(
                            f"Route list {pl_id}, calc {calc_idx}: calc is not a dictionary"
                        )
                    continue

                # Extract calc fields
                calc_order_descr = calc.get('orderDescr')
                extracted_request_number = extract_request_number(calc_order_descr)
                calc_total_clock = calc.get('totalClock')
                calc_idle_clock = calc.get('idleClock')
                calc_object_expend = calc.get('objectExpend')

                # Route distance/time are nested inside calc.route object
                calc_route = calc.get('route', {})
                if not isinstance(calc_route, dict):
                    calc_route = {}
                calc_route_distance = calc_route.get('distance')
                calc_route_time = calc_route.get('time')

                # Create row combining PL fields and calc fields
                row = {
                    'pl_id': pl_id,
                    'pl_ts_number': pl_ts_number,
                    'pl_date_out': pl_date_out,
                    'pl_date_out_plan': pl_date_out_plan,
                    'pl_date_in_plan': pl_date_in_plan,
                    'pl_status': pl_status,
                    'pl_close_list': pl_close_list,
                    'ts_id_mo': ts_id_mo,
                    'ts_reg_number': ts_reg_number,
                    'ts_name_mo': ts_name_mo,
                    'calc_order_descr': calc_order_descr,
                    'extracted_request_number': extracted_request_number,
                    'calc_total_clock': calc_total_clock,
                    'calc_idle_clock': calc_idle_clock,
                    'calc_object_expend': calc_object_expend,
                    'calc_route_distance': calc_route_distance,
                    'calc_route_time': calc_route_time,
                    'glonass_distance': glonass_distance,
                    'glonass_engine_time': glonass_engine_time,
                }

                extracted_rows.append(row)

            return extracted_rows

        except Exception as e:
            # Fail-soft: catch any unexpected errors during extraction
            pl_id = None
            try:
                # Try to get pl_id for logging
                if isinstance(route_list, dict):
                    pl_ts_number = route_list.get('tsNumber')
                    pl_date_out = route_list.get('dateOut')
                    if pl_ts_number and pl_date_out:
                        pl_id = f"{pl_ts_number}_{pl_date_out}"
            except Exception:
                pass

            if self.log_warnings:
                self.logger.warning(
                    f"Route list {pl_id}: unexpected error during field extraction: {e}"
                )

            # Return empty list on error
            return []

    def parse(self) -> None:
        """
        Main parsing method: loads route lists, extracts fields, and writes CSV output.

        This method orchestrates the entire parsing process:
        1. Loads PL_raw.json
        2. Extracts fields from each route list (flattening calcs array)
        3. Writes results to pl_parsed.csv

        Raises:
            Exception: If any critical error occurs during parsing
        """
        self.logger.info("Starting PL parsing")

        try:
            # Load route lists from JSON
            data = self.load_route_lists()
            route_lists = data['list']

            # Extract fields from all route lists (flattening calcs)
            self.logger.info(f"Extracting fields from {len(route_lists)} route lists")
            extracted_records = []

            for idx, route_list in enumerate(route_lists):
                try:
                    # _extract_fields returns a list of rows (one per calc)
                    rows = self._extract_fields(route_list)
                    extracted_records.extend(rows)
                except Exception as e:
                    # Fail-soft: log error but continue processing
                    self.logger.error(f"Error extracting fields from route list at index {idx}: {e}")
                    # Continue without adding any rows for this route list

            self.logger.info(f"Successfully extracted {len(extracted_records)} records")

            # Ensure output directory exists
            self.output_path.parent.mkdir(parents=True, exist_ok=True)

            # Write to CSV
            self.logger.info(f"Writing output to {self.output_path}")

            # Define column order
            fieldnames = [
                'pl_id',
                'pl_ts_number',
                'pl_date_out',
                'pl_date_out_plan',
                'pl_date_in_plan',
                'pl_status',
                'pl_close_list',
                'ts_id_mo',
                'ts_reg_number',
                'ts_name_mo',
                'calc_order_descr',
                'extracted_request_number',
                'calc_total_clock',
                'calc_idle_clock',
                'calc_object_expend',
                'calc_route_distance',
                'calc_route_time',
                'glonass_distance',
                'glonass_engine_time',
            ]

            with open(self.output_path, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(extracted_records)

            self.logger.info(f"Successfully wrote {len(extracted_records)} records to {self.output_path}")
            self.logger.info("PL parsing completed successfully")

        except Exception as e:
            self.logger.error(f"Critical error during parsing: {e}")
            raise


if __name__ == "__main__":
    """
    Main execution block for running the parser as a standalone script.
    """
    try:
        parser = PLParser()
        parser.parse()
    except Exception as e:
        # Use basic logging if parser failed to initialize
        import sys
        logging.basicConfig(level=logging.ERROR)
        logging.error(f"Failed to run parser: {e}")
        sys.exit(1)
