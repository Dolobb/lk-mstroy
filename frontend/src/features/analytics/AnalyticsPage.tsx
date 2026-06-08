import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Table2, LayoutGrid, Map as MapIcon, ChevronRight } from 'lucide-react';
import { DateTimeRangePicker } from '@/components/DateTimeRangePicker';
import { DataFreshnessBadge } from '@/components/DataFreshnessBadge';
import { MiniBar } from '@/components/MiniBar';
import { ShiftChip } from '@/components/ShiftChip';
import type { MicroBar } from '@/components/ShiftChip';
import { ShiftGanttBar } from '@/components/ShiftGanttBar';
import { abbreviateOrg } from '@/features/samosvaly/orgAbbrev';
import { ShiftSubTable } from '@/features/samosvaly/DumpTrucksPage';
import '@/features/samosvaly/samosvaly.css';
import {
  fetchUnifiedData,
  fetchKipVehicleDetails,
  kipDetailToUnified,
  fetchKipSegments,
  fetchKipSegmentProgress,
  triggerKipSegmentFetch,
  triggerDtShiftSegmentFetch,
  fetchDstZones,
} from './api';
import { fetchShiftSegments } from '@/features/samosvaly/api';
import type { UnifiedVehicleRow, UnifiedRecord, KipSegment, KipSegmentProgress, DstZoneFeature } from './types';
import { usePositions } from './hooks/usePositions';
import { useTrack } from './hooks/useTrack';
import { useGroups, useBigObjects } from './hooks/useGroups';
import { AnalyticsMapView } from './AnalyticsMapView';
import { AnalyticsCardsView } from './AnalyticsCardsView';
import { AnalyticsSidebar } from './AnalyticsSidebar';
import { SUBGROUP_LABELS, SUBGROUP_COLORS, SUBGROUP_ORDER, vehicleCategory } from './categories';
import { VehicleIcon } from '@/components/VehicleIcon';

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

// Ray-casting point-in-polygon. GeoJSON ring coords are [lng, lat].
function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
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

interface FilterGroup {
  key: string;
  label: string;
  color: string;
  iconKind: string;
  subKeys: string[];
  subLabels: Record<string, string>;
}

const FILTER_GROUPS: FilterGroup[] = [
  {
    key: 'samosvaly', label: 'Самосв.', color: '#F97316', iconKind: 'samosvaly',
    subKeys: ['dt_delivery', 'dt_onsite'],
    subLabels: { dt_delivery: 'Доставка', dt_onsite: 'По месту' },
  },
  {
    key: 'krany', label: 'Краны', color: '#22C55E', iconKind: 'krany',
    subKeys: ['crane_auto', 'crane_crawler', 'crane_pneumo'],
    subLabels: { crane_auto: 'Автомобильные', crane_crawler: 'Гусеничные', crane_pneumo: 'Пневмоколёсные' },
  },
  {
    key: 'ekskav', label: 'Экскав.', color: '#A78BFA', iconKind: 'ekskav',
    subKeys: ['exc_crawler', 'exc_wheeled', 'exc_loader'],
    subLabels: { exc_crawler: 'Гусеничный', exc_wheeled: 'Колесный', exc_loader: 'Экск.-погрузчик' },
  },
  {
    key: 'dst', label: 'ДСТ', color: '#60A5FA', iconKind: 'kip',
    subKeys: ['bulldozer', 'roller', 'loader'],
    subLabels: { bulldozer: 'Бульдозер', roller: 'Каток', loader: 'Погрузчик' },
  },
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

function subtypeLabel(v: UnifiedVehicleRow): string {
  if (v.source === 'dump_truck') {
    const hasOnsite = v.records.some(r => r.workType === 'onsite');
    const hasDelivery = v.records.some(r => r.workType === 'delivery');
    if (hasOnsite && !hasDelivery) return 'По месту';
    return 'Доставка';
  }
  const vt = v.vehicleType.toLowerCase();
  if (vt.includes('краны автомобильные')) return 'Автомобильный';
  if (vt.includes('краны гусеничные')) return 'Гусеничный';
  if (vt.includes('краны пневмоколёсные')) return 'Пневмоколесный';
  if (vt.includes('бульдозер')) return 'Бульдозер';
  if (vt.includes('каток')) return 'Каток';
  if (vt === 'погрузчик') return 'Погрузчик';
  if (vt === 'экскаватор гусеничный') return 'Гусеничный';
  if (vt === 'экскаватор колесный') return 'Колесный';
  if (vt === 'экскаватор-погрузчик') return 'Погрузчик';
  return v.vehicleType;
}


function subtypeBreakdown(cat: string, vehicles: UnifiedVehicleRow[]): string {
  const counts = new Map<string, number>();
  vehicles.forEach(v => {
    const label = subtypeLabel(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label}`)
    .join(', ');
}

// ─── Defaults ───────────────────────────────────────────

function toYekatIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+05:00`;
}
function isoToYmd(iso: string): string {
  return iso.split('T')[0] ?? iso;
}
const _today = new Date();
const _yesterday = new Date(_today.getTime() - 86400000);
const DEFAULT_DATE_FROM = toYekatIso(new Date(_today.getFullYear(), _today.getMonth(), 1));
const DEFAULT_DATE_TO = toYekatIso(new Date(_yesterday.getFullYear(), _yesterday.getMonth(), _yesterday.getDate(), 23, 45));

const OUTSIDE_GROUP_UID = '__outside' as const;

// ─── Component ──────────────────────────────────────────

export function AnalyticsPage() {
  const { resolvedTheme } = useTheme();
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO);
  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);
  const [shift, setShift] = useState<'all' | 'shift1' | 'shift2'>('all');
  const [vehicleFilters, setVehicleFilters] = useState<Set<string>>(new Set(['all']));
  const [expandedFilterGroups, setExpandedFilterGroups] = useState<Set<string>>(new Set());
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

  const isGroupActive = (group: FilterGroup) => group.subKeys.some(k => vehicleFilters.has(k));

  const toggleExpandFilter = (key: string) => {
    setExpandedFilterGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleFilterGroup = (group: FilterGroup) => {
    setVehicleFilters(prev => {
      const allActive = group.subKeys.every(k => prev.has(k));
      const next = new Set(prev);
      next.delete('all');
      if (allActive) {
        group.subKeys.forEach(k => next.delete(k));
      } else {
        group.subKeys.forEach(k => next.add(k));
      }
      return next.size === 0 ? new Set(['all']) : next;
    });
  };

  const [viewMode, setViewMode] = useState<'table' | 'map' | 'cards'>('table');

  const [dtRows, setDtRows] = useState<UnifiedVehicleRow[]>([]);
  const [dstRows, setDstRows] = useState<UnifiedVehicleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-loaded DST details cache: regNumber → UnifiedRecord[]
  const [dstDetails, setDstDetails] = useState<Map<string, UnifiedRecord[]>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [chipSegments, setChipSegments] = useState<Map<number, MicroBar[]>>(new Map());

  // Table state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set());
  const [focusedObjectUid, setFocusedObjectUid] = useState<string | null>(null);
  const [showOutsideOnMap, setShowOutsideOnMap] = useState(false);

  // Session 9: selected vehicle for track rendering
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  // KIP segments state
  const [kipSegProgress, setKipSegProgress] = useState<KipSegmentProgress | null>(null);

  // Geo-admin: dst_zone polygons для геоматчинга ДСТ → объекты
  const [dstZones, setDstZones] = useState<DstZoneFeature[]>([]);

  // Session 8: groups + big objects
  const { data: groupsData } = useGroups(isoToYmd(dateFrom), isoToYmd(dateTo));
  const { data: bigObjectsData } = useBigObjects();

  // ─── Fetch data ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDstDetails(new Map());
    setExpanded(new Set());
    setSelectedChip(null);

    fetchUnifiedData(isoToYmd(dateFrom), isoToYmd(dateTo))
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

  // Сброс фокуса при смене периода, фильтров или поиска
  useEffect(() => {
    setFocusedObjectUid(null);
  }, [dateFrom, dateTo, shift, vehicleFilters, searchQuery]);

  // ─── Load dst_zones once (geo-admin, static) ─────────

  useEffect(() => {
    fetchDstZones()
      .then(setDstZones)
      .catch(err => console.warn('[geo-admin] dst_zones недоступны:', err));
  }, []);

  // ─── Lazy load DST details on expand ────────────────

  const loadDstDetails = useCallback(async (row: UnifiedVehicleRow) => {
    if (!row.kipVehicleId || dstDetails.has(row.regNumber)) return;
    if (loadingDetails.has(row.regNumber)) return;

    setLoadingDetails(prev => new Set(prev).add(row.regNumber));
    try {
      const details = await fetchKipVehicleDetails(row.kipVehicleId, isoToYmd(dateFrom), isoToYmd(dateTo));
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

  // ─── Onsite micro-bars for table/cards chips ─────────
  useEffect(() => {
    const onsiteRecs = dtRows
      .flatMap(v => v.records)
      .filter(r => r.workType === 'onsite' && r.id != null);
    if (!onsiteRecs.length) return;
    let cancelled = false;
    setChipSegments(new Map());
    Promise.allSettled(
      onsiteRecs.map(rec => fetchShiftSegments(rec.id!).then(segs => ({ id: rec.id!, segs })))
    ).then(results => {
      if (cancelled) return;
      const next = new Map<number, MicroBar[]>();
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          const { id, segs } = r.value;
          next.set(id, segs.map(s => ({
            kip: Math.min(100, (s.engineTimeSec / 1800) * 100),
            mov: Math.min(100, (s.movingTimeSec / 1800) * 100),
          })));
        }
      });
      setChipSegments(next);
    });
    return () => { cancelled = true; };
  }, [dtRows]);

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

  // ─── Geo-match DST vehicles → objectUid ─────────────

  // regNumber → { objectUid, objectName } для ДСТ машин внутри dst_zone полигонов
  const dstGeoMatch = React.useMemo(() => {
    const result = new Map<string, { objectUid: string; objectName: string }>();
    if (!dstZones.length) return result;

    dstRows.forEach(v => {
      if (v.latitude == null || v.longitude == null) return;
      for (const feat of dstZones) {
        const ring = feat.geometry.coordinates[0];
        if (!ring) continue;
        if (pointInPolygon(v.latitude, v.longitude, ring)) {
          result.set(v.regNumber, {
            objectUid: feat.properties.object_uid,
            objectName: feat.properties.object_name,
          });
          break; // первое совпадение достаточно
        }
      }
    });
    return result;
  }, [dstRows, dstZones]);

  // ─── Grouping by SMU/department ─────────────────────

  type GroupEntry = { groupName: string; groupUid?: string; vehicles: UnifiedVehicleRow[] };

  const groups: GroupEntry[] = React.useMemo(() => {
    // key → { groupName, groupUid, vehicles }
    const gMap = new Map<string, GroupEntry>();

    const addToGroup = (key: string, groupName: string, v: UnifiedVehicleRow, groupUid?: string) => {
      if (!gMap.has(key)) gMap.set(key, { groupName, groupUid, vehicles: [] });
      gMap.get(key)!.vehicles.push(v);
    };

    sortedRows.forEach(v => {
      if (v.source === 'dump_truck') {
        // Наиболее частый объект по objectName + objectUid
        const nameCounts = new Map<string, number>();
        const uidForName = new Map<string, string>();
        v.records.forEach(r => {
          const name = r.objectName ?? 'Без объекта';
          nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
          if (r.objectUid) uidForName.set(name, r.objectUid);
        });
        const topName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Без объекта';
        const topUid = uidForName.get(topName);
        const key = topUid ?? topName;
        addToGroup(key, topName, v, topUid);
      } else {
        // DST: основная группа по departmentUnit
        const deptKey = v.departmentUnit || 'Без подразделения';
        addToGroup(deptKey, deptKey, v);

        // Дополнительно: если машина попала в dst_zone — дублируем в объектную группу
        const geo = dstGeoMatch.get(v.regNumber);
        if (geo) {
          addToGroup(geo.objectUid, geo.objectName, v, geo.objectUid);
        }
      }
    });

    return [...gMap.entries()]
      .sort(([, a], [, b]) => {
        const aBez = a.groupName === 'Без объекта' || a.groupName === 'Без подразделения';
        const bBez = b.groupName === 'Без объекта' || b.groupName === 'Без подразделения';
        if (aBez && !bBez) return 1;
        if (bBez && !aBez) return -1;
        return b.vehicles.length - a.vehicles.length;
      })
      .map(([, entry]) => entry);
  }, [sortedRows, dstGeoMatch]);

  // ─── Filtered groups (focus) ────────────────────────

  const filteredGroups = React.useMemo(() => {
    if (focusedObjectUid === null) return groups;
    if (focusedObjectUid === OUTSIDE_GROUP_UID) return []; // drill-down not yet implemented
    return groups.filter(g => g.groupUid === focusedObjectUid);
  }, [groups, focusedObjectUid]);

  // ─── KPI strip (object summaries) ───────────────────

  type ObjectSummary = { uid: string | null; title: string; vehicles: number; work: string; kip: number };

  const objectSummaries: ObjectSummary[] = React.useMemo(() => {
    const dtVehicles = sortedRows.filter(r => r.source === 'dump_truck');
    const totalTrips = dtVehicles.reduce((s, r) => s + r.totalTrips, 0);
    const totalFuel = sortedRows.filter(r => r.source === 'dst').reduce((s, r) => s + r.totalFuelL, 0);
    const kipVals = sortedRows.filter(r => r.avgKipPct > 0).map(r => r.avgKipPct);
    const allKip = kipVals.length ? Math.round(kipVals.reduce((a, b) => a + b, 0) / kipVals.length) : 0;
    const allWork = [totalTrips > 0 ? `${totalTrips} рейс.` : null, totalFuel > 0 ? `${Math.round(totalFuel)} л` : null]
      .filter(Boolean).join(', ') || '—';

    const allCard: ObjectSummary = { uid: null, title: 'Все', vehicles: sortedRows.length, work: allWork, kip: allKip };

    const bigObjectUids = bigObjectsData !== undefined
      ? new Set(bigObjectsData.objects.map(o => o.uid))
      : null; // null = not loaded yet, don't filter

    const objectCards: ObjectSummary[] = groups
      .filter(g => g.groupUid !== undefined && (bigObjectUids === null || bigObjectUids.has(g.groupUid)))
      .map(g => {
        const gDt = g.vehicles.filter(r => r.source === 'dump_truck');
        const gTrips = gDt.reduce((s, r) => s + r.totalTrips, 0);
        const gFuel = g.vehicles.filter(r => r.source === 'dst').reduce((s, r) => s + r.totalFuelL, 0);
        const gKips = g.vehicles.filter(r => r.avgKipPct > 0).map(r => r.avgKipPct);
        const gKip = gKips.length ? Math.round(gKips.reduce((a, b) => a + b, 0) / gKips.length) : 0;
        const gWork = [gTrips > 0 ? `${gTrips} рейс.` : null, gFuel > 0 ? `${Math.round(gFuel)} л` : null]
          .filter(Boolean).join(', ') || '—';
        return { uid: g.groupUid!, title: g.groupName, vehicles: g.vehicles.length, work: gWork, kip: gKip };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));

    const outsideVehicles = groupsData?.outside.length ?? 0;
    const outsideCard: ObjectSummary | null = outsideVehicles > 0
      ? { uid: OUTSIDE_GROUP_UID, title: 'Вне объектов', vehicles: outsideVehicles, work: '—', kip: 0 }
      : null;

    return [allCard, ...(outsideCard ? [outsideCard] : []), ...objectCards];
  }, [sortedRows, groups, bigObjectsData, groupsData]);

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

  const toggleSubgroup = (key: string) => {
    setCollapsedSubgroups(prev => {
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
    workType: string; engineHours?: number; shiftRecordId?: number;
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
      shiftRecordId: r.workType === 'onsite' && r.source === 'dump_truck' ? (r.id ?? undefined) : undefined,
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

  // ─── Chip detail renderer for cards view ────────────

  const renderCardsChipDetail = React.useCallback((chipKey: string): React.ReactNode => {
    const parts = chipKey.split('_');
    const shiftType = parts[parts.length - 1]!;
    const date = parts[parts.length - 2]!;
    const regNumber = parts[0]!;

    const matchRow = sortedRows.find(r => r.regNumber === regNumber);
    if (!matchRow) return null;

    if (matchRow.source === 'dst' && loadingDetails.has(regNumber)) {
      return (
        <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--sv-text-2)' }}>
          <svg className="sv-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
          Загрузка деталей...
        </div>
      );
    }

    const records = getRecords(matchRow);
    const chipRecs = records.filter(r => toDateStr(r.reportDate) === date && r.shiftType === shiftType);
    if (!chipRecs.length) return null;
    const rec = chipRecs[0]!;

    if (rec.source === 'dump_truck' && rec.id != null) {
      return (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {chipRecs.map(cr => (
            <div key={cr.id} style={{ flex: '1 1 300px', minWidth: 0 }}>
              {cr.workType === 'onsite'
                ? <DtOnsiteGanttSection rec={cr} />
                : <ShiftSubTable
                    shiftRecord={{ id: cr.id!, shiftType: cr.shiftType, reportDate: cr.reportDate }}
                    shiftAgg={{ engineTimeSec: cr.engineTimeSec, movingTimeSec: cr.movingTimeSec ?? 0, onsiteMin: cr.onsiteMin ?? 0, kipPct: cr.kipPct, movementPct: cr.secondaryPct }}
                  />
              }
            </div>
          ))}
        </div>
      );
    } else if (rec.source === 'dst') {
      return <DstGanttSection rec={rec} />;
    }
    return null;
  }, [sortedRows, dstDetails, loadingDetails]);

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

  const datePicker = (
    <DateTimeRangePicker
      from={fromDate}
      to={toDate}
      onChange={(f, t) => {
        setDateFrom(toYekatIso(f));
        setDateTo(toYekatIso(t));
      }}
    />
  );

  return (
    <div className="sv-root" data-theme={resolvedTheme} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
      {/* Header */}
      <div className="sv-an-filterbar">
        <DataFreshnessBadge />

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="sv-view-tab"
            onClick={() => {
              const from = new Date(dateFrom);
              const to = new Date(dateTo);
              const durationMs = to.getTime() - from.getTime();
              const newTo = new Date(from.getTime() - 60_000);
              const newFrom = new Date(newTo.getTime() - durationMs);
              setDateFrom(toYekatIso(newFrom));
              setDateTo(toYekatIso(newTo));
            }}
            style={{ width: 24, height: 24, fontSize: 14, padding: 0, justifyContent: 'center', flexShrink: 0 }}
          >‹</button>
          {datePicker}
          <button
            className="sv-view-tab"
            onClick={() => {
              const from = new Date(dateFrom);
              const to = new Date(dateTo);
              const durationMs = to.getTime() - from.getTime();
              const newFrom = new Date(to.getTime() + 60_000);
              const newTo = new Date(newFrom.getTime() + durationMs);
              setDateFrom(toYekatIso(newFrom));
              setDateTo(toYekatIso(newTo));
            }}
            style={{ width: 24, height: 24, fontSize: 14, padding: 0, justifyContent: 'center', flexShrink: 0 }}
          >›</button>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Все */}
          <button
            className={`sv-filter-sq all ${vehicleFilters.has('all') ? 'active' : ''}`}
            onClick={() => toggleFilter('all')}
          >
            <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>ВСЕ</span>
          </button>

          {FILTER_GROUPS.map(group => {
            const allActive = group.subKeys.every(k => vehicleFilters.has(k));
            const partialActive = !allActive && group.subKeys.some(k => vehicleFilters.has(k));
            return (
            <div
              key={group.key}
              className={`sv-filter-group${expandedFilterGroups.has(group.key) ? ' expanded' : ''}${allActive ? ' all-active' : partialActive ? ' partial-active' : ''}`}
            >
              <button
                className={`sv-filter-sq ${isGroupActive(group) ? 'active' : ''}`}
                style={{ '--group-color': group.color } as React.CSSProperties}
                onClick={() => toggleFilterGroup(group)}
              >
                <VehicleIcon kind={group.iconKind} size={16} />
                <span className="sv-filter-sq-label">{group.label}</span>
              </button>
              <button
                className="sv-filter-arrow"
                onClick={() => toggleExpandFilter(group.key)}
                title="Раскрыть подгруппы"
              >
                <ChevronRight size={9} strokeWidth={2.5} />
              </button>
              <div className="sv-filter-drop">
                {group.subKeys.map(k => (
                  <button
                    key={k}
                    className={`sv-filter-sub ${vehicleFilters.has(k) ? 'active' : ''}`}
                    style={{ '--group-color': group.color } as React.CSSProperties}
                    onClick={() => toggleFilter(k)}
                  >
                    {group.subLabels[k]}
                  </button>
                ))}
              </div>
            </div>
          ); })}
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

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          <button
            className={`sv-view-tab ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            style={{ fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <Table2 size={12} />Таблица
          </button>
          <button
            className={`sv-view-tab ${viewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setViewMode('cards')}
            style={{ fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <LayoutGrid size={12} />Карточки
          </button>
          <button
            className={`sv-view-tab ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode('map')}
            style={{ fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <MapIcon size={12} />Карта
          </button>
        </div>
      </div>

      {/* Main grid: content + sidebar */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 10, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: views */}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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

          {/* Map view */}
          {viewMode === 'map' && (
            <MapViewWithPositions
              groups={groups}
              dateFrom={dateFrom}
              dateTo={dateTo}
              selectedVehicleId={selectedVehicleId}
              onSelectVehicle={setSelectedVehicleId}
              focusedObjectUid={focusedObjectUid}
              onFocusObject={setFocusedObjectUid}
              showOutsideOnMap={showOutsideOnMap}
            />
          )}

          {/* Cards view */}
          {viewMode === 'cards' && (loading ? (
              <div className="sv-empty">
                <svg className="sv-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
                </svg>
                <span className="sv-empty-text">Загрузка...</span>
              </div>
            ) : error ? (
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 8, color: '#EF4444', fontSize: 12, margin: 'auto' }}>
                {error}
              </div>
            ) : (
              <AnalyticsCardsView
                filteredGroups={filteredGroups}
                dstRecords={dstDetails}
                selectedChip={selectedChip}
                onChipClick={(key) => setSelectedChip(selectedChip === key ? null : key)}
                onSelectVehicle={(reg) => {
                  setSelectedVehicleId(reg);
                  setViewMode('map');
                }}
                renderChipDetail={renderCardsChipDetail}
              />
          ))}

          {/* Table view */}
          {viewMode === 'table' && (
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
              {filteredGroups.map((g, gi) => {
                const gKey = `grp_${gi}`;
                const isGroupOpen = !collapsedGroups.has(gKey);

                return (
                  <React.Fragment key={gKey}>
                    {/* Group header */}
                    <tr id={`obj-scroll-${g.groupName}`} className="sv-smu-row" onClick={() => toggleGroup(gKey)}>
                      <td colSpan={totalCols}>
                        <div className="sv-smu-header">
                          <span className={`sv-tree-expand ${isGroupOpen ? 'open' : ''}`}>▶</span>
                          <span className="sv-smu-name">{g.groupName}</span>
                          <span className="sv-smu-badge">{g.vehicles.length} ТС</span>
                        </div>
                      </td>
                    </tr>

                    {/* Vehicle rows — sub-grouped by type */}
                    {isGroupOpen && SUBGROUP_ORDER.map(cat => {
                      const catVehicles = g.vehicles.filter(v => vehicleCategory(v) === cat);
                      if (!catVehicles.length) return null;
                      const subKey = `${gKey}_${cat}`;
                      const isSubOpen = !collapsedSubgroups.has(subKey);

                      return (
                        <React.Fragment key={subKey}>
                          {/* Subgroup header */}
                          <tr className="sv-subgroup-row" onClick={() => toggleSubgroup(subKey)}>
                            <td colSpan={totalCols}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 24px', fontSize: 12, fontWeight: 500, color: 'var(--sv-text-2)' }}>
                                <span className={`sv-tree-expand ${isSubOpen ? 'open' : ''}`}>▶</span>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: SUBGROUP_COLORS[cat], flexShrink: 0 }} />
                                <span>{SUBGROUP_LABELS[cat]}</span>
                                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: `${SUBGROUP_COLORS[cat]}1A`, color: SUBGROUP_COLORS[cat], fontWeight: 600 }}>{catVehicles.length} ТС</span>
                                <span style={{ fontSize: 8, color: 'var(--sv-text-3)' }}>{subtypeBreakdown(cat, catVehicles)}</span>
                              </div>
                            </td>
                          </tr>

                          {/* Category vehicles */}
                          {isSubOpen && catVehicles.map((v, vi) => {
                            const vKey = `${subKey}_v${vi}`;
                            const isOpen = expanded.has(vKey);
                            const records = getRecords(v);
                            const isLoadingDst = v.source === 'dst' && loadingDetails.has(v.regNumber);
                            const catColor = SUBGROUP_COLORS[vehicleCategory(v)];
                            const catDot = <span style={{ width: 5, height: 5, borderRadius: '50%', background: catColor, marginRight: 3, flexShrink: 0, display: 'inline-block' }} />;
                            const sourceTag = (
                              <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, color: catColor, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}>
                                {catDot}{subtypeLabel(v)}
                              </span>
                            );

                            return (
                              <React.Fragment key={vKey}>
                                <tr
                                  className="sv-lv0"
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => toggleExpand(vKey, v)}
                                >
                                  <td>
                                    <div className="sv-tree-cell" style={{ paddingLeft: 40 }}>
                                      <div className={`sv-tree-expand ${isOpen ? 'open' : ''}`}>▶</div>
                                      <div className="sv-vehicle-name-cell">
                                        <span
                                          className="sv-reg-num"
                                          title="Показать трек на карте"
                                          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'currentColor', textUnderlineOffset: 2 }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedVehicleId(v.regNumber);
                                            setViewMode('map');
                                          }}
                                        >{v.regNumber}</span>
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
                                          {buildChips(records, v.regNumber).map(c => {
                                            const { key: _k, shiftRecordId, ...chip } = c;
                                            return (
                                              <ShiftChip
                                                key={c.key}
                                                {...chip}
                                                isSelected={selectedChip === c.key}
                                                onClick={() => setSelectedChip(selectedChip === c.key ? null : c.key)}
                                                microBars={shiftRecordId != null ? chipSegments.get(shiftRecordId) : undefined}
                                              />
                                            );
                                          })}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}

                                {/* Detail row for selected chip */}
                                {selectedChip && isOpen && selectedChip.startsWith(v.regNumber + '_') && (() => {
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
                                                  ? <DtOnsiteGanttSection rec={cr} />
                                                  : <ShiftSubTable
                                                      shiftRecord={{ id: cr.id!, shiftType: cr.shiftType, reportDate: cr.reportDate }}
                                                      shiftAgg={{ engineTimeSec: cr.engineTimeSec, movingTimeSec: cr.movingTimeSec ?? 0, onsiteMin: cr.onsiteMin ?? 0, kipPct: cr.kipPct, movementPct: cr.secondaryPct }}
                                                    />
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
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
          )}
        </div>

        {/* Right: sidebar */}
        <AnalyticsSidebar
          objectSummaries={objectSummaries}
          focusedObjectUid={focusedObjectUid}
          onFocusObject={setFocusedObjectUid}
          dateFrom={dateFrom}
          dateTo={dateTo}
          showOutsideOnMap={showOutsideOnMap}
          onToggleOutsideMap={() => setShowOutsideOnMap(v => !v)}
          onPeriodShift={(direction) => {
            const from = new Date(dateFrom);
            const to = new Date(dateTo);
            const durationMs = to.getTime() - from.getTime();
            const STEP = 60_000; // 1 min gap between adjacent periods
            let newFrom: Date, newTo: Date;
            if (direction === -1) {
              newTo = new Date(from.getTime() - STEP);
              newFrom = new Date(newTo.getTime() - durationMs);
            } else {
              newFrom = new Date(to.getTime() + STEP);
              newTo = new Date(newFrom.getTime() + durationMs);
            }
            setDateFrom(toYekatIso(newFrom));
            setDateTo(toYekatIso(newTo));
          }}
        />
      </div>
    </div>
  );
}

// ─── MapView wrapper (positions hook) ───────────────────

function MapViewWithPositions(props: React.ComponentProps<typeof AnalyticsMapView>) {
  const toDate = props.dateTo ? new Date(props.dateTo) : new Date();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isRecent = toDate >= startOfToday;
  const at = isRecent ? new Date() : toDate;
  const { data } = usePositions(at, isRecent);

  const fromDate = props.dateFrom ? new Date(props.dateFrom) : new Date();
  const { data: trackData } = useTrack(props.selectedVehicleId ?? null, fromDate, toDate);

  return <AnalyticsMapView {...props} positions={data?.positions} track={trackData ?? null} />;
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

function DtOnsiteShiftDetail({ rec }: { rec: UnifiedRecord }) {
  return (
    <div style={{
      minWidth: 180,
      padding: '8px 12px',
      background: 'rgba(249,115,22,0.06)',
      border: '1px solid rgba(249,115,22,0.15)',
      borderRadius: 8,
      fontSize: 11,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '4px 16px',
    }}>
      <div><span style={{ opacity: 0.6 }}>Двигатель:</span> {fmtHours(rec.engineTimeSec)}</div>
      <div><span style={{ opacity: 0.6 }}>КИП:</span> <span className={kipColor(rec.kipPct)}>{Math.round(rec.kipPct)}%</span></div>
      <div><span style={{ opacity: 0.6 }}>Движение:</span> {Math.round(rec.secondaryPct)}%</div>
      {rec.movingTimeSec != null && rec.movingTimeSec > 0 && (
        <div><span style={{ opacity: 0.6 }}>В движении:</span> {fmtHours(rec.movingTimeSec)}</div>
      )}
      {rec.onsiteMin != null && rec.onsiteMin > 0 && (
        <div><span style={{ opacity: 0.6 }}>На объекте:</span> {Math.round(rec.onsiteMin)}м</div>
      )}
      {rec.distanceKm != null && rec.distanceKm > 0 && (
        <div><span style={{ opacity: 0.6 }}>Пробег:</span> {rec.distanceKm.toFixed(1)} км</div>
      )}
      {rec.tripsCount != null && rec.tripsCount > 0 && (
        <div><span style={{ opacity: 0.6 }}>Рейсы:</span> {rec.tripsCount}</div>
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

function DtOnsiteGanttSection({ rec }: { rec: UnifiedRecord }) {
  const [fetching, setFetching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dateStr = rec.reportDate.split('T')[0] ?? rec.reportDate;

  const handleTriggerFetch = useCallback(() => {
    if (rec.id == null) return;

    setFetching(true);
    setError(null);
    triggerDtShiftSegmentFetch(dateStr, rec.shiftType)
      .then(() => {
        const started = Date.now();
        const poll = setInterval(() => {
          fetchShiftSegments(rec.id!)
            .then(segs => {
              if (segs.length >= 24) {
                clearInterval(poll);
                setReloadKey(v => v + 1);
                setFetching(false);
              } else if (Date.now() - started > 180_000) {
                clearInterval(poll);
                setError('Сегменты не появились за 3 минуты');
                setFetching(false);
              }
            })
            .catch(err => {
              clearInterval(poll);
              setError(String(err));
              setFetching(false);
            });
        }, 3000);
      })
      .catch(err => {
        setError(String(err));
        setFetching(false);
      });
  }, [rec.id, rec.shiftType, dateStr]);

  return (
    <div style={{ display: 'flex', gap: 12, flex: 1 }}>
      <div style={{ flex: '0 0 auto' }}>
        <DtOnsiteShiftDetail rec={rec} />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        <ShiftGanttBar
          shiftRecordId={rec.id!}
          timezone={rec.objectTimezone}
          reloadKey={reloadKey}
          onFetchMissing={handleTriggerFetch}
          fetchingMissing={fetching}
        />
        {error && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#ef4444' }}>
            Ошибка выгрузки: {error}
          </div>
        )}
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
            if (segs && segs.length >= 24) {
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
          <ShiftGanttBar
            segments={segments}
            onFetchMissing={handleTriggerFetch}
            fetchingMissing={fetching}
          />
        ) : (
          <EmptyGanttDiagram onFetch={handleTriggerFetch} fetching={fetching} />
        )}
      </div>
    </div>
  );
}


