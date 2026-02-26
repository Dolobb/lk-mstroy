import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { TyagachiVehicle, TyagachiRequest, DashboardSummary, SyncStatus, SyncStats } from './types';
import {
  getVehicles,
  getVehicleRequests,
  startSync,
  getSyncStatus,
} from './api';
import { fmtIsoDateTime } from './utils';
import { VehicleOverview } from '../../components/dashboard/vehicle-overview';

// ===================== SyncPanel =====================

interface SyncPanelProps {
  summary: DashboardSummary | null;
  days: number;
  onDaysChange: (d: number) => void;
  onSyncDone: () => void;
}

const daysFromMonthStart = new Date().getDate();

const PERIOD_OPTIONS = [
  { label: '1д', days: 1 },
  { label: '3д', days: 3 },
  { label: '1н', days: 7 },
  { label: '1м', days: daysFromMonthStart },
];

const SyncPanel: React.FC<SyncPanelProps> = ({ summary, days, onDaysChange, onSyncDone }) => {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [monCurrent, setMonCurrent] = useState(0);
  const [monTotal, setMonTotal] = useState(0);
  const [lastStats, setLastStats] = useState<SyncStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    setLastStats(null);
    setMonCurrent(0);
    setMonTotal(0);
    setProgress('Запуск синхронизации...');
    try {
      await startSync(days);
    } catch (e) {
      setError(String(e));
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!syncing) return;
    const interval = setInterval(async () => {
      try {
        const status: SyncStatus = await getSyncStatus();
        setProgress(status.progress || '');
        setMonCurrent(status.mon_current ?? 0);
        setMonTotal(status.mon_total ?? 0);
        if (!status.running) {
          setSyncing(false);
          clearInterval(interval);
          if (status.error) setError(status.error);
          else { if (status.stats) setLastStats(status.stats); onSyncDone(); }
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [syncing, onSyncDone]);

  const ls = summary?.last_sync;
  const monPct = monTotal > 0 ? Math.round((monCurrent / monTotal) * 100) : null;
  const isMonPhase = syncing && monTotal > 0;

  return (
    <div className="glass-card px-4 py-3 flex flex-col gap-2 mb-3 shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Период:</span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => onDaysChange(opt.days)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border-none ${
              days === opt.days
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer border-none disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
          Синхронизировать
        </button>
        {summary && (
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span><span className="text-foreground font-semibold">{summary.vehicles_count}</span> машин</span>
            <span><span className="text-foreground font-semibold">{summary.requests_total}</span> заявок</span>
            <span className="text-green-500">{summary.requests_stable} финал</span>
            <span className="text-yellow-500">{summary.requests_in_progress} в работе</span>
          </div>
        )}
      </div>

      {syncing && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{progress}</span>
            {isMonPhase && (
              <span className="tabular-nums font-semibold text-primary">
                {monCurrent}/{monTotal} · {monPct}%
              </span>
            )}
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            {isMonPhase ? (
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${monPct}%` }} />
            ) : (
              <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
            )}
          </div>
        </div>
      )}

      {error && <span className="text-xs text-red-500">{error}</span>}

      {!syncing && lastStats && (
        <div className="text-xs rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 flex flex-wrap gap-x-4 gap-y-0.5">
          <span className="text-green-400 font-semibold">Синхронизация завершена</span>
          <span className="text-muted-foreground">добавлено: <span className="text-foreground font-semibold">{lastStats.requests_added}</span></span>
          <span className="text-muted-foreground">обновлено: <span className="text-foreground font-semibold">{lastStats.requests_updated}</span></span>
          <span className="text-muted-foreground">
            всего: <span className="text-foreground font-semibold">{lastStats.requests_total}</span> заявок
            · <span className="text-green-400">{lastStats.requests_stable} финал</span>
            · <span className="text-yellow-400">{lastStats.requests_in_progress} в работе</span>
          </span>
        </div>
      )}

      {ls && !syncing && !lastStats && (
        <div className="text-xs text-muted-foreground">
          Последняя синхронизация: {fmtIsoDateTime(ls.synced_at)} — ПЛ {ls.period_from_pl}–{ls.period_to_pl},
          заявки {ls.period_from_req}–{ls.period_to_req}
          {ls.status === 'error' && <span className="text-red-500 ml-1">(ошибка)</span>}
        </div>
      )}
    </div>
  );
};

// ===================== TyagachiVehicleBlock =====================

export const TyagachiVehicleBlock: React.FC = () => {
  const [days, setDays] = useState(daysFromMonthStart);
  const [syncVersion, setSyncVersion] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [fullVehicles, setFullVehicles] = useState<TyagachiVehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  useEffect(() => {
    getSyncStatus()
      .then(s => { if (s.completed_at) setLastSyncAt(s.completed_at) })
      .catch(() => {});
  }, [syncVersion]);

  useEffect(() => {
    setLoadingVehicles(true);
    getVehicles(days)
      .then((v) => setFullVehicles(v))
      .catch(() => {})
      .finally(() => setLoadingVehicles(false));
  }, [days, syncVersion]);

  const handleSyncDone = useCallback(() => {
    setSyncVersion((v) => v + 1);
  }, []);

  const fetchRequests = useCallback(
    async (plate: string, viewDays: number): Promise<TyagachiRequest[]> => {
      const vehicle = fullVehicles.find((v) => v.ts_reg_number === plate);
      if (!vehicle) return [];
      return getVehicleRequests(vehicle.id, viewDays);
    },
    [fullVehicles]
  );

  const realVehicles = fullVehicles.map((v) => ({
    plate: v.ts_reg_number ?? `#${v.ts_id_mo}`,
    model: v.ts_name_mo ?? '',
    stable: v.requests_stable,
    inProgress: v.requests_in_progress,
  }));

  const summary: DashboardSummary | null = fullVehicles.length > 0
    ? {
        vehicles_count: fullVehicles.length,
        requests_total: fullVehicles.reduce((s, v) => s + v.requests_total, 0),
        requests_stable: fullVehicles.reduce((s, v) => s + v.requests_stable, 0),
        requests_in_progress: fullVehicles.reduce((s, v) => s + v.requests_in_progress, 0),
        last_sync: null,
      }
    : null;

  return (
    <>
      <SyncPanel
        summary={summary}
        days={days}
        onDaysChange={setDays}
        onSyncDone={handleSyncDone}
      />
      <VehicleOverview
        vehicleType="tyagachi"
        onTypeChange={() => {}}
        realVehicles={realVehicles}
        loadingVehicles={loadingVehicles}
        fetchRequests={fetchRequests}
        hideTypeSlider
        lastSyncAt={lastSyncAt}
      />
    </>
  );
};
