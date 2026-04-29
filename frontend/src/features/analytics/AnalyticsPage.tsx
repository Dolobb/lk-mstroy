import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { DateRangePicker } from '@/components/DateRangePicker';
import { MiniBar } from '@/components/MiniBar';
import { ShiftChip } from '@/components/ShiftChip';
import { ShiftGanttBar } from '@/components/ShiftGanttBar';
import { abbreviateOrg } from '@/features/samosvaly/orgAbbrev';
import '@/features/samosvaly/samosvaly.css';
import {
  fetchUnifiedData,
  fetchKipVehicleDetails,
  kipDetailToUnified,
  fetchKipSegments,
  fetchKipSegmentProgress,
  triggerKipSegmentFetch,
} from './api';
import type { UnifiedVehicleRow, UnifiedRecord, KipSegment, KipSegmentProgress } from './types';

// ─── Helpers ────────────────────────────────────────────

function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtDateShort(isoDate: string): string {
  const dateOnly = isoDate.split('T')[0] ?? isoDate;
  const p = dateOnly.split('-');
  return `${p[2]}.${p[1]}`;
}

function toDateStr(isoDate: string): string {
  return (isoDate.split('T')[0] ?? isoDate).substring(0, 10);
}

function kipColor(v: number): string {
  return v >= 75 ? 'sv-v-g' : v >= 50 ? 'sv-v-b' : 'sv-v-r';
}

// ─── Vehicle type filters ───────────────────────────────

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'dt_delivery', label: 'Самосв. доставка' },
  { key: 'dt_onsite', label: 'Самосв. по месту' },
  { key: 'crane_auto', label: 'Краны авт.' },
  { key: 'crane_crawler', label: 'Краны гусен.' },
  { key: 'crane_pneumo', label: 'Краны пневмо.' },
  { key: 'bulldozer', label: 'Бульдозер' },
  { key: 'roller', label: 'Каток' },
  { key: 'loader', label: 'Погрузчик' },
  { key: 'exc_crawler', label: 'Экск. гусен.' },
  { key: 'exc_wheeled', label: 'Экск. колесный' },
  { key: 'exc_loader', label: 'Экск.-погрузчик' },
];

function matchesTypeFilter(row: UnifiedVehicleRow, filters: Set<string>): boolean {
  if (filters.has('all')) return true;
  const vt = row.vehicleType.toLowerCase();
  for (const f of filters) {
    switch (f) {
      case 'dt_delivery':
        if (row.source === 'dump_truck') {
          const hasDelivery = row.records.some(r => r.workType === 'delivery');
          if (hasDelivery) return true;
        }
        break;
      case 'dt_onsite':
        if (row.source === 'dump_truck') {
          const hasOnsite = row.records.some(r => r.workType === 'onsite');
          if (hasOnsite) return true;
        }
        break;
      case 'crane_auto': if (vt.includes('краны автомобильные')) return true; break;
      case 'crane_crawler': if (vt.includes('краны гусеничные')) return true; break;
      case 'crane_pneumo': if (vt.includes('краны пневмоколёсные')) return true; break;
      case 'bulldozer': if (vt.includes('бульдозер')) return true; break;
      case 'roller': if (vt.includes('каток')) return true; break;
      case 'loader': if (vt === 'погрузчик') return true; break;
      case 'exc_crawler': if (vt === 'экскаватор гусеничный') return true; break;
      case 'exc_wheeled': if (vt === 'экскаватор колесный') return true; break;
      case 'exc_loader': if (vt === 'экскаватор-погрузчик') return true; break;
    }
  }
  return false;
}

// ─── Defaults ───────────────────────────────────────────

const _today = new Date();
const DEFAULT_DATE_FROM = new Date(_today.getFullYear(), _today.getMonth(), 1).toISOString().slice(0, 10);
const DEFAULT_DATE_TO = _today.toISOString().slice(0, 10);

// ─── Component ──────────────────────────────────────────

export function AnalyticsPage() {
  const { resolvedTheme } = useTheme();
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO);
  const [shift, setShift] = useState<'all' | 'shift1' | 'shift2'>('all');
  const [vehicleFilters, setVehicleFilters] = useState<Set<string>>(new Set(['all']));
  const [searchQuery, setSearchQuery] = useState('');

  const toggleFilter = (key: string) => {
    setVehicleFilters(prev => {
      if (key === 'all') return new Set(['all']);
      const next = new Set(prev);
      next.delete('all');
      if (next.has(key)) next.delete(key); else next.add(key);
      return next.size === 0 ? new Set(['all']) : next;
    });
  };

  const [dtRows, setDtRows] = useState<UnifiedVehicleRow[]>([]);
  const [dstRows, setDstRows] = useState<UnifiedVehicleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-loaded DST details cache: regNumber → UnifiedRecord[]
  const [dstDetails, setDstDetails] = useState<Map<string, UnifiedRecord[]>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());

  // Table state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // KIP segments state
  const [kipSegProgress, setKipSegProgress] = useState<KipSegmentProgress | null>(null);

  // ─── Fetch data ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDstDetails(new Map());
    setExpanded(new Set());
    setSelectedChip(null);

    fetchUnifiedData(dateFrom, dateTo)
      .then(({ dtRows: dt, dstRows: dst }) => {
        if (cancelled) return;
        setDtRows(dt);
        setDstRows(dst);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('fetchUnifiedData error:', err);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  // ─── Lazy load DST details on expand ────────────────

  const loadDstDetails = useCallback(async (row: UnifiedVehicleRow) => {
    if (!row.kipVehicleId || dstDetails.has(row.regNumber)) return;
    if (loadingDetails.has(row.regNumber)) return;

    setLoadingDetails(prev => new Set(prev).add(row.regNumber));
    try {
      const details = await fetchKipVehicleDetails(row.kipVehicleId, dateFrom, dateTo);
      const records = details.map(d =>
        kipDetailToUnified(d, row.nameMO, row.vehicleType, row.organization ?? '', row.departmentUnit ?? '', row.regNumber)
      );
      setDstDetails(prev => new Map(prev).set(row.regNumber, records));
    } catch (err) {
      console.error('loadDstDetails error:', err);
    } finally {
      setLoadingDetails(prev => {
        const s = new Set(prev);
        s.delete(row.regNumber);
        return s;
      });
    }
  }, [dateFrom, dateTo, dstDetails, loadingDetails]);

  // ─── KIP Segment progress polling ─────────────────────

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const p = await fetchKipSegmentProgress();
        if (!cancelled) setKipSegProgress(p);
      } catch { /* KIP not running */ }
    };

    poll();
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // ─── Merged & filtered rows ─────────────────────────

  const allRows: UnifiedVehicleRow[] = React.useMemo(() => {
    let merged = [...dtRows, ...dstRows];

    // Type filter
    merged = merged.filter(r => matchesTypeFilter(r, vehicleFilters));

    // Shift filter: for DT rows, filter records; for DST rows, apply on lazy details
    if (shift !== 'all') {
      merged = merged.map(r => {
        if (r.source === 'dump_truck') {
          const filteredRecs = r.records.filter(rec => rec.shiftType === shift);
          if (!filteredRecs.length) return null;
          const kipVals = filteredRecs.filter(rec => rec.kipPct > 0).map(rec => rec.kipPct);
          const secVals = filteredRecs.filter(rec => rec.secondaryPct > 0).map(rec => rec.secondaryPct);
          return {
            ...r,
            records: filteredRecs,
            shiftsCount: filteredRecs.length,
            avgKipPct: kipVals.length ? kipVals.reduce((a, b) => a + b, 0) / kipVals.length : 0,
            avgSecondaryPct: secVals.length ? secVals.reduce((a, b) => a + b, 0) / secVals.length : 0,
            totalTrips: filteredRecs.reduce((s, rec) => s + (rec.tripsCount ?? 0), 0),
            engineTotalSec: filteredRecs.reduce((s, rec) => s + rec.engineTimeSec, 0),
          };
        }
        return r; // DST: shift filtering happens on lazy details
      }).filter(Boolean) as UnifiedVehicleRow[];
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      merged = merged.filter(r =>
        r.regNumber.toLowerCase().includes(q) ||
        r.nameMO.toLowerCase().includes(q) ||
        (r.organization ?? '').toLowerCase().includes(q)
      );
    }

    return merged;
  }, [dtRows, dstRows, vehicleFilters, shift, searchQuery]);

  // ─── Sort ───────────────────────────────────────────

  const sortedRows = React.useMemo(() => {
    if (!sortCol) return allRows;
    return [...allRows].sort((a, b) => {
      let va = 0, vb = 0;
      switch (sortCol) {
        case 'shiftsCount': va = a.shiftsCount; vb = b.shiftsCount; break;
        case 'tripsOrFuel':
          va = a.source === 'dump_truck' ? a.totalTrips : a.totalFuelL;
          vb = b.source === 'dump_truck' ? b.totalTrips : b.totalFuelL;
          break;
        case 'kipBar': va = a.avgKipPct; vb = b.avgKipPct; break;
        case 'engineTotal': va = a.engineTotalSec; vb = b.engineTotalSec; break;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [allRows, sortCol, sortDir]);

  // ─── Grouping by SMU/department ─────────────────────

  type GroupEntry = { groupName: string; vehicles: UnifiedVehicleRow[] };

  const groups: GroupEntry[] = React.useMemo(() => {
    const gMap = new Map<string, UnifiedVehicleRow[]>();
    sortedRows.forEach(v => {
      let group: string;
      if (v.source === 'dump_truck') {
        const objCounts = new Map<string, number>();
        v.records.forEach(r => {
          const name = r.objectName ?? 'Без объекта';
          objCounts.set(name, (objCounts.get(name) ?? 0) + 1);
        });
        group = [...objCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Без объекта';
      } else {
        group = v.departmentUnit || 'Без подразделения';
      }
      if (!gMap.has(group)) gMap.set(group, []);
      gMap.get(group)!.push(v);
    });
    return [...gMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupName, vehicles]) => ({ groupName, vehicles }));
  }, [sortedRows]);

  // ─── Summary strip ──────────────────────────────────

  const summaryCards = React.useMemo(() => {
    const allVehicles = sortedRows.length;
    const dtCount = sortedRows.filter(r => r.source === 'dump_truck').length;
    const dstCount = sortedRows.filter(r => r.source === 'dst').length;
    const totalTrips = sortedRows.reduce((s, r) => s + r.totalTrips, 0);
    const kipVals = sortedRows.filter(r => r.avgKipPct > 0).map(r => r.avgKipPct);
    const avgKip = kipVals.length ? Math.round(kipVals.reduce((a, b) => a + b, 0) / kipVals.length) : 0;

    return [
      { title: 'Все ТС', value: String(allVehicles), sub: `${dtCount} сам. + ${dstCount} ДСТ` },
      { title: 'Рейсов', value: String(totalTrips), sub: 'самосвалы' },
      { title: 'Ср. КИП', value: avgKip > 0 ? `${avgKip}%` : '—', sub: 'все типы', className: avgKip > 0 ? kipColor(avgKip) : '' },
    ];
  }, [sortedRows]);

  // ─── Handlers ───────────────────────────────────────

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const toggleExpand = (key: string, row?: UnifiedVehicleRow) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(key)) { s.delete(key); } else {
        s.add(key);
        // Lazy-load DST details
        if (row?.source === 'dst') loadDstDetails(row);
      }
      return s;
    });
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const SortIcon = ({ col }: { col: string }) => sortCol === col
    ? <span style={{ marginLeft: 3, fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
    : null;

  // ─── Chip helpers ───────────────────────────────────

  type ChipData = {
    key: string; date: string; shift: 0 | 1 | 2;
    trips: number; kip: number; movement: number;
    workType: string; engineHours?: number;
  };

  function buildChips(recs: UnifiedRecord[], regNumber: string): ChipData[] {
    const sorted = [...recs].sort((a, b) =>
      toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType)
    );
    return sorted.map(r => ({
      key: `${regNumber}_${toDateStr(r.reportDate)}_${r.shiftType}`,
      date: fmtDateShort(toDateStr(r.reportDate)),
      shift: (r.shiftType === 'shift1' ? 1 : 2) as 1 | 2,
      trips: r.tripsCount ?? 0,
      kip: r.kipPct,
      movement: r.secondaryPct,
      workType: r.workType ?? 'delivery',
      engineHours: Math.round(r.engineTimeSec / 3600),
    }));
  }

  function findRecsForChip(chipKey: string, recs: UnifiedRecord[]): UnifiedRecord[] {
    const parts = chipKey.split('_');
    const shiftType = parts[parts.length - 1] as string;
    const date = parts[parts.length - 2] as string;
    return recs.filter(r => toDateStr(r.reportDate) === date && r.shiftType === shiftType);
  }

  // ─── Get records for a row (with lazy DST) ─────────

  function getRecords(row: UnifiedVehicleRow): UnifiedRecord[] {
    if (row.source === 'dump_truck') return row.records;
    return dstDetails.get(row.regNumber) ?? [];
  }

  // ─── Render cell ────────────────────────────────────

  function renderCell(colId: string, row: UnifiedVehicleRow): React.ReactNode {
    switch (colId) {
      case 'requestNumber': {
        const fromRecords = row.records.flatMap(r => r.requestNumbers ?? []);
        const fromRow = row.requestNumbers ?? [];
        const allNums = [...new Set([...fromRecords, ...fromRow])];
        if (!allNums.length) return <span style={{ fontSize: 10 }}>—</span>;
        const text = allNums.map(n => `№${n}`).join(', ');
        if (allNums.length <= 3) return <span style={{ fontSize: 10 }}>{text}</span>;
        const short = allNums.slice(0, 3).map(n => `№${n}`).join(', ') + ' …';
        return <span style={{ fontSize: 10 }} title={text}>{short}</span>;
      }
      case 'vehicleType':
        return <span style={{ fontSize: 10 }}>{row.vehicleType}</span>;
      case 'organization': {
        if (!row.organization) return <span style={{ fontSize: 10 }}>—</span>;
        return <span style={{ fontSize: 10 }} title={row.organization}>{abbreviateOrg(row.organization)}</span>;
      }
      case 'shiftsCount': {
        const gap = row.gapFilledCount ?? 0;
        return (
          <span>
            {row.shiftsCount}
            {gap > 0 && (
              <span
                title={`${gap} см. без данных (gap-fill по границам)`}
                style={{ marginLeft: 4, fontSize: 10, color: '#9ca3af' }}
              >
                ⚑{gap}
              </span>
            )}
          </span>
        );
      }
      case 'tripsOrFuel': {
        if (row.source === 'dump_truck') {
          return <span style={{ fontWeight: 700, color: '#F97316' }}>{row.totalTrips || '—'}</span>;
        }
        const fuel = Math.round(row.totalFuelL);
        return <span style={{ fontWeight: 700, color: '#60A5FA' }}>{fuel > 0 ? `${fuel} л` : '—'}</span>;
      }
      case 'kipBar': {
        const kip = Math.round(row.avgKipPct);
        const sec = Math.round(row.avgSecondaryPct);
        if (!kip && !sec) return <span>—</span>;
        return <MiniBar
          primary={{ value: kip, label: 'КИП' }}
          secondary={{ value: sec, label: row.secondaryLabel }}
        />;
      }
      case 'engineTotal':
        return <span className="sv-td-agg">{fmtHours(row.engineTotalSec)}</span>;
      default:
        return '—';
    }
  }

  // ─── Columns ────────────────────────────────────────

  const COLUMNS = [
    { id: 'requestNumber', label: '№ заявки', sortable: false, maxW: 110 },
    { id: 'vehicleType', label: 'Тип', sortable: false },
    { id: 'organization', label: 'Организация', sortable: false },
    { id: 'shiftsCount', label: 'Смены', sortable: true },
    { id: 'tripsOrFuel', label: 'Рейсы / Расход', sortable: true },
    { id: 'kipBar', label: 'КИП', sortable: true },
    { id: 'engineTotal', label: 'Двиг. итого', sortable: true },
  ] as const;

  // ─── Render ─────────────────────────────────────────

  const totalCols = 1 + COLUMNS.length;

  return (
    <div className="sv-root" data-theme={resolvedTheme} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--sv-text-1)' }}>Аналитика</h2>

        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onRangeChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
          shift={shift}
          onShiftChange={setShift}
        />

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map(f => (
            <button
              key={f.key}
              className={`sv-view-tab ${vehicleFilters.has(f.key) ? 'active' : ''}`}
              onClick={() => toggleFilter(f.key)}
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Поиск ТС..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 6,
            border: '1px solid var(--sv-card-border)',
            background: 'var(--sv-card)',
            color: 'var(--sv-text-1)',
            width: 180,
          }}
        />
      </div>

      {/* Summary strip */}
      <div className="sv-smu-strip" style={{ marginBottom: 8 }}>
        {summaryCards.map(c => (
          <div key={c.title} className="sv-smu-card">
            <div className="sv-smu-card-title">{c.title}</div>
            <div className="sv-smu-card-row">
              <span className={`sv-smu-card-val ${c.className ?? ''}`}>{c.value}</span>
            </div>
            <div className="sv-smu-card-row" style={{ fontSize: 9, opacity: 0.6 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 8, marginBottom: 8, color: '#EF4444', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* KIP Segment progress strip */}
      {kipSegProgress && (kipSegProgress.active.length > 0 || kipSegProgress.queue.length > 0) && (
        <div style={{
          padding: '6px 12px', marginBottom: 8, borderRadius: 8, fontSize: 11,
          background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <svg className="sv-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
          {kipSegProgress.active.map(j => (
            <span key={`${j.vehicleId}-${j.date}-${j.shift}`} style={{ color: 'var(--sv-text-2)' }}>
              <span style={{ fontWeight: 600, color: 'var(--sv-text-1)' }}>{j.vehicleId}</span>
              {' '}{j.segmentsDone}/24
            </span>
          ))}
          {kipSegProgress.queue.length > 0 && (
            <span style={{ color: 'var(--sv-text-3)' }}>
              +{kipSegProgress.queue.length} в очереди
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="sv-an-table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div className="sv-empty">
            <svg className="sv-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
            </svg>
            <span className="sv-empty-text">Загрузка...</span>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="sv-empty">
            <span className="sv-empty-icon">📭</span>
            <span className="sv-empty-text">Нет данных за выбранный период</span>
          </div>
        ) : (
          <table className="sv-at">
            <thead>
              <tr>
                <th className="sv-th-g1" style={{ minWidth: 200, textAlign: 'left', paddingLeft: 10 }}>
                  ТС
                </th>
                {COLUMNS.map(col => (
                  <th
                    key={col.id}
                    className="sv-th-sub"
                    onClick={col.sortable ? () => handleSort(col.id) : undefined}
                    style={{
                      ...(col.sortable ? { cursor: 'pointer' } : {}),
                      ...('maxW' in col && col.maxW ? { maxWidth: col.maxW, overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
                    }}
                  >
                    {col.label}
                    {col.sortable && <SortIcon col={col.id} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const gKey = `grp_${gi}`;
                const isGroupOpen = !collapsedGroups.has(gKey);

                return (
                  <React.Fragment key={gKey}>
                    {/* Group header */}
                    <tr className="sv-smu-row" onClick={() => toggleGroup(gKey)}>
                      <td colSpan={totalCols}>
                        <div className="sv-smu-header">
                          <span className={`sv-tree-expand ${isGroupOpen ? 'open' : ''}`}>▶</span>
                          <span className="sv-smu-name">{g.groupName}</span>
                          <span className="sv-smu-badge">{g.vehicles.length} ТС</span>
                        </div>
                      </td>
                    </tr>

                    {/* Vehicle rows */}
                    {isGroupOpen && g.vehicles.map((v, vi) => {
                      const vKey = `${gKey}_v${vi}`;
                      const isOpen = expanded.has(vKey);
                      const records = getRecords(v);
                      const isLoadingDst = v.source === 'dst' && loadingDetails.has(v.regNumber);
                      const sourceTag = v.source === 'dump_truck'
                        ? <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'rgba(249,115,22,0.15)', color: '#F97316', marginLeft: 6 }}>СМ</span>
                        : <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'rgba(96,165,250,0.15)', color: '#60A5FA', marginLeft: 6 }}>ДСТ</span>;

                      return (
                        <React.Fragment key={vKey}>
                          <tr
                            className="sv-lv0"
                            style={{ cursor: 'pointer' }}
                            onClick={() => toggleExpand(vKey, v)}
                          >
                            <td>
                              <div className="sv-tree-cell">
                                <div className={`sv-tree-expand ${isOpen ? 'open' : ''}`}>▶</div>
                                <div className="sv-vehicle-name-cell">
                                  <span className="sv-reg-num">{v.regNumber}</span>
                                  <span className="sv-veh-model">{v.nameMO}</span>
                                  {sourceTag}
                                </div>
                              </div>
                            </td>
                            {COLUMNS.map(col => (
                              <td key={col.id} style={'maxW' in col && col.maxW ? { maxWidth: col.maxW, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>
                                {renderCell(col.id, v)}
                              </td>
                            ))}
                          </tr>

                          {/* Chip strip row */}
                          {isOpen && (
                            <tr className="sv-chip-row">
                              <td colSpan={totalCols}>
                                {isLoadingDst ? (
                                  <div style={{ padding: 8, fontSize: 11, color: 'var(--sv-text-2)' }}>
                                    <svg className="sv-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}>
                                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
                                    </svg>
                                    Загрузка деталей...
                                  </div>
                                ) : records.length === 0 ? (
                                  <div style={{ padding: 8, fontSize: 11, color: 'var(--sv-text-3)' }}>
                                    {v.source === 'dst' ? 'Нет детальных данных' : 'Нет записей'}
                                  </div>
                                ) : (
                                  <div className="sv-chip-strip">
                                    {buildChips(records, v.regNumber).map(c => (
                                      <ShiftChip
                                        key={c.key}
                                        {...c}
                                        isSelected={selectedChip === c.key}
                                        onClick={() => setSelectedChip(selectedChip === c.key ? null : c.key)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}

                          {/* Detail row for selected chip */}
                          {selectedChip && isOpen && (() => {
                            const chipRecs = findRecsForChip(selectedChip, records);
                            if (!chipRecs.length) return null;
                            const rec = chipRecs[0]!;

                            return (
                              <tr className="sv-sub-row">
                                <td colSpan={totalCols}>
                                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    {rec.source === 'dump_truck' && rec.id != null ? (
                                      chipRecs.map(cr => (
                                        <div key={cr.id} style={{ flex: '1 1 300px', minWidth: 0 }}>
                                          {cr.workType === 'onsite'
                                            ? <ShiftGanttBar shiftRecordId={cr.id!} timezone={cr.objectTimezone} />
                                            : <DtShiftDetail rec={cr} />
                                          }
                                        </div>
                                      ))
                                    ) : rec.source === 'dst' ? (
                                      <DstGanttSection rec={rec} />
                                    ) : (
                                      <div style={{ padding: 12, fontSize: 11, color: 'var(--sv-text-3)' }}>
                                        Детали недоступны
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── DT Shift Detail ──────────────────────────────────

function DtShiftDetail({ rec }: { rec: UnifiedRecord }) {
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--sv-sub-hdr)',
      border: '1px solid var(--sv-sub-border)',
      borderRadius: 8,
      fontSize: 11,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '4px 16px',
    }}>
      <div><span style={{ opacity: 0.6 }}>Двигатель:</span> {fmtHours(rec.engineTimeSec)}</div>
      <div><span style={{ opacity: 0.6 }}>Движение:</span> {fmtHours(rec.movingTimeSec ?? 0)}</div>
      <div><span style={{ opacity: 0.6 }}>Рейсов:</span> {rec.tripsCount ?? 0}</div>
      <div><span style={{ opacity: 0.6 }}>КИП:</span> <span className={kipColor(rec.kipPct)}>{Math.round(rec.kipPct)}%</span></div>
      <div><span style={{ opacity: 0.6 }}>Движение:</span> {Math.round(rec.secondaryPct)}%</div>
      {rec.onsiteMin != null && rec.onsiteMin > 0 && (
        <div><span style={{ opacity: 0.6 }}>На объекте:</span> {rec.onsiteMin}м</div>
      )}
      {rec.distanceKm != null && rec.distanceKm > 0 && (
        <div><span style={{ opacity: 0.6 }}>Пробег:</span> {rec.distanceKm.toFixed(1)} км</div>
      )}
    </div>
  );
}

// ─── DST Shift Detail ─────────────────────────────────

function DstShiftDetail({ rec }: { rec: UnifiedRecord }) {
  const isGap = rec.isGapFilled;
  return (
    <div style={{
      padding: '8px 12px',
      background: isGap ? 'rgba(156,163,175,0.08)' : 'rgba(96,165,250,0.06)',
      border: isGap ? '1px dashed rgba(156,163,175,0.3)' : '1px solid rgba(96,165,250,0.15)',
      borderRadius: 8,
      fontSize: 11,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '4px 16px',
      opacity: isGap ? 0.7 : 1,
    }}>
      {isGap && (
        <div style={{ gridColumn: '1 / -1', color: '#9ca3af', fontSize: 10, marginBottom: 2 }}>
          ⚑ Без данных (расчёт по границам)
        </div>
      )}
      <div><span style={{ opacity: 0.6 }}>Двигатель:</span> {fmtHours(rec.engineTimeSec)}</div>
      <div><span style={{ opacity: 0.6 }}>КИП:</span> <span className={kipColor(rec.kipPct)}>{Math.round(rec.kipPct)}%</span></div>
      <div><span style={{ opacity: 0.6 }}>Нагрузка:</span> {Math.round(rec.secondaryPct)}%</div>
      {rec.fuelConsumedL != null && rec.fuelConsumedL > 0 && (
        <div><span style={{ opacity: 0.6 }}>Расход:</span> {Math.round(rec.fuelConsumedL)} л</div>
      )}
      {rec.totalStayTimeH != null && rec.totalStayTimeH > 0 && (
        <div><span style={{ opacity: 0.6 }}>На объекте:</span> {rec.totalStayTimeH.toFixed(1)}ч</div>
      )}
      {rec.idleTimeH != null && rec.idleTimeH > 0 && (
        <div><span style={{ opacity: 0.6 }}>Простой:</span> {rec.idleTimeH.toFixed(1)}ч</div>
      )}
    </div>
  );
}

// ─── DST Gantt Section ───────────────────────────────────

function EmptyGanttDiagram({ onFetch, fetching }: { onFetch: () => void; fetching: boolean }) {
  const Y_TICKS = [100, 75, 50, 25, 0];
  const SHIFT_LABELS = ['', '+2ч', '+4ч', '+6ч', '+8ч', '+10ч'];
  return (
    <div className="sv-shift-gantt" style={{ opacity: 0.5 }}>
      <div className="sv-shift-gantt-body">
        <div className="sv-shift-gantt-yaxis">
          {Y_TICKS.map(pct => (
            <span key={pct} style={{ top: `${100 - pct}%` }}>{pct}%</span>
          ))}
        </div>
        <div className="sv-shift-gantt-main">
          <div className="sv-shift-gantt-chart">
            {Y_TICKS.map(pct => (
              <div key={pct} className="sv-shift-gantt-gridline" style={{ top: `${100 - pct}%` }} />
            ))}
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="sv-shift-gantt-bar" />
            ))}
          </div>
          <div className="sv-shift-gantt-xaxis">
            {SHIFT_LABELS.map((lbl, i) => (
              <div key={i} className="sv-shift-gantt-tick" style={{ left: `${(i * 4 / 24) * 100}%` }}>
                <div className="sv-shift-gantt-tick-line" />
                <span>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          onClick={onFetch}
          disabled={fetching}
          style={{
            fontSize: 11,
            cursor: fetching ? 'default' : 'pointer',
            border: '1px solid currentColor',
            borderRadius: 4,
            background: 'rgba(139,92,246,0.1)',
            color: 'inherit',
            padding: '3px 10px',
            opacity: fetching ? 0.6 : 1,
          }}
        >
          {fetching ? 'Выгрузка...' : 'Выгрузить'}
        </button>
      </div>
    </div>
  );
}

function DstGanttSection({ rec }: { rec: UnifiedRecord }) {
  const kipShift = rec.shiftType === 'shift1' ? 'morning' : 'evening';
  const dateStr = rec.reportDate.split('T')[0] ?? rec.reportDate;

  const [segments, setSegments] = useState<KipSegment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const loadSegments = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchKipSegments(rec.regNumber, dateStr, kipShift)
      .then(segs => setSegments(segs))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [rec.regNumber, dateStr, kipShift]);

  useEffect(() => { loadSegments(); }, [loadSegments]);

  const handleTriggerFetch = useCallback(() => {
    setFetching(true);
    triggerKipSegmentFetch(rec.regNumber, dateStr, kipShift)
      .then(() => {
        // Poll until segments appear
        const poll = setInterval(() => {
          fetchKipSegments(rec.regNumber, dateStr, kipShift).then(segs => {
            if (segs && segs.length > 0) {
              clearInterval(poll);
              setSegments(segs);
              setFetching(false);
            }
          });
        }, 3000);
        // Stop polling after 3 minutes
        setTimeout(() => { clearInterval(poll); setFetching(false); }, 180_000);
      })
      .catch(err => {
        setError(String(err));
        setFetching(false);
      });
  }, [rec.regNumber, dateStr, kipShift]);

  return (
    <div style={{ display: 'flex', gap: 12, flex: 1 }}>
      <div style={{ flex: '0 0 auto' }}>
        <DstShiftDetail rec={rec} />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, position: 'relative' }}>
        {loading ? (
          <div className="sv-shift-gantt-empty">Загрузка сегментов...</div>
        ) : error ? (
          <div className="sv-shift-gantt-empty" style={{ color: '#ef4444' }}>
            Ошибка: {error}{' '}
            <button onClick={loadSegments} style={{ fontSize: 10, marginLeft: 6, cursor: 'pointer', border: '1px solid currentColor', borderRadius: 4, background: 'transparent', color: 'inherit', padding: '1px 6px' }}>
              Повторить
            </button>
          </div>
        ) : segments && segments.length > 0 ? (
          <ShiftGanttBar segments={segments} />
        ) : (
          <EmptyGanttDiagram onFetch={handleTriggerFetch} fetching={fetching} />
        )}
      </div>
    </div>
  );
}

