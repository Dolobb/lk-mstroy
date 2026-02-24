"""
Monitoring Data Parser.

Parses monitoring API response, extracting key metrics.
Track array is simplified by time interval to reduce data size.
"""

from typing import Dict, Any, List
from datetime import datetime

# Default interval for track simplification (minutes)
TRACK_SIMPLIFY_INTERVAL_MIN = 20  # Снижено для лучшей детализации


def _parse_datetime(dt_str: str) -> datetime:
    """Parse datetime string from API."""
    if not dt_str:
        return None
    try:
        # Format: "DD.MM.YYYY HH:MM:SS"
        return datetime.strptime(dt_str, '%d.%m.%Y %H:%M:%S')
    except ValueError:
        try:
            return datetime.strptime(dt_str, '%d.%m.%Y %H:%M')
        except ValueError:
            return None


def _simplify_track(track: List[dict], interval_minutes: int = TRACK_SIMPLIFY_INTERVAL_MIN) -> List[dict]:
    """
    Simplify track by time interval.

    Keeps first point, last point, and points at least interval_minutes apart.

    Args:
        track: List of track points with 'time', 'lat', 'lon', 'speed' fields
        interval_minutes: Minimum interval between points in minutes

    Returns:
        Simplified list of track points
    """
    if not track or len(track) <= 2:
        return track

    result = [track[0]]  # Always keep first point
    last_time = _parse_datetime(track[0].get('time', ''))

    for point in track[1:-1]:
        point_time = _parse_datetime(point.get('time', ''))
        if point_time and last_time:
            delta_minutes = (point_time - last_time).total_seconds() / 60
            if delta_minutes >= interval_minutes:
                result.append(point)
                last_time = point_time
        elif not last_time and point_time:
            # If we couldn't parse last_time but have this one, add it
            result.append(point)
            last_time = point_time

    result.append(track[-1])  # Always keep last point
    return result


def parse_monitoring(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse monitoring response into dictionary with nested structures.

    Extracts key metrics, ignores track array (too large).

    Args:
        data: Raw API response from getMonitoringStats

    Returns:
        Dictionary with monitoring fields including parkings and fuels arrays
    """
    if not data or not isinstance(data, dict):
        return _empty_monitoring()

    # Basic fields
    result = {
        'mon_mo_uid': data.get('moUid'),
        'mon_name_mo': data.get('nameMO'),
        'mon_distance': data.get('distance'),
        'mon_moving_time': data.get('movingTime'),
        'mon_engine_time': data.get('engineTime'),
        'mon_engine_idling_time': data.get('engineIdlingTime'),
        'mon_last_activity': data.get('lastActivityTime'),
    }

    # Convert times from seconds to hours for readability
    if result['mon_moving_time']:
        result['mon_moving_time_hours'] = round(result['mon_moving_time'] / 3600, 2)
    else:
        result['mon_moving_time_hours'] = None

    if result['mon_engine_time']:
        result['mon_engine_time_hours'] = round(result['mon_engine_time'] / 3600, 2)
    else:
        result['mon_engine_time_hours'] = None

    if result['mon_engine_idling_time']:
        result['mon_idling_time_hours'] = round(result['mon_engine_idling_time'] / 3600, 2)
    else:
        result['mon_idling_time_hours'] = None

    # Fuel data - all records as array
    fuels = data.get('fuels', [])
    result['mon_fuels'] = []
    if fuels and isinstance(fuels, list):
        for fuel in fuels:
            if isinstance(fuel, dict):
                result['mon_fuels'].append({
                    'name': fuel.get('fuelName'),
                    'charges': fuel.get('charges'),
                    'discharges': fuel.get('discharges'),
                    'rate': fuel.get('rate'),
                    'value_begin': fuel.get('valueBegin'),
                    'value_end': fuel.get('valueEnd'),
                })

    # First fuel for CSV compatibility
    if result['mon_fuels']:
        f = result['mon_fuels'][0]
        result['mon_fuel_name'] = f['name']
        result['mon_fuel_charges'] = f['charges']
        result['mon_fuel_discharges'] = f['discharges']
        result['mon_fuel_rate'] = f['rate']
        result['mon_fuel_begin'] = f['value_begin']
        result['mon_fuel_end'] = f['value_end']
    else:
        result['mon_fuel_name'] = None
        result['mon_fuel_charges'] = None
        result['mon_fuel_discharges'] = None
        result['mon_fuel_rate'] = None
        result['mon_fuel_begin'] = None
        result['mon_fuel_end'] = None

    # Parkings - full data with calculated time and coordinates
    parkings = data.get('parkings', [])
    result['mon_parkings'] = []
    total_parking_minutes = 0

    if parkings and isinstance(parkings, list):
        for p in parkings:
            if isinstance(p, dict):
                begin = p.get('begin')
                end = p.get('end')
                address = p.get('address', '')
                lon = p.get('lon')
                lat = p.get('lat')

                # Calculate parking duration
                parking_minutes = None
                begin_dt = _parse_datetime(begin)
                end_dt = _parse_datetime(end)
                if begin_dt and end_dt:
                    parking_minutes = round((end_dt - begin_dt).total_seconds() / 60, 1)
                    total_parking_minutes += parking_minutes

                result['mon_parkings'].append({
                    'begin': begin,
                    'end': end,
                    'address': address,
                    'duration_min': parking_minutes,
                    'lat': lat,
                    'lon': lon,
                })

    result['mon_parkings_count'] = len(result['mon_parkings'])
    result['mon_parkings_total_hours'] = round(total_parking_minutes / 60, 2) if total_parking_minutes else 0

    # Track - simplified by time interval
    track = data.get('track', [])
    result['mon_track'] = []

    if track and isinstance(track, list):
        # Extract relevant fields from track points
        track_points = []
        for t in track:
            if isinstance(t, dict):
                lat = t.get('lat')
                lon = t.get('lon')
                if lat is not None and lon is not None:
                    track_points.append({
                        'lat': lat,
                        'lon': lon,
                        'time': t.get('time', ''),
                        'speed': t.get('speed'),
                    })

        # Simplify track
        result['mon_track'] = _simplify_track(track_points)

    return result


def _empty_monitoring() -> Dict[str, Any]:
    """Return empty monitoring record."""
    return {
        'mon_mo_uid': None,
        'mon_name_mo': None,
        'mon_distance': None,
        'mon_moving_time': None,
        'mon_engine_time': None,
        'mon_engine_idling_time': None,
        'mon_last_activity': None,
        'mon_moving_time_hours': None,
        'mon_engine_time_hours': None,
        'mon_idling_time_hours': None,
        'mon_fuel_name': None,
        'mon_fuel_charges': None,
        'mon_fuel_discharges': None,
        'mon_fuel_rate': None,
        'mon_fuel_begin': None,
        'mon_fuel_end': None,
        'mon_fuels': [],
        'mon_parkings': [],
        'mon_parkings_count': 0,
        'mon_parkings_total_hours': 0,
        'mon_track': [],
    }


# Field names for CSV header (flat fields only)
MONITORING_FIELDS = [
    'mon_mo_uid',
    'mon_name_mo',
    'mon_distance',
    'mon_moving_time_hours',
    'mon_engine_time_hours',
    'mon_idling_time_hours',
    'mon_fuel_name',
    'mon_fuel_charges',
    'mon_fuel_discharges',
    'mon_fuel_rate',
    'mon_parkings_count',
    'mon_parkings_total_hours',
]
