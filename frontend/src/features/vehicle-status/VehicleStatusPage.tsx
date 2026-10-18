import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { RefreshCw, Filter, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, X, Pin, ChevronsDown, ChevronsUp, History, ChevronDown } from 'lucide-react';
import { FilterDropdown, uniqueSortedBy } from '@/components/FilterDropdown';
import type { VehicleRecord, SyncStatus, SyncLogEntry } from './types';
import { fetchVehicles, fetchSyncStatus, triggerSync, fetchSnapshotDates, fetchSnapshots, fetchSyncLogs } from './api';
import { RepairBadge } from './RepairBadge';
import { useRepairPeriods } from './useRepairPeriods';
import { getRepairOnDate } from './repairPeriods';

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
  const text = v.trim();
  return !text || /^#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|Н\/Д)$/i.test(text) ? '—' : text;
}

function getCellValue(r: VehicleRecord, key: ColKey): string {
  if (key === 'plateNumber') return r.plateNumber;
  const val = r[key as keyof VehicleRecord];
  if (val === null || val === undefined || typeof val === 'boolean') return '';
  const text = cellText(String(val));
  return text === '—' ? '' : text;
}

type ActiveFilters = Partial<Record<ColKey, Set<string>>>;

interface GroupInfo {
  key: string;
  label: string;
  records: VehicleRecord[];
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
    <div className="flex items-center gap-1 flex-wrap" aria-label="Группировка техники">
      <span className="text-[11px] text-muted-foreground mr-1">Группировать:</span>
      {GROUP_PILLS.map(p => {
        const active = selected.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onToggle(p.key)}
            aria-pressed={active}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border cursor-pointer font-semibold transition-colors"
            style={{
              fontSize: 11,
              background: active ? 'rgba(249,115,22,0.12)' : 'transparent',
              color: active ? 'var(--primary)' : 'var(--muted-foreground)',
              border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
            }}
          >
            {p.label}<ChevronDown className={`size-3 ${active ? 'rotate-180' : ''}`} />
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

  // Дата, на которую показываем статус: архив → выбранная дата снимка, иначе сегодня.
  // Значок-ключ должен соответствовать этой дате (а не «последнему периоду вообще»).
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const viewDate = snapshotMode && selectedSnapshotDate ? selectedSnapshotDate : today;
  const repairFrom = React.useMemo(() => {
    const d180 = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
    return viewDate < d180 ? viewDate : d180;
  }, [viewDate]);
  const repairTo = React.useMemo(() => (viewDate > today ? viewDate : today), [viewDate, today]);
  const repairPeriods = useRepairPeriods(repairFrom, repairTo);

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
        map[col.key] = uniqueSortedBy(allRecords, r => getCellValue(r, col.key));
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
        r.isBroken === true ? 'bg-destructive/5' : r.isBroken === 'middle' ? 'bg-amber-500/5' : ''
      } ${isPinned ? 'bg-primary/5' : ''}`}
    >
      <td className="px-1 py-1.5 text-center">
        <button
          onClick={() => togglePin(r.id)}
          className={`p-0.5 rounded border-none cursor-pointer transition-colors ${
            isPinned
              ? 'text-primary'
              : 'text-muted-foreground hover:text-primary'
          }`}
          title={isPinned ? 'Открепить' : 'Закрепить'}
          aria-label={isPinned ? 'Открепить' : 'Закрепить'}
        >
          <Pin className="size-3" style={isPinned ? { transform: 'rotate(45deg)' } : undefined} />
        </button>
      </td>
      <td className="px-3 py-1.5 font-medium">
        <div className="font-mono">{r.plateNumber}</div>
        <span data-source={r.category} title={`Источник: ${r.category}`} className="inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 mt-1 text-[10px] text-muted-foreground align-middle">{r.category || 'Источник не указан'}</span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground"><span className="line-clamp-2 break-words" title={cellText(r.branch)}>{cellText(r.branch)}</span></td>
      <td className="px-3 py-1.5"><span className="line-clamp-2 break-words" title={cellText(r.vehicleType)}>{cellText(r.vehicleType)}</span></td>
      <td className="px-3 py-1.5"><span className="line-clamp-2 break-words" title={cellText(r.brand)}>{cellText(r.brand)}</span></td>
      <td className="px-3 py-1.5 text-muted-foreground"><span className="line-clamp-2 break-words" title={cellText(r.constructionObject)}>{cellText(r.constructionObject)}</span></td>
      <td className="px-3 py-1.5">
        {(() => {
          const periods = repairPeriods.get(r.plateNumber.toUpperCase()) ?? [];
          // Период, покрывающий просматриваемую дату — согласован с цветом badge.
          const activePeriod = getRepairOnDate(periods, viewDate) ?? undefined;
          const badgeClass = r.isBroken === true
            ? 'bg-destructive/15 text-destructive'
            : r.isBroken === 'middle'
            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            : 'bg-green-500/15 text-green-600 dark:text-green-400';
          return (
            <span className="inline-flex items-center gap-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${badgeClass}`}
                style={{ fontSize: '10px' }}
              >
                {cellText(r.techStatus)}
              </span>
              {activePeriod && <RepairBadge period={activePeriod} size={11} />}
            </span>
          );
        })()}
      </td>
      <td className="px-3 py-1.5 text-muted-foreground"><span className="line-clamp-2 break-words" title={cellText(r.workType)}>{cellText(r.workType)}</span></td>
      <td className="px-3 py-1.5 text-muted-foreground"><span className="line-clamp-2 break-words" title={cellText(r.category)}>{cellText(r.category)}</span></td>
    </tr>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Состояние техники</h1>
          {syncStatus.lastSync && (
            <span className="text-xs text-muted-foreground">
              Синхронизация: {formatDateTime(syncStatus.lastSync)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowSyncHistory(v => !v)} aria-expanded={showSyncHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border bg-popover text-foreground hover:bg-muted cursor-pointer">
            <History className="size-3.5" />{showSyncHistory ? 'Скрыть журнал' : 'Журнал синхронизации'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer border-none"
          >
            <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Синхронизация…' : 'Синхронизировать'}</span>
          </button>
        </div>
      </div>

      {syncStatus.lastResult?.errors && syncStatus.lastResult.errors.length > 0 && (
        <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
          <span title={syncStatus.lastResult.errors.join('; ')}>Не удалось обновить часть источников: {syncStatus.lastResult.errors.length} ошибок.</span>
        </div>
      )}
      {error && <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2" title={error}>Не удалось загрузить данные. Попробуйте открыть страницу позже.</div>}

        {/* Sync History Panel */}
        {showSyncHistory && <div className="shrink-0">
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
                      <td className="px-2 py-0.5">{l.trigger === 'cron' ? 'По расписанию' : 'Вручную'}</td>
                      <td className="px-2 py-0.5 font-medium">{{ success: 'Успешно', error: 'Ошибка', partial: 'Частично', running: 'Выполняется' }[l.status] || 'Нет статуса'}</td>
                      <td className="px-2 py-0.5 text-right">{l.processed || 0}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.downloadMs != null ? (l.downloadMs / 1000).toFixed(1) + ' с' : '—'}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.parseMs != null ? (l.parseMs / 1000).toFixed(1) + ' с' : '—'}</td>
                      <td className="px-2 py-0.5 text-right text-muted-foreground">{l.writeMs != null ? (l.writeMs / 1000).toFixed(1) + ' с' : '—'}</td>
                      <td className="px-2 py-0.5 max-w-48 truncate" title={l.errors?.[0] || l.errorMessage || undefined}>{l.errors?.length || l.errorMessage ? 'Не удалось загрузить данные' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showSyncHistory && syncLogs.length === 0 && (
            <div className="mt-1 text-xs text-muted-foreground">Нет записей. Запустите синхронизацию.</div>
          )}
        </div>}

      <div className="flex items-center gap-3 shrink-0 flex-wrap">
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
        <button
          onClick={() => setSnapshotMode(v => !v)}
          role="switch" aria-checked={snapshotMode}
          className="px-2.5 py-1.5 rounded-lg border-none cursor-pointer font-semibold transition-colors"
          style={{
            fontSize: 11,
            background: snapshotMode ? 'rgba(249,115,22,0.12)' : 'transparent',
            color: snapshotMode ? 'var(--primary)' : 'var(--muted-foreground)',
            border: snapshotMode ? '1px solid var(--primary)' : '1px solid var(--border)',
          }}
        >
          <History className="size-3 inline mr-1" /> Архив
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
        <span className="text-xs text-muted-foreground ml-auto" style={{ fontSize: '11px' }}>
          {loading ? 'Загрузка…' : `${filtered.length} из ${allRecords.length} записей`}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto glass-card rounded-lg">
        <table className="w-full text-xs border-collapse" style={{ fontSize: '11px', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '32px' }} />
            <col style={{ width: '170px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '130px' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border/50 sticky top-0 bg-popover z-10">
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
                            aria-label={`Фильтр: ${col.label}`}
                            aria-expanded={openFilter === col.key}
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
                            <span className="absolute -top-1 -right-1 min-w-3 h-3 flex items-center justify-center rounded-full bg-primary text-primary-foreground font-bold leading-none" style={{ fontSize: 10, padding: '0 3px' }}>{filterCount}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {col.filterable && openFilter === col.key && (
                      <div className={`absolute top-full z-50 w-64 [&>div]:static [&>div]:mt-0 ${['techStatus', 'workType', 'category'].includes(col.key) ? 'right-0' : 'left-0'}`}>
                        <FilterDropdown
                          values={columnValues[col.key] || []}
                          selected={activeFilters[col.key] || new Set<string>()}
                          onToggle={v => toggleFilterValue(col.key, v)}
                          onClear={() => clearFilter(col.key)}
                          onClose={handleCloseFilter}
                        />
                      </div>
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
                              fontSize: 10,
                              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                              color: 'var(--muted-foreground)',
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
                            style={{ fontSize: 10, background: 'rgba(59,130,246,0.1)', color: '#60A5FA' }}
                          >
                            {g.records.length} зап.
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
            Стр. {page} из {totalPages} ({unpinnedRecords.length} записей)
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
