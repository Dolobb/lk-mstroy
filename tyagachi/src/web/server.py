"""
FastAPI Web Server for TransportAnalytics.

Provides:
- Web interface for fetching data
- Archive functionality
- Report viewing
"""

import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
import json
import threading

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .models import Database, Report, ShiftCache
from .shifts import ShiftMonitoringFetcher, split_period_into_shifts_str
from .sync import sync_vehicle_data

# Configure logging
logger = logging.getLogger('web_server')

# Base paths
BASE_DIR = Path(__file__).parent.parent.parent
DATA_DIR = BASE_DIR / 'Data'
FINAL_DIR = DATA_DIR / 'final'
HISTORY_DIR = DATA_DIR / 'history'
TEMPLATES_DIR = BASE_DIR / 'templates'

# Ensure history directory exists
HISTORY_DIR.mkdir(parents=True, exist_ok=True)

# Initialize database
db = Database()

# FastAPI app
app = FastAPI(
    title="TransportAnalytics",
    description="Web interface for transport requests and route lists",
    version="1.0.0"
)


# ============================================================
# Pydantic models for API
# ============================================================

class FetchRequest(BaseModel):
    """Request to fetch data from API."""
    from_requests: str  # DD.MM.YYYY
    to_requests: str
    from_pl: str
    to_pl: str
    use_legacy_pl_method: Optional[bool] = False


class ArchiveRequest(BaseModel):
    """Request to archive a request."""
    request_number: str
    notes: Optional[str] = None
    route_start_address: Optional[str] = None
    route_end_address: Optional[str] = None
    route_start_date: Optional[str] = None
    pl_count: Optional[int] = None


class UnarchiveRequest(BaseModel):
    """Request to remove from archive."""
    request_number: str


class CreateReportRequest(BaseModel):
    """Request to create a new report."""
    from_requests: str  # DD.MM.YYYY
    to_requests: str
    from_pl: str
    to_pl: str
    title: Optional[str] = None
    use_legacy_pl_method: Optional[bool] = False


class SaveReportStateRequest(BaseModel):
    """Request to save report state (viewed requests and shift cache)."""
    viewed_requests: Optional[list] = None
    shift_caches: Optional[list] = None  # List of {pl_id, ts_id_mo, shift_key, monitoring_data}


class LoadShiftsRequest(BaseModel):
    """Request to load shift data for a vehicle."""
    pl_id: str
    ts_id_mo: int
    from_date: str  # DD.MM.YYYY HH:MM
    to_date: str


class SyncRequest(BaseModel):
    """Request to start vehicle data sync."""
    period_days: int = 14  # 1, 3, 7, or 14


# ============================================================
# Global state for fetch status
# ============================================================

fetch_status = {
    'running': False,
    'progress': '',
    'error': None,
    'completed_at': None,
    'stats': None
}
fetch_lock = threading.Lock()

sync_status = {
    'running': False,
    'progress': '',
    'error': None,
    'completed_at': None,
    'stats': None
}
sync_lock = threading.Lock()


# ============================================================
# Routes
# ============================================================

import re


def normalize_vehicle_type(ts_name_mo: str) -> str:
    """Strip prefix 'С/тягач' / 'седельный тягач' and return the rest as-is."""
    if not ts_name_mo:
        return 'Прочие'
    s = ts_name_mo.strip()
    s = re.sub(r'^[Сс]/[Тт]ягач\s*', '', s)
    s = re.sub(r'^[Сс]едельный\s+тягач\s*', '', s, flags=re.IGNORECASE)
    s = s.strip()
    return s if s else 'Прочие'


# HTML template for main page
_INDEX_TEMPLATE = '''<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TransportAnalytics</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; background: #f0f2f5; color: #1a1a1a; min-height: 100vh; }}
        .header {{ background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%); color: white; padding: 30px 20px; text-align: center; }}
        .header h1 {{ font-size: 28px; font-weight: 600; margin-bottom: 8px; }}
        .header p {{ opacity: 0.8; font-size: 14px; }}
        .container {{ max-width: 1400px; margin: 0 auto; padding: 30px 20px; }}
        .card {{ background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 24px; }}
        .card-title {{ font-size: 18px; font-weight: 600; color: #2d3748; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }}
        .two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
        @media (max-width: 1000px) {{ .two-col {{ grid-template-columns: 1fr; }} }}
        .form-row {{ display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }}
        .form-group {{ flex: 1; min-width: 140px; }}
        .form-group label {{ display: block; font-size: 13px; color: #4a5568; margin-bottom: 6px; font-weight: 500; }}
        .form-group input {{ width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px; }}
        .form-group input:focus {{ outline: none; border-color: #4299e1; box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.15); }}
        .form-section-title {{ font-size: 13px; font-weight: 600; color: #718096; margin-bottom: 12px; text-transform: uppercase; }}
        .btn {{ padding: 12px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }}
        .btn-primary {{ background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%); color: white; }}
        .btn-primary:hover {{ transform: translateY(-1px); box-shadow: 0 4px 12px rgba(66, 153, 225, 0.3); }}
        .btn-primary:disabled {{ opacity: 0.6; cursor: not-allowed; transform: none; }}
        .btn-secondary {{ background: #edf2f7; color: #4a5568; }}
        .btn-sm {{ padding: 8px 16px; font-size: 13px; }}
        .btn-danger {{ background: #fed7d7; color: #c53030; }}
        .btn-danger:hover {{ background: #feb2b2; }}
        .btn-success {{ background: #c6f6d5; color: #22543d; }}
        .btn-success:hover {{ background: #9ae6b4; }}
        .status-panel {{ background: #f7fafc; border-radius: 8px; padding: 16px; margin-top: 16px; display: none; }}
        .status-panel.active {{ display: block; }}
        .status-text {{ display: flex; align-items: center; gap: 10px; font-size: 14px; color: #4a5568; }}
        .spinner {{ width: 18px; height: 18px; border: 2px solid #e2e8f0; border-top-color: #4299e1; border-radius: 50%; animation: spin 0.8s linear infinite; }}
        @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
        .report-item {{ background: #f7fafc; border-radius: 8px; padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; transition: background 0.2s; }}
        .report-item:hover {{ background: #edf2f7; }}
        .report-item-info {{ flex: 1; min-width: 200px; }}
        .report-item-title {{ font-size: 16px; font-weight: 600; color: #2d3748; margin-bottom: 4px; }}
        .report-item-meta {{ font-size: 13px; color: #718096; }}
        .report-item-actions {{ display: flex; gap: 8px; }}
        .empty-state {{ text-align: center; padding: 40px; color: #a0aec0; }}
        .footer {{ text-align: center; padding: 20px; color: #a0aec0; font-size: 12px; }}

        /* Sync panel */
        .sync-bar {{ display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
        .sync-bar .period-btns {{ display: flex; gap: 6px; }}
        .period-btn {{ padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; cursor: pointer; background: white; color: #4a5568; transition: all 0.15s; }}
        .period-btn:hover {{ border-color: #4299e1; color: #3182ce; }}
        .period-btn.active {{ background: #4299e1; color: white; border-color: #4299e1; }}
        .sync-summary {{ font-size: 13px; color: #718096; margin-top: 12px; }}
        .sync-summary span {{ font-weight: 600; color: #2d3748; }}

        /* Vehicle cards */
        .vehicle-card {{ background: #f7fafc; border-radius: 10px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #4299e1; transition: background 0.2s; }}
        .vehicle-card:hover {{ background: #edf2f7; }}
        .vehicle-header {{ display: flex; justify-content: space-between; align-items: center; cursor: pointer; }}
        .vehicle-name {{ font-weight: 600; color: #2d3748; font-size: 15px; }}
        .vehicle-stats {{ font-size: 13px; color: #718096; margin-top: 4px; }}
        .vehicle-stats .stable {{ color: #38a169; font-weight: 500; }}
        .vehicle-stats .in-prog {{ color: #d69e2e; font-weight: 500; }}
        .vehicle-expand {{ font-size: 12px; color: #a0aec0; cursor: pointer; user-select: none; }}
        .vehicle-requests {{ display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }}
        .vehicle-requests.open {{ display: block; }}
        .req-row {{ padding: 8px 12px; border-radius: 6px; margin-bottom: 6px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.15s; }}
        .req-row:hover {{ background: #e2e8f0; }}
        .req-row.stable {{ background: #f0fff4; border-left: 3px solid #48bb78; }}
        .req-row.in-progress {{ background: #fffff0; border-left: 3px solid #ecc94b; }}
        .req-route {{ color: #4a5568; }}
        .req-status-badge {{ font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }}
        .req-status-badge.stable {{ background: #c6f6d5; color: #22543d; }}
        .req-status-badge.in-progress {{ background: #fefcbf; color: #744210; }}
        .req-pl-info {{ font-size: 11px; color: #a0aec0; margin-top: 2px; }}

        /* Timeline */
        .timeline-container {{ margin-bottom: 14px; }}
        .timeline-header {{ font-size: 12px; font-weight: 600; color: #718096; margin-bottom: 6px; text-transform: uppercase; }}
        .timeline-dates {{ display: flex; justify-content: space-between; font-size: 10px; color: #a0aec0; margin-bottom: 2px; }}
        .timeline-track {{ position: relative; height: 32px; background: #edf2f7; border-radius: 6px; overflow: hidden; }}
        .timeline-seg {{ position: absolute; top: 2px; height: 28px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: white; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 4px; transition: opacity 0.15s, transform 0.15s; min-width: 4px; }}
        .timeline-seg:hover {{ opacity: 0.85; transform: scaleY(1.1); z-index: 2; }}
        .timeline-seg.stable {{ background: linear-gradient(135deg, #48bb78, #38a169); }}
        .timeline-seg.in-progress {{ background: linear-gradient(135deg, #ecc94b, #d69e2e); }}
        .timeline-seg.unknown {{ background: linear-gradient(135deg, #a0aec0, #718096); }}
        .timeline-gap {{ position: absolute; top: 10px; height: 12px; background: repeating-linear-gradient(45deg, #fed7d7, #fed7d7 4px, transparent 4px, transparent 8px); border-radius: 3px; opacity: 0.6; }}
        .timeline-tooltip {{ position: fixed; background: #2d3748; color: white; padding: 8px 12px; border-radius: 6px; font-size: 12px; pointer-events: none; z-index: 100; max-width: 300px; line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }}
        .timeline-legend {{ display: flex; gap: 14px; margin-top: 6px; font-size: 11px; color: #718096; }}
        .timeline-legend-item {{ display: flex; align-items: center; gap: 4px; }}
        .timeline-legend-dot {{ width: 10px; height: 10px; border-radius: 3px; }}

        /* View period buttons */
        .view-period-bar {{ display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }}
        .view-period-bar .label {{ font-size: 13px; color: #718096; font-weight: 500; }}
        .view-btn {{ padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; cursor: pointer; background: white; color: #4a5568; transition: all 0.15s; }}
        .view-btn:hover {{ border-color: #4299e1; color: #3182ce; }}
        .view-btn.active {{ background: #3182ce; color: white; border-color: #3182ce; }}

        /* Filter panel */
        .filter-panel {{ margin-bottom: 20px; }}
        .brand-filter {{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }}
        .brand-btn {{ padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 14px; font-size: 12px; cursor: pointer; background: white; color: #4a5568; transition: all 0.15s; white-space: nowrap; }}
        .brand-btn:hover {{ border-color: #4299e1; color: #3182ce; }}
        .brand-btn.active {{ background: #4299e1; color: white; border-color: #4299e1; }}
        .brand-btn .count {{ font-size: 10px; opacity: 0.7; margin-left: 2px; }}
        .vehicle-search {{ width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; margin-bottom: 8px; }}
        .vehicle-search:focus {{ outline: none; border-color: #4299e1; box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.15); }}
        .checkbox-controls {{ display: flex; gap: 12px; margin-bottom: 8px; font-size: 12px; }}
        .checkbox-controls a {{ color: #4299e1; cursor: pointer; text-decoration: none; }}
        .checkbox-controls a:hover {{ text-decoration: underline; }}
        .checkbox-list {{ max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px; }}
        .checkbox-item {{ display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; font-size: 13px; cursor: pointer; transition: background 0.1s; }}
        .checkbox-item:hover {{ background: #f7fafc; }}
        .checkbox-item.hidden {{ display: none; }}
        .checkbox-item input {{ cursor: pointer; }}
        .checkbox-item .reg {{ font-weight: 600; color: #2d3748; }}
        .checkbox-item .name {{ color: #718096; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>TransportAnalytics</h1>
        <p>Веб-интерфейс для анализа заявок и путевых листов</p>
    </div>
    <div class="container">
        <!-- Sync panel (full width) -->
        <div class="card">
            <div class="card-title">Синхронизация данных</div>
            <div class="sync-bar">
                <div class="period-btns">
                    <button class="period-btn" data-days="1" onclick="selectPeriod(this)">1 день</button>
                    <button class="period-btn" data-days="3" onclick="selectPeriod(this)">3 дня</button>
                    <button class="period-btn" data-days="7" onclick="selectPeriod(this)">1 нед</button>
                    <button class="period-btn active" data-days="14" onclick="selectPeriod(this)">2 нед</button>
                </div>
                <button class="btn btn-primary" id="syncBtn" onclick="startSync()">Синхронизировать</button>
            </div>
            <div class="status-panel" id="syncStatusPanel">
                <div class="status-text"><div class="spinner"></div><span id="syncStatusText">...</span></div>
            </div>
            <div class="sync-summary" id="syncSummary">{sync_summary_html}</div>
        </div>

        <div class="two-col">
            <!-- Left: Vehicle overview -->
            <div>
                <div class="card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;flex-wrap:wrap;gap:8px;">
                        <span style="font-size:18px;font-weight:600;color:#2d3748;">Обзор машин</span>
                        <div class="view-period-bar" style="margin-bottom:0;">
                            <span class="label">Период:</span>
                            <button class="view-btn" data-vdays="7" onclick="selectViewPeriod(this)">1 нед</button>
                            <button class="view-btn active" data-vdays="14" onclick="selectViewPeriod(this)">2 нед</button>
                            <button class="view-btn" data-vdays="30" onclick="selectViewPeriod(this)">1 мес</button>
                            <button class="view-btn" data-vdays="0" onclick="selectViewPeriod(this)">Всё</button>
                        </div>
                    </div>
                    <div class="filter-panel">
                        <div class="brand-filter" id="brandFilter">{brand_buttons_html}</div>
                        <input type="text" class="vehicle-search" id="vehicleSearch" placeholder="Поиск по номеру..." oninput="filterBySearch(this.value)">
                        <div class="checkbox-controls">
                            <a onclick="toggleAllVehicles(true)">Выбрать все</a>
                            <a onclick="toggleAllVehicles(false)">Снять все</a>
                        </div>
                        <div class="checkbox-list" id="checkboxList">{checkboxes_html}</div>
                    </div>
                    <div id="vehicleList">{vehicles_html}</div>
                </div>
            </div>

            <!-- Right: Report creation + History -->
            <div>
                <div class="card">
                    <div class="card-title">Создать новый отчёт</div>
                    <form id="fetchForm" onsubmit="startFetch(event)">
                        <div class="form-section-title">Период заявок</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="from_requests">Дата начала</label>
                                <input type="text" id="from_requests" placeholder="ДД.ММ.ГГГГ" value="01.12.2025" required>
                            </div>
                            <div class="form-group">
                                <label for="to_requests">Дата окончания</label>
                                <input type="text" id="to_requests" placeholder="ДД.ММ.ГГГГ" value="{today}" required>
                            </div>
                        </div>
                        <div class="form-section-title">Период путевых листов</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="from_pl">Дата начала</label>
                                <input type="text" id="from_pl" placeholder="ДД.ММ.ГГГГ" value="" required>
                            </div>
                            <div class="form-group">
                                <label for="to_pl">Дата окончания</label>
                                <input type="text" id="to_pl" placeholder="ДД.ММ.ГГГГ" value="{today}" required>
                            </div>
                        </div>
                        <div class="form-row" style="align-items: center; margin-bottom: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #4a5568; cursor: pointer;">
                                <input type="checkbox" id="useLegacyMethod" style="width: auto; cursor: pointer;">
                                <span>Старый метод (по дате закрытия ПЛ)</span>
                            </label>
                        </div>
                        <div class="form-row">
                            <button type="submit" class="btn btn-primary" id="fetchBtn">Создать отчёт</button>
                            <button type="button" class="btn btn-secondary" onclick="fillSameDate()">= даты</button>
                        </div>
                    </form>
                    <div class="status-panel" id="statusPanel">
                        <div class="status-text"><div class="spinner"></div><span id="statusText">Загрузка...</span></div>
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">История отчётов</div>
                    <div id="reportList">{reports_html}</div>
                </div>
            </div>
        </div>
    </div>
    <div class="footer">TransportAnalytics v2.0</div>
    <script>
        let selectedPeriodDays = 14;
        let dashboardViewDays = 14;
        let activeVehicleType = 'all';

        function selectPeriod(btn) {{
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedPeriodDays = parseInt(btn.dataset.days);
        }}

        function selectViewPeriod(btn) {{
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            dashboardViewDays = parseInt(btn.dataset.vdays);
            // Reload all expanded vehicle cards
            document.querySelectorAll('.vehicle-requests.open').forEach(el => {{
                el.dataset.loaded = '';
                const vid = el.id.replace('vreqs-', '');
                loadVehicleRequests(vid, el);
            }});
        }}

        function filterByType(type) {{
            activeVehicleType = type;
            // Update brand buttons
            document.querySelectorAll('.brand-btn').forEach(b => {{
                b.classList.toggle('active', b.dataset.brand === type);
            }});
            // Show/hide checkboxes
            document.querySelectorAll('.checkbox-item').forEach(item => {{
                if (type === 'all' || item.dataset.vehicleType === type) {{
                    item.classList.remove('hidden');
                }} else {{
                    item.classList.add('hidden');
                }}
            }});
            // Also apply search filter
            filterBySearch(document.getElementById('vehicleSearch').value);
            applyVehicleFilter();
        }}

        function filterBySearch(query) {{
            const q = query.toLowerCase();
            document.querySelectorAll('.checkbox-item').forEach(item => {{
                // Skip already hidden by type filter
                if (activeVehicleType !== 'all' && item.dataset.vehicleType !== activeVehicleType) return;
                const reg = (item.dataset.reg || '').toLowerCase();
                if (q && !reg.includes(q)) {{
                    item.classList.add('hidden');
                }} else {{
                    item.classList.remove('hidden');
                }}
            }});
        }}

        function toggleAllVehicles(checked) {{
            document.querySelectorAll('.checkbox-item:not(.hidden) input[type="checkbox"]').forEach(cb => {{
                cb.checked = checked;
            }});
            applyVehicleFilter();
        }}

        function applyVehicleFilter() {{
            const checked = new Set();
            document.querySelectorAll('.checkbox-item input[type="checkbox"]:checked').forEach(cb => {{
                checked.add(cb.dataset.vid);
            }});
            document.querySelectorAll('.vehicle-card').forEach(card => {{
                const vid = card.dataset.vehicleId;
                card.style.display = checked.has(vid) ? '' : 'none';
            }});
        }}

        async function startSync() {{
            const btn = document.getElementById('syncBtn');
            const panel = document.getElementById('syncStatusPanel');
            const text = document.getElementById('syncStatusText');
            btn.disabled = true;
            panel.classList.add('active');
            text.textContent = 'Запуск синхронизации...';
            try {{
                const resp = await fetch('/api/sync', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ period_days: selectedPeriodDays }})
                }});
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.detail || 'Ошибка');
                pollSyncStatus();
            }} catch(e) {{
                text.textContent = 'Ошибка: ' + e.message;
                btn.disabled = false;
            }}
        }}

        async function pollSyncStatus() {{
            const text = document.getElementById('syncStatusText');
            const btn = document.getElementById('syncBtn');
            try {{
                const resp = await fetch('/api/sync/status');
                const data = await resp.json();
                text.textContent = data.progress || 'Обработка...';
                if (data.running) {{
                    setTimeout(pollSyncStatus, 1500);
                }} else {{
                    btn.disabled = false;
                    if (data.error) {{
                        text.textContent = 'Ошибка: ' + data.error;
                    }} else {{
                        text.textContent = 'Синхронизация завершена!';
                        setTimeout(() => location.reload(), 1500);
                    }}
                }}
            }} catch(e) {{
                text.textContent = 'Ошибка проверки';
                btn.disabled = false;
            }}
        }}

        function toggleVehicle(vehicleId) {{
            const el = document.getElementById('vreqs-' + vehicleId);
            const arrow = document.getElementById('varrow-' + vehicleId);
            if (el.classList.contains('open')) {{
                el.classList.remove('open');
                arrow.textContent = 'Развернуть';
            }} else {{
                el.classList.add('open');
                arrow.textContent = 'Свернуть';
                // Load requests if not loaded yet
                if (!el.dataset.loaded) {{
                    loadVehicleRequests(vehicleId, el);
                }}
            }}
        }}

        async function loadVehicleRequests(vehicleId, container) {{
            try {{
                // Build query param for view period
                const daysSuffix = dashboardViewDays > 0 ? '?days=' + dashboardViewDays : '';
                // Load both requests and timeline in parallel
                const [reqResp, tlResp] = await Promise.all([
                    fetch('/api/vehicles/' + vehicleId + '/requests' + daysSuffix),
                    fetch('/api/vehicles/' + vehicleId + '/timeline' + daysSuffix)
                ]);
                const reqData = await reqResp.json();
                const tlData = await tlResp.json();

                let html = '';

                // Timeline
                html += renderTimeline(tlData.segments || []);

                // Request list
                for (const req of reqData.requests) {{
                    const cls = req.stability_status === 'stable' ? 'stable' : 'in-progress';
                    const badge = req.stability_status === 'stable' ? 'стабильная' : 'в работе';
                    const route = (req.route_start_address || '?') + ' &rarr; ' + (req.route_end_address || '?');
                    let plInfo = '';
                    if (req.pl_records && req.pl_records.length > 0) {{
                        const plStatuses = req.pl_records.map(p => p.pl_status || '?').join(', ');
                        plInfo = '<div class="req-pl-info">ПЛ: ' + plStatuses + '</div>';
                    }}
                    html += '<div class="req-row ' + cls + '" onclick="openRequestReport(' + req.request_number + ')">' +
                        '<div><span class="req-route">#' + req.request_number + ' — ' + route + '</span>' + plInfo + '</div>' +
                        '<span class="req-status-badge ' + cls + '">' + badge + '</span></div>';
                }}
                if (reqData.requests.length === 0 && (!tlData.segments || tlData.segments.length === 0)) {{
                    html += '<div style="color:#a0aec0;font-size:13px;padding:8px;">Нет данных</div>';
                }}
                container.innerHTML = html;
                container.dataset.loaded = '1';
            }} catch(e) {{
                container.innerHTML = '<div style="color:#e53e3e;font-size:13px;">Ошибка загрузки</div>';
            }}
        }}

        function parseRuDate(s) {{
            // Parse "DD.MM.YYYY HH:MM" or "DD.MM.YYYY" to timestamp
            if (!s) return null;
            const parts = s.split(' ');
            const dmy = parts[0].split('.');
            if (dmy.length < 3) return null;
            const hm = parts[1] ? parts[1].split(':') : ['0','0'];
            return new Date(parseInt(dmy[2]), parseInt(dmy[1])-1, parseInt(dmy[0]),
                            parseInt(hm[0]||0), parseInt(hm[1]||0)).getTime();
        }}

        function fmtDate(ts) {{
            const d = new Date(ts);
            return String(d.getDate()).padStart(2,'0') + '.' +
                   String(d.getMonth()+1).padStart(2,'0');
        }}

        function fmtDateFull(ts) {{
            const d = new Date(ts);
            return String(d.getDate()).padStart(2,'0') + '.' +
                   String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear() + ' ' +
                   String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }}

        function renderTimeline(segments) {{
            if (!segments || segments.length === 0) return '';

            // Parse all dates and find global range
            const parsed = [];
            for (const seg of segments) {{
                const t0 = parseRuDate(seg.pl_date_out_plan);
                const t1 = parseRuDate(seg.pl_date_in_plan);
                if (t0 && t1 && t1 > t0) {{
                    parsed.push({{ ...seg, t0, t1 }});
                }}
            }}
            if (parsed.length === 0) return '';

            parsed.sort((a, b) => a.t0 - b.t0);
            const globalStart = parsed[0].t0;
            const globalEnd = Math.max(...parsed.map(s => s.t1));
            const totalMs = globalEnd - globalStart;
            if (totalMs <= 0) return '';

            const pct = (ts) => ((ts - globalStart) / totalMs * 100);

            let html = '<div class="timeline-container">';
            html += '<div class="timeline-header">Таймлайн</div>';
            html += '<div class="timeline-dates"><span>' + fmtDate(globalStart) + '</span><span>' + fmtDate(globalEnd) + '</span></div>';
            html += '<div class="timeline-track">';

            // Render gaps (between consecutive segments)
            for (let i = 0; i < parsed.length - 1; i++) {{
                const gapStart = parsed[i].t1;
                const gapEnd = parsed[i+1].t0;
                if (gapEnd > gapStart) {{
                    const left = pct(gapStart);
                    const width = pct(gapEnd) - left;
                    if (width > 0.3) {{
                        html += '<div class="timeline-gap" style="left:' + left + '%;width:' + width + '%" title="Пробел"></div>';
                    }}
                }}
            }}

            // Render segments
            for (const seg of parsed) {{
                const left = pct(seg.t0);
                const width = Math.max(pct(seg.t1) - left, 0.5);
                const cls = seg.stability_status === 'stable' ? 'stable' : (seg.stability_status === 'in_progress' ? 'in-progress' : 'unknown');
                const reqNum = seg.request_number || '?';
                const label = width > 6 ? '#' + reqNum : '';
                const tipData = encodeURIComponent(JSON.stringify({{
                    req: reqNum,
                    from: seg.pl_date_out_plan,
                    to: seg.pl_date_in_plan,
                    status: seg.pl_status || '?',
                    stability: seg.stability_status || '?',
                    route_from: seg.route_start_address || '',
                    route_to: seg.route_end_address || ''
                }}));
                html += '<div class="timeline-seg ' + cls + '" style="left:' + left + '%;width:' + width + '%"' +
                    ' data-tip="' + tipData + '"' +
                    ' onmouseenter="showTimelineTip(event,this)" onmouseleave="hideTimelineTip()"' +
                    ' onclick="openRequestReport(' + reqNum + ')">' + label + '</div>';
            }}

            html += '</div>'; // track
            html += '<div class="timeline-legend">';
            html += '<div class="timeline-legend-item"><div class="timeline-legend-dot" style="background:#48bb78"></div> Стабильная</div>';
            html += '<div class="timeline-legend-item"><div class="timeline-legend-dot" style="background:#ecc94b"></div> В работе</div>';
            html += '<div class="timeline-legend-item"><div class="timeline-legend-dot" style="background:repeating-linear-gradient(45deg,#fed7d7,#fed7d7 2px,transparent 2px,transparent 4px)"></div> Пробел</div>';
            html += '</div>';
            html += '</div>'; // container
            return html;
        }}

        let tipEl = null;
        function showTimelineTip(event, el) {{
            const data = JSON.parse(decodeURIComponent(el.dataset.tip));
            if (!tipEl) {{
                tipEl = document.createElement('div');
                tipEl.className = 'timeline-tooltip';
                document.body.appendChild(tipEl);
            }}
            let lines = ['<b>Заявка #' + data.req + '</b>'];
            if (data.route_from || data.route_to) lines.push(data.route_from + ' → ' + data.route_to);
            lines.push(data.from + ' — ' + data.to);
            lines.push('ПЛ: ' + data.status + ' | ' + (data.stability === 'stable' ? 'Стабильная' : 'В работе'));
            tipEl.innerHTML = lines.join('<br>');
            tipEl.style.display = 'block';
            tipEl.style.left = (event.clientX + 12) + 'px';
            tipEl.style.top = (event.clientY - 10) + 'px';
        }}
        function hideTimelineTip() {{
            if (tipEl) tipEl.style.display = 'none';
        }}
        document.addEventListener('mousemove', function(e) {{
            if (tipEl && tipEl.style.display === 'block') {{
                tipEl.style.left = (e.clientX + 12) + 'px';
                tipEl.style.top = (e.clientY - 10) + 'px';
            }}
        }});

        function openRequestReport(reqNumber) {{
            window.open('/api/request/' + reqNumber + '/report', '_blank');
        }}

        function fillSameDate() {{
            document.getElementById('from_pl').value = document.getElementById('from_requests').value;
            document.getElementById('to_pl').value = document.getElementById('to_requests').value;
        }}

        async function startFetch(event) {{
            event.preventDefault();
            const btn = document.getElementById('fetchBtn');
            const statusPanel = document.getElementById('statusPanel');
            const statusText = document.getElementById('statusText');
            btn.disabled = true;
            statusPanel.classList.add('active');
            statusText.textContent = 'Запуск загрузки...';
            const formData = {{
                from_requests: document.getElementById('from_requests').value,
                to_requests: document.getElementById('to_requests').value,
                from_pl: document.getElementById('from_pl').value,
                to_pl: document.getElementById('to_pl').value,
                use_legacy_pl_method: document.getElementById('useLegacyMethod').checked
            }};
            try {{
                const response = await fetch('/api/reports', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(formData)
                }});
                const data = await response.json();
                if (!response.ok) throw new Error(data.detail || 'Ошибка запуска');
                pollStatus(data.report_id);
            }} catch (error) {{
                statusText.textContent = 'Ошибка: ' + error.message;
                btn.disabled = false;
            }}
        }}

        async function pollStatus(reportId) {{
            const statusText = document.getElementById('statusText');
            const btn = document.getElementById('fetchBtn');
            try {{
                const response = await fetch('/api/status');
                const data = await response.json();
                statusText.textContent = data.progress || 'Обработка...';
                if (data.running) {{
                    setTimeout(() => pollStatus(reportId), 1000);
                }} else {{
                    btn.disabled = false;
                    if (data.error) {{
                        statusText.textContent = 'Ошибка: ' + data.error;
                    }} else {{
                        statusText.textContent = 'Готово! Открываю отчёт...';
                        setTimeout(() => {{
                            window.open('/api/reports/' + reportId, '_blank');
                            location.reload();
                        }}, 1000);
                    }}
                }}
            }} catch (error) {{
                statusText.textContent = 'Ошибка проверки статуса';
                btn.disabled = false;
            }}
        }}

        function openReport(reportId) {{ window.open('/api/reports/' + reportId, '_blank'); }}
        function openReportV2(reportId) {{ window.open('/api/reports/' + reportId + '/v2', '_blank'); }}
        async function deleteReport(reportId) {{
            if (!confirm('Удалить отчёт из истории?')) return;
            try {{
                const response = await fetch('/api/reports/' + reportId, {{ method: 'DELETE' }});
                if (response.ok) location.reload();
                else alert('Ошибка удаления');
            }} catch (error) {{ alert('Ошибка: ' + error.message); }}
        }}

        document.addEventListener('DOMContentLoaded', async function() {{
            // Check if fetch is running
            try {{
                const response = await fetch('/api/status');
                const data = await response.json();
                if (data.running) {{
                    document.getElementById('fetchBtn').disabled = true;
                    document.getElementById('statusPanel').classList.add('active');
                    pollStatus(data.report_id || 0);
                }}
            }} catch (e) {{}}
            // Check if sync is running
            try {{
                const resp = await fetch('/api/sync/status');
                const data = await resp.json();
                if (data.running) {{
                    document.getElementById('syncBtn').disabled = true;
                    document.getElementById('syncStatusPanel').classList.add('active');
                    pollSyncStatus();
                }}
            }} catch(e) {{}}
        }});
    </script>
</body>
</html>'''


@app.get("/", response_class=HTMLResponse)
async def index():
    """Main menu page - create reports and view history."""
    reports = db.get_reports(limit=20)
    today = datetime.now().strftime('%d.%m.%Y')

    # Build reports list HTML
    reports_html = ""
    if reports:
        for r in reports:
            created = r['created_at'][:16].replace('T', ' ') if r['created_at'] else '—'
            viewed_count = len(r['viewed_requests']) if r['viewed_requests'] else 0

            # Build stats line
            stats_parts = []
            if r['from_requests'] and r['to_requests']:
                stats_parts.append(f"Заявки: {r['from_requests']} — {r['to_requests']}")
            if r['requests_count'] is not None:
                stats_parts.append(f"Заявок: {r['requests_count']}")
            if r['pl_count'] is not None:
                stats_parts.append(f"ПЛ: {r['pl_count']}")
            if r['pl_unmatched_count'] is not None and r['pl_unmatched_count'] > 0:
                stats_parts.append(f"<span style='color:#e53e3e'>ПЛ без заявок: {r['pl_unmatched_count']}</span>")

            stats_line = " | ".join(stats_parts) if stats_parts else ''
            meta_line = f"Создан: {created} | Просмотрено: {viewed_count}"

            reports_html += f'''
                <div class="report-item">
                    <div class="report-item-info">
                        <div class="report-item-title">{r['title'] or 'Без названия'}</div>
                        <div class="report-item-meta">{meta_line}</div>
                        <div class="report-item-stats" style="font-size:11px;color:#718096;margin-top:2px;">{stats_line}</div>
                    </div>
                    <div class="report-item-actions">
                        <button class="btn btn-sm btn-primary" onclick="openReport({r['id']})">Открыть</button>
                        <button class="btn btn-sm btn-success" onclick="openReportV2({r['id']})" title="3-колоночный layout (тест)">V2</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteReport({r['id']})">Удалить</button>
                    </div>
                </div>'''
    else:
        reports_html = '<div class="empty-state"><p>История пуста. Создайте первый отчёт.</p></div>'

    # Build vehicles list HTML with brand grouping
    vehicles = db.get_vehicles_with_stats()
    vehicles_html = ""
    brand_buttons_html = ""
    checkboxes_html = ""

    if vehicles:
        # Compute normalized type for each vehicle
        from collections import Counter
        brand_counts = Counter()
        for v in vehicles:
            vtype = normalize_vehicle_type(v['ts_name_mo'])
            v['_vehicle_type'] = vtype
            brand_counts[vtype] += 1

        # Brand filter buttons
        sorted_brands = sorted(brand_counts.items(), key=lambda x: -x[1])
        brand_buttons_html = '<button class="brand-btn active" data-brand="all" onclick="filterByType(\'all\')">Все</button>'
        for brand, count in sorted_brands:
            brand_buttons_html += (
                f'<button class="brand-btn" data-brand="{brand}" onclick="filterByType(\'{brand}\')">'
                f'{brand} <span class="count">({count})</span></button>'
            )

        # Checkbox list
        for v in vehicles:
            reg = v['ts_reg_number'] or '—'
            name = v['ts_name_mo'] or ''
            vtype = v['_vehicle_type']
            checkboxes_html += (
                f'<label class="checkbox-item" data-vehicle-type="{vtype}" data-reg="{reg}">'
                f'<input type="checkbox" checked data-vid="{v["id"]}" onchange="applyVehicleFilter()">'
                f'<span class="reg">{reg}</span> <span class="name">— {name}</span>'
                f'</label>'
            )

        # Vehicle cards
        for v in vehicles:
            reg = v['ts_reg_number'] or '—'
            name = v['ts_name_mo'] or ''
            total = v['requests_total']
            stable = v['requests_stable']
            in_prog = v['requests_in_progress']
            vtype = v['_vehicle_type']
            vehicles_html += f'''
                <div class="vehicle-card" data-vehicle-id="{v['id']}" data-vehicle-type="{vtype}">
                    <div class="vehicle-header" onclick="toggleVehicle({v['id']})">
                        <div>
                            <div class="vehicle-name">{reg} — {name}</div>
                            <div class="vehicle-stats">
                                Заявок: {total}
                                (<span class="stable">{stable} стаб.</span>,
                                 <span class="in-prog">{in_prog} в работе</span>)
                            </div>
                        </div>
                        <span class="vehicle-expand" id="varrow-{v['id']}">Развернуть</span>
                    </div>
                    <div class="vehicle-requests" id="vreqs-{v['id']}"></div>
                </div>'''
    else:
        vehicles_html = '<div class="empty-state"><p>Нет данных. Запустите синхронизацию.</p></div>'

    # Build sync summary
    summary = db.get_dashboard_summary()
    last_sync = summary.get('last_sync')
    if last_sync:
        sync_time = last_sync['synced_at'][:16].replace('T', ' ') if last_sync['synced_at'] else '?'
        sync_period = f"{last_sync.get('period_from_pl', '?')} — {last_sync.get('period_to_pl', '?')}"
        sync_summary_html = (
            f"Последняя синхронизация: <span>{sync_time}</span> | "
            f"Период ПЛ: <span>{sync_period}</span> | "
            f"<span>{summary['vehicles_count']}</span> машин | "
            f"<span>{summary['requests_total']}</span> заявок "
            f"(<span class='stable' style='color:#38a169'>{summary['requests_stable']} стаб.</span>, "
            f"<span class='in-prog' style='color:#d69e2e'>{summary['requests_in_progress']} в работе</span>)"
        )
    else:
        sync_summary_html = "Синхронизация ещё не выполнялась."

    html = _INDEX_TEMPLATE.format(
        today=today,
        reports_html=reports_html,
        vehicles_html=vehicles_html,
        sync_summary_html=sync_summary_html,
        brand_buttons_html=brand_buttons_html,
        checkboxes_html=checkboxes_html,
    )
    return HTMLResponse(content=html)


@app.get("/report")
async def get_report():
    """Serve the current report.html."""
    report_path = FINAL_DIR / 'report.html'
    if not report_path.exists():
        raise HTTPException(status_code=404, detail="Report not found")
    return FileResponse(report_path, media_type='text/html')


@app.post("/api/fetch")
async def start_fetch(request: FetchRequest, background_tasks: BackgroundTasks):
    """Start data fetching in background."""
    global fetch_status

    with fetch_lock:
        if fetch_status['running']:
            raise HTTPException(status_code=400, detail="Fetch already in progress")

        fetch_status = {
            'running': True,
            'progress': 'Starting...',
            'error': None,
            'completed_at': None,
            'stats': None
        }

    # Run in background
    background_tasks.add_task(
        run_fetch_pipeline,
        request.from_requests,
        request.to_requests,
        request.from_pl,
        request.to_pl,
        request.use_legacy_pl_method
    )

    return {"status": "started"}


@app.get("/api/status")
async def get_status():
    """Get current fetch status."""
    return fetch_status


@app.post("/api/archive")
async def archive_request(request: ArchiveRequest):
    """Add request to archive."""
    try:
        entry = db.archive_request(
            request_number=request.request_number,
            notes=request.notes,
            route_start_address=request.route_start_address,
            route_end_address=request.route_end_address,
            route_start_date=request.route_start_date,
            pl_count=request.pl_count
        )
        return {"status": "ok", "entry": entry.to_dict()}
    except Exception as e:
        logger.error(f"Archive error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/archive")
async def get_archive(limit: int = 100, offset: int = 0):
    """Get archived requests."""
    return db.get_archived(limit=limit, offset=offset)


@app.delete("/api/archive")
async def unarchive(request: UnarchiveRequest):
    """Remove request from archive."""
    success = db.unarchive_request(request.request_number)
    if success:
        return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Request not found in archive")


@app.get("/api/archived-numbers")
async def get_archived_numbers():
    """Get set of archived request numbers."""
    numbers = db.get_archived_numbers()
    return {"numbers": list(numbers)}


# ============================================================
# Report history endpoints
# ============================================================

@app.get("/api/reports")
async def get_reports(limit: int = 50, offset: int = 0):
    """Get list of reports from history."""
    reports = db.get_reports(limit=limit, offset=offset)
    return {"reports": reports}


@app.post("/api/reports")
async def create_report(request: CreateReportRequest, background_tasks: BackgroundTasks):
    """Create a new report (starts fetch pipeline)."""
    global fetch_status

    with fetch_lock:
        if fetch_status['running']:
            raise HTTPException(status_code=400, detail="Fetch already in progress")

    # Generate title if not provided - use PL dates as primary
    title = request.title or f"ПЛ {request.from_pl} — {request.to_pl}"

    # Generate HTML filename
    # Name report by PL dates (primary), not request dates
    html_filename = f"report_PL_{request.from_pl.replace('.', '-')}_{request.to_pl.replace('.', '-')}.html"

    # Create report record
    report = db.create_report(
        title=title,
        from_requests=request.from_requests,
        to_requests=request.to_requests,
        from_pl=request.from_pl,
        to_pl=request.to_pl,
        html_filename=html_filename
    )

    with fetch_lock:
        fetch_status = {
            'running': True,
            'progress': 'Starting...',
            'error': None,
            'completed_at': None,
            'stats': None,
            'report_id': report.id
        }

    # Run in background
    background_tasks.add_task(
        run_fetch_pipeline_for_report,
        report.id,
        request.from_requests,
        request.to_requests,
        request.from_pl,
        request.to_pl,
        html_filename,
        request.use_legacy_pl_method
    )

    return {"status": "started", "report_id": report.id}


@app.get("/api/reports/{report_id}")
async def get_report_by_id(report_id: int):
    """Get report HTML by ID."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    html_path = HISTORY_DIR / report.html_filename
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="Report file not found")

    return FileResponse(html_path, media_type='text/html')


@app.get("/api/reports/{report_id}/v2")
async def get_report_v2_by_id(report_id: int):
    """Get V2 report HTML by ID (3-column layout)."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    v2_filename = report.html_filename.replace('.html', '_v2.html')
    html_path = HISTORY_DIR / v2_filename
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="V2 report not found. Generate a new report to get V2 version.")

    return FileResponse(html_path, media_type='text/html')


@app.get("/api/reports/{report_id}/info")
async def get_report_info(report_id: int):
    """Get report metadata."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report.to_dict()


@app.post("/api/reports/{report_id}/save")
async def save_report_state(report_id: int, request: SaveReportStateRequest):
    """Save report state (viewed requests and shift cache)."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Update viewed requests
    if request.viewed_requests is not None:
        db.update_report(report_id, viewed_requests=request.viewed_requests)

    # Save shift caches
    if request.shift_caches:
        db.save_shift_caches_bulk(report_id, request.shift_caches)

    return {"status": "ok"}


@app.post("/api/reports/{report_id}/shifts")
async def load_shifts(report_id: int, request: LoadShiftsRequest):
    """Load shift data for a vehicle."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Check cache first
    cached = db.get_all_shift_caches(
        report_id=report_id,
        pl_id=request.pl_id,
        ts_id_mo=request.ts_id_mo
    )

    if cached:
        # Return cached data
        return {
            "shifts": [
                {
                    "key": c['shift_key'],
                    "label": c['shift_key'].replace('_morning', ' Утро').replace('_evening', ' Вечер'),
                    "data": c['monitoring_data']
                }
                for c in cached
            ],
            "from_cache": True
        }

    # Fetch fresh data
    fetcher = ShiftMonitoringFetcher(str(BASE_DIR / 'config.yaml'))
    shifts = fetcher.fetch_all_shifts(
        ts_id_mo=request.ts_id_mo,
        from_date=request.from_date,
        to_date=request.to_date
    )

    # Cache the results
    for shift in shifts:
        db.save_shift_cache(
            report_id=report_id,
            pl_id=request.pl_id,
            ts_id_mo=request.ts_id_mo,
            shift_key=shift['key'],
            monitoring_data=shift['data']
        )

    return {
        "shifts": shifts,
        "from_cache": False
    }


@app.delete("/api/reports/{report_id}")
async def delete_report(report_id: int):
    """Delete a report from history."""
    report = db.get_report(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Delete HTML file if exists
    html_path = HISTORY_DIR / report.html_filename
    if html_path.exists():
        html_path.unlink()

    # Delete from database
    db.delete_report(report_id)

    return {"status": "ok"}


# ============================================================
# Dashboard / Sync endpoints
# ============================================================

@app.post("/api/sync")
async def start_sync(request: SyncRequest, background_tasks: BackgroundTasks):
    """Start vehicle data synchronization."""
    global sync_status

    with sync_lock:
        if sync_status['running']:
            raise HTTPException(status_code=400, detail="Sync already in progress")
        sync_status = {
            'running': True,
            'progress': 'Starting...',
            'error': None,
            'completed_at': None,
            'stats': None
        }

    # Calculate date range
    from datetime import timedelta
    to_pl = datetime.now().strftime('%d.%m.%Y')
    from_pl = (datetime.now() - timedelta(days=request.period_days)).strftime('%d.%m.%Y')

    background_tasks.add_task(run_sync_pipeline, from_pl, to_pl)
    return {"status": "started", "period_from": from_pl, "period_to": to_pl}


@app.get("/api/sync/status")
async def get_sync_status():
    """Get current sync status."""
    return sync_status


@app.get("/api/vehicles")
async def get_vehicles(days: Optional[int] = None):
    """Get vehicles with aggregated stats."""
    vehicles = db.get_vehicles_with_stats(days=days)
    return {"vehicles": vehicles}


@app.get("/api/vehicles/{vehicle_id}/requests")
async def get_vehicle_requests(vehicle_id: int, days: Optional[int] = None):
    """Get requests for a specific vehicle."""
    requests = db.get_vehicle_requests(vehicle_id, days=days)
    return {"requests": requests}


@app.get("/api/vehicles/{vehicle_id}/timeline")
async def get_vehicle_timeline(vehicle_id: int, days: Optional[int] = None):
    """Get timeline segments for a vehicle."""
    segments = db.get_vehicle_timeline(vehicle_id, days=days)
    return {"segments": segments}


@app.get("/api/timeline")
async def get_all_timelines():
    """Get timelines for all vehicles."""
    data = db.get_all_vehicles_timeline()
    return {"vehicles": data}


@app.get("/api/dashboard/summary")
async def get_dashboard_summary():
    """Get dashboard summary."""
    return db.get_dashboard_summary()


@app.get("/api/request/{request_number}/report", response_class=HTMLResponse)
async def get_request_report(request_number: int):
    """Generate V2 report for a single request from cached matched_data_json."""
    from src.web.models import TrackedRequest as TR

    session = db.get_session()
    try:
        tr = session.query(TR).filter_by(request_number=request_number).first()
        if not tr:
            raise HTTPException(status_code=404, detail="Request not found")
        if not tr.matched_data_json:
            raise HTTPException(status_code=404, detail="No cached data for this request. Re-sync first.")

        matched_records = json.loads(tr.matched_data_json)
    finally:
        session.close()

    from src.output.html_generator_v2 import generate_html_report, build_hierarchy

    hierarchy = build_hierarchy(matched_records, [])
    title = f"Заявка #{request_number}"

    # Generate to temp file and return
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.html', delete=False, dir=str(HISTORY_DIR)) as tmp:
        tmp_path = tmp.name

    generate_html_report(hierarchy, tmp_path, title=title, web_mode=True)

    html_content = Path(tmp_path).read_text(encoding='utf-8')
    Path(tmp_path).unlink()  # cleanup

    return HTMLResponse(content=html_content)


# ============================================================
# Background sync pipeline
# ============================================================

def run_sync_pipeline(from_pl: str, to_pl: str):
    """Run sync in background thread."""
    global sync_status

    def progress_cb(msg: str):
        with sync_lock:
            sync_status['progress'] = msg

    try:
        result = sync_vehicle_data(
            period_from_pl=from_pl,
            period_to_pl=to_pl,
            db=db,
            progress_callback=progress_cb,
        )
        with sync_lock:
            sync_status['running'] = False
            sync_status['progress'] = 'Готово!'
            sync_status['completed_at'] = datetime.now().isoformat()
            sync_status['stats'] = result
    except Exception as e:
        logger.exception("Sync pipeline error")
        with sync_lock:
            sync_status['running'] = False
            sync_status['error'] = str(e)
        # Log error to DB
        try:
            db.create_sync_log({
                'period_from_pl': from_pl,
                'period_to_pl': to_pl,
                'status': 'error',
                'error_message': str(e),
            })
        except Exception:
            pass


# ============================================================
# Background fetch pipeline
# ============================================================

def run_fetch_pipeline(from_req: str, to_req: str, from_pl: str, to_pl: str, use_legacy_pl_method: bool = False):
    """Run the full fetch pipeline in background."""
    global fetch_status
    import sys
    import time

    try:
        # Import here to avoid circular imports
        sys.path.insert(0, str(BASE_DIR))

        from src.api.fetcher import DataFetcher
        from src.parsers.request_parser import RequestParser
        from src.parsers.pl_parser import PLParser
        from src.output.html_generator_v2 import generate_html_report, build_hierarchy
        import pandas as pd
        import yaml

        # Load config
        config_path = BASE_DIR / 'config.yaml'
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        method_name = "legacy (по дате закрытия)" if use_legacy_pl_method else "новый (по дате выезда)"
        with fetch_lock:
            fetch_status['progress'] = f'Загрузка данных из API (метод ПЛ: {method_name})...'

        # Initialize fetcher
        fetcher = DataFetcher(str(config_path))

        # Fetch data
        requests_data, pl_data = fetcher.fetch_all(
            from_requests=from_req,
            to_requests=to_req,
            from_pl=from_pl,
            to_pl=to_pl,
            save_raw=True,
            use_legacy_pl_method=use_legacy_pl_method
        )

        req_count = len(requests_data.get('list', []))
        pl_count = len(pl_data.get('list', []))

        with fetch_lock:
            fetch_status['progress'] = f'Загружено: {req_count} заявок, {pl_count} ПЛ. Парсинг...'

        # Parse
        raw_dir = Path(config['paths']['input']['requests']).parent
        requests_file = raw_dir / f"Requests_{from_req.replace('.', '-')}_{to_req.replace('.', '-')}.json"
        pl_file = raw_dir / f"PL_{from_pl.replace('.', '-')}_{to_pl.replace('.', '-')}.json"

        request_parser = RequestParser(str(config_path))
        request_parser.input_path = str(requests_file)
        request_parser.parse()

        pl_parser = PLParser(str(config_path))
        pl_parser.input_path = str(pl_file)
        pl_parser.parse()

        with fetch_lock:
            fetch_status['progress'] = 'Загрузка мониторинга...'

        # Monitoring
        monitoring_tasks = fetcher.extract_monitoring_tasks(pl_data)
        monitoring_results = fetcher.fetch_monitoring_batch(monitoring_tasks)

        with fetch_lock:
            fetch_status['progress'] = 'Сопоставление данных...'

        # Matching
        intermediate_dir = Path(config['paths']['output']['intermediate'])
        output_dir = Path(config['paths']['output']['final'])
        output_dir.mkdir(parents=True, exist_ok=True)

        requests_df = pd.read_csv(intermediate_dir / 'requests_parsed.csv')
        pl_df = pd.read_csv(intermediate_dir / 'pl_parsed.csv')

        req_key = 'request_number'
        pl_key = 'extracted_request_number'

        matched_df = pd.merge(
            requests_df,
            pl_df,
            left_on=req_key,
            right_on=pl_key,
            how='inner',
            suffixes=('_req', '_pl')
        )

        # Add monitoring data
        monitoring_cols_csv = [
            'mon_distance', 'mon_moving_time_hours', 'mon_engine_time_hours',
            'mon_idling_time_hours', 'mon_fuel_rate', 'mon_parkings_count',
            'mon_parkings_total_hours'
        ]

        for col in monitoring_cols_csv:
            matched_df[col] = None

        html_records = []
        matched_count = 0

        for idx, row in matched_df.iterrows():
            pl_id = row.get('pl_id')
            ts_id_str = str(row.get('ts_id_mo', ''))
            ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]

            record = row.to_dict()
            mon_data_found = None

            for ts_id in ts_ids:
                key = (pl_id, ts_id)
                if key in monitoring_results:
                    mon_data_found = monitoring_results[key]
                    for col in monitoring_cols_csv:
                        if col in mon_data_found:
                            matched_df.at[idx, col] = mon_data_found[col]
                    matched_count += 1
                    break

            if mon_data_found:
                record.update(mon_data_found)
            html_records.append(record)

        matched_df.to_csv(output_dir / 'matched_full.csv', index=False)
        matched_df.to_csv(output_dir / 'matched.csv', index=False)

        # Unmatched
        requests_unmatched = requests_df[~requests_df[req_key].isin(pl_df[pl_key])]
        requests_unmatched.to_csv(output_dir / 'requests_unmatched.csv', index=False)

        pl_unmatched = pl_df[~pl_df[pl_key].isin(requests_df[req_key])]
        pl_unmatched.to_csv(output_dir / 'pl_unmatched.csv', index=False)

        with fetch_lock:
            fetch_status['progress'] = 'Генерация HTML отчёта...'

        # Generate HTML
        hierarchy = build_hierarchy(html_records, [])
        html_path = output_dir / 'report.html'
        generate_html_report(
            hierarchy,
            str(html_path),
            title=f"Отчёт за {from_req} - {to_req}"
        )

        with fetch_lock:
            fetch_status['running'] = False
            fetch_status['progress'] = 'Готово!'
            fetch_status['completed_at'] = datetime.now().isoformat()
            fetch_status['stats'] = {
                'requests': req_count,
                'pl': pl_count,
                'matched': len(matched_df),
                'monitoring': matched_count
            }

    except Exception as e:
        logger.exception("Fetch pipeline error")
        with fetch_lock:
            fetch_status['running'] = False
            fetch_status['error'] = str(e)


def run_fetch_pipeline_for_report(
    report_id: int,
    from_req: str,
    to_req: str,
    from_pl: str,
    to_pl: str,
    html_filename: str,
    use_legacy_pl_method: bool = False
):
    """Run the full fetch pipeline and save to history."""
    global fetch_status
    import sys
    import time

    try:
        # Import here to avoid circular imports
        sys.path.insert(0, str(BASE_DIR))

        from src.api.fetcher import DataFetcher
        from src.parsers.request_parser import RequestParser
        from src.parsers.pl_parser import PLParser
        from src.output.html_generator_v2 import generate_html_report, build_hierarchy
        import pandas as pd
        import yaml

        # Load config
        config_path = BASE_DIR / 'config.yaml'
        with open(config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)

        method_name = "legacy (по дате закрытия)" if use_legacy_pl_method else "новый (по дате выезда)"
        with fetch_lock:
            fetch_status['progress'] = f'Загрузка данных из API (метод ПЛ: {method_name})...'

        # Initialize fetcher
        fetcher = DataFetcher(str(config_path))

        # Fetch data
        requests_data, pl_data = fetcher.fetch_all(
            from_requests=from_req,
            to_requests=to_req,
            from_pl=from_pl,
            to_pl=to_pl,
            save_raw=True,
            use_legacy_pl_method=use_legacy_pl_method
        )

        req_count = len(requests_data.get('list', []))
        pl_count = len(pl_data.get('list', []))

        with fetch_lock:
            fetch_status['progress'] = f'Загружено: {req_count} заявок, {pl_count} ПЛ. Парсинг...'

        # Parse
        raw_dir = Path(config['paths']['input']['requests']).parent
        requests_file = raw_dir / f"Requests_{from_req.replace('.', '-')}_{to_req.replace('.', '-')}.json"
        pl_file = raw_dir / f"PL_{from_pl.replace('.', '-')}_{to_pl.replace('.', '-')}.json"

        request_parser = RequestParser(str(config_path))
        request_parser.input_path = str(requests_file)
        request_parser.parse()

        pl_parser = PLParser(str(config_path))
        pl_parser.input_path = str(pl_file)
        pl_parser.parse()

        with fetch_lock:
            fetch_status['progress'] = 'Загрузка мониторинга...'

        # Monitoring
        monitoring_tasks = fetcher.extract_monitoring_tasks(pl_data)
        monitoring_results = fetcher.fetch_monitoring_batch(monitoring_tasks)

        with fetch_lock:
            fetch_status['progress'] = 'Сопоставление данных...'

        # Matching
        intermediate_dir = Path(config['paths']['output']['intermediate'])
        output_dir = Path(config['paths']['output']['final'])
        output_dir.mkdir(parents=True, exist_ok=True)

        requests_df = pd.read_csv(intermediate_dir / 'requests_parsed.csv')
        pl_df = pd.read_csv(intermediate_dir / 'pl_parsed.csv')

        req_key = 'request_number'
        pl_key = 'extracted_request_number'

        matched_df = pd.merge(
            requests_df,
            pl_df,
            left_on=req_key,
            right_on=pl_key,
            how='inner',
            suffixes=('_req', '_pl')
        )

        # Add monitoring data
        monitoring_cols_csv = [
            'mon_distance', 'mon_moving_time_hours', 'mon_engine_time_hours',
            'mon_idling_time_hours', 'mon_fuel_rate', 'mon_parkings_count',
            'mon_parkings_total_hours'
        ]

        for col in monitoring_cols_csv:
            matched_df[col] = None

        html_records = []
        matched_count = 0

        for idx, row in matched_df.iterrows():
            pl_id = row.get('pl_id')
            ts_id_str = str(row.get('ts_id_mo', ''))
            ts_ids = [int(x.strip()) for x in ts_id_str.split(',') if x.strip().isdigit()]

            record = row.to_dict()
            mon_data_found = None

            for ts_id in ts_ids:
                key = (pl_id, ts_id)
                if key in monitoring_results:
                    mon_data_found = monitoring_results[key]
                    for col in monitoring_cols_csv:
                        if col in mon_data_found:
                            matched_df.at[idx, col] = mon_data_found[col]
                    matched_count += 1
                    break

            if mon_data_found:
                record.update(mon_data_found)
            html_records.append(record)

        matched_df.to_csv(output_dir / 'matched_full.csv', index=False)
        matched_df.to_csv(output_dir / 'matched.csv', index=False)

        # Unmatched
        requests_unmatched = requests_df[~requests_df[req_key].isin(pl_df[pl_key])]
        requests_unmatched.to_csv(output_dir / 'requests_unmatched.csv', index=False)

        pl_unmatched = pl_df[~pl_df[pl_key].isin(requests_df[req_key])]
        pl_unmatched.to_csv(output_dir / 'pl_unmatched.csv', index=False)

        with fetch_lock:
            fetch_status['progress'] = 'Генерация HTML отчёта...'

        # Calculate statistics
        pl_unmatched_count = len(pl_df[~pl_df[pl_key].isin(requests_df[req_key])])

        # Generate HTML - save to both final and history
        hierarchy = build_hierarchy(html_records, [])

        # Title based on PL dates
        report_title = f"ПЛ {from_pl} — {to_pl}"

        # Save to final (current report)
        html_path = output_dir / 'report.html'
        generate_html_report(
            hierarchy,
            str(html_path),
            title=report_title,
            web_mode=True,
            report_id=report_id
        )

        # Save to history
        history_path = HISTORY_DIR / html_filename
        generate_html_report(
            hierarchy,
            str(history_path),
            title=report_title,
            web_mode=True,
            report_id=report_id
        )

        # Generate V2 report (3-column layout) for testing
        try:
            from src.output.html_generator_v2 import generate_html_report as generate_html_report_v2
            v2_filename = html_filename.replace('.html', '_v2.html')
            v2_path = HISTORY_DIR / v2_filename
            generate_html_report_v2(
                hierarchy,
                str(v2_path),
                title=f"{report_title} (V2)",
                web_mode=True,
                report_id=report_id
            )
            # Also save to final
            v2_final_path = output_dir / 'report_v2.html'
            generate_html_report_v2(
                hierarchy,
                str(v2_final_path),
                title=f"{report_title} (V2)",
                web_mode=True,
                report_id=report_id
            )
            logger.info(f"V2 report generated: {v2_path}")
        except Exception as e:
            logger.warning(f"Failed to generate V2 report: {e}")

        # Update report with statistics
        db.update_report(
            report_id,
            requests_count=req_count,
            pl_count=pl_count,
            matched_count=len(matched_df),
            pl_unmatched_count=pl_unmatched_count
        )

        with fetch_lock:
            fetch_status['running'] = False
            fetch_status['progress'] = 'Готово!'
            fetch_status['completed_at'] = datetime.now().isoformat()
            fetch_status['stats'] = {
                'requests': req_count,
                'pl': pl_count,
                'matched': len(matched_df),
                'monitoring': matched_count
            }

    except Exception as e:
        logger.exception("Fetch pipeline error")
        with fetch_lock:
            fetch_status['running'] = False
            fetch_status['error'] = str(e)


# ============================================================
# Run server
# ============================================================

def run_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the FastAPI server."""
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_server()
