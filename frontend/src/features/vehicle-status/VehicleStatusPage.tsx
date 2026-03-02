import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { StatusRecord, SyncStatus } from './types';
import { fetchVehicleStatus, fetchSyncStatus, triggerSync } from './api';

// Должны совпадать с displayName в SHEET_TABS (vehicle-status/server/src/services/sheetsSyncService.ts)
const CATEGORIES = [
  'Стягачи',
  'ДСТ МС11',
  'Самосвалы',
  'Автобусы/Бортовые МС11',
  'АБС/АБН МС11',
  'МС 11 Краны',
  'Малая механизация МС11',
  'Спецтехника МС11',
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  const d  = String(dt.getDate()).padStart(2, '0');
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const h  = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${d}.${mo}.${dt.getFullYear()} ${h}:${mi}`;
}

export const VehicleStatusPage: React.FC = () => {
  const [records, setRecords]         = useState<StatusRecord[]>([]);
  const [syncStatus, setSyncStatus]   = useState<SyncStatus>({ lastSync: null, lastResult: null, inProgress: false });
  const [filterMode, setFilterMode]   = useState<'all' | 'repairing'>('all');
  const [filterCat, setFilterCat]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const prevLastSync                  = useRef<string | null>(null);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: { isRepairing?: boolean; category?: string } = {};
      if (filterMode === 'repairing') filters.isRepairing = true;
      if (filterCat) filters.category = filterCat;
      const data = await fetchVehicleStatus(filters);
      setRecords(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const s = await fetchSyncStatus();
      setSyncStatus(s);
      return s;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    load();
    loadSyncStatus();
  }, [filterMode, filterCat]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const before = syncStatus.lastSync;
      prevLastSync.current = before;
      await triggerSync();

      // Poll every 2s until lastSync changes
      pollRef.current = setInterval(async () => {
        const s = await loadSyncStatus();
        if (s && s.lastSync && s.lastSync !== prevLastSync.current) {
          stopPoll();
          setSyncing(false);
          await load();
        }
      }, 2000);

      // Safety timeout after 60s
      setTimeout(() => {
        if (syncing) {
          stopPoll();
          setSyncing(false);
        }
      }, 60_000);
    } catch (e) {
      setError(String(e));
      setSyncing(false);
    }
  };

  useEffect(() => () => stopPoll(), []);

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Состояние техники</h1>
          {syncStatus.lastSync && (
            <span className="text-xs text-muted-foreground">
              Последняя синхронизация: {formatDateTime(syncStatus.lastSync)}
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

      {/* Errors */}
      {syncStatus.lastResult?.errors && syncStatus.lastResult.errors.length > 0 && (
        <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2">
          {syncStatus.lastResult.errors.slice(0, 3).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          {syncStatus.lastResult.errors.length > 3 && (
            <div>…ещё {syncStatus.lastResult.errors.length - 3} ошибок</div>
          )}
        </div>
      )}
      {error && (
        <div className="shrink-0 text-xs text-destructive bg-destructive/10 rounded-lg p-2">{error}</div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          {(['all', 'repairing'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1 rounded-lg border-none cursor-pointer transition-colors font-medium ${
                filterMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontSize: '11px' }}
            >
              {mode === 'all' ? 'Все' : 'В ремонте'}
            </button>
          ))}
        </div>

        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
          style={{ fontSize: '11px' }}
        >
          <option value="">Все категории</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c.trim()}</option>
          ))}
        </select>

        {(filterMode !== 'all' || filterCat) && (
          <button
            onClick={() => { setFilterMode('all'); setFilterCat(''); }}
            className="text-xs text-muted-foreground hover:text-foreground border-none bg-transparent cursor-pointer"
            style={{ fontSize: '11px' }}
          >
            Сбросить
          </button>
        )}

        <span className="text-xs text-muted-foreground ml-auto" style={{ fontSize: '11px' }}>
          {loading ? 'Загрузка…' : `${records.length} записей`}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto glass-card rounded-lg">
        <table className="w-full text-xs border-collapse" style={{ fontSize: '11px' }}>
          <thead>
            <tr className="border-b border-border/50 sticky top-0 bg-card/90 backdrop-blur-sm z-10">
              {['Гос. №', 'Категория', 'Тех. состояние', 'Статус', 'Начало', 'Конец', 'Дней', 'Проверка'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr
                key={r.id}
                className={`border-b border-border/30 transition-colors hover:bg-muted/30 ${
                  r.isRepairing ? 'bg-destructive/5' : ''
                }`}
              >
                <td className="px-3 py-1.5 font-mono font-medium">{r.plateNumber}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.category?.trim() || '—'}</td>
                <td className="px-3 py-1.5">{r.statusText || '—'}</td>
                <td className="px-3 py-1.5">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                      r.isRepairing
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-green-500/15 text-green-600 dark:text-green-400'
                    }`}
                    style={{ fontSize: '10px' }}
                  >
                    {r.isRepairing ? 'В ремонте' : 'Исправен'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDate(r.dateStart)}</td>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDate(r.dateEnd)}</td>
                <td className="px-3 py-1.5 text-center">
                  {r.isRepairing ? (
                    <span className="text-destructive font-medium">{r.daysInRepair}</span>
                  ) : (
                    <span className="text-muted-foreground">{r.daysInRepair}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDate(r.lastCheckDate)}</td>
              </tr>
            ))}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  Нет данных. Нажмите «Синхронизировать» для загрузки из Google Sheets.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
