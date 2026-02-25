import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ChevronDown, ChevronRight, ExternalLink, Truck, FileText, Plus } from 'lucide-react';
import type { TyagachiVehicle, TyagachiRequest, DashboardSummary, SyncStatus, SyncStats, LegacyReport } from './types';
import {
  getDashboardSummary,
  getVehicles,
  getVehicleRequests,
  startSync,
  getSyncStatus,
  getLegacyReports,
  getLegacyReportUrl,
  createReport,
  getFetchStatus,
} from './api';
import { fmtRuDT, fmtRequestStatus, fmtStability, fmtIsoDateTime } from './utils';

// ===================== SyncPanel =====================

interface SyncPanelProps {
  summary: DashboardSummary | null;
  onSyncDone: () => void;
}

const daysFromMonthStart = new Date().getDate();

const PERIOD_OPTIONS = [
  { label: '1д', days: 1 },
  { label: '3д', days: 3 },
  { label: '1н', days: 7 },
  { label: '1м', days: daysFromMonthStart },
];

const SyncPanel: React.FC<SyncPanelProps> = ({ summary, onSyncDone }) => {
  const [period, setPeriod] = useState(daysFromMonthStart);
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
      await startSync(period);
    } catch (e) {
      setError(String(e));
      setSyncing(false);
      return;
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
          if (status.error) {
            setError(status.error);
          } else {
            if (status.stats) setLastStats(status.stats);
            onSyncDone();
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [syncing, onSyncDone]);

  const ls = summary?.last_sync;
  const monPct = monTotal > 0 ? Math.round((monCurrent / monTotal) * 100) : null;
  const isMonPhase = syncing && monTotal > 0;

  return (
    <div className="glass-card px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">Период:</span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => setPeriod(opt.days)}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border-none ${
              period === opt.days
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
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${monPct}%` }}
              />
            ) : (
              <div className="h-full bg-primary rounded-full animate-pulse w-1/3" />
            )}
          </div>
        </div>
      )}

      {error && <span className="text-xs text-red-500">{error}</span>}

      {/* Completion log */}
      {!syncing && lastStats && (
        <div className="text-xs rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 flex flex-wrap gap-x-4 gap-y-0.5">
          <span className="text-green-400 font-semibold">Синхронизация завершена</span>
          <span className="text-muted-foreground">
            добавлено: <span className="text-foreground font-semibold">{lastStats.requests_added}</span>
          </span>
          <span className="text-muted-foreground">
            обновлено: <span className="text-foreground font-semibold">{lastStats.requests_updated}</span>
          </span>
          <span className="text-muted-foreground">
            всего в БД: <span className="text-foreground font-semibold">{lastStats.requests_total}</span> заявок
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

// ===================== RequestRow =====================

interface RequestRowProps {
  req: TyagachiRequest;
  onClick: () => void;
}

const RequestRow: React.FC<RequestRowProps> = ({ req, onClick }) => {
  const isStable = req.stability_status === 'stable';
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer border-none bg-transparent group"
    >
      <div className="flex items-start gap-2">
        <span className="text-xs font-mono text-primary shrink-0 mt-0.5">#{req.request_number}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-foreground font-medium truncate">
              {req.route_start_address && req.route_end_address
                ? `${req.route_start_address} → ${req.route_end_address}`
                : req.object_expend_name ?? '—'}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                isStable ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}
            >
              {fmtStability(req.stability_status)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
            <span>{fmtRequestStatus(req.request_status)}</span>
            {req.route_start_date && <span>{fmtRuDT(req.route_start_date)}</span>}
            {req.order_name_cargo && <span className="truncate">{req.order_name_cargo}</span>}
          </div>
        </div>
        <ExternalLink className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      </div>
    </button>
  );
};

// ===================== VehicleCard =====================

interface VehicleCardProps {
  vehicle: TyagachiVehicle;
}

const VehicleCard: React.FC<VehicleCardProps> = ({ vehicle }) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [requests, setRequests] = useState<TyagachiRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const handleExpand = async () => {
    if (!expanded && requests.length === 0) {
      setLoading(true);
      try {
        const reqs = await getVehicleRequests(vehicle.id);
        setRequests(reqs);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div className="glass-card overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
      <button
        onClick={handleExpand}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer border-none bg-transparent"
      >
        <Truck className="size-4 text-primary shrink-0" />
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">
            {vehicle.ts_reg_number ?? `ТС #${vehicle.ts_id_mo}`}
          </div>
          {vehicle.ts_name_mo && (
            <div className="text-[10px] text-muted-foreground truncate">{vehicle.ts_name_mo}</div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <span>{vehicle.requests_total} заявок</span>
          {vehicle.requests_in_progress > 0 && (
            <span className="text-yellow-500">{vehicle.requests_in_progress} акт.</span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Загрузка...</div>
          ) : requests.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Нет заявок</div>
          ) : (
            <div className="py-1">
              {requests.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  onClick={() => navigate(`/tyagachi/requests/${req.request_number}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ===================== LegacyReportsSection =====================

const toRuDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const LegacyReportsSection: React.FC = () => {
  const [reports, setReports] = useState<LegacyReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Create report form
  const [showForm, setShowForm] = useState(false);
  const [fromPL, setFromPL] = useState('');
  const [toPL, setToPL] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getLegacyReports();
      setReports(r);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExpand = () => {
    if (!expanded && reports.length === 0) load();
    setExpanded((v) => !v);
  };

  const handleCreateReport = async () => {
    if (!fromPL || !toPL) return;
    setCreating(true);
    setCreateError(null);
    setCreateProgress('Запуск генерации отчёта...');
    try {
      await createReport({
        from_pl: toRuDate(fromPL),
        to_pl: toRuDate(toPL),
        from_requests: toRuDate(fromPL),
        to_requests: toRuDate(toPL),
        title: reportTitle || undefined,
      });
    } catch (e) {
      setCreateError(String(e));
      setCreating(false);
      return;
    }
  };

  useEffect(() => {
    if (!creating) return;
    const interval = setInterval(async () => {
      try {
        const status = await getFetchStatus();
        setCreateProgress(status.progress || 'Генерация...');
        if (!status.running) {
          setCreating(false);
          clearInterval(interval);
          if (status.error) {
            setCreateError(status.error);
          } else {
            setCreateProgress('');
            setShowForm(false);
            load();
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [creating, load]);

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={handleExpand}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer border-none bg-transparent"
      >
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <span className="flex-1 text-left text-sm font-semibold text-foreground">
          Архив HTML-отчётов
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50">
          {/* Create report form */}
          <div className="px-3 py-2 border-b border-border/30">
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer border-none bg-transparent"
            >
              <Plus className="size-3.5" />
              {showForm ? 'Скрыть форму' : 'Создать новый отчёт'}
            </button>

            {showForm && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">От (ПЛ)</label>
                    <input
                      type="date"
                      value={fromPL}
                      onChange={(e) => setFromPL(e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs bg-muted border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">До (ПЛ)</label>
                    <input
                      type="date"
                      value={toPL}
                      onChange={(e) => setToPL(e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs bg-muted border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="Название (необязательно)"
                  className="w-full px-2 py-1 rounded text-xs bg-muted border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleCreateReport}
                  disabled={creating || !fromPL || !toPL}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer border-none disabled:opacity-60 self-start"
                >
                  <RefreshCw className={`size-3 ${creating ? 'animate-spin' : ''}`} />
                  {creating ? 'Генерация...' : 'Создать отчёт'}
                </button>
                {creating && createProgress && (
                  <div className="text-[10px] text-muted-foreground">{createProgress}</div>
                )}
                {createError && (
                  <div className="text-[10px] text-red-500">{createError}</div>
                )}
              </div>
            )}
          </div>

          {/* Reports list */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Загрузка...</div>
            ) : reports.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Нет сохранённых отчётов</div>
            ) : (
              <div className="py-1">
                {reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">
                        {rep.title ?? `Отчёт #${rep.id}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtIsoDateTime(rep.created_at)}
                        {rep.requests_count != null && ` · ${rep.requests_count} заявок`}
                        {rep.matched_count != null && ` · ${rep.matched_count} совпадений`}
                      </div>
                    </div>
                    <a
                      href={getLegacyReportUrl(rep.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors shrink-0"
                      style={{ textDecoration: 'none' }}
                    >
                      <ExternalLink className="size-3" />
                      Открыть
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ===================== Main Dashboard =====================

const TyagachiDashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [vehicles, setVehicles] = useState<TyagachiVehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVehicles = useCallback(async () => {
    setLoadingVehicles(true);
    setError(null);
    try {
      const [v, s] = await Promise.all([getVehicles(), getDashboardSummary()]);
      setVehicles(v);
      setSummary(s);
    } catch (e) {
      setError('Не удалось загрузить данные тягачей. Убедитесь что сервер запущен (python main.py --web).');
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 p-3 overflow-y-auto">
      <SyncPanel summary={summary} onSyncDone={loadVehicles} />

      {error && (
        <div className="glass-card px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vehicles column */}
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Машины ({vehicles.length})
          </h2>
          {loadingVehicles ? (
            <div className="glass-card px-4 py-6 text-sm text-muted-foreground text-center">
              Загрузка...
            </div>
          ) : vehicles.length === 0 && !error ? (
            <div className="glass-card px-4 py-6 text-sm text-muted-foreground text-center">
              Нет данных. Запустите синхронизацию.
            </div>
          ) : (
            vehicles.map((v) => <VehicleCard key={v.id} vehicle={v} />)
          )}
        </div>

        {/* Legacy reports column */}
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            История
          </h2>
          <LegacyReportsSection />
        </div>
      </div>
    </div>
  );
};

export default TyagachiDashboard;
