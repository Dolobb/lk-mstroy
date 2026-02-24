"""
Shift management module for TransportAnalytics.

Handles:
- Splitting time periods into work shifts (morning/evening)
- Fetching monitoring data for individual shifts
- Caching shift data

Shift schedule:
- Morning shift: 07:30 - 19:30
- Evening shift: 19:30 - 07:30 (next day)
- Note: 00:00-07:30 belongs to the PREVIOUS day's evening shift
"""

from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger('web.shifts')


# Shift time boundaries
MORNING_START = (7, 30)   # 07:30
MORNING_END = (19, 30)    # 19:30
EVENING_START = (19, 30)  # 19:30
EVENING_END = (7, 30)     # 07:30 next day


def parse_datetime(dt_str: str) -> Optional[datetime]:
    """
    Parse datetime string in format DD.MM.YYYY HH:MM or DD.MM.YYYY.

    Args:
        dt_str: Date/time string

    Returns:
        datetime object or None if parsing fails
    """
    if not dt_str:
        return None

    # Try full datetime format first
    for fmt in ['%d.%m.%Y %H:%M:%S', '%d.%m.%Y %H:%M', '%d.%m.%Y']:
        try:
            return datetime.strptime(dt_str.strip(), fmt)
        except ValueError:
            continue

    logger.warning(f"Could not parse datetime: {dt_str}")
    return None


def format_datetime(dt: datetime) -> str:
    """Format datetime as DD.MM.YYYY HH:MM."""
    return dt.strftime('%d.%m.%Y %H:%M')


def format_date(dt: datetime) -> str:
    """Format datetime as DD.MM.YYYY."""
    return dt.strftime('%d.%m.%Y')


def get_shift_type(dt: datetime) -> str:
    """
    Determine shift type for a given datetime.

    Args:
        dt: datetime to check

    Returns:
        'morning' or 'evening'
    """
    hour, minute = dt.hour, dt.minute
    time_val = hour * 60 + minute

    morning_start_val = MORNING_START[0] * 60 + MORNING_START[1]  # 7:30 = 450
    morning_end_val = MORNING_END[0] * 60 + MORNING_END[1]        # 19:30 = 1170

    if morning_start_val <= time_val < morning_end_val:
        return 'morning'
    return 'evening'


def get_shift_key(dt: datetime, shift_type: str) -> str:
    """
    Generate unique shift key.

    For evening shift that spans midnight, use the date when the shift STARTED.

    Args:
        dt: datetime within the shift
        shift_type: 'morning' or 'evening'

    Returns:
        Key like "25.01.2026_morning" or "25.01.2026_evening"
    """
    if shift_type == 'evening':
        # If it's between 00:00 and 07:30, the shift started yesterday
        if dt.hour < 7 or (dt.hour == 7 and dt.minute < 30):
            shift_date = dt - timedelta(days=1)
        else:
            shift_date = dt
    else:
        shift_date = dt

    return f"{format_date(shift_date)}_{shift_type}"


def get_shift_label(shift_key: str) -> str:
    """
    Generate human-readable shift label.

    Args:
        shift_key: Key like "25.01.2026_morning"

    Returns:
        Label like "Утро 25.01" or "Вечер 25.01"
    """
    parts = shift_key.rsplit('_', 1)
    if len(parts) != 2:
        return shift_key

    date_str, shift_type = parts

    # Extract day.month from full date
    date_parts = date_str.split('.')
    if len(date_parts) >= 2:
        short_date = f"{date_parts[0]}.{date_parts[1]}"
    else:
        short_date = date_str

    if shift_type == 'morning':
        return f"Утро {short_date}"
    else:
        return f"Вечер {short_date}"


def get_shift_boundaries(shift_key: str) -> Tuple[datetime, datetime]:
    """
    Get start and end datetime for a shift.

    Args:
        shift_key: Key like "25.01.2026_morning"

    Returns:
        Tuple of (start_datetime, end_datetime)
    """
    parts = shift_key.rsplit('_', 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid shift key: {shift_key}")

    date_str, shift_type = parts
    date = datetime.strptime(date_str, '%d.%m.%Y')

    if shift_type == 'morning':
        start = date.replace(hour=MORNING_START[0], minute=MORNING_START[1])
        end = date.replace(hour=MORNING_END[0], minute=MORNING_END[1])
    else:
        # Evening shift starts at 19:30, ends at 07:30 next day
        start = date.replace(hour=EVENING_START[0], minute=EVENING_START[1])
        end = (date + timedelta(days=1)).replace(hour=EVENING_END[0], minute=EVENING_END[1])

    return start, end


def split_period_into_shifts(from_dt: datetime, to_dt: datetime) -> List[Dict[str, Any]]:
    """
    Split a time period into individual shifts.

    Args:
        from_dt: Period start datetime
        to_dt: Period end datetime

    Returns:
        List of shift dicts with keys:
        - key: unique shift key
        - label: human-readable label
        - from_dt: shift start (datetime)
        - to_dt: shift end (datetime)
        - actual_from: actual start within period (datetime)
        - actual_to: actual end within period (datetime)
    """
    shifts = []
    current = from_dt

    while current < to_dt:
        shift_type = get_shift_type(current)
        shift_key = get_shift_key(current, shift_type)

        # Get shift boundaries
        shift_start, shift_end = get_shift_boundaries(shift_key)

        # Clip to actual period
        actual_from = max(current, shift_start)
        actual_to = min(to_dt, shift_end)

        if actual_from < actual_to:
            shifts.append({
                'key': shift_key,
                'label': get_shift_label(shift_key),
                'from_dt': shift_start,
                'to_dt': shift_end,
                'actual_from': actual_from,
                'actual_to': actual_to
            })

        # Move to next shift
        current = shift_end

    return shifts


def split_period_into_shifts_str(from_date: str, to_date: str) -> List[Dict[str, Any]]:
    """
    Split a time period into individual shifts (string version).

    Args:
        from_date: Period start (DD.MM.YYYY HH:MM or DD.MM.YYYY)
        to_date: Period end (DD.MM.YYYY HH:MM or DD.MM.YYYY)

    Returns:
        List of shift dicts with string dates:
        - key: unique shift key
        - label: human-readable label
        - from: shift start (DD.MM.YYYY HH:MM)
        - to: shift end (DD.MM.YYYY HH:MM)
    """
    from_dt = parse_datetime(from_date)
    to_dt = parse_datetime(to_date)

    if not from_dt or not to_dt:
        logger.error(f"Cannot parse dates: {from_date} - {to_date}")
        return []

    # If only date given (no time), assume full day
    if from_dt.hour == 0 and from_dt.minute == 0:
        from_dt = from_dt.replace(hour=MORNING_START[0], minute=MORNING_START[1])
    if to_dt.hour == 0 and to_dt.minute == 0:
        to_dt = to_dt.replace(hour=MORNING_END[0], minute=MORNING_END[1])

    shifts = split_period_into_shifts(from_dt, to_dt)

    # Convert to string format
    result = []
    for s in shifts:
        result.append({
            'key': s['key'],
            'label': s['label'],
            'from': format_datetime(s['actual_from']),
            'to': format_datetime(s['actual_to'])
        })

    return result


class ShiftMonitoringFetcher:
    """
    Fetches monitoring data for specific shifts.
    Uses the existing API client infrastructure.
    """

    def __init__(self, config_path: str = "config.yaml"):
        """Initialize with config path."""
        self.config_path = config_path
        self._client = None
        self._fetcher = None

    @property
    def client(self):
        """Lazy-load API client."""
        if self._client is None:
            from src.api.client import APIClient
            self._client = APIClient(self.config_path)
        return self._client

    def fetch_shift_monitoring(
        self,
        ts_id_mo: int,
        shift_key: str,
        from_date: str = None,
        to_date: str = None
    ) -> Dict[str, Any]:
        """
        Fetch monitoring data for a specific shift.

        Args:
            ts_id_mo: Vehicle monitoring ID
            shift_key: Shift key like "25.01.2026_morning"
            from_date: Optional override for start date
            to_date: Optional override for end date

        Returns:
            Parsed monitoring data dict
        """
        from src.parsers.monitoring_parser import parse_monitoring
        from src.api.client import NotFoundError

        # Get dates from shift key if not provided
        if not from_date or not to_date:
            start, end = get_shift_boundaries(shift_key)
            from_date = format_datetime(start)
            to_date = format_datetime(end)

        try:
            raw_data = self.client.get_monitoring_stats(
                id_mo=ts_id_mo,
                from_date=from_date,
                to_date=to_date
            )
            return parse_monitoring(raw_data)
        except NotFoundError:
            logger.debug(f"No monitoring data for vehicle {ts_id_mo} in shift {shift_key}")
            return parse_monitoring({})
        except Exception as e:
            logger.error(f"Error fetching monitoring for {ts_id_mo}/{shift_key}: {e}")
            return parse_monitoring({})

    def fetch_all_shifts(
        self,
        ts_id_mo: int,
        from_date: str,
        to_date: str
    ) -> List[Dict[str, Any]]:
        """
        Fetch monitoring data for all shifts in a period.

        Args:
            ts_id_mo: Vehicle monitoring ID
            from_date: Period start (DD.MM.YYYY HH:MM)
            to_date: Period end (DD.MM.YYYY HH:MM)

        Returns:
            List of shift data dicts with 'key', 'label', 'from', 'to', 'data'
        """
        shifts = split_period_into_shifts_str(from_date, to_date)

        results = []
        for shift in shifts:
            data = self.fetch_shift_monitoring(
                ts_id_mo=ts_id_mo,
                shift_key=shift['key'],
                from_date=shift['from'],
                to_date=shift['to']
            )
            results.append({
                'key': shift['key'],
                'label': shift['label'],
                'from': shift['from'],
                'to': shift['to'],
                'data': data
            })

        return results
