"""
SQLite models for archive functionality.
Uses SQLAlchemy for database operations.
"""

from datetime import datetime, timedelta
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from pathlib import Path
import json

Base = declarative_base()


class Report(Base):
    """Report history record."""
    __tablename__ = 'reports'

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=True)
    from_requests = Column(String(20), nullable=True)  # "15.01.2026"
    to_requests = Column(String(20), nullable=True)
    from_pl = Column(String(20), nullable=True)
    to_pl = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    html_filename = Column(String(200), nullable=True)  # "report_15-01_20-01.html"
    viewed_requests = Column(Text, nullable=True)  # JSON: ["12345", "12346", ...]

    # Statistics
    requests_count = Column(Integer, nullable=True)  # Total requests fetched
    pl_count = Column(Integer, nullable=True)  # Total PL fetched
    matched_count = Column(Integer, nullable=True)  # Matched PL count
    pl_unmatched_count = Column(Integer, nullable=True)  # PL without matching request

    # Relationship to shift cache
    shift_caches = relationship("ShiftCache", back_populates="report", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'from_requests': self.from_requests,
            'to_requests': self.to_requests,
            'from_pl': self.from_pl,
            'to_pl': self.to_pl,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'html_filename': self.html_filename,
            'viewed_requests': json.loads(self.viewed_requests) if self.viewed_requests else [],
            'requests_count': self.requests_count,
            'pl_count': self.pl_count,
            'matched_count': self.matched_count,
            'pl_unmatched_count': self.pl_unmatched_count
        }

    def get_viewed_requests(self) -> list:
        """Get list of viewed request numbers."""
        if not self.viewed_requests:
            return []
        return json.loads(self.viewed_requests)

    def set_viewed_requests(self, request_numbers: list):
        """Set list of viewed request numbers."""
        self.viewed_requests = json.dumps(request_numbers)


class ShiftCache(Base):
    """Cached shift monitoring data."""
    __tablename__ = 'shift_cache'

    id = Column(Integer, primary_key=True)
    report_id = Column(Integer, ForeignKey('reports.id'), nullable=False)
    pl_id = Column(String(100), nullable=False)
    ts_id_mo = Column(Integer, nullable=False)
    shift_key = Column(String(50), nullable=False)  # "25.01.2026_morning"
    monitoring_data = Column(Text, nullable=True)  # JSON blob
    loaded_at = Column(DateTime, default=datetime.utcnow)

    # Relationship to report
    report = relationship("Report", back_populates="shift_caches")

    # Unique constraint
    __table_args__ = (
        # UNIQUE(report_id, pl_id, ts_id_mo, shift_key) is handled by create index
    )

    def to_dict(self):
        return {
            'id': self.id,
            'report_id': self.report_id,
            'pl_id': self.pl_id,
            'ts_id_mo': self.ts_id_mo,
            'shift_key': self.shift_key,
            'monitoring_data': json.loads(self.monitoring_data) if self.monitoring_data else None,
            'loaded_at': self.loaded_at.isoformat() if self.loaded_at else None
        }

    def get_monitoring_data(self) -> dict:
        """Get parsed monitoring data."""
        if not self.monitoring_data:
            return {}
        return json.loads(self.monitoring_data)

    def set_monitoring_data(self, data: dict):
        """Set monitoring data as JSON."""
        self.monitoring_data = json.dumps(data)


class ArchivedRequest(Base):
    """Archived request record."""
    __tablename__ = 'archived_requests'

    id = Column(Integer, primary_key=True)
    request_number = Column(String(50), unique=True, nullable=False, index=True)
    archived_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)
    archived_by = Column(String(100), nullable=True)  # User identifier (optional)

    # Cached request info for quick display
    route_start_address = Column(String(500), nullable=True)
    route_end_address = Column(String(500), nullable=True)
    route_start_date = Column(String(50), nullable=True)
    pl_count = Column(Integer, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'request_number': self.request_number,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'notes': self.notes,
            'archived_by': self.archived_by,
            'route_start_address': self.route_start_address,
            'route_end_address': self.route_end_address,
            'route_start_date': self.route_start_date,
            'pl_count': self.pl_count
        }


class Vehicle(Base):
    """Vehicle registry — auto-populated from PL data."""
    __tablename__ = 'vehicles'

    id = Column(Integer, primary_key=True)
    ts_id_mo = Column(Integer, unique=True, nullable=False, index=True)
    ts_reg_number = Column(String(50))
    ts_name_mo = Column(String(200))
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)

    pl_records = relationship("PLRecord", back_populates="vehicle")

    def to_dict(self):
        return {
            'id': self.id,
            'ts_id_mo': self.ts_id_mo,
            'ts_reg_number': self.ts_reg_number,
            'ts_name_mo': self.ts_name_mo,
            'first_seen_at': self.first_seen_at.isoformat() if self.first_seen_at else None,
            'last_seen_at': self.last_seen_at.isoformat() if self.last_seen_at else None,
        }


class TrackedRequest(Base):
    """Tracked request — cumulative, respects stability."""
    __tablename__ = 'tracked_requests'

    id = Column(Integer, primary_key=True)
    request_number = Column(Integer, unique=True, nullable=False, index=True)
    request_status = Column(String(50))
    stability_status = Column(String(20))  # 'stable' / 'in_progress'

    route_start_address = Column(String(500))
    route_end_address = Column(String(500))
    route_start_date = Column(String(50))
    route_end_date = Column(String(50))
    route_distance = Column(String(50))
    object_expend_code = Column(String(100))
    object_expend_name = Column(String(200))
    order_name_cargo = Column(String(200))

    matched_data_json = Column(Text)

    first_synced_at = Column(DateTime, default=datetime.utcnow)
    last_synced_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'request_number': self.request_number,
            'request_status': self.request_status,
            'stability_status': self.stability_status,
            'route_start_address': self.route_start_address,
            'route_end_address': self.route_end_address,
            'route_start_date': self.route_start_date,
            'route_end_date': self.route_end_date,
            'route_distance': self.route_distance,
            'object_expend_code': self.object_expend_code,
            'object_expend_name': self.object_expend_name,
            'order_name_cargo': self.order_name_cargo,
            'first_synced_at': self.first_synced_at.isoformat() if self.first_synced_at else None,
            'last_synced_at': self.last_synced_at.isoformat() if self.last_synced_at else None,
        }


class PLRecord(Base):
    """PL record — links vehicle to request."""
    __tablename__ = 'pl_records'

    id = Column(Integer, primary_key=True)
    vehicle_id = Column(Integer, ForeignKey('vehicles.id'), index=True)
    request_number = Column(Integer, index=True)

    pl_id = Column(String(100), unique=True, nullable=False)
    pl_ts_number = Column(String(50))
    pl_date_out = Column(String(50))
    pl_date_out_plan = Column(String(50))
    pl_date_in_plan = Column(String(50))
    pl_status = Column(String(50))
    pl_close_list = Column(String(50))

    has_monitoring = Column(Boolean, default=False)

    synced_at = Column(DateTime, default=datetime.utcnow)

    vehicle = relationship("Vehicle", back_populates="pl_records")

    def to_dict(self):
        return {
            'id': self.id,
            'vehicle_id': self.vehicle_id,
            'request_number': self.request_number,
            'pl_id': self.pl_id,
            'pl_ts_number': self.pl_ts_number,
            'pl_date_out': self.pl_date_out,
            'pl_date_out_plan': self.pl_date_out_plan,
            'pl_date_in_plan': self.pl_date_in_plan,
            'pl_status': self.pl_status,
            'pl_close_list': self.pl_close_list,
            'has_monitoring': self.has_monitoring,
            'synced_at': self.synced_at.isoformat() if self.synced_at else None,
        }


class SyncLog(Base):
    """Sync log — records each synchronization run."""
    __tablename__ = 'sync_log'

    id = Column(Integer, primary_key=True)
    synced_at = Column(DateTime, default=datetime.utcnow)
    period_from_pl = Column(String(20))
    period_to_pl = Column(String(20))
    period_from_req = Column(String(20))
    period_to_req = Column(String(20))
    vehicles_count = Column(Integer)
    requests_total = Column(Integer)
    requests_stable = Column(Integer)
    requests_in_progress = Column(Integer)
    status = Column(String(20))
    error_message = Column(Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'synced_at': self.synced_at.isoformat() if self.synced_at else None,
            'period_from_pl': self.period_from_pl,
            'period_to_pl': self.period_to_pl,
            'period_from_req': self.period_from_req,
            'period_to_req': self.period_to_req,
            'vehicles_count': self.vehicles_count,
            'requests_total': self.requests_total,
            'requests_stable': self.requests_stable,
            'requests_in_progress': self.requests_in_progress,
            'status': self.status,
            'error_message': self.error_message,
        }


class Database:
    """Database connection manager."""

    def __init__(self, db_path: str = None):
        if db_path is None:
            # Default: store in Data directory
            base_dir = Path(__file__).parent.parent.parent
            db_path = base_dir / 'Data' / 'archive.db'
            db_path.parent.mkdir(parents=True, exist_ok=True)

        self.db_path = str(db_path)
        self.engine = create_engine(f'sqlite:///{self.db_path}', echo=False)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def get_session(self):
        return self.Session()

    def archive_request(
        self,
        request_number: str,
        notes: str = None,
        archived_by: str = None,
        route_start_address: str = None,
        route_end_address: str = None,
        route_start_date: str = None,
        pl_count: int = None
    ) -> ArchivedRequest:
        """Add request to archive."""
        session = self.get_session()
        try:
            # Check if already archived
            existing = session.query(ArchivedRequest).filter_by(
                request_number=request_number
            ).first()

            if existing:
                # Update notes if provided
                if notes:
                    existing.notes = notes
                session.commit()
                return existing

            # Create new archive entry
            entry = ArchivedRequest(
                request_number=request_number,
                notes=notes,
                archived_by=archived_by,
                route_start_address=route_start_address,
                route_end_address=route_end_address,
                route_start_date=route_start_date,
                pl_count=pl_count
            )
            session.add(entry)
            session.commit()
            session.refresh(entry)
            return entry
        finally:
            session.close()

    def unarchive_request(self, request_number: str) -> bool:
        """Remove request from archive."""
        session = self.get_session()
        try:
            entry = session.query(ArchivedRequest).filter_by(
                request_number=request_number
            ).first()
            if entry:
                session.delete(entry)
                session.commit()
                return True
            return False
        finally:
            session.close()

    def get_archived(self, limit: int = 100, offset: int = 0) -> list:
        """Get list of archived requests."""
        session = self.get_session()
        try:
            entries = session.query(ArchivedRequest).order_by(
                ArchivedRequest.archived_at.desc()
            ).offset(offset).limit(limit).all()
            return [e.to_dict() for e in entries]
        finally:
            session.close()

    def is_archived(self, request_number: str) -> bool:
        """Check if request is archived."""
        session = self.get_session()
        try:
            return session.query(ArchivedRequest).filter_by(
                request_number=request_number
            ).first() is not None
        finally:
            session.close()

    def get_archived_numbers(self) -> set:
        """Get set of all archived request numbers."""
        session = self.get_session()
        try:
            entries = session.query(ArchivedRequest.request_number).all()
            return {e.request_number for e in entries}
        finally:
            session.close()

    def count_archived(self) -> int:
        """Count total archived requests."""
        session = self.get_session()
        try:
            return session.query(ArchivedRequest).count()
        finally:
            session.close()

    # ============================================================
    # Report methods
    # ============================================================

    def create_report(
        self,
        title: str,
        from_requests: str,
        to_requests: str,
        from_pl: str,
        to_pl: str,
        html_filename: str = None,
        requests_count: int = None,
        pl_count: int = None,
        matched_count: int = None,
        pl_unmatched_count: int = None
    ) -> Report:
        """Create a new report record."""
        session = self.get_session()
        try:
            report = Report(
                title=title,
                from_requests=from_requests,
                to_requests=to_requests,
                from_pl=from_pl,
                to_pl=to_pl,
                html_filename=html_filename,
                viewed_requests='[]',
                requests_count=requests_count,
                pl_count=pl_count,
                matched_count=matched_count,
                pl_unmatched_count=pl_unmatched_count
            )
            session.add(report)
            session.commit()
            session.refresh(report)
            return report
        finally:
            session.close()

    def get_report(self, report_id: int) -> Report:
        """Get report by ID."""
        session = self.get_session()
        try:
            return session.query(Report).filter_by(id=report_id).first()
        finally:
            session.close()

    def get_reports(self, limit: int = 50, offset: int = 0) -> list:
        """Get list of reports, newest first."""
        session = self.get_session()
        try:
            reports = session.query(Report).order_by(
                Report.created_at.desc()
            ).offset(offset).limit(limit).all()
            return [r.to_dict() for r in reports]
        finally:
            session.close()

    def update_report(
        self,
        report_id: int,
        html_filename: str = None,
        viewed_requests: list = None,
        requests_count: int = None,
        pl_count: int = None,
        matched_count: int = None,
        pl_unmatched_count: int = None
    ) -> bool:
        """Update report fields."""
        session = self.get_session()
        try:
            report = session.query(Report).filter_by(id=report_id).first()
            if not report:
                return False
            if html_filename is not None:
                report.html_filename = html_filename
            if viewed_requests is not None:
                report.set_viewed_requests(viewed_requests)
            if requests_count is not None:
                report.requests_count = requests_count
            if pl_count is not None:
                report.pl_count = pl_count
            if matched_count is not None:
                report.matched_count = matched_count
            if pl_unmatched_count is not None:
                report.pl_unmatched_count = pl_unmatched_count
            session.commit()
            return True
        finally:
            session.close()

    def delete_report(self, report_id: int) -> bool:
        """Delete a report and its shift cache."""
        session = self.get_session()
        try:
            report = session.query(Report).filter_by(id=report_id).first()
            if report:
                session.delete(report)
                session.commit()
                return True
            return False
        finally:
            session.close()

    # ============================================================
    # Shift cache methods
    # ============================================================

    def get_shift_cache(
        self,
        report_id: int,
        pl_id: str,
        ts_id_mo: int,
        shift_key: str
    ) -> ShiftCache:
        """Get cached shift data if exists."""
        session = self.get_session()
        try:
            return session.query(ShiftCache).filter_by(
                report_id=report_id,
                pl_id=pl_id,
                ts_id_mo=ts_id_mo,
                shift_key=shift_key
            ).first()
        finally:
            session.close()

    def get_all_shift_caches(
        self,
        report_id: int,
        pl_id: str,
        ts_id_mo: int
    ) -> list:
        """Get all cached shifts for a vehicle in a PL."""
        session = self.get_session()
        try:
            caches = session.query(ShiftCache).filter_by(
                report_id=report_id,
                pl_id=pl_id,
                ts_id_mo=ts_id_mo
            ).all()
            return [c.to_dict() for c in caches]
        finally:
            session.close()

    def save_shift_cache(
        self,
        report_id: int,
        pl_id: str,
        ts_id_mo: int,
        shift_key: str,
        monitoring_data: dict
    ) -> ShiftCache:
        """Save or update shift cache."""
        session = self.get_session()
        try:
            existing = session.query(ShiftCache).filter_by(
                report_id=report_id,
                pl_id=pl_id,
                ts_id_mo=ts_id_mo,
                shift_key=shift_key
            ).first()

            if existing:
                existing.set_monitoring_data(monitoring_data)
                existing.loaded_at = datetime.utcnow()
                session.commit()
                return existing

            cache = ShiftCache(
                report_id=report_id,
                pl_id=pl_id,
                ts_id_mo=ts_id_mo,
                shift_key=shift_key
            )
            cache.set_monitoring_data(monitoring_data)
            session.add(cache)
            session.commit()
            session.refresh(cache)
            return cache
        finally:
            session.close()

    def save_shift_caches_bulk(
        self,
        report_id: int,
        shifts: list
    ) -> int:
        """Save multiple shift caches at once.

        Args:
            report_id: Report ID
            shifts: List of dicts with keys: pl_id, ts_id_mo, shift_key, monitoring_data

        Returns:
            Number of saved caches
        """
        session = self.get_session()
        try:
            count = 0
            for shift in shifts:
                existing = session.query(ShiftCache).filter_by(
                    report_id=report_id,
                    pl_id=shift['pl_id'],
                    ts_id_mo=shift['ts_id_mo'],
                    shift_key=shift['shift_key']
                ).first()

                if existing:
                    existing.set_monitoring_data(shift['monitoring_data'])
                    existing.loaded_at = datetime.utcnow()
                else:
                    cache = ShiftCache(
                        report_id=report_id,
                        pl_id=shift['pl_id'],
                        ts_id_mo=shift['ts_id_mo'],
                        shift_key=shift['shift_key']
                    )
                    cache.set_monitoring_data(shift['monitoring_data'])
                    session.add(cache)
                count += 1

            session.commit()
            return count
        finally:
            session.close()

    # ============================================================
    # Vehicle / Dashboard methods
    # ============================================================

    def upsert_vehicle(self, ts_id_mo: int, ts_reg_number: str = None, ts_name_mo: str = None) -> int:
        """Upsert vehicle by ts_id_mo. Returns vehicle.id."""
        session = self.get_session()
        try:
            v = session.query(Vehicle).filter_by(ts_id_mo=ts_id_mo).first()
            if v:
                if ts_reg_number:
                    v.ts_reg_number = ts_reg_number
                if ts_name_mo:
                    v.ts_name_mo = ts_name_mo
                v.last_seen_at = datetime.utcnow()
                session.commit()
                return v.id
            v = Vehicle(
                ts_id_mo=ts_id_mo,
                ts_reg_number=ts_reg_number,
                ts_name_mo=ts_name_mo,
            )
            session.add(v)
            session.commit()
            session.refresh(v)
            return v.id
        finally:
            session.close()

    def upsert_tracked_request(self, data: dict) -> str:
        """Upsert tracked request. Returns 'added', 'updated', or 'skipped'."""
        session = self.get_session()
        try:
            req_num = data['request_number']
            existing = session.query(TrackedRequest).filter_by(request_number=req_num).first()
            if existing and existing.stability_status == 'stable':
                return 'skipped'
            if existing:
                for k, v in data.items():
                    if k != 'request_number' and v is not None:
                        setattr(existing, k, v)
                existing.last_synced_at = datetime.utcnow()
                session.commit()
                return 'updated'
            else:
                existing = TrackedRequest(**data)
                session.add(existing)
                session.commit()
                return 'added'
        finally:
            session.close()

    def upsert_pl_record(self, data: dict) -> None:
        """Upsert PL record by pl_id."""
        session = self.get_session()
        try:
            existing = session.query(PLRecord).filter_by(pl_id=data['pl_id']).first()
            if existing:
                for k, v in data.items():
                    if k != 'pl_id' and v is not None:
                        setattr(existing, k, v)
                existing.synced_at = datetime.utcnow()
            else:
                existing = PLRecord(**data)
                session.add(existing)
            session.commit()
        finally:
            session.close()

    def create_sync_log(self, data: dict) -> SyncLog:
        """Create a sync log entry."""
        session = self.get_session()
        try:
            entry = SyncLog(**data)
            session.add(entry)
            session.commit()
            session.refresh(entry)
            return entry
        finally:
            session.close()

    def get_last_sync(self) -> dict:
        """Get last successful sync log."""
        session = self.get_session()
        try:
            entry = session.query(SyncLog).filter_by(status='success').order_by(
                SyncLog.synced_at.desc()
            ).first()
            return entry.to_dict() if entry else None
        finally:
            session.close()

    def _date_cutoff(self, days: int) -> str:
        """Return cutoff date string YYYY-MM-DD for filtering pl_date_out."""
        return (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

    @staticmethod
    def _parse_pl_date(date_str: str) -> str:
        """Convert 'DD.MM.YYYY ...' to 'YYYY-MM-DD' for comparison."""
        if not date_str:
            return ''
        parts = date_str.strip().split(' ')[0].split('.')
        if len(parts) == 3:
            return f'{parts[2]}-{parts[1]}-{parts[0]}'
        return ''

    def get_vehicles_with_stats(self, days: int = None) -> list:
        """Get all vehicles with request counts. If days given, only count PLs within period."""
        session = self.get_session()
        try:
            vehicles = session.query(Vehicle).order_by(Vehicle.ts_reg_number).all()
            cutoff = self._date_cutoff(days) if days else None
            result = []
            for v in vehicles:
                # Get PL records for this vehicle, optionally filtered by date
                pl_query = session.query(PLRecord).filter(
                    PLRecord.vehicle_id == v.id,
                    PLRecord.request_number.isnot(None)
                )
                pl_records = pl_query.all()

                # Filter by date if cutoff set
                if cutoff:
                    pl_records = [p for p in pl_records if self._parse_pl_date(p.pl_date_out) >= cutoff]

                req_nums = list(set(p.request_number for p in pl_records))

                stable = 0
                in_progress = 0
                for rn in req_nums:
                    tr = session.query(TrackedRequest).filter_by(request_number=rn).first()
                    if tr:
                        if tr.stability_status == 'stable':
                            stable += 1
                        else:
                            in_progress += 1

                vd = v.to_dict()
                vd['requests_total'] = len(req_nums)
                vd['requests_stable'] = stable
                vd['requests_in_progress'] = in_progress
                result.append(vd)
            return result
        finally:
            session.close()

    def get_vehicle_requests(self, vehicle_id: int, days: int = None) -> list:
        """Get requests for a specific vehicle. If days given, only include PLs within period."""
        session = self.get_session()
        try:
            pl_records = session.query(PLRecord).filter_by(vehicle_id=vehicle_id).all()
            cutoff = self._date_cutoff(days) if days else None
            if cutoff:
                pl_records = [p for p in pl_records if self._parse_pl_date(p.pl_date_out) >= cutoff]
            req_nums = set(pl.request_number for pl in pl_records if pl.request_number)

            result = []
            for rn in sorted(req_nums):
                tr = session.query(TrackedRequest).filter_by(request_number=rn).first()
                pls = [pl.to_dict() for pl in pl_records if pl.request_number == rn]
                entry = tr.to_dict() if tr else {'request_number': rn}
                entry['pl_records'] = pls
                result.append(entry)
            return result
        finally:
            session.close()

    def get_dashboard_summary(self) -> dict:
        """Get dashboard summary stats."""
        session = self.get_session()
        try:
            vehicles_count = session.query(Vehicle).count()
            requests_total = session.query(TrackedRequest).count()
            requests_stable = session.query(TrackedRequest).filter_by(stability_status='stable').count()
            requests_in_progress = session.query(TrackedRequest).filter_by(stability_status='in_progress').count()
            last_sync = self.get_last_sync()
            return {
                'vehicles_count': vehicles_count,
                'requests_total': requests_total,
                'requests_stable': requests_stable,
                'requests_in_progress': requests_in_progress,
                'last_sync': last_sync,
            }
        finally:
            session.close()

    def get_in_progress_request_numbers(self) -> set:
        """Get set of request numbers that are still in_progress."""
        session = self.get_session()
        try:
            entries = session.query(TrackedRequest.request_number).filter_by(
                stability_status='in_progress'
            ).all()
            return {e.request_number for e in entries}
        finally:
            session.close()

    def get_vehicle_timeline(self, vehicle_id: int, days: int = None) -> list:
        """Get timeline segments for a vehicle.

        Returns list of segments sorted by date, each with:
        - pl_id, pl_date_out_plan, pl_date_in_plan, pl_status
        - request_number, request_status, stability_status
        - route_start_address, route_end_address
        """
        session = self.get_session()
        try:
            pl_records = session.query(PLRecord).filter_by(
                vehicle_id=vehicle_id
            ).order_by(PLRecord.pl_date_out_plan).all()

            cutoff = self._date_cutoff(days) if days else None
            if cutoff:
                pl_records = [p for p in pl_records if self._parse_pl_date(p.pl_date_out) >= cutoff]

            segments = []
            for pl in pl_records:
                seg = pl.to_dict()
                if pl.request_number:
                    tr = session.query(TrackedRequest).filter_by(
                        request_number=pl.request_number
                    ).first()
                    if tr:
                        seg['request_status'] = tr.request_status
                        seg['stability_status'] = tr.stability_status
                        seg['route_start_address'] = tr.route_start_address
                        seg['route_end_address'] = tr.route_end_address
                        seg['order_name_cargo'] = tr.order_name_cargo
                segments.append(seg)
            return segments
        finally:
            session.close()

    def cleanup_old_data(self, max_age_days: int = 60) -> dict:
        """Delete data older than max_age_days. Returns cleanup stats."""
        cutoff = self._date_cutoff(max_age_days)
        session = self.get_session()
        try:
            # 1. Find and delete old PLRecords
            all_pls = session.query(PLRecord).all()
            old_pl_ids = []
            for pl in all_pls:
                parsed = self._parse_pl_date(pl.pl_date_out)
                if parsed and parsed < cutoff:
                    old_pl_ids.append(pl.id)

            deleted_pls = 0
            if old_pl_ids:
                deleted_pls = session.query(PLRecord).filter(
                    PLRecord.id.in_(old_pl_ids)
                ).delete(synchronize_session='fetch')

            # 2. Delete orphaned TrackedRequests (no PLRecords referencing them)
            all_active_req_nums = set(
                r[0] for r in session.query(PLRecord.request_number).filter(
                    PLRecord.request_number.isnot(None)
                ).distinct().all()
            )
            orphan_reqs = session.query(TrackedRequest).filter(
                ~TrackedRequest.request_number.in_(all_active_req_nums) if all_active_req_nums
                else TrackedRequest.id > 0
            ).all()
            deleted_reqs = len(orphan_reqs)
            for req in orphan_reqs:
                session.delete(req)

            # 3. Delete orphaned Vehicles (no PLRecords referencing them)
            all_active_vehicle_ids = set(
                r[0] for r in session.query(PLRecord.vehicle_id).filter(
                    PLRecord.vehicle_id.isnot(None)
                ).distinct().all()
            )
            orphan_vehicles = session.query(Vehicle).filter(
                ~Vehicle.id.in_(all_active_vehicle_ids) if all_active_vehicle_ids
                else Vehicle.id > 0
            ).all()
            deleted_vehicles = len(orphan_vehicles)
            for v in orphan_vehicles:
                session.delete(v)

            # 4. Delete old SyncLogs
            sync_cutoff = datetime.now() - timedelta(days=max_age_days)
            deleted_syncs = session.query(SyncLog).filter(
                SyncLog.synced_at < sync_cutoff
            ).delete(synchronize_session='fetch')

            session.commit()
            return {
                'deleted_pls': deleted_pls,
                'deleted_requests': deleted_reqs,
                'deleted_vehicles': deleted_vehicles,
                'deleted_sync_logs': deleted_syncs,
            }
        finally:
            session.close()

    def get_all_vehicles_timeline(self) -> list:
        """Get timeline for all vehicles (for overview)."""
        session = self.get_session()
        try:
            vehicles = session.query(Vehicle).order_by(Vehicle.ts_reg_number).all()
            result = []
            for v in vehicles:
                timeline = self.get_vehicle_timeline(v.id)
                if timeline:
                    vd = v.to_dict()
                    vd['segments'] = timeline
                    result.append(vd)
            return result
        finally:
            session.close()
