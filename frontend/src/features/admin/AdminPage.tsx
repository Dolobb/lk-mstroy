import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Play, Square, ChevronDown, ChevronUp, XCircle, Database, Search } from 'lucide-react';
import { DateRangePicker } from '@/components/DateRangePicker';
import type { ServiceStatus, DataCoverage, FetchStatus, RecalcStatus, DbTablePreset, DbQueryResult } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function daysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

function formatDbCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function fetchServices(): Promise<ServiceStatus[]> {
  const res = await fetch('/api/admin/services');
  if (!res.ok) throw new Error('Ошибка запроса');
  return res.json();
}

async function fetchLogs(id: string, lines = 80): Promise<string[]> {
  const res = await fetch(`/api/admin/services/${id}/logs?lines=${lines}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.lines as string[];
}

async function serviceAction(id: string, action: 'start' | 'stop' | 'restart') {
  await fetch(`/api/admin/services/${id}/${action}`, { method: 'POST' });
}

async function fetchCoverage(from: string, to: string): Promise<DataCoverage> {
  const res = await fetch(`/api/admin/data-coverage?from=${from}&to=${to}`);
  if (!res.ok) return { kip: [], dumpTrucks: [] };
  return res.json();
}

async function fetchFetchStatus(): Promise<FetchStatus> {
  const res = await fetch('/api/admin/fetch/status');
  if (!res.ok) return { active: false, service: null, current: null, startedAt: null, queue: [], done: [], errors: [] };
  return res.json();
}

async function startFetch(service: 'kip' | 'dump-trucks', from: string, to: string) {
  const res = await fetch(`/api/admin/fetch/${service}?from=${from}&to=${to}`, { method: 'POST' });
  return res.json();
}

async function startForceFetch(service: 'kip', from: string, to: string) {
  const res = await fetch(`/api/admin/fetch/${service}?from=${from}&to=${to}&force=true`, { method: 'POST' });
  return res.json();
}

async function cancelFetch() {
  await fetch('/api/admin/fetch/cancel', { method: 'POST' });
}

async function fetchRecalcStatus(): Promise<RecalcStatus> {
  const res = await fetch('/api/admin/recalc/status');
  if (!res.ok) return { active: false, service: null, current: null, queue: [], done: [], errors: [] };
  return res.json();
}

async function startRecalc(service: 'kip' | 'dump-trucks', from: string, to: string) {
  const res = await fetch(`/api/admin/recalc/${service}?from=${from}&to=${to}`, { method: 'POST' });
  return res.json();
}

async function cancelRecalc() {
  await fetch('/api/admin/recalc/cancel', { method: 'POST' });
}

async function fetchDbTables(): Promise<DbTablePreset[]> {
  const res = await fetch('/api/admin/db-tables');
  if (!res.ok) return [];
  return res.json();
}

async function fetchDbQuery(table: string, dateFrom: string, dateTo: string): Promise<DbQueryResult> {
  const res = await fetch(`/api/admin/db-query?table=${table}&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=200`);
  return res.json();
}

async function startRefreshFetch(service: 'kip' | 'dump-trucks', from: string, to: string) {
  const res = await fetch(`/api/admin/fetch/${service}?from=${from}&to=${to}&refresh=true`, { method: 'POST' });
  return res.json();
}

// ─── Service Card ─────────────────────────────────────────────────────────────

const ServiceCard: React.FC<{ svc: ServiceStatus; onAction: () => void }> = ({ svc, onAction }) => {
  const [logsOpen, setLogsOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [acting, setActing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!logsOpen) return;
    const load = async () => {
      const lines = await fetchLogs(svc.id);
      setLogLines(lines);
      setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
    };
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [logsOpen, svc.id]);

  const act = async (action: 'start' | 'stop' | 'restart') => {
    setActing(true);
    await serviceAction(svc.id, action);
    setTimeout(() => { setActing(false); onAction(); }, 1200);
  };

  const statusColor = svc.portOpen
    ? 'bg-green-500'
    : svc.running
    ? 'bg-yellow-400'
    : 'bg-muted-foreground/40';

  const statusLabel = svc.portOpen ? 'Работает' : svc.running ? 'Запускается...' : 'Остановлен';

  return (
    <div className="glass-card rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`size-2 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-sm font-medium truncate">{svc.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">:{svc.port}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0" style={{ fontSize: '10px' }}>
          {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => act('start')}
          disabled={acting || svc.running}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 disabled:opacity-40 transition-colors"
          style={{ fontSize: '11px' }}
        >
          <Play className="size-3" />
          Запустить
        </button>
        <button
          onClick={() => act('restart')}
          disabled={acting}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
          style={{ fontSize: '11px' }}
        >
          <RotateCcw className={`size-3 ${acting ? 'animate-spin' : ''}`} />
          Перезапустить
        </button>
        <button
          onClick={() => act('stop')}
          disabled={acting || !svc.running}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40 transition-colors"
          style={{ fontSize: '11px' }}
        >
          <Square className="size-3" />
          Стоп
        </button>
        <button
          onClick={() => setLogsOpen(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-muted text-muted-foreground hover:text-foreground transition-colors ml-auto"
          style={{ fontSize: '11px' }}
        >
          {logsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          Логи
        </button>
      </div>

      {logsOpen && (
        <div
          ref={logRef}
          className="bg-black/60 rounded-lg p-2 overflow-auto font-mono text-green-400 leading-relaxed"
          style={{ fontSize: '10px', maxHeight: '180px' }}
        >
          {logLines.length === 0 ? (
            <span className="text-muted-foreground">Нет логов</span>
          ) : (
            logLines.map((l, i) => (
              <div
                key={i}
                className={
                  l.startsWith('[err]') ? 'text-red-400'
                  : l.startsWith('[admin]') ? 'text-yellow-400'
                  : ''
                }
              >
                {l}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─── Coverage calendar row ────────────────────────────────────────────────────

const CoverageRow: React.FC<{
  label: string;
  dates: Set<string>;
  done: Set<string>;
  current: string | null;
  partial?: Set<string>;
  allDays: string[];
}> = ({ label, dates, done, current, partial = new Set(), allDays }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-muted-foreground shrink-0 w-24 text-right" style={{ fontSize: '11px' }}>
      {label}
    </span>
    <div className="flex flex-wrap gap-0.5">
      {allDays.map(d => {
        const has = dates.has(d);
        const justDone = done.has(d);
        const isCurrent = d === current;
        const isPartial = !has && !justDone && !isCurrent && partial.has(d);
        return (
          <div
            key={d}
            title={`${fmtDate(d)}${has || justDone ? ' ✓' : isCurrent ? ' ⏳ загружается...' : isPartial ? ' ⚠️ частично' : ' — нет данных'}`}
            className={`rounded-sm transition-colors ${
              has || justDone
                ? 'bg-green-500/70'
                : isCurrent
                ? 'bg-yellow-400/80 animate-pulse'
                : isPartial
                ? 'bg-yellow-400/50'
                : 'bg-muted/60'
            }`}
            style={{ width: '14px', height: '14px' }}
          />
        );
      })}
    </div>
  </div>
);

// ─── Main page ────────────────────────────────────────────────────────────────

export const AdminPage: React.FC = () => {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [coverage, setCoverage] = useState<DataCoverage | null>(null);
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({
    active: false, service: null, current: null, startedAt: null, queue: [], done: [], errors: [],
  });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recalcStatus, setRecalcStatus] = useState<RecalcStatus>({
    active: false, service: null, current: null, queue: [], done: [], errors: [],
  });
  const [coverageFrom, setCoverageFrom] = useState(monthStart());
  const [coverageTo, setCoverageTo] = useState(today());
  const [loadingCov, setLoadingCov] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [refreshMode, setRefreshMode] = useState(false);

  // DB Viewer state
  const [dbOpen, setDbOpen] = useState(false);
  const [dbTables, setDbTables] = useState<DbTablePreset[]>([]);
  const [dbSelectedTable, setDbSelectedTable] = useState('');
  const [dbDateFrom, setDbDateFrom] = useState(monthStart());
  const [dbDateTo, setDbDateTo] = useState(today());
  const [dbResult, setDbResult] = useState<DbQueryResult | null>(null);
  const [dbLoading, setDbLoading] = useState(false);

  const loadServices = async () => {
    try {
      const data = await fetchServices();
      setServices(data);
      setAdminError(null);
    } catch {
      setAdminError('Не удалось подключиться к admin-серверу (:3005). Запустите: cd admin && npm run dev');
    }
  };

  const loadCoverage = async () => {
    setLoadingCov(true);
    const data = await fetchCoverage(coverageFrom, coverageTo);
    setCoverage(data);
    setLoadingCov(false);
  };

  const loadFetchStatus = async () => {
    const s = await fetchFetchStatus();
    setFetchStatus(s);
    // Обновляем покрытие всегда — иначе после перезапуска admin-сервера календарик зависает
    const data = await fetchCoverage(coverageFrom, coverageTo);
    setCoverage(data);
  };

  const loadRecalcStatus = async () => {
    const s = await fetchRecalcStatus();
    setRecalcStatus(s);
  };

  useEffect(() => {
    loadServices();
    const t = setInterval(loadServices, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadCoverage();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Поллинг статуса загрузки каждые 5с
  useEffect(() => {
    const t = setInterval(loadFetchStatus, 5000);
    return () => clearInterval(t);
  }, [coverageFrom, coverageTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Поллинг статуса пересчёта каждые 5с
  useEffect(() => {
    const t = setInterval(loadRecalcStatus, 5000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Счётчик секунд для текущей даты в загрузке
  useEffect(() => {
    if (!fetchStatus.active || !fetchStatus.startedAt) {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(Math.floor((Date.now() - fetchStatus.startedAt) / 1000));
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - (fetchStatus.startedAt ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [fetchStatus.active, fetchStatus.startedAt]);

  // Load DB tables once
  useEffect(() => {
    fetchDbTables().then(tables => {
      setDbTables(tables);
      if (tables.length > 0) setDbSelectedTable(tables[0].key);
    });
  }, []);

  const handleDbQuery = async () => {
    if (!dbSelectedTable) return;
    setDbLoading(true);
    const result = await fetchDbQuery(dbSelectedTable, dbDateFrom, dbDateTo);
    setDbResult(result);
    setDbLoading(false);
  };

  const handleStartFetch = async (service: 'kip' | 'dump-trucks') => {
    if (refreshMode) {
      const result = await startRefreshFetch(service, coverageFrom, coverageTo);
      if (result.total === 0 && !result.started) {
        alert('Нет дат в выбранном периоде.');
        return;
      }
      await loadFetchStatus();
      return;
    }
    const result = await startFetch(service, coverageFrom, coverageTo);
    if (result.missing === 0) {
      alert('Все даты в выбранном периоде уже загружены!');
      return;
    }
    await loadFetchStatus();
  };

  const handleStartForceFetch = async () => {
    const result = await startForceFetch('kip', coverageFrom, coverageTo);
    if (result.missing === 0) {
      alert('Все даты в периоде уже есть в monitoring_raw!');
      return;
    }
    await loadFetchStatus();
  };

  const handleCancel = async () => {
    await cancelFetch();
    await loadFetchStatus();
  };

  const handleStartRecalc = async (service: 'kip' | 'dump-trucks') => {
    const result = await startRecalc(service, coverageFrom, coverageTo);
    if (result.count === 0) {
      alert('Нет данных в выбранном периоде для пересчёта. Сначала выполните загрузку.');
      return;
    }
    await loadRecalcStatus();
  };

  const handleCancelRecalc = async () => {
    await cancelRecalc();
    await loadRecalcStatus();
  };

  const allDays = daysInRange(coverageFrom, coverageTo);
  const kipSet = new Set(coverage?.kip ?? []);
  const dtSet = new Set(coverage?.dumpTrucks ?? []);
  const rawSet = new Set(coverage?.rawDates ?? []);
  const rawPartialSet = new Set(coverage?.rawPartial ?? []);
  const fetchDoneSet = new Set(fetchStatus.done);

  const isKipFetching = fetchStatus.active && fetchStatus.service === 'kip';
  const isDTFetching = fetchStatus.active && fetchStatus.service === 'dump-trucks';
  const totalFetch = fetchStatus.done.length + fetchStatus.queue.length + (fetchStatus.current ? 1 : 0);

  const isKipRecalcing = recalcStatus.active && recalcStatus.service === 'kip';
  const isDTRecalcing  = recalcStatus.active && recalcStatus.service === 'dump-trucks';
  const totalRecalc = recalcStatus.done.length + recalcStatus.queue.length + (recalcStatus.current ? 1 : 0);

  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-4">

      {/* Services */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Сервисы</h2>
        {adminError ? (
          <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-3">
            {adminError}
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {services.map(svc => (
              <ServiceCard key={svc.id} svc={svc} onAction={loadServices} />
            ))}
          </div>
        )}
      </div>

      {/* Data coverage */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Покрытие данных</h2>
        <div className="glass-card rounded-xl p-3 flex flex-col gap-3">

          {/* Period + refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker
              dateFrom={coverageFrom}
              dateTo={coverageTo}
              onRangeChange={(from, to) => { setCoverageFrom(from); setCoverageTo(to); }}
            />
            <button
              onClick={loadCoverage}
              disabled={loadingCov}
              className="px-3 py-1 rounded-lg text-xs border-none cursor-pointer bg-muted text-foreground hover:bg-muted/80 disabled:opacity-60 transition-opacity"
              style={{ fontSize: '11px' }}
            >
              {loadingCov ? 'Загрузка...' : 'Обновить'}
            </button>
          </div>

          {/* Fetch buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleStartFetch('kip')}
              disabled={fetchStatus.active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                isKipFetching
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/15 text-primary hover:bg-primary/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {isKipFetching && <RotateCcw className="size-3 animate-spin" />}
              Обновить КИП
            </button>
            <button
              onClick={() => handleStartFetch('dump-trucks')}
              disabled={fetchStatus.active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                isDTFetching
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/15 text-primary hover:bg-primary/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {isDTFetching && <RotateCcw className="size-3 animate-spin" />}
              Обновить Самосвалы
            </button>
            <button
              onClick={handleStartForceFetch}
              disabled={fetchStatus.active}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 disabled:opacity-50"
              style={{ fontSize: '11px' }}
            >
              Перевыгрузить raw (КИП)
            </button>
            {fetchStatus.active && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors font-medium"
                style={{ fontSize: '11px' }}
              >
                <XCircle className="size-3" />
                Отмена
              </button>
            )}
            <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none" style={{ fontSize: '11px' }}>
              <input
                type="checkbox"
                checked={refreshMode}
                onChange={e => setRefreshMode(e.target.checked)}
                disabled={fetchStatus.active}
                className="cursor-pointer accent-amber-500"
              />
              <span className="text-muted-foreground">Обновить все (перезагрузить существующие)</span>
            </label>
          </div>

          {/* Progress bar */}
          {fetchStatus.active && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
                <span className="text-muted-foreground">
                  Загружается: <span className="text-foreground font-mono">
                    {fetchStatus.current ? fmtDate(fetchStatus.current) : '...'}
                  </span>
                  {elapsedSec > 0 && (
                    <span className="text-muted-foreground ml-1.5">
                      {elapsedSec < 60
                        ? `${elapsedSec}с`
                        : `${Math.floor(elapsedSec / 60)}м ${elapsedSec % 60}с`}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {fetchStatus.done.length} из {totalFetch} дн.
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: totalFetch > 0 ? `${(fetchStatus.done.length / totalFetch) * 100}%` : '0%' }}
                />
              </div>
              {fetchStatus.queue.length > 0 && (
                <div className="text-muted-foreground" style={{ fontSize: '10px' }}>
                  В очереди: {fetchStatus.queue.slice(0, 5).map(fmtDate).join(', ')}
                  {fetchStatus.queue.length > 5 ? ` ...ещё ${fetchStatus.queue.length - 5}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {fetchStatus.errors.length > 0 && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
              {fetchStatus.errors.slice(-3).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* DB connection errors */}
          {coverage?.errors && (coverage.errors.kip || coverage.errors.dumpTrucks) && (
            <div className="flex flex-col gap-1 text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
              {coverage.errors.kip && (
                <div><span className="font-medium">КИП БД ({coverage.config?.kip}):</span> {coverage.errors.kip}</div>
              )}
              {coverage.errors.dumpTrucks && (
                <div><span className="font-medium">Самосвалы БД ({coverage.config?.main}):</span> {coverage.errors.dumpTrucks}</div>
              )}
              <div className="text-muted-foreground mt-1">
                Проверь <span className="font-mono">admin/.env</span> — порты и пользователя БД
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3" style={{ fontSize: '10px' }}>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-green-500/70" />
              <span className="text-muted-foreground">Полные (&ge;90%)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-yellow-400/50" />
              <span className="text-muted-foreground">Частично</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-yellow-400/80 animate-pulse" />
              <span className="text-muted-foreground">Загружается</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-muted/60" />
              <span className="text-muted-foreground">Нет данных</span>
            </div>
            <span className="text-muted-foreground ml-auto">
              {allDays.length} дн. | КИП: {kipSet.size} | Raw: {rawSet.size}{rawPartialSet.size > 0 ? `+${rawPartialSet.size}⚠️` : ''} | Самосвалы: {dtSet.size}
            </span>
          </div>

          {/* Calendar */}
          {coverage && (
            <div className="flex flex-col gap-1.5">
              <CoverageRow
                label="КИП техники"
                dates={kipSet}
                done={isKipFetching ? fetchDoneSet : new Set()}
                current={isKipFetching ? fetchStatus.current : null}
                allDays={allDays}
              />
              <CoverageRow
                label="KIP raw"
                dates={rawSet}
                done={new Set()}
                current={null}
                partial={rawPartialSet}
                allDays={allDays}
              />
              <CoverageRow
                label="Самосвалы"
                dates={dtSet}
                done={isDTFetching ? fetchDoneSet : new Set()}
                current={isDTFetching ? fetchStatus.current : null}
                allDays={allDays}
              />
            </div>
          )}

          {/* Date labels */}
          {allDays.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0" />
              <div className="flex flex-wrap gap-0.5">
                {allDays.map((d, i) => (
                  <div key={d} style={{ width: '14px', fontSize: '8px' }} className="text-muted-foreground text-center overflow-hidden">
                    {i % 7 === 0 ? fmtDate(d) : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recalculate */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Пересчёт данных</h2>
        <div className="glass-card rounded-xl p-3 flex flex-col gap-3">
          <div className="text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
            Пересчитать КИП из уже сохранённых сырых данных — без обращения к TIS API.
            Период выбирается тот же, что и для покрытия данных.
          </div>

          {/* Recalc buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleStartRecalc('kip')}
              disabled={recalcStatus.active || fetchStatus.active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                isKipRecalcing
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/15 text-primary hover:bg-primary/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {isKipRecalcing && <RotateCcw className="size-3 animate-spin" />}
              Пересчитать КИП
            </button>
            <button
              onClick={() => handleStartRecalc('dump-trucks')}
              disabled={recalcStatus.active || fetchStatus.active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                isDTRecalcing
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/15 text-primary hover:bg-primary/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {isDTRecalcing && <RotateCcw className="size-3 animate-spin" />}
              Пересчитать Самосвалы
            </button>
            {recalcStatus.active && (
              <button
                onClick={handleCancelRecalc}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors font-medium"
                style={{ fontSize: '11px' }}
              >
                <XCircle className="size-3" />
                Отмена
              </button>
            )}
          </div>

          {/* Progress bar */}
          {recalcStatus.active && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
                <span className="text-muted-foreground">
                  Пересчёт: <span className="text-foreground font-mono">
                    {recalcStatus.current ? fmtDate(recalcStatus.current) : '...'}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {recalcStatus.done.length} из {totalRecalc} дн.
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: totalRecalc > 0 ? `${(recalcStatus.done.length / totalRecalc) * 100}%` : '0%' }}
                />
              </div>
              {recalcStatus.queue.length > 0 && (
                <div className="text-muted-foreground" style={{ fontSize: '10px' }}>
                  В очереди: {recalcStatus.queue.slice(0, 5).map(fmtDate).join(', ')}
                  {recalcStatus.queue.length > 5 ? ` ...ещё ${recalcStatus.queue.length - 5}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Errors */}
          {recalcStatus.errors.length > 0 && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
              {recalcStatus.errors.slice(-3).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* Last result */}
          {!recalcStatus.active && recalcStatus.done.length > 0 && (
            <div className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
              Последний пересчёт: {recalcStatus.done.length} дн. выполнено
              {recalcStatus.errors.length > 0 ? `, ${recalcStatus.errors.length} ошибок` : ''}
            </div>
          )}
        </div>
      </div>

      {/* DB Viewer */}
      <div>
        <button
          onClick={() => setDbOpen(v => !v)}
          className="flex items-center gap-2 text-sm font-semibold mb-2 cursor-pointer bg-transparent border-none text-foreground p-0"
        >
          <Database className="size-4" />
          Просмотр БД
          {dbOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        {dbOpen && (
          <div className="glass-card rounded-xl p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={dbSelectedTable}
                onChange={e => setDbSelectedTable(e.target.value)}
                className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
                style={{ fontSize: '11px' }}
              >
                {dbTables.map(t => (
                  <option key={t.key} value={t.key}>{t.label} ({t.pool})</option>
                ))}
              </select>
              <input
                type="date"
                value={dbDateFrom}
                onChange={e => setDbDateFrom(e.target.value)}
                className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
                style={{ fontSize: '11px' }}
              />
              <span className="text-xs text-muted-foreground">—</span>
              <input
                type="date"
                value={dbDateTo}
                onChange={e => setDbDateTo(e.target.value)}
                className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
                style={{ fontSize: '11px' }}
              />
              <button
                onClick={handleDbQuery}
                disabled={dbLoading || !dbSelectedTable}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors font-medium"
                style={{ fontSize: '11px' }}
              >
                <Search className="size-3" />
                {dbLoading ? 'Загрузка...' : 'Запрос'}
              </button>
              {dbResult && (
                <span className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
                  {dbResult.total} строк
                </span>
              )}
            </div>

            {dbResult?.error && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
                {dbResult.error}
              </div>
            )}

            {dbResult && !dbResult.error && dbResult.rows.length > 0 && (
              <div className="overflow-auto rounded-lg border border-border/50" style={{ maxHeight: '400px' }}>
                <table className="w-full text-left border-collapse" style={{ fontSize: '10px' }}>
                  <thead className="sticky top-0 bg-muted z-10">
                    <tr>
                      {dbResult.columns.map(col => (
                        <th key={col} className="px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-b border-border/50">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dbResult.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        {dbResult.columns.map(col => (
                          <td key={col} className="px-2 py-1 whitespace-nowrap border-b border-border/30 font-mono">
                            {formatDbCell(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {dbResult && !dbResult.error && dbResult.rows.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4" style={{ fontSize: '11px' }}>
                Нет данных за выбранный период
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hot-reload hint */}
      <div className="glass-card rounded-xl p-3">
        <h2 className="text-xs font-semibold mb-1.5">Когда нужен перезапуск?</h2>
        <div className="grid gap-1" style={{ fontSize: '11px' }}>
          {[
            ['✅ Автоматически (tsx watch / uvicorn --reload)', 'Изменения .ts / .py файлов'],
            ['✅ Автоматически (Vite HMR)', 'Изменения React-компонентов и CSS'],
            ['🔄 Перезапуск нужен', 'Изменения .env, новые пакеты (npm install), схема БД'],
          ].map(([status, desc]) => (
            <div key={desc} className="flex items-start gap-2">
              <span className="shrink-0 text-muted-foreground">{status}</span>
              <span className="text-muted-foreground">— {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
