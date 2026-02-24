"""
HTML Report Generator.

Generates hierarchical HTML report:
Request → Route Lists → Vehicles + Monitoring
With search, sorting, and Plan/Fact comparison.
"""

from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime
import json


def generate_html_report(
    hierarchy: Dict[str, Any],
    output_path: str,
    title: str = "Отчёт по заявкам и путевым листам",
    web_mode: bool = False,
    report_id: int = None
) -> str:
    """
    Generate HTML report from hierarchical data.

    Args:
        hierarchy: Nested structure {request_number: {request_data, pl_list: [{pl_data, vehicles: [...]}]}}
        output_path: Path to save HTML file
        title: Report title
        web_mode: If True, add archive buttons and web features
        report_id: Optional report ID for shift loading

    Returns:
        Path to generated file
    """
    html = _build_html(hierarchy, title, web_mode=web_mode, report_id=report_id)

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)

    return str(path)


def _format_pl_number(pl_id: str) -> str:
    """Format PL number: remove date part after underscore."""
    if not pl_id:
        return '—'
    if '_' in str(pl_id):
        return str(pl_id).split('_')[0]
    return str(pl_id)


def _build_html(hierarchy: Dict[str, Any], title: str, web_mode: bool = False, report_id: int = None) -> str:
    """Build HTML string from hierarchy."""

    # Statistics
    total_requests = len(hierarchy)
    total_pl = sum(len(req.get('pl_list', [])) for req in hierarchy.values())
    total_vehicles = sum(
        len(pl.get('vehicles', []))
        for req in hierarchy.values()
        for pl in req.get('pl_list', [])
    )

    # Collect unique values for filters
    import math
    start_addresses = set()
    end_addresses = set()
    cost_objects = set()

    def is_valid_value(val):
        if val is None or val == '' or val == '—':
            return False
        if isinstance(val, float) and math.isnan(val):
            return False
        return True

    for req in hierarchy.values():
        start_addr = req.get('route_start_address')
        end_addr = req.get('route_end_address')
        cost_obj = req.get('object_expend_name')
        if is_valid_value(start_addr):
            start_addresses.add(str(start_addr))
        if is_valid_value(end_addr):
            end_addresses.add(str(end_addr))
        if is_valid_value(cost_obj):
            cost_objects.add(str(cost_obj))

    # Sort filter values
    start_addresses = sorted(start_addresses)
    end_addresses = sorted(end_addresses)
    cost_objects = sorted(cost_objects)

    # Sort by route_start_date
    sorted_items = sorted(
        hierarchy.items(),
        key=lambda x: x[1].get('route_start_date', '') or '',
        reverse=True
    )

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            background: #f0f2f5;
            color: #1a1a1a;
        }}

        /* Fixed Header */
        .header {{
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #1a365d;
            color: white;
            padding: 12px 20px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }}

        .header-content {{
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 30px;
            flex-wrap: wrap;
        }}

        .header h1 {{
            font-size: 18px;
            font-weight: 600;
            white-space: nowrap;
        }}

        .search-box {{
            flex: 1;
            min-width: 250px;
            max-width: 400px;
        }}

        .search-box input {{
            width: 100%;
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            background: rgba(255,255,255,0.15);
            color: white;
        }}

        .search-box input::placeholder {{
            color: rgba(255,255,255,0.6);
        }}

        .search-box input:focus {{
            outline: none;
            background: rgba(255,255,255,0.25);
        }}

        .header-stats {{
            display: flex;
            gap: 20px;
            font-size: 13px;
        }}

        .header-stats span {{
            opacity: 0.8;
        }}

        .header-stats strong {{
            color: #63b3ed;
        }}

        /* Filter Panel */
        .filter-panel {{
            background: #1e4a7a;
            padding: 12px 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }}

        .filter-panel-content {{
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            gap: 15px;
            flex-wrap: wrap;
        }}

        .filter-group {{
            position: relative;
        }}

        .filter-label {{
            font-size: 11px;
            color: rgba(255,255,255,0.7);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        .filter-dropdown {{
            position: relative;
        }}

        .filter-btn {{
            background: rgba(255,255,255,0.15);
            border: none;
            border-radius: 6px;
            padding: 8px 12px;
            color: white;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 180px;
            justify-content: space-between;
        }}

        .filter-btn:hover {{
            background: rgba(255,255,255,0.25);
        }}

        .filter-btn .count {{
            background: #4299e1;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 11px;
        }}

        .filter-popup {{
            position: absolute;
            top: 100%;
            left: 0;
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            min-width: 280px;
            max-height: 350px;
            z-index: 2000;
            display: none;
            overflow: hidden;
        }}

        .filter-popup.active {{
            display: block;
        }}

        .filter-search {{
            padding: 10px;
            border-bottom: 1px solid #e2e8f0;
        }}

        .filter-search input {{
            width: 100%;
            padding: 8px 10px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            font-size: 13px;
        }}

        .filter-options {{
            max-height: 250px;
            overflow-y: auto;
        }}

        .filter-option {{
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
            color: #2d3748;
        }}

        .filter-option:hover {{
            background: #f7fafc;
        }}

        .filter-option input {{
            margin-right: 10px;
        }}

        .filter-option.hidden {{
            display: none;
        }}

        .filter-actions {{
            padding: 10px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }}

        .filter-actions button {{
            flex: 1;
            padding: 6px 10px;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            min-width: 70px;
        }}

        .filter-actions .apply-btn {{
            background: #4299e1;
            color: white;
        }}

        .filter-actions .clear-btn {{
            background: #e2e8f0;
            color: #4a5568;
        }}

        .filter-actions .select-all-btn {{
            background: #48bb78;
            color: white;
        }}

        .parking-time-filter {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .parking-time-filter input {{
            width: 70px;
            padding: 8px 10px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            background: rgba(255,255,255,0.15);
            color: white;
            text-align: center;
        }}

        .parking-time-filter input::placeholder {{
            color: rgba(255,255,255,0.5);
        }}

        .parking-time-filter span {{
            font-size: 13px;
            color: rgba(255,255,255,0.8);
        }}

        /* Parking groups by day */
        .parking-day-group {{
            margin-bottom: 12px;
        }}

        .parking-day-header {{
            font-size: 12px;
            font-weight: 600;
            color: #975a16;
            background: #fef5e7;
            padding: 6px 12px;
            border-radius: 4px 4px 0 0;
            border: 1px solid #fbd38d;
            border-bottom: none;
        }}

        .parking-day-items {{
            border: 1px solid #fbd38d;
            border-radius: 0 0 4px 4px;
        }}

        .parking-item {{
            background: #fffaf0;
            border-bottom: 1px solid #fbd38d;
            padding: 8px 12px;
            font-size: 13px;
        }}

        .parking-item:last-child {{
            border-bottom: none;
            border-radius: 0 0 4px 4px;
        }}

        /* Main Content */
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 140px 20px 40px;
        }}

        .sort-bar {{
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            align-items: center;
        }}

        .sort-bar label {{
            font-size: 13px;
            color: #666;
        }}

        .sort-bar select {{
            padding: 6px 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 13px;
            background: white;
        }}

        .results-info {{
            font-size: 13px;
            color: #666;
            margin-bottom: 15px;
        }}

        /* Request Card */
        .request {{
            background: white;
            border-radius: 12px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            overflow: hidden;
        }}

        .request.hidden {{
            display: none;
        }}

        .request-header {{
            background: linear-gradient(135deg, #2c5282 0%, #1a365d 100%);
            color: white;
            padding: 16px 20px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 15px;
        }}

        .request-header:hover {{
            background: linear-gradient(135deg, #2b4c7e 0%, #1a365d 100%);
        }}

        .request-title {{
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
        }}

        .request-route {{
            font-size: 13px;
            opacity: 0.9;
        }}

        .request-badges {{
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }}

        .badge {{
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }}

        .badge-success {{ background: #48bb78; }}
        .badge-info {{ background: #4299e1; }}
        .badge-warning {{ background: #ed8936; }}

        .request-body {{
            padding: 20px;
        }}

        /* Plan Container */
        .plan-section {{
            background: #f7fafc;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }}

        .section-title {{
            font-size: 14px;
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .section-title::before {{
            content: '';
            width: 4px;
            height: 16px;
            background: #4299e1;
            border-radius: 2px;
        }}

        .plan-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
        }}

        .plan-item {{
            background: white;
            padding: 10px 12px;
            border-radius: 6px;
            border-left: 3px solid #4299e1;
        }}

        .plan-item .label {{
            font-size: 11px;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        .plan-item .value {{
            font-size: 14px;
            color: #1a202c;
            font-weight: 500;
            margin-top: 2px;
        }}

        /* Calculated Plan */
        .calc-plan-section {{
            background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);
            border: 1px solid #d6bcfa;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }}

        .calc-plan-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            cursor: pointer;
        }}

        .calc-plan-title {{
            font-size: 14px;
            font-weight: 600;
            color: #553c9a;
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .calc-plan-title::before {{
            content: '';
            width: 4px;
            height: 16px;
            background: #805ad5;
            border-radius: 2px;
        }}

        .calc-plan-toggle {{
            font-size: 12px;
            color: #805ad5;
        }}

        .calc-plan-body {{
            display: none;
        }}

        .calc-plan-body.active {{
            display: block;
        }}

        .calc-plan-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 10px;
            margin-bottom: 12px;
        }}

        .calc-input-group {{
            background: white;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1px solid #e9d8fd;
        }}

        .calc-input-group label {{
            font-size: 11px;
            color: #805ad5;
            display: block;
            margin-bottom: 4px;
        }}

        .calc-input-group input {{
            width: 100%;
            padding: 4px 6px;
            border: 1px solid #d6bcfa;
            border-radius: 4px;
            font-size: 13px;
            color: #553c9a;
        }}

        .calc-input-group input:focus {{
            outline: none;
            border-color: #805ad5;
        }}

        .calc-input-row {{
            display: flex;
            gap: 8px;
            align-items: center;
        }}

        .calc-input-row input {{
            width: 80px;
        }}

        .calc-results {{
            background: white;
            border-radius: 6px;
            padding: 12px;
            border: 1px solid #d6bcfa;
        }}

        .calc-results-title {{
            font-size: 12px;
            font-weight: 600;
            color: #553c9a;
            margin-bottom: 8px;
        }}

        .calc-result-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 8px;
        }}

        .calc-result-item {{
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            padding: 4px 0;
            border-bottom: 1px dashed #e9d8fd;
        }}

        .calc-result-item:last-child {{
            border-bottom: none;
        }}

        .calc-result-item .label {{
            color: #718096;
        }}

        .calc-result-item .value {{
            font-weight: 600;
            color: #553c9a;
        }}

        .calc-result-item.highlight {{
            background: #faf5ff;
            padding: 6px 8px;
            border-radius: 4px;
            border: none;
            margin-top: 4px;
        }}

        .calc-result-item.highlight .value {{
            color: #38a169;
            font-size: 14px;
        }}

        /* PL Card */
        .pl-card {{
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
        }}

        .pl-header {{
            background: #edf2f7;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }}

        .pl-header:hover {{
            background: #e2e8f0;
        }}

        .pl-number {{
            font-weight: 600;
            color: #2d3748;
        }}

        .pl-meta {{
            font-size: 13px;
            color: #718096;
        }}

        .pl-body {{
            padding: 16px;
        }}

        /* Vehicle/Fact Section */
        .vehicle-card {{
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
        }}

        .vehicle-header {{
            background: #f7fafc;
            padding: 12px 16px;
            border-bottom: 1px solid #e2e8f0;
        }}

        .vehicle-name {{
            font-weight: 600;
            color: #2d3748;
        }}

        .vehicle-reg {{
            font-size: 13px;
            color: #4a5568;
            font-family: monospace;
        }}

        .fact-section {{
            padding: 16px;
        }}

        .fact-title {{
            font-size: 13px;
            font-weight: 600;
            color: #38a169;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
        }}

        .fact-title::before {{
            content: '';
            width: 4px;
            height: 14px;
            background: #38a169;
            border-radius: 2px;
        }}

        .fact-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 10px;
            margin-bottom: 16px;
        }}

        .fact-item {{
            background: #f0fff4;
            padding: 8px 12px;
            border-radius: 6px;
            border-left: 3px solid #48bb78;
        }}

        .fact-item .label {{
            font-size: 11px;
            color: #276749;
        }}

        .fact-item .value {{
            font-size: 14px;
            font-weight: 600;
            color: #22543d;
        }}

        /* Parkings */
        .parkings-section {{
            margin-top: 12px;
        }}

        .parkings-title {{
            font-size: 12px;
            font-weight: 600;
            color: #744210;
            margin-bottom: 8px;
        }}

        .parking-time {{
            font-weight: 500;
            color: #744210;
        }}

        .parking-address {{
            color: #975a16;
            font-size: 12px;
            margin-top: 2px;
        }}

        /* Fuels */
        .fuels-section {{
            margin-top: 12px;
        }}

        .fuels-title {{
            font-size: 12px;
            font-weight: 600;
            color: #553c9a;
            margin-bottom: 8px;
        }}

        .fuel-item {{
            background: #faf5ff;
            border: 1px solid #d6bcfa;
            border-radius: 4px;
            padding: 8px 12px;
            margin-bottom: 6px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 8px;
            font-size: 13px;
        }}

        .fuel-stat {{
            text-align: center;
        }}

        .fuel-stat .label {{
            font-size: 10px;
            color: #805ad5;
        }}

        .fuel-stat .value {{
            font-weight: 600;
            color: #553c9a;
        }}

        /* No data */
        .no-data {{
            color: #a0aec0;
            font-size: 13px;
            font-style: italic;
            padding: 10px;
        }}

        /* Copy button styles */
        .copyable {{
            cursor: pointer;
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }}

        .copyable:hover {{
            opacity: 0.85;
        }}

        .copy-btn {{
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border: none;
            background: rgba(255,255,255,0.2);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.7;
            transition: opacity 0.2s, background 0.2s;
        }}

        .copy-btn:hover {{
            opacity: 1;
            background: rgba(255,255,255,0.35);
        }}

        .copy-btn.copied {{
            background: #48bb78;
            opacity: 1;
        }}

        .pl-header .copy-btn, .vehicle-header .copy-btn {{
            background: rgba(0,0,0,0.08);
        }}

        .pl-header .copy-btn:hover, .vehicle-header .copy-btn:hover {{
            background: rgba(0,0,0,0.15);
        }}

        /* Expand/collapse arrow indicators */
        .expand-arrow {{
            display: inline-block;
            width: 16px;
            height: 16px;
            text-align: center;
            font-size: 10px;
            transition: transform 0.2s;
            color: rgba(255,255,255,0.7);
        }}

        .expand-arrow.down {{
            transform: rotate(0deg);
        }}

        .expand-arrow.up {{
            transform: rotate(180deg);
        }}

        .pl-header .expand-arrow, .vehicle-header .expand-arrow {{
            color: #718096;
        }}

        /* Timezone tag style */
        .timezone-tag {{
            font-size: 11px;
            background: rgba(255,255,255,0.2);
            padding: 2px 8px;
            border-radius: 10px;
            margin-left: 10px;
            font-weight: normal;
        }}

        /* Footer */
        .footer {{
            text-align: center;
            padding: 30px;
            color: #a0aec0;
            font-size: 12px;
        }}

        /* Responsive */
        @media (max-width: 768px) {{
            .header-content {{
                flex-direction: column;
                gap: 10px;
            }}
            .search-box {{
                max-width: 100%;
            }}
            .header-stats {{
                flex-wrap: wrap;
                gap: 10px;
            }}
        }}

        /* Map styles */
        .map-container {{
            display: none;
            height: 450px;
            margin: 12px 0;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid #e2e8f0;
        }}

        .map-container.active {{
            display: block;
        }}

        .leaflet-map {{
            height: 100%;
            width: 100%;
            border-radius: 8px;
        }}

        .map-toggle-btn {{
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 12px;
            transition: transform 0.1s, box-shadow 0.1s;
        }}

        .map-toggle-btn:hover {{
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(56, 161, 105, 0.3);
        }}

        .map-toggle-btn.active {{
            background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
        }}

        .map-legend {{
            background: white;
            padding: 8px 12px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            font-size: 12px;
            line-height: 1.6;
        }}

        .map-legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}

        .map-legend-line {{
            width: 20px;
            height: 3px;
            border-radius: 2px;
        }}

        .map-legend-marker {{
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }}

        /* Map display params panel */
        .map-display-params {{
            display: none;
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            margin: 10px 0;
        }}

        .map-display-params.active {{
            display: block;
        }}

        .params-title {{
            font-weight: 600;
            font-size: 13px;
            color: #2d3748;
            margin-bottom: 10px;
        }}

        .filter-group {{
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }}

        .filter-label {{
            font-size: 12px;
            color: #4a5568;
            min-width: 140px;
        }}

        .filter-checkbox {{
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
        }}

        .filter-checkbox:hover {{
            border-color: #cbd5e0;
            background: #edf2f7;
        }}

        .filter-checkbox input {{
            margin: 0;
        }}

        .filter-checkbox .color-dot {{
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }}

        .map-display-params input[type="number"] {{
            width: 70px;
            padding: 4px 8px;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            font-size: 12px;
        }}

        /* Map layout with timeline */
        .map-layout {{
            display: flex;
            height: 100%;
        }}

        .map-area {{
            flex: 1;
            min-width: 0;
            height: 100%;
        }}

        .map-area .leaflet-map {{
            height: 100%;
            width: 100%;
            border-radius: 8px 0 0 8px;
        }}

        .timeline-area {{
            width: 280px;
            height: 100%;
            border-left: 1px solid #e2e8f0;
            overflow-y: auto;
            background: #fafafa;
            flex-shrink: 0;
        }}

        .timeline-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #edf2f7;
            border-bottom: 1px solid #e2e8f0;
            position: sticky;
            top: 0;
            z-index: 1;
        }}

        .timeline-title {{
            font-weight: 600;
            font-size: 12px;
            margin: 0;
        }}

        .timeline-expand-btn {{
            background: none;
            border: 1px solid #cbd5e0;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 10px;
            cursor: pointer;
            color: #4a5568;
        }}

        .timeline-expand-btn:hover {{
            background: #e2e8f0;
        }}

        .timeline-items {{
            padding: 0;
        }}

        .timeline-vehicle-group {{
            border-bottom: 1px solid #e2e8f0;
        }}

        .timeline-vehicle-header {{
            font-weight: 600;
            font-size: 11px;
            padding: 8px 12px;
            background: #edf2f7;
            border-left: 4px solid #48bb78;
            color: #2d3748;
        }}

        .timeline-item {{
            padding: 6px 12px;
            border-bottom: 1px solid #f0f0f0;
            cursor: pointer;
            font-size: 11px;
            transition: background 0.15s;
        }}

        .timeline-item:hover {{
            background: #edf2f7;
        }}

        .timeline-item.parking {{
            background: #fffaf0;
            border-left: 3px solid #ed8936;
        }}

        .timeline-item.point {{
            border-left: 3px solid #48bb78;
        }}

        .timeline-item .time {{
            font-weight: 600;
            color: #2d3748;
        }}

        .timeline-item .info {{
            color: #718096;
            font-size: 10px;
            margin-top: 2px;
        }}

        .timeline-item .info.address {{
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 180px;
        }}

        /* Collapsed timeline - hide addresses */
        .timeline-area.collapsed .timeline-item .info.address {{
            display: none;
        }}

        /* Archive button styles */
        .archive-btn {{
            background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
            margin-left: 8px;
        }}

        .archive-btn:hover {{
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(237, 137, 54, 0.3);
        }}

        .archive-btn.archived {{
            background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
        }}

        .archive-btn.archived:hover {{
            box-shadow: 0 2px 8px rgba(72, 187, 120, 0.3);
        }}

        .request.is-archived {{
            opacity: 0.6;
        }}

        .request.is-archived .request-header {{
            background: linear-gradient(135deg, #718096 0%, #4a5568 100%);
        }}

        /* Hide archived filter */
        .hide-archived-toggle {{
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: rgba(255,255,255,0.8);
        }}

        .hide-archived-toggle input {{
            width: 16px;
            height: 16px;
            cursor: pointer;
        }}

        /* Day navigation tabs */
        .day-nav {{
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            flex-wrap: wrap;
            background: #f7fafc;
            padding: 8px;
            border-radius: 8px;
        }}

        .day-nav-btn {{
            padding: 6px 12px;
            border: 1px solid #e2e8f0;
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #4a5568;
            transition: all 0.2s;
        }}

        .day-nav-btn:hover {{
            background: #edf2f7;
            border-color: #cbd5e0;
        }}

        .day-nav-btn.active {{
            background: #4299e1;
            color: white;
            border-color: #4299e1;
        }}

        .day-nav-btn .day-stats {{
            font-size: 10px;
            opacity: 0.8;
            margin-left: 4px;
        }}

        .day-content {{
            display: none;
        }}

        .day-content.active {{
            display: block;
        }}

        /* Day summary card */
        .day-summary {{
            background: linear-gradient(135deg, #ebf8ff 0%, #e6fffa 100%);
            border: 1px solid #81e6d9;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 12px;
        }}

        .day-summary-title {{
            font-size: 13px;
            font-weight: 600;
            color: #234e52;
            margin-bottom: 8px;
        }}

        .day-summary-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 12px;
        }}

        .day-summary-item {{
            text-align: center;
        }}

        .day-summary-item .label {{
            font-size: 10px;
            color: #285e61;
            text-transform: uppercase;
        }}

        .day-summary-item .value {{
            font-size: 14px;
            font-weight: 600;
            color: #234e52;
        }}

        /* Shift loading styles */
        .shift-load-btn {{
            background: linear-gradient(135deg, #805ad5 0%, #6b46c1 100%);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 12px;
            transition: transform 0.1s, box-shadow 0.1s;
        }}

        .shift-load-btn:hover {{
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(128, 90, 213, 0.3);
        }}

        .shift-load-btn:disabled {{
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }}

        .shift-container {{
            display: none;
            margin-top: 16px;
            background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);
            border: 1px solid #d6bcfa;
            border-radius: 8px;
            padding: 16px;
        }}

        .shift-tabs {{
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }}

        .shift-tab {{
            padding: 8px 16px;
            background: white;
            border: 1px solid #d6bcfa;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            color: #553c9a;
            transition: all 0.2s;
        }}

        .shift-tab:hover {{
            background: #e9d8fd;
        }}

        .shift-tab.active {{
            background: #805ad5;
            color: white;
            border-color: #805ad5;
        }}

        .shift-content {{
            display: none;
        }}

        .shift-content.active {{
            display: block;
        }}

        .shift-period {{
            font-size: 12px;
            color: #805ad5;
            margin-bottom: 12px;
            font-weight: 500;
        }}

        .shift-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 10px;
        }}

        .shift-item {{
            background: white;
            padding: 10px 12px;
            border-radius: 6px;
            border-left: 3px solid #805ad5;
        }}

        .shift-item .label {{
            font-size: 11px;
            color: #805ad5;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}

        .shift-item .value {{
            font-size: 14px;
            font-weight: 600;
            color: #553c9a;
            margin-top: 2px;
        }}

        .cache-note {{
            font-size: 11px;
            color: #805ad5;
            margin-bottom: 8px;
            font-style: italic;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>📊 {title}</h1>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Поиск по номеру заявки, ПЛ или машины..." onkeyup="filterRequests()">
            </div>
            <div class="header-stats">
                <span>Заявок: <strong>{total_requests}</strong></span>
                <span>ПЛ: <strong>{total_pl}</strong></span>
                <span>ТС: <strong>{total_vehicles}</strong></span>
            </div>
        </div>
        <div class="filter-panel">
            <div class="filter-panel-content">
                <div class="filter-group">
                    <div class="filter-label">Начало маршрута</div>
                    <div class="filter-dropdown">
                        <button class="filter-btn" onclick="toggleFilter('startAddr')">
                            <span>Все</span>
                            <span class="count" id="startAddrCount">0</span>
                        </button>
                        <div class="filter-popup" id="startAddrPopup">
                            <div class="filter-search">
                                <input type="text" placeholder="Поиск..." oninput="searchFilterOptions('startAddr', this.value)">
                            </div>
                            <div class="filter-options" id="startAddrOptions"></div>
                            <div class="filter-actions">
                                <button class="select-all-btn" onclick="selectAllFilter('startAddr')">Все</button>
                                <button class="clear-btn" onclick="clearFilter('startAddr')">Сбросить</button>
                                <button class="apply-btn" onclick="applyFilters()">Применить</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="filter-group">
                    <div class="filter-label">Конец маршрута</div>
                    <div class="filter-dropdown">
                        <button class="filter-btn" onclick="toggleFilter('endAddr')">
                            <span>Все</span>
                            <span class="count" id="endAddrCount">0</span>
                        </button>
                        <div class="filter-popup" id="endAddrPopup">
                            <div class="filter-search">
                                <input type="text" placeholder="Поиск..." oninput="searchFilterOptions('endAddr', this.value)">
                            </div>
                            <div class="filter-options" id="endAddrOptions"></div>
                            <div class="filter-actions">
                                <button class="select-all-btn" onclick="selectAllFilter('endAddr')">Все</button>
                                <button class="clear-btn" onclick="clearFilter('endAddr')">Сбросить</button>
                                <button class="apply-btn" onclick="applyFilters()">Применить</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="filter-group">
                    <div class="filter-label">Объект затрат</div>
                    <div class="filter-dropdown">
                        <button class="filter-btn" onclick="toggleFilter('costObj')">
                            <span>Все</span>
                            <span class="count" id="costObjCount">0</span>
                        </button>
                        <div class="filter-popup" id="costObjPopup">
                            <div class="filter-search">
                                <input type="text" placeholder="Поиск..." oninput="searchFilterOptions('costObj', this.value)">
                            </div>
                            <div class="filter-options" id="costObjOptions"></div>
                            <div class="filter-actions">
                                <button class="select-all-btn" onclick="selectAllFilter('costObj')">Все</button>
                                <button class="clear-btn" onclick="clearFilter('costObj')">Сбросить</button>
                                <button class="apply-btn" onclick="applyFilters()">Применить</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="filter-group">
                    <div class="filter-label">Мин. время стоянки</div>
                    <div class="parking-time-filter">
                        <input type="number" id="minParkingTime" value="60" min="0" onchange="updateParkingDisplay()">
                        <span>мин</span>
                    </div>
                </div>
                <div class="filter-group">
                    <div class="filter-label">Архив</div>
                    <label class="hide-archived-toggle">
                        <input type="checkbox" id="hideArchived" onchange="filterRequests()">
                        <span>Скрыть просмотренные</span>
                    </label>
                </div>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="sort-bar">
            <label>Сортировка:</label>
            <select id="sortSelect" onchange="sortRequests()">
                <option value="date-desc">По дате (новые первые)</option>
                <option value="date-asc">По дате (старые первые)</option>
                <option value="number-asc">По номеру заявки</option>
            </select>
        </div>

        <div class="results-info" id="resultsInfo">
            Показано заявок: {total_requests}
        </div>

        <div id="requestsContainer">
"""

    # Requests
    for req_num, req_data in sorted_items:
        html += _build_request_html(req_num, req_data)

    html += """        </div>
    </div>

    <div class="footer">
        Сгенерировано: """ + datetime.now().strftime('%d.%m.%Y %H:%M') + """
    </div>

    <script>
        // Report ID for shift loading API
        const REPORT_ID = """ + (str(report_id) if report_id else "null") + """;

        // Filter data
        const filterData = {
            startAddr: """ + json.dumps(start_addresses, ensure_ascii=False) + """,
            endAddr: """ + json.dumps(end_addresses, ensure_ascii=False) + """,
            costObj: """ + json.dumps(cost_objects, ensure_ascii=False) + """
        };

        // Selected filter values
        const selectedFilters = {
            startAddr: new Set(),
            endAddr: new Set(),
            costObj: new Set()
        };

        // Initialize filters
        document.addEventListener('DOMContentLoaded', function() {
            initFilterOptions('startAddr', filterData.startAddr);
            initFilterOptions('endAddr', filterData.endAddr);
            initFilterOptions('costObj', filterData.costObj);
            updateParkingDisplay();
        });

        function initFilterOptions(filterId, options) {
            const container = document.getElementById(filterId + 'Options');
            container.innerHTML = '';
            options.forEach((opt, idx) => {
                const div = document.createElement('div');
                div.className = 'filter-option';
                div.setAttribute('data-value', opt);
                div.innerHTML = '<input type="checkbox" id="' + filterId + '_' + idx + '"> <label for="' + filterId + '_' + idx + '">' + opt + '</label>';
                div.onclick = function(e) {
                    if (e.target.tagName !== 'INPUT') {
                        const cb = div.querySelector('input');
                        cb.checked = !cb.checked;
                    }
                };
                container.appendChild(div);
            });
        }

        function toggleFilter(filterId) {
            const popup = document.getElementById(filterId + 'Popup');
            const isActive = popup.classList.contains('active');

            // Close all popups
            document.querySelectorAll('.filter-popup').forEach(p => p.classList.remove('active'));

            if (!isActive) {
                popup.classList.add('active');
            }
        }

        // Close popups on outside click
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.filter-dropdown')) {
                document.querySelectorAll('.filter-popup').forEach(p => p.classList.remove('active'));
            }
        });

        function searchFilterOptions(filterId, query) {
            const container = document.getElementById(filterId + 'Options');
            const options = container.querySelectorAll('.filter-option');
            const q = query.toLowerCase();

            options.forEach(opt => {
                const value = opt.getAttribute('data-value').toLowerCase();
                if (value.includes(q)) {
                    opt.classList.remove('hidden');
                } else {
                    opt.classList.add('hidden');
                }
            });
        }

        function clearFilter(filterId) {
            const container = document.getElementById(filterId + 'Options');
            container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            selectedFilters[filterId].clear();
            updateFilterButton(filterId);
        }

        function selectAllFilter(filterId) {
            const container = document.getElementById(filterId + 'Options');
            container.querySelectorAll('.filter-option:not(.hidden) input[type="checkbox"]').forEach(cb => cb.checked = true);
        }

        function applyFilters() {
            // Collect selected values for each filter
            ['startAddr', 'endAddr', 'costObj'].forEach(filterId => {
                selectedFilters[filterId].clear();
                const container = document.getElementById(filterId + 'Options');
                container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    const opt = cb.closest('.filter-option');
                    selectedFilters[filterId].add(opt.getAttribute('data-value'));
                });
                updateFilterButton(filterId);
            });

            // Close popups
            document.querySelectorAll('.filter-popup').forEach(p => p.classList.remove('active'));

            // Apply all filters
            filterRequests();
        }

        function updateFilterButton(filterId) {
            const count = selectedFilters[filterId].size;
            document.getElementById(filterId + 'Count').textContent = count;
            const btn = document.querySelector('#' + filterId + 'Popup').previousElementSibling;
            const label = btn.querySelector('span:first-child');
            if (count === 0) {
                label.textContent = 'Все';
            } else if (count === 1) {
                label.textContent = Array.from(selectedFilters[filterId])[0].substring(0, 20) + '...';
            } else {
                label.textContent = 'Выбрано: ' + count;
            }
        }

        function filterRequests() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const hideArchived = document.getElementById('hideArchived').checked;
            const requests = document.querySelectorAll('.request');
            let visibleCount = 0;

            requests.forEach(req => {
                const text = req.getAttribute('data-search').toLowerCase();
                const startAddr = req.getAttribute('data-start-addr') || '';
                const endAddr = req.getAttribute('data-end-addr') || '';
                const costObj = req.getAttribute('data-cost-obj') || '';
                const isArchived = req.classList.contains('is-archived');

                // Text search
                const matchesSearch = !query || text.includes(query);

                // Filter checks
                const matchesStart = selectedFilters.startAddr.size === 0 || selectedFilters.startAddr.has(startAddr);
                const matchesEnd = selectedFilters.endAddr.size === 0 || selectedFilters.endAddr.has(endAddr);
                const matchesCost = selectedFilters.costObj.size === 0 || selectedFilters.costObj.has(costObj);

                // Archive filter
                const matchesArchive = !hideArchived || !isArchived;

                if (matchesSearch && matchesStart && matchesEnd && matchesCost && matchesArchive) {
                    req.classList.remove('hidden');
                    visibleCount++;
                } else {
                    req.classList.add('hidden');
                }
            });

            document.getElementById('resultsInfo').textContent = 'Показано заявок: ' + visibleCount;
        }

        function sortRequests() {
            const container = document.getElementById('requestsContainer');
            const requests = Array.from(container.querySelectorAll('.request'));
            const sortType = document.getElementById('sortSelect').value;

            requests.sort((a, b) => {
                if (sortType === 'date-desc') {
                    return (b.getAttribute('data-date') || '').localeCompare(a.getAttribute('data-date') || '');
                } else if (sortType === 'date-asc') {
                    return (a.getAttribute('data-date') || '').localeCompare(b.getAttribute('data-date') || '');
                } else if (sortType === 'number-asc') {
                    return parseInt(a.getAttribute('data-number')) - parseInt(b.getAttribute('data-number'));
                }
                return 0;
            });

            requests.forEach(req => container.appendChild(req));
        }

        function togglePL(plId) {
            const body = document.getElementById('pl-body-' + plId);
            if (body) {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
            }
        }

        function updateParkingDisplay() {
            const minTime = parseInt(document.getElementById('minParkingTime').value) || 0;
            document.querySelectorAll('.parking-day-group').forEach(group => {
                let visibleCount = 0;
                group.querySelectorAll('.parking-item').forEach(item => {
                    const duration = parseInt(item.getAttribute('data-duration')) || 0;
                    if (duration >= minTime) {
                        item.style.display = 'block';
                        visibleCount++;
                    } else {
                        item.style.display = 'none';
                    }
                });
                // Hide day group if no items visible
                group.style.display = visibleCount > 0 ? 'block' : 'none';
            });
        }

        function switchDay(vehicleId, dayIndex) {
            // Update buttons
            const nav = document.getElementById('day-nav-' + vehicleId);
            if (nav) {
                nav.querySelectorAll('.day-nav-btn').forEach((btn, idx) => {
                    btn.classList.toggle('active', idx === dayIndex);
                });
            }

            // Update content
            const container = document.getElementById('day-container-' + vehicleId);
            if (container) {
                container.querySelectorAll('.day-content').forEach((content, idx) => {
                    content.classList.toggle('active', idx === dayIndex);
                });
            }
        }

        function toggleCalcPlan(reqNum) {
            const body = document.getElementById('calc-body-' + reqNum);
            const toggle = document.getElementById('calc-toggle-' + reqNum);
            if (body.classList.contains('active')) {
                body.classList.remove('active');
                toggle.textContent = '▼ развернуть';
            } else {
                body.classList.add('active');
                toggle.textContent = '▲ свернуть';
                updateCalcPlan(reqNum);
            }
        }

        function updateCalcPlan(reqNum) {
            // Get input values
            const ts = parseInt(document.getElementById('calc-ts-' + reqNum).value) || 1;
            const trips = parseInt(document.getElementById('calc-trips-' + reqNum).value) || 1;
            const distOneWay = parseFloat(document.getElementById('calc-dist-' + reqNum).value) || 0;
            const speed = parseFloat(document.getElementById('calc-speed-' + reqNum).value) || 65;
            const workHours = parseFloat(document.getElementById('calc-hours-' + reqNum).value) || 11;
            const loadTime = parseFloat(document.getElementById('calc-load-' + reqNum).value) || 1.5;
            const startDateStr = document.getElementById('calc-start-date-' + reqNum).value;
            const startTimeStr = document.getElementById('calc-start-time-' + reqNum).value;

            // Calculations
            const tripsPerTs = Math.ceil(trips / ts);
            const roundDist = distOneWay * 2;
            const travelTime = roundDist / speed;
            const tripTime = travelTime + loadTime;
            const tripsPerDay = Math.floor(workHours / tripTime);
            const daysNeeded = tripsPerDay > 0 ? Math.ceil(tripsPerTs / tripsPerDay) : 999;

            // Update results
            document.getElementById('calc-res-trips-per-ts-' + reqNum).textContent = tripsPerTs;
            document.getElementById('calc-res-round-dist-' + reqNum).textContent = roundDist.toFixed(0) + ' км (' + distOneWay.toFixed(0) + ' × 2)';
            document.getElementById('calc-res-trip-time-' + reqNum).textContent = tripTime.toFixed(1) + ' ч (' + travelTime.toFixed(1) + 'ч в пути + ' + loadTime + 'ч погрузка)';
            document.getElementById('calc-res-trips-per-day-' + reqNum).textContent = tripsPerDay > 0 ? tripsPerDay : '< 1';
            document.getElementById('calc-res-days-' + reqNum).textContent = daysNeeded < 999 ? daysNeeded : '—';

            // Calculate end date
            if (startDateStr && daysNeeded < 999) {
                const endDate = calculateEndDate(startDateStr, startTimeStr, daysNeeded, workHours, tripTime, tripsPerTs, tripsPerDay);
                document.getElementById('calc-res-end-date-' + reqNum).textContent = endDate;
            } else {
                document.getElementById('calc-res-end-date-' + reqNum).textContent = '—';
            }
        }

        function copyToClipboard(text, btn) {
            navigator.clipboard.writeText(text).then(function() {
                // Visual feedback
                btn.classList.add('copied');
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '✓';
                setTimeout(function() {
                    btn.classList.remove('copied');
                    btn.innerHTML = originalHtml;
                }, 1000);
            }).catch(function(err) {
                console.error('Copy failed:', err);
            });
        }

        function copyValue(event, value) {
            event.stopPropagation();
            const btn = event.currentTarget;
            copyToClipboard(value, btn);
        }

        function calculateEndDate(startDateStr, startTimeStr, daysNeeded, workHours, tripTime, tripsPerTs, tripsPerDay) {
            // Parse start date (DD.MM.YYYY)
            const dateParts = startDateStr.split('.');
            if (dateParts.length !== 3) return '—';

            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1;
            const year = parseInt(dateParts[2]);

            // Parse start time (HH:MM)
            const timeParts = startTimeStr.split(':');
            const startHour = parseInt(timeParts[0]) || 6;
            const startMin = parseInt(timeParts[1]) || 0;

            // Create start date
            const startDate = new Date(year, month, day, startHour, startMin);

            // Calculate remaining trips on last day
            const fullDays = daysNeeded - 1;
            const remainingTrips = tripsPerTs - (fullDays * tripsPerDay);
            const lastDayHours = remainingTrips * tripTime;

            // Calculate end date
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + fullDays);
            endDate.setHours(startHour + Math.floor(lastDayHours));
            endDate.setMinutes(startMin + Math.round((lastDayHours % 1) * 60));

            // Format result
            const endDay = String(endDate.getDate()).padStart(2, '0');
            const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
            const endYear = endDate.getFullYear();
            const endHour = String(endDate.getHours()).padStart(2, '0');
            const endMinute = String(endDate.getMinutes()).padStart(2, '0');

            return endDay + '.' + endMonth + '.' + endYear + ' ~' + endHour + ':' + endMinute;
        }

        // Map functions
        const mapInstances = {};

        function toggleMap(requestId) {
            const container = document.getElementById('map-' + requestId);
            const btn = document.getElementById('map-btn-' + requestId);
            const paramsPanel = document.getElementById('map-params-' + requestId);

            if (container.classList.contains('active')) {
                container.classList.remove('active');
                btn.classList.remove('active');
                btn.innerHTML = '🗺️ Показать карту';
                if (paramsPanel) paramsPanel.classList.remove('active');
                return;
            }

            container.classList.add('active');
            btn.classList.add('active');
            btn.innerHTML = '❌ Скрыть карту';
            if (paramsPanel) paramsPanel.classList.add('active');

            if (!container.dataset.initialized) {
                initMap(requestId, container);
                container.dataset.initialized = 'true';
            } else if (mapInstances[requestId]) {
                // Invalidate size when showing again
                setTimeout(function() {
                    mapInstances[requestId].invalidateSize();
                }, 100);
            }
        }

        // Track colors palette for different vehicles
        const trackColors = ['#48bb78', '#ed64a6', '#4299e1', '#ecc94b', '#9f7aea', '#38b2ac', '#f56565'];

        // Store vehicle data and layers for filtering
        const mapVehiclesData = {};
        const mapVehicleLayers = {};
        const mapTimeFilters = {};

        // Format datetime string "2026-02-01 08:30:00" -> "01.02 08:30"
        function formatDateTime(dtStr) {
            if (!dtStr) return '';
            // Expected format: "YYYY-MM-DD HH:MM:SS" or "DD.MM.YYYY HH:MM:SS"
            const parts = dtStr.split(' ');
            if (parts.length < 2) return dtStr;

            const datePart = parts[0];
            const timePart = parts[1].substring(0, 5); // HH:MM

            // Check date format
            if (datePart.includes('-')) {
                // YYYY-MM-DD
                const dp = datePart.split('-');
                if (dp.length === 3) {
                    return dp[2] + '.' + dp[1] + ' ' + timePart;
                }
            } else if (datePart.includes('.')) {
                // DD.MM.YYYY
                const dp = datePart.split('.');
                if (dp.length === 3) {
                    return dp[0] + '.' + dp[1] + ' ' + timePart;
                }
            }
            return timePart;
        }

        // Build display names with PL numbering for same vehicles
        function buildVehicleDisplayNames(vehicles) {
            // Count occurrences of each reg number
            const counts = {};
            vehicles.forEach(function(v) {
                const reg = v.ts_reg_number || '';
                counts[reg] = (counts[reg] || 0) + 1;
            });

            // Assign display names with numbering if needed
            const indices = {};
            vehicles.forEach(function(v) {
                const reg = v.ts_reg_number || 'ТС';
                if (counts[reg] > 1) {
                    indices[reg] = (indices[reg] || 0) + 1;
                    v.displayName = reg + '-№' + indices[reg];
                } else {
                    v.displayName = reg;
                }
            });
        }

        function initMap(requestId, container) {
            const mapData = container.querySelector('.map-data');
            if (!mapData) return;

            const polyline = mapData.dataset.polyline || '';
            const routePointsStr = mapData.dataset.routePoints || '[]';
            const vehiclesStr = mapData.dataset.vehicles || '[]';

            let routePoints = [];
            let vehicles = [];

            try { routePoints = JSON.parse(routePointsStr); } catch(e) {}
            try { vehicles = JSON.parse(vehiclesStr); } catch(e) {}

            // Build display names with PL numbering for same vehicles
            buildVehicleDisplayNames(vehicles);

            // Store vehicles data for this map
            mapVehiclesData[requestId] = vehicles;
            mapVehicleLayers[requestId] = [];

            const mapEl = container.querySelector('.leaflet-map');
            const map = L.map(mapEl).setView([56, 68], 6);
            mapInstances[requestId] = map;

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);

            const bounds = [];

            // Plan route (blue) - from polyline
            if (polyline) {
                const decoded = decodePolyline(polyline);
                if (decoded.length > 0) {
                    const planLine = L.polyline(decoded, {
                        color: '#3182ce',
                        weight: 4,
                        opacity: 0.8
                    }).addTo(map);
                    bounds.push(...decoded);
                }
            }

            // Route points (markers for start/end)
            if (routePoints.length > 0) {
                // Start point (green)
                const start = routePoints[0];
                if (start.lat && start.lng) {
                    L.marker([start.lat, start.lng], {
                        icon: L.divIcon({
                            className: 'custom-marker',
                            html: '<div style="background:#38a169;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7]
                        })
                    }).bindPopup('<b>Старт</b><br>' + (start.address || '') + '<br>' + (start.date || '') + ' ' + (start.time || '')).addTo(map);
                    bounds.push([start.lat, start.lng]);
                }

                // End point (red)
                if (routePoints.length > 1) {
                    const end = routePoints[routePoints.length - 1];
                    if (end.lat && end.lng) {
                        L.marker([end.lat, end.lng], {
                            icon: L.divIcon({
                                className: 'custom-marker',
                                html: '<div style="background:#e53e3e;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>',
                                iconSize: [14, 14],
                                iconAnchor: [7, 7]
                            })
                        }).bindPopup('<b>Финиш</b><br>' + (end.address || '') + '<br>' + (end.date || '') + ' ' + (end.time || '')).addTo(map);
                        bounds.push([end.lat, end.lng]);
                    }
                }
            }

            // Build vehicle checkboxes and render tracks
            const filterContainer = document.getElementById('vehicle-filters-' + requestId);

            vehicles.forEach(function(v, vIdx) {
                const color = trackColors[vIdx % trackColors.length];
                const vehicleId = 'v' + vIdx;

                // Create layer group for this vehicle
                const vehicleGroup = L.layerGroup().addTo(map);
                mapVehicleLayers[requestId].push({
                    id: vehicleId,
                    group: vehicleGroup,
                    color: color,
                    vehicle: v
                });

                // Render track with direction arrows and chronology markers
                if (v.track && v.track.length > 0) {
                    const trackCoords = v.track.map(function(p) { return [p.lat, p.lon]; });
                    const trackLine = L.polyline(trackCoords, {
                        color: color,
                        weight: 3,
                        opacity: 0.9,
                        dashArray: '5, 5'
                    }).addTo(vehicleGroup);
                    bounds.push(...trackCoords);

                    // Add chronology markers at start and end of track
                    if (trackCoords.length > 0) {
                        // Start marker (bright small circle)
                        L.circleMarker(trackCoords[0], {
                            color: color,
                            fillColor: color,
                            fillOpacity: 0.8,
                            radius: 4,
                            weight: 2
                        }).bindPopup('Начало трека ' + (v.displayName || v.ts_reg_number) + '<br>' + formatDateTime(v.track[0].time)).addTo(vehicleGroup);

                        // End marker (larger dimmer circle)
                        L.circleMarker(trackCoords[trackCoords.length - 1], {
                            color: color,
                            fillColor: color,
                            fillOpacity: 0.5,
                            radius: 6,
                            weight: 2
                        }).bindPopup('Конец трека ' + (v.displayName || v.ts_reg_number) + '<br>' + formatDateTime(v.track[v.track.length - 1].time)).addTo(vehicleGroup);
                    }

                    // Add arrow decorators to show direction
                    if (trackCoords.length > 1) {
                        const arrowInterval = Math.max(Math.floor(trackCoords.length / 5), 1);
                        for (let i = arrowInterval; i < trackCoords.length; i += arrowInterval) {
                            const prevPoint = trackCoords[i - 1];
                            const currPoint = trackCoords[i];
                            const angle = Math.atan2(currPoint[0] - prevPoint[0], currPoint[1] - prevPoint[1]) * 180 / Math.PI;

                            L.marker(currPoint, {
                                icon: L.divIcon({
                                    className: 'direction-arrow',
                                    html: '<div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:8px solid ' + color + ';transform:rotate(' + angle + 'deg);opacity:0.7;"></div>',
                                    iconSize: [8, 8],
                                    iconAnchor: [4, 4]
                                })
                            }).addTo(vehicleGroup);
                        }
                    }
                }

                // Render parkings with numbering
                if (v.parkings) {
                    v.parkings.forEach(function(p, pIdx) {
                        if (p.lat && p.lon) {
                            // Format time range
                            const beginTime = formatDateTime(p.begin);
                            const endTime = formatDateTime(p.end);
                            const timeRange = beginTime && endTime ? beginTime + ' — ' + endTime : '';

                            const parkingNum = pIdx + 1;
                            const marker = L.marker([p.lat, p.lon], {
                                icon: L.divIcon({
                                    className: 'parking-marker',
                                    html: '<div style="background:#ed8936;width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:11px;">' + parkingNum + '</div>',
                                    iconSize: [20, 20],
                                    iconAnchor: [10, 10]
                                })
                            }).bindPopup('<b>🅿️ Стоянка #' + parkingNum + '</b><br>' + v.displayName + '<br>' + (p.address || '—') + '<br><b>' + timeRange + '</b><br>' + (p.duration_min || 0) + ' мін');
                            marker.parkingDuration = p.duration_min || 0;
                            marker.parkingNumber = parkingNum;
                            marker.addTo(vehicleGroup);
                            bounds.push([p.lat, p.lon]);
                        }
                    });
                }

                // Add checkbox for this vehicle
                if (filterContainer) {
                    const label = document.createElement('label');
                    label.className = 'filter-checkbox';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = true;
                    checkbox.dataset.vehicleIdx = vIdx;
                    checkbox.onchange = function() { updateMapFilters(requestId); };
                    label.appendChild(checkbox);
                    const dot = document.createElement('span');
                    dot.className = 'color-dot';
                    dot.style.background = color;
                    label.appendChild(dot);
                    label.appendChild(document.createTextNode(' ' + (v.displayName || v.ts_reg_number || 'ТС ' + (vIdx+1))));
                    filterContainer.appendChild(label);
                }
            });

            // Fit bounds
            if (bounds.length > 0) {
                map.fitBounds(bounds, { padding: [30, 30] });
            }

            // Add legend
            const legend = L.control({ position: 'bottomright' });
            legend.onAdd = function() {
                const div = L.DomUtil.create('div', 'map-legend');
                let legendHtml = '<div class="map-legend-item"><div class="map-legend-line" style="background:#3182ce;"></div>План</div>' +
                    '<div class="map-legend-item"><div class="map-legend-marker" style="background:#38a169;"></div>Старт</div>' +
                    '<div class="map-legend-item"><div class="map-legend-marker" style="background:#e53e3e;"></div>Финиш</div>' +
                    '<div class="map-legend-item"><div class="map-legend-marker" style="background:#ed8936;"></div>Стоянка</div>';

                // Add vehicle colors to legend
                vehicles.forEach(function(v, vIdx) {
                    const color = trackColors[vIdx % trackColors.length];
                    legendHtml += '<div class="map-legend-item"><div class="map-legend-line" style="background:'+color+';border-style:dashed;"></div>' + (v.displayName || v.ts_reg_number || 'ТС ' + (vIdx+1)) + '</div>';
                });

                div.innerHTML = legendHtml;
                return div;
            };
            legend.addTo(map);

            // Build initial timeline
            buildTimeline(requestId);
        }

        function updateMapFilters(requestId) {
            const map = mapInstances[requestId];
            const layers = mapVehicleLayers[requestId];
            if (!map || !layers) return;

            const minParking = parseInt(document.getElementById('min-parking-' + requestId).value) || 0;
            const filterContainer = document.getElementById('vehicle-filters-' + requestId);
            const checkboxes = filterContainer ? filterContainer.querySelectorAll('input[type="checkbox"]') : [];

            // Get visible vehicle indices
            const visibleVehicles = [];
            checkboxes.forEach(function(cb) {
                if (cb.checked) {
                    visibleVehicles.push(parseInt(cb.dataset.vehicleIdx));
                }
            });

            // Toggle visibility and filter parkings
            layers.forEach(function(layerData, idx) {
                if (visibleVehicles.indexOf(idx) >= 0) {
                    if (!map.hasLayer(layerData.group)) {
                        map.addLayer(layerData.group);
                    }
                    // Filter parkings by duration
                    layerData.group.eachLayer(function(layer) {
                        if (layer.parkingDuration !== undefined) {
                            if (layer.parkingDuration >= minParking) {
                                layer.setOpacity(1);
                            } else {
                                layer.setOpacity(0);
                            }
                        }
                    });
                } else {
                    if (map.hasLayer(layerData.group)) {
                        map.removeLayer(layerData.group);
                    }
                }
            });

            // Rebuild timeline with filters
            buildTimeline(requestId);
        }

        function buildTimeline(requestId) {
            const timelineEl = document.getElementById('timeline-' + requestId);
            if (!timelineEl) return;

            const vehicles = mapVehiclesData[requestId] || [];
            const layers = mapVehicleLayers[requestId] || [];
            const minParking = parseInt(document.getElementById('min-parking-' + requestId).value) || 0;
            const showParkings = document.getElementById('show-parkings-' + requestId) ? document.getElementById('show-parkings-' + requestId).checked : true;

            // Get time filter if active
            const timeFilter = mapTimeFilters[requestId];

            // Get visible vehicles
            const filterContainer = document.getElementById('vehicle-filters-' + requestId);
            const checkboxes = filterContainer ? filterContainer.querySelectorAll('input[type="checkbox"]') : [];
            const visibleVehicles = [];
            checkboxes.forEach(function(cb) {
                if (cb.checked) {
                    visibleVehicles.push(parseInt(cb.dataset.vehicleIdx));
                }
            });

            let html = '';

            vehicles.forEach(function(v, vIdx) {
                if (visibleVehicles.length > 0 && visibleVehicles.indexOf(vIdx) < 0) return;

                const color = trackColors[vIdx % trackColors.length];

                html += '<div class="timeline-vehicle-group">';
                html += '<div class="timeline-vehicle-header" style="border-left-color:'+color+'">' + (v.displayName || v.ts_reg_number || 'ТС ' + (vIdx+1)) + '</div>';

                // Collect timeline items (points + parkings)
                const items = [];

                // Add track points with adaptive interval (20 min base + gap filling between parkings)
                if (v.track && v.track.length > 0) {
                    const baseIntervalMs = 20 * 60 * 1000; // 20 minutes (matches new API interval)
                    let lastShownTime = null;

                    // Collect parking times for gap detection
                    const parkingTimes = [];
                    if (v.parkings) {
                        v.parkings.forEach(function(p) {
                            if (p.begin) {
                                parkingTimes.push({
                                    time: parseTimeToMs(p.begin),
                                    end: p.end ? parseTimeToMs(p.end) : null
                                });
                            }
                        });
                        parkingTimes.sort(function(a, b) { return a.time - b.time; });
                    }

                    // Track which gaps between parkings have been filled
                    const filledGaps = new Set();

                    v.track.forEach(function(point) {
                        if (point.time && point.lat && point.lon) {
                            const pointTime = parseTimeToMs(point.time);

                            let shouldShow = false;

                            // Rule 1: Always show first point
                            if (lastShownTime === null) {
                                shouldShow = true;
                            }
                            // Rule 2: Show if base interval (20 min) has passed
                            else if ((pointTime - lastShownTime) >= baseIntervalMs) {
                                shouldShow = true;
                            }
                            // Rule 3: Adaptive - fill gaps between close parkings
                            else {
                                // Check if this point fills a gap between consecutive parkings
                                for (let i = 0; i < parkingTimes.length - 1; i++) {
                                    const parking1 = parkingTimes[i];
                                    const parking2 = parkingTimes[i + 1];
                                    const gapKey = i + '-' + (i + 1);

                                    // If parkings are close (< 20 min apart) and no point shown between them yet
                                    if ((parking2.time - parking1.time) < baseIntervalMs && !filledGaps.has(gapKey)) {
                                        // Check if this point is between these parkings
                                        if (pointTime > parking1.time && pointTime < parking2.time) {
                                            shouldShow = true;
                                            filledGaps.add(gapKey);  // Mark gap as filled
                                            break;
                                        }
                                    }
                                }
                            }

                            if (shouldShow) {
                                // Apply time filter if active
                                let includePoint = true;
                                if (timeFilter) {
                                    includePoint = pointTime >= timeFilter.startMs && pointTime <= timeFilter.endMs;
                                }

                                if (includePoint) {
                                    items.push({
                                        type: 'point',
                                        time: point.time,
                                        timeMs: pointTime,
                                        lat: point.lat,
                                        lon: point.lon,
                                        speed: point.speed,
                                        inTimeRange: !timeFilter
                                    });
                                }

                                lastShownTime = pointTime;
                            }
                        }
                    });
                }

                // Add parkings with filter and numbering
                if (v.parkings && showParkings) {
                    let parkingNum = 0;
                    v.parkings.forEach(function(p) {
                        if (p.lat && p.lon && (p.duration_min || 0) >= minParking) {
                            const beginTime = p.begin || '';
                            const beginMs = parseTimeToMs(beginTime);

                            // Apply time filter if active
                            let includeParking = true;
                            if (timeFilter) {
                                includeParking = beginMs >= timeFilter.startMs && beginMs <= timeFilter.endMs;
                            }

                            if (includeParking) {
                                parkingNum++;
                                items.push({
                                    type: 'parking',
                                    parkingNumber: parkingNum,
                                    begin: beginTime,
                                    end: p.end || '',
                                    timeMs: beginMs,
                                    lat: p.lat,
                                    lon: p.lon,
                                    duration: p.duration_min,
                                    address: p.address,
                                    inTimeRange: !timeFilter
                                });
                            }
                        }
                    });
                }

                // Sort by time
                items.sort(function(a, b) { return a.timeMs - b.timeMs; });

                // Render items
                items.forEach(function(item) {
                    const highlightStyle = item.inTimeRange ? '' : 'opacity:0.4;';

                    if (item.type === 'point') {
                        html += '<div class="timeline-item point" style="border-left-color:'+color+';'+highlightStyle+';position:relative;">';
                        html += '<div style="display:flex;justify-content:space-between;align-items:start;">';
                        html += "<div style='flex:1;cursor:pointer;' onclick='focusOnPoint(\\\""+requestId+"\\\", "+item.lat+", "+item.lon+", false)'>";
                        html += '<div class="time">📍 ' + formatDateTime(item.time) + '</div>';
                        if (item.speed) html += '<div class="info">' + item.speed + ' км/ч</div>';
                        html += '</div>';
                        html += "<div style='display:flex;gap:2px;flex-shrink:0;'>";
                        html += "<button onclick='event.stopPropagation();setTimeFilterFrom(\\\""+requestId+"\\\", \\\""+item.time+"\\\")' style='font-size:9px;padding:2px 4px;background:#48bb78;color:white;border:none;border-radius:3px;cursor:pointer;' title='Установить как начало'>От</button>";
                        html += "<button onclick='event.stopPropagation();setTimeFilterTo(\\\""+requestId+"\\\", \\\""+item.time+"\\\")' style='font-size:9px;padding:2px 4px;background:#ed8936;color:white;border:none;border-radius:3px;cursor:pointer;' title='Установить как конец'>До</button>";
                        html += '</div></div></div>';
                    } else {
                        // Format time range for parking
                        const beginFmt = formatDateTime(item.begin);
                        const endFmt = formatDateTime(item.end);
                        const timeRange = beginFmt + ' — ' + endFmt;

                        html += '<div class="timeline-item parking" style="'+highlightStyle+';position:relative;">';
                        html += "<div style='display:flex;justify-content:space-between;align-items:start;'>";
                        html += "<div style='flex:1;cursor:pointer;' onclick='focusOnPoint(\\\""+requestId+"\\\", "+item.lat+", "+item.lon+", true)'>";
                        html += '<div class="time">🅿️ Стоянка #' + item.parkingNumber + '</div>';
                        html += '<div class="info">' + timeRange + '</div>';
                        html += '<div class="info">' + (item.duration || 0) + ' мин</div>';
                        if (item.address) html += '<div class="info address">' + item.address + '</div>';
                        html += '</div>';
                        html += "<div style='display:flex;gap:2px;flex-shrink:0;'>";
                        html += "<button onclick='event.stopPropagation();setTimeFilterFrom(\\\""+requestId+"\\\", \\\""+item.begin+"\\\")' style='font-size:9px;padding:2px 4px;background:#48bb78;color:white;border:none;border-radius:3px;cursor:pointer;' title='Установить как начало'>От</button>";
                        html += "<button onclick='event.stopPropagation();setTimeFilterTo(\\\""+requestId+"\\\", \\\""+item.end+"\\\")' style='font-size:9px;padding:2px 4px;background:#ed8936;color:white;border:none;border-radius:3px;cursor:pointer;' title='Установить как конец'>До</button>";
                        html += '</div></div></div>';
                    }
                });

                html += '</div>';
            });

            const itemsEl = timelineEl.querySelector('.timeline-items');
            if (itemsEl) {
                itemsEl.innerHTML = html || '<div style="padding:12px;color:#718096;font-size:11px;">Нет данных</div>';
                // Add click handlers via delegation
                itemsEl.onclick = function(e) {
                    const item = e.target.closest('.timeline-item');
                    if (item && item.dataset.lat && item.dataset.lon) {
                        focusOnPoint(item.dataset.reqid, parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
                    }
                };
            }
        }

        function parseTimeToMs(dtStr) {
            if (!dtStr) return 0;
            // Handle formats: "DD.MM.YYYY HH:MM:SS" or "HH:MM:SS" or "HH:MM"
            const parts = dtStr.split(' ');

            if (parts.length >= 2) {
                // Full datetime: "DD.MM.YYYY HH:MM:SS"
                const datePart = parts[0];
                const timePart = parts[1];
                const dp = datePart.split('.');
                const tp = timePart.split(':');

                if (dp.length === 3 && tp.length >= 2) {
                    const day = parseInt(dp[0]) || 1;
                    const month = parseInt(dp[1]) || 1;
                    const year = parseInt(dp[2]) || 2026;
                    const h = parseInt(tp[0]) || 0;
                    const m = parseInt(tp[1]) || 0;
                    const s = parseInt(tp[2]) || 0;
                    return new Date(year, month - 1, day, h, m, s).getTime();
                }
            }

            // Time only: "HH:MM:SS" or "HH:MM"
            const tp = dtStr.split(':');
            if (tp.length >= 2) {
                const h = parseInt(tp[0]) || 0;
                const m = parseInt(tp[1]) || 0;
                const s = parseInt(tp[2]) || 0;
                return (h * 3600 + m * 60 + s) * 1000;
            }
            return 0;
        }

        function toggleParkings(requestId) {
            const map = mapInstances[requestId];
            const layers = mapVehicleLayers[requestId];
            const showParkings = document.getElementById('show-parkings-' + requestId).checked;

            if (!map || !layers) return;

            // Show/hide parking markers
            layers.forEach(function(layerData) {
                layerData.group.eachLayer(function(layer) {
                    if (layer.options.icon && layer.options.icon.options.className === 'parking-marker') {
                        if (showParkings) {
                            layer.setOpacity(1);
                        } else {
                            layer.setOpacity(0);
                        }
                    }
                });
            });

            buildTimeline(requestId);
        }

        function focusOnPoint(requestId, lat, lon, openPopup) {
            const map = mapInstances[requestId];
            if (map) {
                map.setView([lat, lon], 16, { animate: true, duration: 0.5 });

                // Open popup if requested
                if (openPopup) {
                    setTimeout(function() {
                        map.eachLayer(function(layer) {
                            if (layer.getLatLng && layer.getLatLng().lat === lat && layer.getLatLng().lng === lon) {
                                layer.openPopup();
                            }
                        });
                    }, 500);
                }
            }
        }

        function setTimeFilterFrom(requestId, timeStr) {
            // Parse time string "04.02.2026 08:30:00" or "2026-02-04 08:30:00"
            const parts = timeStr.split(' ');
            if (parts.length >= 2) {
                const datePart = parts[0];
                const timeParts = parts[1].split(':');

                let yyyy, mm, dd;
                if (datePart.indexOf('.') > 0) {
                    // DD.MM.YYYY format
                    const dateParts = datePart.split('.');
                    dd = dateParts[0];
                    mm = dateParts[1];
                    yyyy = dateParts[2];
                } else {
                    // YYYY-MM-DD format
                    const dateParts = datePart.split('-');
                    yyyy = dateParts[0];
                    mm = dateParts[1];
                    dd = dateParts[2];
                }

                document.getElementById('start-date-' + requestId).value = yyyy + '-' + mm + '-' + dd;
                document.getElementById('start-time-' + requestId).value = timeParts[0] + ':' + timeParts[1];
            }
        }

        function setTimeFilterTo(requestId, timeStr) {
            // Parse time string "04.02.2026 08:30:00" or "2026-02-04 08:30:00"
            const parts = timeStr.split(' ');
            if (parts.length >= 2) {
                const datePart = parts[0];
                const timeParts = parts[1].split(':');

                let yyyy, mm, dd;
                if (datePart.indexOf('.') > 0) {
                    // DD.MM.YYYY format
                    const dateParts = datePart.split('.');
                    dd = dateParts[0];
                    mm = dateParts[1];
                    yyyy = dateParts[2];
                } else {
                    // YYYY-MM-DD format
                    const dateParts = datePart.split('-');
                    yyyy = dateParts[0];
                    mm = dateParts[1];
                    dd = dateParts[2];
                }

                document.getElementById('end-date-' + requestId).value = yyyy + '-' + mm + '-' + dd;
                document.getElementById('end-time-' + requestId).value = timeParts[0] + ':' + timeParts[1];
            }
        }

        function applyTimeFilter(requestId) {
            const startDate = document.getElementById('start-date-' + requestId).value;
            const startTime = document.getElementById('start-time-' + requestId).value || '00:00';
            const endDate = document.getElementById('end-date-' + requestId).value;
            const endTime = document.getElementById('end-time-' + requestId).value || '23:59';

            if (!startDate || !endDate) {
                alert('Пожалуйста, выберите даты начала и конца');
                return;
            }

            // Convert YYYY-MM-DD to DD.MM.YYYY for parseTimeToMs
            const startDateParts = startDate.split('-');
            const endDateParts = endDate.split('-');
            const startDateStr = startDateParts[2] + '.' + startDateParts[1] + '.' + startDateParts[0];
            const endDateStr = endDateParts[2] + '.' + endDateParts[1] + '.' + endDateParts[0];

            // Parse dates to milliseconds
            const startMs = parseTimeToMs(startDateStr + ' ' + startTime + ':00');
            const endMs = parseTimeToMs(endDateStr + ' ' + endTime + ':59');

            if (startMs >= endMs) {
                alert('Дата начала должна быть раньше даты конца');
                return;
            }

            mapTimeFilters[requestId] = {
                startMs: startMs,
                endMs: endMs
            };

            // Update track visualization on map
            updateTrackHighlight(requestId);

            // Rebuild timeline with filter
            buildTimeline(requestId);
        }

        function clearTimeFilter(requestId) {
            delete mapTimeFilters[requestId];

            // Clear input fields
            document.getElementById('start-date-' + requestId).value = '';
            document.getElementById('start-time-' + requestId).value = '00:00';
            document.getElementById('end-date-' + requestId).value = '';
            document.getElementById('end-time-' + requestId).value = '23:59';

            // Clear track highlight
            updateTrackHighlight(requestId);

            // Rebuild timeline without filter
            buildTimeline(requestId);
        }

        function updateTrackHighlight(requestId) {
            const vehicles = mapVehiclesData[requestId] || [];
            const layers = mapVehicleLayers[requestId] || [];
            const timeFilter = mapTimeFilters[requestId];
            const map = mapInstances[requestId];

            if (!map) return;

            // Remove old highlight layers
            if (!window.highlightLayers) window.highlightLayers = {};
            if (window.highlightLayers[requestId]) {
                window.highlightLayers[requestId].forEach(layer => map.removeLayer(layer));
            }
            window.highlightLayers[requestId] = [];

            vehicles.forEach(function(v, vIdx) {
                const color = trackColors[vIdx % trackColors.length];
                const layerData = layers[vIdx];

                if (!layerData || !v.track || v.track.length === 0) return;

                if (timeFilter) {
                    // Dim all elements in this vehicle's layer
                    layerData.group.eachLayer(function(layer) {
                        // Dim track lines
                        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
                            layer.setStyle({ opacity: 0.2, weight: 2 });
                        }
                        // Dim parking markers
                        if (layer.options.icon && layer.options.icon.options.className === 'parking-marker') {
                            layer.setOpacity(0.3);
                        }
                        // Dim direction arrows
                        if (layer.options.icon && layer.options.icon.options.className === 'direction-arrow') {
                            layer.setOpacity(0.2);
                        }
                        // Dim chronology markers
                        if (layer instanceof L.CircleMarker) {
                            layer.setStyle({ opacity: 0.3, fillOpacity: 0.2 });
                        }
                    });

                    // Find and highlight parkings in time range
                    if (v.parkings) {
                        v.parkings.forEach(function(p, pIdx) {
                            if (p.lat && p.lon && p.begin) {
                                const beginMs = parseTimeToMs(p.begin);
                                if (beginMs >= timeFilter.startMs && beginMs <= timeFilter.endMs) {
                                    // Find and restore opacity for this parking marker
                                    layerData.group.eachLayer(function(layer) {
                                        if (layer.getLatLng &&
                                            layer.getLatLng().lat === p.lat &&
                                            layer.getLatLng().lng === p.lon &&
                                            layer.parkingNumber === (pIdx + 1)) {
                                            layer.setOpacity(1);
                                        }
                                    });
                                }
                            }
                        });
                    }

                    // Find track points in time range and draw thick highlight
                    const highlightCoords = [];
                    v.track.forEach(function(point) {
                        if (point.time) {
                            const pointMs = parseTimeToMs(point.time);
                            if (pointMs >= timeFilter.startMs && pointMs <= timeFilter.endMs) {
                                highlightCoords.push([point.lat, point.lon]);
                            }
                        }
                    });

                    // Draw thick highlighted segment
                    if (highlightCoords.length > 0) {
                        const highlightLine = L.polyline(highlightCoords, {
                            color: color,
                            weight: 6,
                            opacity: 1,
                            dashArray: '5, 5'
                        }).addTo(map);
                        window.highlightLayers[requestId].push(highlightLine);

                        // Add arrows on highlighted segment
                        if (highlightCoords.length > 1) {
                            const arrowInterval = Math.max(Math.floor(highlightCoords.length / 3), 1);
                            for (let i = arrowInterval; i < highlightCoords.length; i += arrowInterval) {
                                const prevPoint = highlightCoords[i - 1];
                                const currPoint = highlightCoords[i];
                                const angle = Math.atan2(currPoint[0] - prevPoint[0], currPoint[1] - prevPoint[1]) * 180 / Math.PI;

                                const arrow = L.marker(currPoint, {
                                    icon: L.divIcon({
                                        className: 'direction-arrow-highlight',
                                        html: '<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ' + color + ';transform:rotate(' + angle + 'deg);opacity:1;"></div>',
                                        iconSize: [10, 10],
                                        iconAnchor: [5, 5]
                                    })
                                }).addTo(map);
                                window.highlightLayers[requestId].push(arrow);
                            }
                        }
                    }
                } else {
                    // No filter - restore full visibility
                    layerData.group.eachLayer(function(layer) {
                        if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
                            layer.setStyle({ opacity: 0.9, weight: 3 });
                        }
                        if (layer.options.icon && layer.options.icon.options.className === 'parking-marker') {
                            layer.setOpacity(1);
                        }
                        if (layer.options.icon && layer.options.icon.options.className === 'direction-arrow') {
                            layer.setOpacity(0.7);
                        }
                        if (layer instanceof L.CircleMarker) {
                            layer.setStyle({ opacity: 1, fillOpacity: 0.8 });
                        }
                    });
                }
            });
        }

        function decodePolyline(encoded) {
            // Google Polyline decoding algorithm
            const points = [];
            let index = 0, lat = 0, lng = 0;

            while (index < encoded.length) {
                let b, shift = 0, result = 0;

                do {
                    b = encoded.charCodeAt(index++) - 63;
                    result |= (b & 0x1f) << shift;
                    shift += 5;
                } while (b >= 0x20);

                const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
                lat += dlat;

                shift = 0;
                result = 0;

                do {
                    b = encoded.charCodeAt(index++) - 63;
                    result |= (b & 0x1f) << shift;
                    shift += 5;
                } while (b >= 0x20);

                const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
                lng += dlng;

                points.push([lat / 1e5, lng / 1e5]);
            }

            return points;
        }

        // Archive functionality
        const archivedRequests = new Set();

        async function loadArchivedRequests() {
            try {
                const response = await fetch('/api/archived-numbers');
                if (response.ok) {
                    const data = await response.json();
                    data.numbers.forEach(num => archivedRequests.add(num));
                    updateArchivedUI();
                }
            } catch (e) {
                // Not in web mode or server not available
                console.log('Archive API not available (standalone mode)');
            }
        }

        function updateArchivedUI() {
            document.querySelectorAll('.request').forEach(req => {
                const reqNum = req.getAttribute('data-number');
                if (archivedRequests.has(reqNum)) {
                    req.classList.add('is-archived');
                    const btn = req.querySelector('.archive-btn');
                    if (btn) {
                        btn.classList.add('archived');
                        btn.innerHTML = '✓ Просмотрено';
                    }
                }
            });
        }

        async function toggleArchive(event, reqNum, startAddr, endAddr, startDate, plCount) {
            event.stopPropagation();
            const btn = event.currentTarget;
            const req = btn.closest('.request');

            if (archivedRequests.has(reqNum)) {
                // Unarchive
                try {
                    const response = await fetch('/api/archive', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ request_number: reqNum })
                    });
                    if (response.ok) {
                        archivedRequests.delete(reqNum);
                        req.classList.remove('is-archived');
                        btn.classList.remove('archived');
                        btn.innerHTML = '★ В архив';
                    }
                } catch (e) {
                    console.error('Unarchive failed:', e);
                }
            } else {
                // Archive
                try {
                    const response = await fetch('/api/archive', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            request_number: reqNum,
                            route_start_address: startAddr,
                            route_end_address: endAddr,
                            route_start_date: startDate,
                            pl_count: plCount
                        })
                    });
                    if (response.ok) {
                        archivedRequests.add(reqNum);
                        req.classList.add('is-archived');
                        btn.classList.add('archived');
                        btn.innerHTML = '✓ Просмотрено';
                    }
                } catch (e) {
                    console.error('Archive failed:', e);
                }
            }
        }

        // Load archived on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadArchivedRequests();
        });

        // Shift loading functionality
        async function loadShifts(vehicleUid, plId, tsIdMo, fromDate, toDate) {
            if (!REPORT_ID) {
                alert('Загрузка смен недоступна в автономном режиме');
                return;
            }

            const btn = document.getElementById('shift-btn-' + vehicleUid);
            const container = document.getElementById('shift-container-' + vehicleUid);

            if (!btn || !container) return;

            // Show loading state
            btn.disabled = true;
            btn.innerHTML = '⏳ Загрузка...';

            try {
                const response = await fetch('/api/reports/' + REPORT_ID + '/shifts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pl_id: plId,
                        ts_id_mo: tsIdMo,
                        from_date: fromDate,
                        to_date: toDate
                    })
                });

                if (!response.ok) {
                    throw new Error('Ошибка загрузки');
                }

                const data = await response.json();
                displayShifts(vehicleUid, data.shifts, data.from_cache);

                // Hide button after successful load
                btn.style.display = 'none';

            } catch (e) {
                console.error('Shift loading failed:', e);
                btn.innerHTML = '❌ Ошибка';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.innerHTML = '📊 Загрузить по сменам';
                }, 2000);
            }
        }

        function displayShifts(vehicleUid, shifts, fromCache) {
            const container = document.getElementById('shift-container-' + vehicleUid);
            if (!container || !shifts || shifts.length === 0) {
                container.innerHTML = '<div class="no-data">Нет данных по сменам</div>';
                container.style.display = 'block';
                return;
            }

            // Build tabs for shifts
            let tabsHtml = '<div class="shift-tabs">';
            let contentHtml = '';

            shifts.forEach((shift, idx) => {
                const activeClass = idx === 0 ? ' active' : '';
                const label = shift.label || shift.key;

                tabsHtml += '<button class="shift-tab' + activeClass + '" onclick="switchShift(\\'' + vehicleUid + '\\', ' + idx + ')">' + label + '</button>';

                // Format shift data
                const d = shift.data || {};
                const distance = (d.mon_distance || 0).toFixed(1);
                const movingHours = (d.mon_moving_time_hours || 0).toFixed(1);
                const engineHours = (d.mon_engine_time_hours || 0).toFixed(1);
                const idlingHours = (d.mon_idling_time_hours || 0).toFixed(1);
                const fuelRate = (d.mon_fuel_rate || 0).toFixed(1);

                contentHtml += '<div class="shift-content' + activeClass + '">';
                contentHtml += '<div class="shift-period">' + (shift.from || '') + ' — ' + (shift.to || '') + '</div>';
                contentHtml += '<div class="shift-grid">';

                if (parseFloat(distance) > 0) {
                    contentHtml += '<div class="shift-item"><div class="label">Пробег</div><div class="value">' + distance + ' км</div></div>';
                }
                if (parseFloat(movingHours) > 0) {
                    contentHtml += '<div class="shift-item"><div class="label">В движении</div><div class="value">' + movingHours + ' ч</div></div>';
                }
                if (parseFloat(engineHours) > 0) {
                    contentHtml += '<div class="shift-item"><div class="label">Двигатель</div><div class="value">' + engineHours + ' ч</div></div>';
                }
                if (parseFloat(idlingHours) > 0) {
                    contentHtml += '<div class="shift-item"><div class="label">Простой</div><div class="value">' + idlingHours + ' ч</div></div>';
                }
                if (parseFloat(fuelRate) > 0) {
                    contentHtml += '<div class="shift-item"><div class="label">Расход топлива</div><div class="value">' + fuelRate + ' л</div></div>';
                }

                contentHtml += '</div></div>';
            });

            tabsHtml += '</div>';

            const cacheNote = fromCache ? '<div class="cache-note">Загружено из кэша</div>' : '';
            container.innerHTML = cacheNote + tabsHtml + '<div class="shift-contents">' + contentHtml + '</div>';
            container.style.display = 'block';
        }

        function switchShift(vehicleUid, shiftIdx) {
            const container = document.getElementById('shift-container-' + vehicleUid);
            if (!container) return;

            // Update tabs
            container.querySelectorAll('.shift-tab').forEach((tab, idx) => {
                tab.classList.toggle('active', idx === shiftIdx);
            });

            // Update content
            container.querySelectorAll('.shift-content').forEach((content, idx) => {
                content.classList.toggle('active', idx === shiftIdx);
            });
        }
    </script>
</body>
</html>
"""
    return html


def _build_request_html(req_num: str, req_data: Dict) -> str:
    """Build HTML for a single request."""
    status = req_data.get('request_status', '—')
    date_processed = req_data.get('request_date_processed', '—')
    start_addr = req_data.get('route_start_address', '—')
    end_addr = req_data.get('route_end_address', '—')
    start_date = req_data.get('route_start_date', '')
    end_date = req_data.get('route_end_date', '')
    time_zone_tag = req_data.get('route_time_zone_tag', '')

    # Plan data
    cargo_name = req_data.get('order_name_cargo', '')
    cargo_weight = req_data.get('order_weight_cargo', '')
    cargo_volume = req_data.get('order_volume_cargo', '')
    count_ts = req_data.get('order_count_ts', '')
    cnt_trip = req_data.get('order_cnt_trip', '')
    route_distance = req_data.get('route_distance', '')
    route_time = req_data.get('route_time', '')
    object_expend = req_data.get('object_expend_name', '')

    # Map data - handle NaN values
    import math
    route_polyline = req_data.get('route_polyline', '')
    if route_polyline is None or (isinstance(route_polyline, float) and math.isnan(route_polyline)):
        route_polyline = ''
    else:
        route_polyline = str(route_polyline)

    route_points_json = req_data.get('route_points_json', '')
    if route_points_json is None or (isinstance(route_points_json, float) and math.isnan(route_points_json)):
        route_points_json = '[]'
    else:
        route_points_json = str(route_points_json)

    pl_list = req_data.get('pl_list', [])
    pl_count = len(pl_list)

    # Search data: include request number, all PL numbers, all vehicle reg numbers
    search_parts = [str(req_num)]
    for pl in pl_list:
        search_parts.append(_format_pl_number(pl.get('pl_id', '')))
        for v in pl.get('vehicles', []):
            search_parts.append(str(v.get('ts_reg_number', '')))
            search_parts.append(str(v.get('ts_name_mo', '')))
    search_data = ' '.join(search_parts)

    status_badge = 'badge-success' if 'COMPLETED' in status else 'badge-info'

    # Escape quotes in addresses for data attributes
    def safe_str(val):
        import math
        if val is None or val == '':
            return ''
        if isinstance(val, float) and math.isnan(val):
            return ''
        return str(val)

    start_addr_escaped = safe_str(start_addr).replace('"', '&quot;')
    end_addr_escaped = safe_str(end_addr).replace('"', '&quot;')
    object_expend_escaped = safe_str(object_expend).replace('"', '&quot;')

    tz_tag_html = f'<span class="timezone-tag">{time_zone_tag}</span>' if time_zone_tag else ''

    # Escape for JS string
    start_addr_js = safe_str(start_addr).replace("'", "\\'").replace('"', '\\"')
    end_addr_js = safe_str(end_addr).replace("'", "\\'").replace('"', '\\"')
    start_date_js = (start_date or '').replace("'", "\\'")

    html = f"""
        <div class="request" data-search="{search_data}" data-date="{start_date}" data-number="{req_num}" data-start-addr="{start_addr_escaped}" data-end-addr="{end_addr_escaped}" data-cost-obj="{object_expend_escaped}">
            <div class="request-header" onclick="var body = this.nextElementSibling; var arrow = this.querySelector('.expand-arrow'); body.style.display = body.style.display === 'none' ? 'block' : 'none'; arrow.classList.toggle('up');">
                <div>
                    <div class="request-title">
                        <span class="expand-arrow down">▼</span>
                        <span class="copyable" onclick="event.stopPropagation(); copyToClipboard('{req_num}', this.querySelector('.copy-btn'));">
                            Заявка №{req_num}
                            <button class="copy-btn" title="Копировать номер заявки">📋</button>
                        </span>
                        {tz_tag_html}
                        <button class="archive-btn" onclick="toggleArchive(event, '{req_num}', '{start_addr_js}', '{end_addr_js}', '{start_date_js}', {pl_count})" title="Добавить в архив просмотренных">★ В архив</button>
                    </div>
                    <div class="request-route">{start_addr} → {end_addr}</div>
                </div>
                <div class="request-badges">
                    <span class="badge badge-info">{start_date or '—'}</span>
                    <span class="badge {status_badge}">ПЛ: {pl_count}</span>
                </div>
            </div>
            <div class="request-body">
                <div class="plan-section">
                    <div class="section-title">План</div>
                    <div class="plan-grid">
                        <div class="plan-item">
                            <div class="label">Дата начала</div>
                            <div class="value">{start_date or '—'}</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Дата окончания</div>
                            <div class="value">{end_date or '—'}</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Расстояние</div>
                            <div class="value">{_format_distance_km(route_distance)} км</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Время в пути</div>
                            <div class="value">{_format_time(route_time)}</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Кол-во ТС</div>
                            <div class="value">{_format_int(count_ts)}</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Кол-во ездок</div>
                            <div class="value">{_format_int(cnt_trip)}</div>
                        </div>
                        <div class="plan-item">
                            <div class="label">Объект затрат</div>
                            <div class="value">{object_expend or '—'}</div>
                        </div>
"""

    if cargo_name:
        html += f"""                        <div class="plan-item">
                            <div class="label">Груз</div>
                            <div class="value">{cargo_name}</div>
                        </div>
"""
    if cargo_weight:
        html += f"""                        <div class="plan-item">
                            <div class="label">Вес груза</div>
                            <div class="value">{cargo_weight} т</div>
                        </div>
"""
    if cargo_volume:
        html += f"""                        <div class="plan-item">
                            <div class="label">Объем груза</div>
                            <div class="value">{cargo_volume} м³</div>
                        </div>
"""

    html += """                    </div>
"""

    # Collect structured vehicles data for map
    vehicles_data = []
    for pl in pl_list:
        pl_id = pl.get('pl_id', '')
        for v in pl.get('vehicles', []):
            v_track = v.get('mon_track', [])
            v_parkings = v.get('mon_parkings', [])
            if v_track or v_parkings:
                vehicles_data.append({
                    'pl_id': pl_id,
                    'pl_number': _format_pl_number(pl_id),
                    'ts_reg_number': v.get('ts_reg_number', ''),
                    'track': v_track,
                    'parkings': v_parkings
                })

    vehicles_json = json.dumps(vehicles_data, ensure_ascii=False) if vehicles_data else '[]'

    # Escape for HTML attributes
    polyline_escaped = route_polyline.replace('"', '&quot;').replace("'", "&#39;")
    route_points_escaped = route_points_json.replace('"', '&quot;').replace("'", "&#39;")
    vehicles_escaped = vehicles_json.replace('"', '&quot;').replace("'", "&#39;")

    # Map button and container
    html += f"""
                    <button class="map-toggle-btn" id="map-btn-{req_num}" onclick="toggleMap('{req_num}')">
                        🗺️ Показать карту
                    </button>

                    <div class="map-display-params" id="map-params-{req_num}">
                        <div class="params-title">Параметры отображения</div>
                        <div class="filter-group">
                            <div class="filter-label">Машины:</div>
                            <div class="vehicle-checkboxes" id="vehicle-filters-{req_num}"></div>
                        </div>
                        <div class="filter-group">
                            <div class="filter-label">Стоянки:</div>
                            <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
                                <input type="checkbox" id="show-parkings-{req_num}" checked onchange="toggleParkings('{req_num}')">
                                <span>Отображать</span>
                            </label>
                            <span style="font-size:12px;color:#718096;">Мин. время (мин):</span>
                            <input type="number" id="min-parking-{req_num}" value="0" min="0" style="width:60px;" onchange="updateMapFilters('{req_num}')">
                        </div>
                        <div class="filter-group">
                            <div class="filter-label">Временной промежуток:</div>
                            <div style="display:flex;gap:8px;align-items:center;flex:1;flex-wrap:wrap;">
                                <div style="display:flex;gap:6px;align-items:center;background:white;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;">
                                    <span style="font-size:11px;color:#718096;font-weight:500;">От:</span>
                                    <input type="date" id="start-date-{req_num}" style="font-size:11px;padding:4px;border:1px solid #cbd5e0;border-radius:4px;">
                                    <input type="time" id="start-time-{req_num}" value="00:00" style="font-size:11px;padding:4px;border:1px solid #cbd5e0;border-radius:4px;">
                                </div>
                                <div style="display:flex;gap:6px;align-items:center;background:white;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;">
                                    <span style="font-size:11px;color:#718096;font-weight:500;">До:</span>
                                    <input type="date" id="end-date-{req_num}" style="font-size:11px;padding:4px;border:1px solid #cbd5e0;border-radius:4px;">
                                    <input type="time" id="end-time-{req_num}" value="23:59" style="font-size:11px;padding:4px;border:1px solid #cbd5e0;border-radius:4px;">
                                </div>
                                <button onclick="applyTimeFilter('{req_num}')" style="font-size:11px;padding:6px 16px;background:#3182ce;color:white;border:none;border-radius:4px;cursor:pointer;">Применить</button>
                                <button onclick="clearTimeFilter('{req_num}')" style="font-size:11px;padding:6px 16px;background:#718096;color:white;border:none;border-radius:4px;cursor:pointer;">Сбросить</button>
                            </div>
                        </div>
                    </div>

                    <div id="map-{req_num}" class="map-container">
                        <div class="map-data"
                             data-polyline="{polyline_escaped}"
                             data-route-points="{route_points_escaped}"
                             data-vehicles="{vehicles_escaped}">
                        </div>
                        <div class="map-layout">
                            <div class="map-area">
                                <div class="leaflet-map"></div>
                            </div>
                            <div class="timeline-area" id="timeline-{req_num}">
                                <div class="timeline-title">Таймлайн</div>
                                <div class="timeline-items"></div>
                            </div>
                        </div>
                    </div>
                </div>
"""

    # Расчетный план калькулятор
    # Prepare default values for calculator
    calc_ts = _safe_float(count_ts) if _safe_float(count_ts) > 0 else 1
    calc_trips = _safe_float(cnt_trip) if _safe_float(cnt_trip) > 0 else 1
    calc_distance_m = _safe_float(route_distance)
    calc_distance_km = calc_distance_m / 1000 if calc_distance_m > 0 else 0

    # Parse start date for default value
    start_date_val = ''
    start_time_val = '06:00'
    if start_date:
        parts = str(start_date).split(' ')
        if parts:
            start_date_val = parts[0]
        if len(parts) > 1:
            start_time_val = parts[1][:5] if len(parts[1]) >= 5 else parts[1]

    html += f"""
                <div class="calc-plan-section">
                    <div class="calc-plan-header" onclick="toggleCalcPlan('{req_num}')">
                        <div class="calc-plan-title">Расчетный план</div>
                        <span class="calc-plan-toggle" id="calc-toggle-{req_num}">▼ развернуть</span>
                    </div>
                    <div class="calc-plan-body" id="calc-body-{req_num}">
                        <div class="calc-plan-grid">
                            <div class="calc-input-group">
                                <label>Кол-во ТС</label>
                                <input type="number" id="calc-ts-{req_num}" value="{int(calc_ts)}" min="1" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Кол-во ездок</label>
                                <input type="number" id="calc-trips-{req_num}" value="{int(calc_trips)}" min="1" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Расстояние (км, в 1 сторону)</label>
                                <input type="number" id="calc-dist-{req_num}" value="{calc_distance_km:.0f}" min="1" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Скорость (км/ч)</label>
                                <input type="number" id="calc-speed-{req_num}" value="65" min="10" max="120" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Раб. часов в день</label>
                                <input type="number" id="calc-hours-{req_num}" value="11" min="1" max="24" step="0.5" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Время погрузки (ч)</label>
                                <input type="number" id="calc-load-{req_num}" value="1.5" min="0" max="10" step="0.5" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Дата начала</label>
                                <input type="text" id="calc-start-date-{req_num}" value="{start_date_val}" placeholder="ДД.ММ.ГГГГ" onchange="updateCalcPlan('{req_num}')">
                            </div>
                            <div class="calc-input-group">
                                <label>Время начала</label>
                                <input type="text" id="calc-start-time-{req_num}" value="{start_time_val}" placeholder="ЧЧ:ММ" onchange="updateCalcPlan('{req_num}')">
                            </div>
                        </div>
                        <div class="calc-results">
                            <div class="calc-results-title">Результат расчёта</div>
                            <div class="calc-result-grid">
                                <div>
                                    <div class="calc-result-item">
                                        <span class="label">Рейсов на 1 ТС:</span>
                                        <span class="value" id="calc-res-trips-per-ts-{req_num}">—</span>
                                    </div>
                                    <div class="calc-result-item">
                                        <span class="label">Расстояние рейса (туда-обратно):</span>
                                        <span class="value" id="calc-res-round-dist-{req_num}">—</span>
                                    </div>
                                    <div class="calc-result-item">
                                        <span class="label">Время рейса:</span>
                                        <span class="value" id="calc-res-trip-time-{req_num}">—</span>
                                    </div>
                                </div>
                                <div>
                                    <div class="calc-result-item">
                                        <span class="label">Рейсов в день:</span>
                                        <span class="value" id="calc-res-trips-per-day-{req_num}">—</span>
                                    </div>
                                    <div class="calc-result-item">
                                        <span class="label">Дней на выполнение:</span>
                                        <span class="value" id="calc-res-days-{req_num}">—</span>
                                    </div>
                                    <div class="calc-result-item highlight">
                                        <span class="label">Завершение:</span>
                                        <span class="value" id="calc-res-end-date-{req_num}">—</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
"""

    if not pl_list:
        html += '                <div class="no-data">Нет связанных путевых листов</div>\n'
    else:
        for idx, pl in enumerate(pl_list):
            html += _build_pl_html(pl, f"{req_num}_{idx}")

    html += """            </div>
        </div>
"""
    return html


def _build_pl_html(pl_data: Dict, pl_uid: str) -> str:
    """Build HTML for a route list."""
    pl_id = pl_data.get('pl_id', '—')
    pl_number = _format_pl_number(pl_id)
    date_out = pl_data.get('pl_date_out', '—')
    date_out_plan = pl_data.get('pl_date_out_plan', '')
    date_in_plan = pl_data.get('pl_date_in_plan', '')
    status = pl_data.get('pl_status', '—')

    vehicles = pl_data.get('vehicles', [])

    html = f"""
                <div class="pl-card">
                    <div class="pl-header" onclick="togglePL('{pl_uid}'); var arrow = this.querySelector('.expand-arrow'); arrow.classList.toggle('up');">
                        <div>
                            <span class="expand-arrow down">▼</span>
                            <span class="pl-number copyable" onclick="event.stopPropagation(); copyToClipboard('{pl_number}', this.querySelector('.copy-btn'));">
                                ПЛ №{pl_number}
                                <button class="copy-btn" title="Копировать номер ПЛ">📋</button>
                            </span>
                            <span class="pl-meta"> — {date_out}</span>
                        </div>
                        <span class="pl-meta">{status} | ТС: {len(vehicles)}</span>
                    </div>
                    <div class="pl-body" id="pl-body-{pl_uid}">
                        <div style="font-size: 13px; color: #718096; margin-bottom: 12px;">
                            План: {date_out_plan or '—'} → {date_in_plan or '—'}
                        </div>
"""

    if not vehicles:
        html += '                        <div class="no-data">Нет транспортных средств</div>\n'
    else:
        for v_idx, vehicle in enumerate(vehicles):
            vehicle_uid = f"{pl_uid}_v{v_idx}"
            html += _build_vehicle_html(
                vehicle,
                vehicle_uid,
                pl_id=pl_id,
                from_date=date_out_plan,
                to_date=date_in_plan
            )

    html += """                    </div>
                </div>
"""
    return html


def _build_vehicle_html(vehicle: Dict, vehicle_uid: str = "", pl_id: str = "", from_date: str = "", to_date: str = "") -> str:
    """Build HTML for a vehicle with monitoring (Fact section)."""
    reg_number = vehicle.get('ts_reg_number', '—')
    name = vehicle.get('ts_name_mo', '—')

    # Monitoring data
    distance = vehicle.get('mon_distance')
    engine_hours = vehicle.get('mon_engine_time_hours')
    moving_hours = vehicle.get('mon_moving_time_hours')
    idling_hours = vehicle.get('mon_idling_time_hours')
    fuel_rate = vehicle.get('mon_fuel_rate')
    parkings_count = vehicle.get('mon_parkings_count', 0)
    parkings_total = vehicle.get('mon_parkings_total_hours', 0)

    # Arrays
    parkings = vehicle.get('mon_parkings', [])
    fuels = vehicle.get('mon_fuels', [])

    html = f"""
                        <div class="vehicle-card">
                            <div class="vehicle-header">
                                <span class="vehicle-reg copyable" onclick="copyToClipboard('{reg_number}', this.querySelector('.copy-btn'));">
                                    {reg_number}
                                    <button class="copy-btn" title="Копировать номер машины">📋</button>
                                </span>
                                <span class="vehicle-name"> — {name}</span>
                            </div>
                            <div class="fact-section">
                                <div class="fact-title">Факт (мониторинг)</div>
"""

    # Check for valid monitoring data (not None and not NaN)
    has_monitoring = _safe_float(distance) > 0 or _safe_float(engine_hours) > 0

    if has_monitoring:
        html += """                                <div class="fact-grid">
"""
        if _safe_float(distance) > 0:
            html += f'                                    <div class="fact-item"><div class="label">Пробег</div><div class="value">{_safe_float(distance):.1f} км</div></div>\n'
        if _safe_float(moving_hours) > 0:
            html += f'                                    <div class="fact-item"><div class="label">В движении</div><div class="value">{_safe_float(moving_hours):.1f} ч</div></div>\n'
        if _safe_float(engine_hours) > 0:
            html += f'                                    <div class="fact-item"><div class="label">Двигатель</div><div class="value">{_safe_float(engine_hours):.1f} ч</div></div>\n'
        if _safe_float(idling_hours) > 0:
            html += f'                                    <div class="fact-item"><div class="label">Простой</div><div class="value">{_safe_float(idling_hours):.1f} ч</div></div>\n'
        if _safe_float(fuel_rate) > 0:
            html += f'                                    <div class="fact-item"><div class="label">Расход топлива</div><div class="value">{_safe_float(fuel_rate):.1f} л</div></div>\n'
        if parkings_count:
            html += f'                                    <div class="fact-item"><div class="label">Стоянок</div><div class="value">{parkings_count} ({_safe_float(parkings_total):.1f} ч)</div></div>\n'
        html += """                                </div>
"""
    else:
        html += '                                <div class="no-data">Нет данных мониторинга</div>\n'

    # Fuels details
    if fuels:
        html += """                                <div class="fuels-section">
                                    <div class="fuels-title">⛽ Топливо</div>
"""
        for fuel in fuels:
            html += f"""                                    <div class="fuel-item">
                                        <div class="fuel-stat"><div class="label">Тип</div><div class="value">{fuel.get('name', '—')}</div></div>
                                        <div class="fuel-stat"><div class="label">Заправки</div><div class="value">{_safe_float(fuel.get('charges')):.1f} л</div></div>
                                        <div class="fuel-stat"><div class="label">Сливы</div><div class="value">{_safe_float(fuel.get('discharges')):.1f} л</div></div>
                                        <div class="fuel-stat"><div class="label">Расход</div><div class="value">{_safe_float(fuel.get('rate')):.1f} л</div></div>
                                        <div class="fuel-stat"><div class="label">Начало</div><div class="value">{_safe_float(fuel.get('value_begin')):.1f} л</div></div>
                                        <div class="fuel-stat"><div class="label">Конец</div><div class="value">{_safe_float(fuel.get('value_end')):.1f} л</div></div>
                                    </div>
"""
        html += """                                </div>
"""

    # Parkings details - grouped by day with navigation
    if parkings:
        # Group parkings by day
        parkings_by_day = {}
        for p in parkings:
            begin_str = p.get('begin', '')
            if begin_str:
                date_part = _extract_date(begin_str)
                if date_part not in parkings_by_day:
                    parkings_by_day[date_part] = []
                parkings_by_day[date_part].append(p)

        # Sort days (oldest first)
        sorted_days = sorted(parkings_by_day.keys(), key=_parse_date_for_sort)
        num_days = len(sorted_days)

        html += """                                <div class="parkings-section">
                                    <div class="parkings-title">🅿️ Стоянки</div>
"""

        # Day navigation (only if more than 1 day)
        if num_days > 1:
            html += f"""                                    <div class="day-nav" id="day-nav-{vehicle_uid}">
"""
            for idx, day in enumerate(sorted_days):
                day_parkings = parkings_by_day[day]
                day_total_min = sum(p.get('duration_min') or 0 for p in day_parkings)
                day_total_str = _format_duration_minutes(day_total_min)
                active_class = ' active' if idx == 0 else ''
                html += f"""                                        <button class="day-nav-btn{active_class}" onclick="switchDay('{vehicle_uid}', {idx})">
                                            📅 {day}
                                            <span class="day-stats">({len(day_parkings)} ст., {day_total_str})</span>
                                        </button>
"""
            html += """                                    </div>
"""

        # Day content containers
        html += f"""                                    <div id="day-container-{vehicle_uid}">
"""
        for idx, day in enumerate(sorted_days):
            day_parkings = parkings_by_day[day]
            active_class = ' active' if idx == 0 or num_days == 1 else ''

            # Calculate day summary
            day_total_min = sum(p.get('duration_min') or 0 for p in day_parkings)

            html += f"""                                        <div class="day-content{active_class}">
"""
            # Day summary (if multiple days)
            if num_days > 1:
                html += f"""                                            <div class="day-summary">
                                                <div class="day-summary-title">📅 {day}</div>
                                                <div class="day-summary-grid">
                                                    <div class="day-summary-item">
                                                        <div class="label">Стоянок</div>
                                                        <div class="value">{len(day_parkings)}</div>
                                                    </div>
                                                    <div class="day-summary-item">
                                                        <div class="label">Общее время</div>
                                                        <div class="value">{_format_duration_minutes(day_total_min)}</div>
                                                    </div>
                                                </div>
                                            </div>
"""

            html += f"""                                            <div class="parking-day-group">
                                                <div class="parking-day-items" style="border-radius: 4px;">
"""
            for p in day_parkings:
                duration = p.get('duration_min') or 0
                dur_str = _format_duration_minutes(duration)
                begin_time = _extract_time(p.get('begin', ''))
                end_time = _extract_time(p.get('end', ''))
                address = p.get('address', '—')
                html += f"""                                                    <div class="parking-item" data-duration="{int(duration)}">
                                                        <div class="parking-time">{begin_time} → {end_time} ({dur_str})</div>
                                                        <div class="parking-address">{address}</div>
                                                    </div>
"""
            html += """                                                </div>
                                            </div>
                                        </div>
"""
        html += """                                    </div>
                                </div>
"""

    # Shift loading button and container
    ts_id_mo = vehicle.get('ts_id_mo', '')
    if ts_id_mo and from_date and to_date:
        # Escape values for JS
        pl_id_js = pl_id.replace("'", "\\'") if pl_id else ''
        from_date_js = from_date.replace("'", "\\'") if from_date else ''
        to_date_js = to_date.replace("'", "\\'") if to_date else ''

        html += f"""
                                <button class="shift-load-btn" id="shift-btn-{vehicle_uid}"
                                        onclick="loadShifts('{vehicle_uid}', '{pl_id_js}', {ts_id_mo}, '{from_date_js}', '{to_date_js}')">
                                    📊 Загрузить по сменам
                                </button>
                                <div class="shift-container" id="shift-container-{vehicle_uid}"></div>
"""

    html += """                            </div>
                        </div>
"""
    return html


def _format_int(val) -> str:
    """Format integer value, handling NaN."""
    if val is None or val == '':
        return '—'
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return '—'
        return str(int(val))
    except (ValueError, TypeError):
        return '—'


def _format_number(val) -> str:
    """Format number with thousands separator."""
    if val is None or val == '':
        return '—'
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return '—'
        return f"{float(val):,.0f}".replace(',', ' ')
    except (ValueError, TypeError):
        return str(val)


def _format_distance_km(meters) -> str:
    """Convert meters to kilometers and format."""
    if meters is None or meters == '':
        return '—'
    try:
        import math
        if isinstance(meters, float) and math.isnan(meters):
            return '—'
        km = float(meters) / 1000
        if km >= 1:
            return f"{km:,.1f}".replace(',', ' ')
        else:
            return f"{km:.2f}"
    except (ValueError, TypeError):
        return '—'


def _format_time(milliseconds) -> str:
    """Format milliseconds to HH:MM format."""
    if milliseconds is None or milliseconds == '':
        return '—'
    try:
        import math
        if isinstance(milliseconds, float) and math.isnan(milliseconds):
            return '—'
        total_seconds = int(float(milliseconds) / 1000)  # Convert ms to seconds
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        return f"{hours}ч {minutes}м"
    except (ValueError, TypeError):
        return '—'


def _safe_float(val, default=0) -> float:
    """Safely convert value to float, handling NaN."""
    if val is None or val == '':
        return default
    try:
        import math
        f = float(val)
        if math.isnan(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def _extract_date(datetime_str: str) -> str:
    """Extract date part from datetime string (DD.MM.YYYY)."""
    if not datetime_str:
        return '—'
    # Try common formats
    datetime_str = str(datetime_str).strip()
    # Format: DD.MM.YYYY HH:MM:SS
    if ' ' in datetime_str:
        date_part = datetime_str.split(' ')[0]
        return date_part
    return datetime_str


def _parse_date_for_sort(date_str: str) -> tuple:
    """Parse DD.MM.YYYY to sortable tuple (YYYY, MM, DD)."""
    try:
        parts = date_str.split('.')
        if len(parts) == 3:
            return (int(parts[2]), int(parts[1]), int(parts[0]))
    except (ValueError, AttributeError):
        pass
    return (0, 0, 0)


def _extract_time(datetime_str: str) -> str:
    """Extract time part from datetime string (HH:MM)."""
    if not datetime_str:
        return '—'
    datetime_str = str(datetime_str).strip()
    # Format: DD.MM.YYYY HH:MM:SS or DD.MM.YYYY HH:MM
    if ' ' in datetime_str:
        time_part = datetime_str.split(' ')[1]
        # Return only HH:MM (first 5 characters)
        if len(time_part) >= 5:
            return time_part[:5]
        return time_part
    return '—'


def _format_duration_minutes(minutes) -> str:
    """Format duration in minutes to human-readable format."""
    if minutes is None:
        return '—'
    try:
        mins = int(float(minutes))
        if mins >= 60:
            hours = mins // 60
            remaining_mins = mins % 60
            if remaining_mins > 0:
                return f"{hours}ч {remaining_mins}м"
            return f"{hours}ч"
        return f"{mins} мин"
    except (ValueError, TypeError):
        return '—'


def build_hierarchy(
    matched_data: List[Dict],
    unmatched_requests: List[Dict] = None
) -> Dict[str, Any]:
    """
    Build hierarchical structure from flat matched data.

    Args:
        matched_data: List of matched records (Request + PL + Vehicle + Monitoring)
        unmatched_requests: Optional list of requests without PL (ignored now)

    Returns:
        Nested dictionary structure for HTML generation
    """
    hierarchy = {}

    # Process matched data
    for row in matched_data:
        req_num = str(row.get('request_number', 'unknown'))

        # Initialize request if new
        if req_num not in hierarchy:
            hierarchy[req_num] = {
                'request_number': req_num,
                'request_status': row.get('request_status'),
                'request_date_processed': row.get('request_date_processed'),
                'route_start_address': row.get('route_start_address'),
                'route_end_address': row.get('route_end_address'),
                'route_start_date': row.get('route_start_date'),
                'route_end_date': row.get('route_end_date'),
                'route_time_zone_tag': row.get('route_time_zone_tag'),
                # Plan fields
                'order_name_cargo': row.get('order_name_cargo'),
                'order_weight_cargo': row.get('order_weight_cargo'),
                'order_volume_cargo': row.get('order_volume_cargo'),
                'order_count_ts': row.get('order_count_ts'),
                'order_cnt_trip': row.get('order_cnt_trip'),
                'route_distance': row.get('route_distance'),
                'route_time': row.get('route_time'),
                'object_expend_name': row.get('object_expend_name'),
                # Map data
                'route_polyline': row.get('route_polyline'),
                'route_points_json': row.get('route_points_json'),
                'pl_list': []
            }

        # Find or create PL
        pl_id = row.get('pl_id')
        pl_list = hierarchy[req_num]['pl_list']

        pl_entry = None
        for pl in pl_list:
            if pl.get('pl_id') == pl_id:
                pl_entry = pl
                break

        if pl_entry is None:
            pl_entry = {
                'pl_id': pl_id,
                'pl_date_out': row.get('pl_date_out'),
                'pl_date_out_plan': row.get('pl_date_out_plan'),
                'pl_date_in_plan': row.get('pl_date_in_plan'),
                'pl_status': row.get('pl_status'),
                'vehicles': []
            }
            pl_list.append(pl_entry)

        # Add vehicle with monitoring
        vehicle = {
            'ts_id_mo': row.get('ts_id_mo'),
            'ts_reg_number': row.get('ts_reg_number'),
            'ts_name_mo': row.get('ts_name_mo'),
        }

        # Add monitoring fields
        for key, value in row.items():
            if key.startswith('mon_'):
                vehicle[key] = value

        pl_entry['vehicles'].append(vehicle)

    return hierarchy
