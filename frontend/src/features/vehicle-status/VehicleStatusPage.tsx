import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { RefreshCw, Filter, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, X, Pin, ChevronsDown, ChevronsUp, History } from 'lucide-react';
import type { VehicleRecord, SyncStatus, SyncLogEntry } from './types';
import { fetchVehicles, fetchSyncStatus, triggerSync, fetchSnapshotDates, fetchSnapshots, fetchSyncLogs } from './api';

const PAGE_SIZE = 50;

type ColKey = 'plateNumber' | 'branch' | 'vehicleType' | 'brand' | 'constructionObject' | 'techStatus' | 'workType' | 'category';

const COLUMNS: { key: ColKey; label: string; filterable: boolean }[] = [
  { key: 'plateNumber', label: 'Гос. №', filterable: false },
  { key: 'branch', label: 'Филиал', filterable: true },
  { key: 'vehicleType', label: 'Тип ТС', filterable: true },
  { key: 'brand', label: 'Марка', filterable: true },
  { key: 'constructionObject', label: 'Объект', filterable: true },
  { key: 'techStatus', label: 'Тех. состояние', filterable: true },
  { key: 'workType', label: 'Вид работ', filterable: true },
  { key: 'category', label: 'Категория', filterable: true },
];

const GROUPABLE_COLUMNS = COLUMNS.filter(c => c.key !== 'plateNumber');

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  const d = String(dt.getDate()).padStart(2, '0');
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${d}.${mo}.${dt.getFullYear()} ${h}:${mi}`;
}

function cellText(v: string | null | undefined): string {
  if (!v) return '—';
  return v.trim() || '—';
}

function getCellValue(r: VehicleRecord, key: ColKey): string {
  if (key === 'plateNumber') return r.plateNumber;
  const val = r[key as keyof VehicleRecord];
  if (val === null || val === undefined || typeof val === 'boolean') return '';
  return String(val).trim();
}

function uniqueSorted(records: VehicleRecord[], key: ColKey): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const r of records) {
    const v = getCellValue(r, key);
    if (!v) continue;
    const lower = v.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(v);
  }
  return result.sort((a, b) => a.localeCompare(b, 'ru'));
}

type ActiveFilters = Partial<Record<ColKey, Set<string>>>;

interface GroupInfo {
  key: string;
  label: string;
  records: VehicleRecord[];
}

function FilterDropdown({
  values,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  values: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = values.filter(v => {
    try { return v.toLowerCase().includes(search.toLowerCase()); }
    catch { return true; }
  });

  const selectedLower = useMemo(() => new Set([...selected].map(v => v.toLowerCase())), [selected]);
  const isSelected = (v: string) => selectedLower.has(v.toLowerCase());

  return (
    <div ref={ref} className="absolute top-full mt-1 left-0 right-0 z-50 border border-border rounded-xl shadow-xl overflow-hidden min-w-64"
      style={{ background: 'var(--popover)' }}
      onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 px-3 py-1.5 border-b border-border/40">
        <button
          type="button"
          onClick={() => {
            const allVisibleSelected = filtered.every(v => isSelected(v));
            filtered.forEach(v => {
              if (allVisibleSelected ? isSelected(v) : !isSelected(v)) onToggle(v);
            });
          }}
          className="px-2 py-0.5 rounded-lg bg-card-inner hover:bg-card-inner/80 border border-border/40 cursor-pointer text-text-secondary"
          style={{ fontSize: 10 }}
        >
          {filtered.every(v => isSelected(v)) ? 'Снять' : 'Все'}
        </button>
        <button
          type="button"
          onClick={() => { filtered.forEach(v => { if (isSelected(v)) onToggle(v); }); }}
          className="px-2 py-0.5 rounded-lg bg-card-inner hover:bg-card-inner/80 border border-border/40 cursor-pointer text-text-secondary"
          style={{ fontSize: 10 }}
        >
          Снять ({filtered.filter(v => isSelected(v)).length})
        </button>
      </div>
      {values.length > 10 && (
        <div className="px-3 py-2 border-b border-border/40">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="w-full px-2.5 py-1.5 rounded-lg bg-card-inner border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ fontSize: 12 }}
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto custom-scrollbar">
        {filtered.map(v => (
          <div
            key={v}
            onClick={() => onToggle(v)}
            className="flex items-start gap-2 px-3 py-1.5 hover:bg-card-inner cursor-pointer"
          >
            <div
              className={`w-3.5 h-3.5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                isSelected(v) ? 'bg-secondary border-secondary' : 'border-text-muted'
              }`}
            >
              {isSelected(v) && (
                <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-text-secondary leading-snug" style={{ fontSize: 11 }}>{v}</span>
          </div>
        ))}
        {filtered.length === 0 && <div className="px-3 py-2 text-text-muted" style={{ fontSize: 11 }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}

const GROUP_PILLS: { key: ColKey; label: string }[] = GROUPABLE_COLUMNS.map(c => ({ key: c.key, label: c.label }));

function GroupByPills({
  selected,
  onToggle,
}: {
  selected: ColKey[];
  onToggle: (key: ColKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {GROUP_PILLS.map(p => {
        const active = selected.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onToggle(p.key)}
            className="px-2.5 py-1 rounded-lg border-none cursor-pointer font-semibold transition-colors"
            style={{
              fontSize: 11,
              background: active ? 'rgba(249,115,22,0.12)' : 'transparent',
              color: active ? '#F97116' : 'var(--text-muted)',
              border: active ? '1px solid rgba(249,115,22,0.2)' : '1px solid transparent',
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export const VehicleStatusPage: React.FC = () => {
  const [allRecords, setAllRecords] = useState<VehicleRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ lastSync: null, lastResult: null, inProgress: false });

  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({});
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [openFilter, setOpenFilter] = useState<ColKey | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<ColKey[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [snapshotMode, setSnapshotMode] = useState(false);
  const [snapshotDates, setSnapshotDates] = useState<string[]>([]);
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState<string>('');
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevLastSync = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const togglePin = useCallback((id: number) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleGroupBy = useCallback((key: ColKey) => {
    setGroupBy(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }, []);

  const columnValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      if (col.filterable) {
        map[col.key] = uniqueSorted(allRecords, col.key);
      }
    }
    return map;
  }, [allRecords]);

  const filtered = useMemo(() => {
    let data = allRecords;
    if (searchInput.trim()) {
      const q = searchInput.trim().toUpperCase();
      data = data.filter(r => r.plateNumber.toUpperCase().includes(q));
    }
    for (const [key, selected] of Object.entries(activeFilters)) {
      if (!selected || selected.size === 0) continue;
      const colKey = key as ColKey;
      const selectedLower = new Set([...selected].map(v => v.toLowerCase()));
      data = data.filter(r => selectedLower.has(getCellValue(r, colKey).toLowerCase()));
    }
    return data;
  }, [allRecords, activeFilters, searchInput]);

  const { pinnedRecords, unpinnedRecords } = useMemo(() => {
    const pinned: VehicleRecord[] = [];
    const unpinned: VehicleRecord[] = [];
    for (const r of filtered) {
      if (pinnedIds.has(r.id)) pinned.push(r);
      else unpinned.push(r);
    }
    return { pinnedRecords: pinned, unpinnedRecords: unpinned };
  }, [filtered, pinnedIds]);

  const groups = useMemo((): GroupInfo[] => {
    if (groupBy.length === 0) return [];
    const map = new Map<string, { label: string; records: VehicleRecord[] }>();
    for (const r of unpinnedRecords) {
      const parts = groupBy.map(k => getCellValue(r, k) || '(пусто)');
      const label = parts.join(' | ');
      const key = parts.map(p => p.toLowerCase()).join(' | ');
      if (!map.has(key)) map.set(key, { label, records: [] });
      map.get(key)!.records.push(r);
    }
    const entries = [...map.entries()];
    entries.sort((a, b) => {
      if (a[0] === '(пусто)') return 1;
      if (b[0] === '(пусто)') return -1;
      return a[0].localeCompare(b[0], 'ru');
    });
    return entries.map(([key, { label, records }]) => ({ key, label, records }));
  }, [unpinnedRecords, groupBy]);

  const expandAllGroups = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAllGroups = useCallback(() => setCollapsedGroups(new Set(groups.map(g => g.key))), [groups]);

  const totalPages = Math.max(1, Math.ceil(unpinnedRecords.length / PAGE_SIZE));

  const unpinnedPageData = useMemo(() => {
    if (groupBy.length > 0) return [];
    const start = (page - 1) * PAGE_SIZE;
    return unpinnedRecords.slice(start, start + PAGE_SIZE);
  }, [unpinnedRecords, groupBy, page]);

  useEffect(() => { setPage(1); }, [activeFilters, searchInput, groupBy]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchVehicles();
      setAllRecords(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSnapshotDates = useCallback(async () => {
    try {
      const dates = await fetchSnapshotDates();
      setSnapshotDates(dates);
    } catch {}
  }, []);

  useEffect(() => { loadSnapshotDates(); }, [loadSnapshotDates]);

  useEffect(() => {
    if (!showSyncHistory) return;
    fetchSyncLogs(30).then(setSyncLogs).catch(() => {});
  }, [showSyncHistory]);

  useEffect(() => {
    if (!snapshotMode || !selectedSnapshotDate) return;
    setLoading(true);
    fetchSnapshots(selectedSnapshotDate)
      .then(data => { setAllRecords(data); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [snapshotMode, selectedSnapshotDate]);

  useEffect(() => {
    if (snapshotMode) return;
    load();
  }, [snapshotMode, load]);

  const loadSyncStatus = async (): Promise<SyncStatus | null> => {
    try {
      const s = await fetchSyncStatus();
      setSyncStatus(s);
      return s;
    } catch { return null; }
  };

  useEffect(() => { load(); loadSyncStatus(); }, []);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      prevLastSync.current = syncStatus.lastSync;
      await triggerSync();
      pollRef.current = setInterval(async () => {
        const s = await loadSyncStatus();
        if (s && s.lastSync && s.lastSync !== prevLastSync.current) {
          stopPoll();
          setSyncing(false);
          load();
        }
      }, 2000);
      setTimeout(() => { if (syncing) { stopPoll(); setSyncing(false); } }, 60_000);
    } catch (e) {
      setError(String(e));
      setSyncing(false);
    }
  };

  useEffect(() => () => stopPoll(), []);

  const toggleFilterValue = (col: ColKey, value: string) => {
    setActiveFilters(prev => {
      const set = new Set(prev[col] || []);
      if (set.has(value)) set.delete(value); else set.add(value);
      const next = { ...prev, [col]: set };
      if (set.size === 0) delete next[col];
      return next;
    });
  };

  const clearFilter = (col: ColKey) => {
    setActiveFilters(prev => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setOpenFilter(null);
  };

  const clearAllFilters = () => {
    setActiveFilters({});
    setSearchInput('');
    setGroupBy([]);
    setCollapsedGroups(new Set());
  };

  const hasActiveFilter = Object.keys(activeFilters).length > 0 || searchInput.trim() || groupBy.length > 0;

  const handleCloseFilter = useCallback(() => {
    setOpenFilter(null);
  }, []);

  const COL_COUNT = 9;

  const renderRow = (r: VehicleRecord, isPinned: boolean) => (
    <tr
      key={`${isPinned ? 'p' : 'u'}-${r.id}`}
      className={`border-b border-border/30 transition-colors hover:bg-muted/30 ${
        r.isBroken ? 'bg-destructive/5' : ''
      } ${isPinned ? 'bg-primary/5' : ''}`}
    >
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={() => togglePin(r.id)}
          className={`p-0.5 rounded border-none cursor-pointer transition-colors ${
            isPinned
              ? 'text-primary'
              : 'text-muted-foreground/30 hover:text-muted-foreground'
          }`}
          title={isPinned ? 'Открепить' : 'Закрепить'}
        >
          <Pin className="size-3" style={isPinned ? { transform: 'rotate(45deg)' } : undefined} />
        </button>
      </td>
      <td className="px-3 py-1.5 font-mono font-medium">{r.plateNumber}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{cellText(r.branch)}</td>
      <td className="px-3 py-1.5">{cellText(r.vehicleType)}</td>
      <td className="px-3 py-1.5">{cellText(r.brand)}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{cellText(r.constructionObject)}</td>
      <td className="px-3 py-1.5">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
            r.isBroken
              ? 'bg-destructive/15 text-destructive'
              : 'bg-green-500/15 text-green-600 dark:text-green-400'
          }`}
          style={{ fontSize: '10px' }}
        >
          {r.techStatus || '—'}
        </span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">{cellText(r.workType)}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{cellText(r.category)}</td>
    </tr>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Вся техника</h1>
          {syncStatus.lastSync && (
            <span className="text-xs text-muted-foreground">
              Синхронизация: {formatDateTime(syncStatus.lastSync)}
            </span>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer border-none"
        >
          <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Синхронизация…' : 'Синхронизировать'}</span>
        </button>
      </div>

      {syncStatus.lastResult?.errors && syncStatus.lastResult.errors.length > 0 && (
        <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
          {syncStatus.lastResult.errors.slice(0, 3).map((e, i) => <div key={i}>{e}</div>)}
          {syncStatus.lastResult.errors.length > 3 && <div>…ещё {syncStatus.lastResult.errors.length - 3}</div>}
        </div>
      )}
      {error && <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2">{error}</div>}

        {/* Sync History Panel */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setShowSyncHistory(v => !v)}
            style={{ fontSize: 11, color: showSyncHistory ? '#F97116' : 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            {showSyncHistory ? 'Скрыть журнал' : 'Журнал синхронизации'}
          </button>
          {showSyncHistory && syncLogs.length > 0 && (
            <div className="mt-1 overflow-auto max-h-32 rounded-lg border border-border/30" style={{ background: 'var(--card)' }}>
              <table className="w-full text-xs border-collapse" style={{ fontSize: 10 }}>
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="px-2 py-1 text-left">Время</th>
                    <th className="px-2 py-1 text-left">Тип</th>
                    <th className="px-2 py-1 text-left">Статус</th>
                    <th className="px-2 py-1 text-right">ТС</th>
                    <th className="px-2 py-1 text-right">Загр.</th>
                    <th className="px-2 py-1 text-right">Парс.</th>
                    <th className="px-2 py-1 text-right">Запись</th>
                    <th className="px-2 py-1 text-left">Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.slice(0, 15).map(l => (
                    <tr key={l.id} className={'border-b border-border/20' + (l.status === 'error' ? ' text-destructive' : l.status === 'partial' ? ' text-orange-500' : '')}>
                      <td className="px-2 py-0.5 whitespace-nowrap">{formatDateTime(l.startedAt)}</td>
                      <td className="px-2 py-0.5">{l.trigger === 'cron' ? 'cron' : 'руч'}</td>
                      <td className="px-2 py-0.5 font-medium">{l.status}</td>
                      <td className="px-2 py-0.5 text-right">{l.processed || 0}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.downloadMs != null ? (l.downloadMs / 1000).toFixed(1) + 's' : '—'}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.parseMs != null ? (l.parseMs / 1000).toFixed(1) + 's' : '—'}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.writeMs != null ? (l.writeMs / 1000).toFixed(1) + 's' : '—'}</td>
                      <td className="px-2 py-0.5 max-w-48 truncate">{l.errors?.[0] || l.errorMessage || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showSyncHistory && syncLogs.length === 0 && (
            <div className="mt-1 text-xs text-muted-foreground">Нет записей. Запустите синхронизацию.</div>
          )}
        </div>

      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <button
          onClick={() => setSnapshotMode(v => !v)}
          className="px-2.5 py-1.5 rounded-lg border-none cursor-pointer font-semibold transition-colors"
          style={{
            fontSize: 11,
            background: snapshotMode ? 'rgba(249,115,22,0.12)' : 'transparent',
            color: snapshotMode ? '#F97116' : 'var(--text-muted)',
            border: snapshotMode ? '1px solid rgba(249,115,22,0.2)' : '1px solid transparent',
          }}
        >
          Архив
        </button>
        {snapshotMode && (
          <select
            value={selectedSnapshotDate}
            onChange={e => setSelectedSnapshotDate(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg bg-muted border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Выберите дату</option>
            {snapshotDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Поиск по гос. номеру…"
          className="text-xs px-2.5 py-1.5 rounded-lg bg-muted border border-border/50 text-foreground w-48 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <GroupByPills selected={groupBy} onToggle={toggleGroupBy} />
        {groupBy.length > 0 && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={expandAllGroups}
              className="p-1 rounded border-none bg-transparent cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Развернуть все"
            >
              <ChevronsDown className="size-3.5" />
            </button>
            <button
              onClick={collapseAllGroups}
              className="p-1 rounded border-none bg-transparent cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Свернуть все"
            >
              <ChevronsUp className="size-3.5" />
            </button>
          </div>
        )}
        {hasActiveFilter && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border-none bg-transparent cursor-pointer"
            style={{ fontSize: '11px' }}
          >
            <X className="size-3" /> Сбросить
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto" style={{ fontSize: '11px' }}>
          {loading ? 'Загрузка…' : `${filtered.length} из ${allRecords.length}`}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto glass-card rounded-lg">
        <table className="w-full text-xs border-collapse" style={{ fontSize: '11px', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '32px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '130px' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border/50 sticky top-0 bg-card z-10">
              <th className="px-1 py-2 w-8" />
              {COLUMNS.map(col => {
                const filterActive = !!(activeFilters[col.key] && activeFilters[col.key]!.size > 0);
                const filterCount = activeFilters[col.key]?.size || 0;
                return (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap relative">
                    <div className="flex items-center gap-1">
                      <span>{col.label}</span>
                      {col.filterable && (
                        <span className="relative inline-flex">
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === col.key ? null : col.key); }}
                            className={`p-0.5 rounded border-none cursor-pointer transition-colors ${
                              filterActive
                                ? 'text-primary bg-primary/10'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            }`}
                          >
                            <Filter className="size-3" />
                          </button>
                          {filterCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-3 h-3 flex items-center justify-center rounded-full bg-primary text-primary-foreground font-bold leading-none" style={{ fontSize: 8, padding: '0 3px' }}>{filterCount}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {col.filterable && openFilter === col.key && (
                      <FilterDropdown
                        values={columnValues[col.key] || []}
                        selected={activeFilters[col.key] || new Set<string>()}
                        onToggle={v => toggleFilterValue(col.key, v)}
                        onClear={() => clearFilter(col.key)}
                        onClose={handleCloseFilter}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pinnedRecords.length > 0 && pinnedRecords.map(r => renderRow(r, true))}

            {groupBy.length > 0 ? (
              groups.map(g => {
                const isOpen = !collapsedGroups.has(g.key);
                return (
                  <React.Fragment key={g.key}>
                    <tr
                      className="border-b border-border/30 cursor-pointer hover:bg-muted/20"
                      onClick={() => toggleGroupCollapse(g.key)}
                    >
                      <td colSpan={COL_COUNT} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex items-center justify-center w-[18px] h-[18px] rounded transition-transform"
                            style={{
                              fontSize: 9,
                              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                              color: 'var(--text-muted)',
                              background: 'var(--muted)',
                            }}
                          >
                            ▶
                          </span>
                          <span className="font-bold text-sm" style={{ letterSpacing: 0.3 }}>
                            {g.label}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded-md font-semibold"
                            style={{ fontSize: 9, background: 'rgba(59,130,246,0.1)', color: '#60A5FA' }}
                          >
                            {g.records.length} ТС
                          </span>
                        </div>
                      </td>
                    </tr>
                    {isOpen && g.records.map(r => renderRow(r, false))}
                  </React.Fragment>
                );
              })
            ) : (
              unpinnedPageData.map(r => renderRow(r, false))
            )}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={COL_COUNT} className="px-3 py-8 text-center text-muted-foreground">
                  {allRecords.length === 0
                    ? 'Нет данных. Нажмите «Синхронизировать» для загрузки из Google Sheets.'
                    : 'Ничего не найдено. Измените фильтры.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {groupBy.length === 0 && unpinnedRecords.length > PAGE_SIZE && (
        <div className="flex items-center justify-between shrink-0 pt-1">
          <span className="text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
            Стр. {page} из {totalPages} ({unpinnedRecords.length} ТС)
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="p-1 rounded border-none bg-transparent cursor-pointer disabled:opacity-30 hover:bg-muted">
              <ChevronsLeft className="size-4" />
            </button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1 rounded border-none bg-transparent cursor-pointer disabled:opacity-30 hover:bg-muted">
              <ChevronLeft className="size-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1 rounded border-none bg-transparent cursor-pointer disabled:opacity-30 hover:bg-muted">
              <ChevronRight className="size-4" />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="p-1 rounded border-none bg-transparent cursor-pointer disabled:opacity-30 hover:bg-muted">
              <ChevronsRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
