import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Play, Square, ChevronDown, ChevronUp, XCircle, Database, Search, HelpCircle, Activity, Clock } from 'lucide-react';
import { DateRangePicker } from '@/components/DateRangePicker';
import type { ServiceStatus, DataCoverage, FetchStatus, RecalcStatus, SegmentFetchStatus, KipSegmentProgress, DbTablePreset, DbQueryResult, PipelineHealthCard, PipelineRun, CoverageDashboardResponse, DayCard } from './types';

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
  if (!res.ok) return { kip: [], dumpTrucks: [], rawDates: [] };
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

async function fetchPipelineHealth(): Promise<PipelineHealthCard[]> {
  try {
    const res = await fetch('/api/admin/pipeline-health');
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function fetchPipelineRuns(limit = 20): Promise<PipelineRun[]> {
  try {
    const res = await fetch(`/api/admin/pipeline-runs?limit=${limit}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

interface PipelineErrorEntry {
  run_id: string;
  pipeline_name: string;
  target_date: string;
  shift_type: string | null;
  status: 'failed' | 'partial';
  started_at: string;
  messages: string[];
  reconcile_only: boolean;
  total_vehicles: number;
  success_count: number;
  occurrences: number;
}

async function fetchPipelineErrors(days = 7): Promise<PipelineErrorEntry[]> {
  try {
    const res = await fetch(`/api/admin/pipeline-errors?days=${days}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

interface LogEvent {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: 'spawn' | 'cron' | 'handler' | 'http' | 'reconcile' | 'pipeline' | 'boss' | 'admin';
  service?: string;
  runId?: string;
  pipeline?: string;
  date?: string;
  shift?: string;
  msg: string;
  fields?: Record<string, unknown>;
}

async function fetchAdminLogs(params: {
  category?: string[];
  level?: string[];
  runId?: string;
  pipeline?: string;
  service?: string;
  hours?: number;
  limit?: number;
} = {}): Promise<LogEvent[]> {
  const q = new URLSearchParams();
  if (params.category?.length) q.set('category', params.category.join(','));
  if (params.level?.length) q.set('level', params.level.join(','));
  if (params.runId) q.set('runId', params.runId);
  if (params.pipeline) q.set('pipeline', params.pipeline);
  if (params.service) q.set('service', params.service);
  if (params.hours) q.set('since', new Date(Date.now() - params.hours * 3600 * 1000).toISOString());
  q.set('limit', String(params.limit ?? 500));
  try {
    const res = await fetch(`/api/admin/logs?${q.toString()}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function fetchCoverageDashboard(from: string, to: string): Promise<CoverageDashboardResponse | null> {
  try {
    const res = await fetch(`/api/admin/coverage-dashboard?from=${from}&to=${to}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function startRefreshFetch(service: 'kip' | 'dump-trucks', from: string, to: string) {
  const res = await fetch(`/api/admin/fetch/${service}?from=${from}&to=${to}&refresh=true`, { method: 'POST' });
  return res.json();
}

async function fetchSegmentStatus(): Promise<SegmentFetchStatus> {
  const res = await fetch('/api/admin/fetch-segments/status');
  if (!res.ok) return { active: false, current: null, startedAt: null, queue: [], done: [], errors: [] };
  return res.json();
}

async function startSegmentFetch(from: string, to: string, force: boolean) {
  const res = await fetch(`/api/admin/fetch-segments?from=${from}&to=${to}${force ? '&force=true' : ''}`, { method: 'POST' });
  return res.json();
}

async function cancelSegmentFetch() {
  await fetch('/api/admin/fetch-segments/cancel', { method: 'POST' });
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

// ─── Pipeline Health Cards ────────────────────────────────────────────────────

const PIPELINE_LABELS: Record<string, string> = {
  kip_daily: 'КИП Daily',
  dt_daily: 'Самосвалы',
  kip_recalc: 'КИП Recalc',
  dt_recalc: 'СМ Recalc',
  dt_segments: 'Сегменты',
};

function formatHoursAgo(hours: number | null): string {
  if (hours === null) return 'никогда';
  if (hours < 1) return `${Math.round(hours * 60)}м назад`;
  if (hours < 24) return `${Math.round(hours)}ч назад`;
  return `${Math.round(hours / 24)}д назад`;
}

const PipelineHealthCards: React.FC<{ cards: PipelineHealthCard[] }> = ({ cards }) => {
  if (cards.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Activity className="size-4" />
        <h2 className="text-sm font-semibold">Pipeline Health</h2>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {cards.map(c => {
          const bgColor = c.status === 'green' ? 'bg-green-500/10 border-green-500/30'
            : c.status === 'yellow' ? 'bg-yellow-500/10 border-yellow-500/30'
            : 'bg-red-500/10 border-red-500/30';
          const dotColor = c.status === 'green' ? 'bg-green-500'
            : c.status === 'yellow' ? 'bg-yellow-400'
            : 'bg-red-500';
          return (
            <div
              key={c.pipeline_name}
              className={`rounded-xl p-2.5 border ${bgColor}`}
              title={`${c.runs_7d} запусков за 7д, ${c.failures_7d} ошибок\nПоследний: ${c.last_run ?? 'никогда'}\nУспешный: ${c.last_success ?? 'никогда'}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`size-2 rounded-full ${dotColor}`} />
                <span className="text-xs font-medium truncate">{PIPELINE_LABELS[c.pipeline_name] ?? c.pipeline_name}</span>
              </div>
              <div className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
                {formatHoursAgo(c.hours_since_success)}
                {c.failures_7d > 0 && (
                  <span className="text-red-400 ml-1.5">{c.failures_7d} err</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Real Errors Panel ───────────────────────────────────────────────────────
// Shows only actionable failures: filters out reconcile/restart housekeeping
// noise, groups by pipeline+date+shift, offers a one-click re-fetch.

const PipelineErrorsPanel: React.FC<{
  entries: PipelineErrorEntry[];
  onRefetch: (service: 'kip' | 'dump-trucks', date: string) => void | Promise<void>;
  onReload: () => void;
}> = ({ entries, onRefetch, onReload }) => {
  // Defence-in-depth: hide rows with no real message. The backend filter has had
  // bugs that let benign 'partial' rows slip through with messages=[]; rendering
  // them as "processed N/M" with no explanation only confuses operators.
  const visible = entries.filter(e => e.messages.length > 0);
  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 p-2.5">
        <div className="flex items-center gap-2 mb-1">
          <XCircle className="size-4 text-green-500" />
          <h2 className="text-sm font-semibold">Реальные ошибки за 7д</h2>
        </div>
        <div className="text-xs text-muted-foreground">Нет — пайплайны отработали без ошибок.</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <XCircle className="size-4 text-red-500" />
          <h2 className="text-sm font-semibold">Реальные ошибки за 7д ({visible.length})</h2>
        </div>
        <button onClick={onReload} className="text-xs text-muted-foreground hover:text-foreground" title="Обновить список">
          ⟳
        </button>
      </div>
      <div className="flex flex-col gap-1" style={{ fontSize: '11px' }}>
        {visible.map(e => {
          const service: 'kip' | 'dump-trucks' = e.pipeline_name.startsWith('kip') ? 'kip' : 'dump-trucks';
          const dot = e.status === 'partial' ? 'bg-yellow-400' : 'bg-red-500';
          const tooltip = e.messages.join('\n');
          return (
            <div key={e.run_id} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-muted/40">
              <span className={`size-1.5 rounded-full ${dot} mt-1.5`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-muted-foreground">{e.target_date}</span>
                  {e.shift_type && <span className="text-muted-foreground">{e.shift_type}</span>}
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate">{PIPELINE_LABELS[e.pipeline_name] ?? e.pipeline_name}</span>
                  {e.occurrences > 1 && <span className="text-muted-foreground">×{e.occurrences}</span>}
                  <span className={`ml-auto ${e.status === 'partial' ? 'text-yellow-500' : 'text-red-400'}`}>{e.status}</span>
                </div>
                <div className="text-muted-foreground truncate" title={tooltip}>
                  {e.messages[0]}
                </div>
              </div>
              {(e.pipeline_name === 'kip_daily' || e.pipeline_name === 'dt_daily') && (
                <button
                  onClick={() => onRefetch(service, e.target_date)}
                  className="text-xs px-2 py-0.5 rounded border border-border/50 hover:bg-muted/60"
                  title="Перевыгрузить эту дату"
                >
                  ↻
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Pipeline Warnings Panel ─────────────────────────────────────────────────
// Soft signals from sanity-watchdog: e.g. "low activity: 1 ТС vs 7д-медиана 28".
// These are NOT errors — pipelines completed cleanly — but they're the kind of
// drift a human operator should notice. Reads warn-level pipeline events from
// admin.jsonl (NOT from pipeline_runs.errors — kept clean by design).

const PipelineWarningsPanel: React.FC = () => {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const load = React.useCallback(async () => {
    const data = await fetchAdminLogs({
      category: ['pipeline'],
      level: ['warn'],
      hours: 48,
      limit: 200,
    });
    setEvents(data);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Dedupe: most recent warn per (pipeline,date,shift) — older ones are stale.
  const latestByKey = new Map<string, LogEvent>();
  for (const ev of events) {
    const key = `${ev.pipeline ?? '-'}|${ev.date ?? '-'}|${ev.shift ?? '-'}|${ev.msg.split(':')[0]}`;
    const prev = latestByKey.get(key);
    if (!prev || ev.ts > prev.ts) latestByKey.set(key, ev);
  }
  const visible = Array.from(latestByKey.values()).sort((a, b) => b.ts.localeCompare(a.ts));

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 p-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">Предупреждения за 48ч</span>
        </div>
        <div className="text-xs text-muted-foreground">Нет — данные в норме.</div>
      </div>
    );
  }

  const fmtTs = (iso: string): string => {
    const d = new Date(iso);
    const date = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${date} ${time}`;
  };

  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-yellow-400" />
          <h2 className="text-sm font-semibold">Предупреждения за 48ч ({visible.length})</h2>
        </div>
      </div>
      <div className="flex flex-col gap-1" style={{ fontSize: '11px' }}>
        {visible.map((ev, i) => (
          <div key={`${ev.ts}-${i}`} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-muted/40">
            <span className="font-mono text-muted-foreground shrink-0">{fmtTs(ev.ts)}</span>
            <span className="text-muted-foreground shrink-0">·</span>
            <span className="shrink-0">
              {PIPELINE_LABELS[ev.pipeline ?? ''] ?? ev.pipeline}
              {ev.date && <span className="text-muted-foreground"> {ev.date}</span>}
              {ev.shift && <span className="text-muted-foreground"> {ev.shift}</span>}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate text-yellow-600 dark:text-yellow-400" title={ev.msg}>{ev.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Logs Panel ──────────────────────────────────────────────────────────────
// Reads /api/admin/logs (admin/logs/admin.jsonl). Writes are emitted at every
// orchestration seam (spawn / cron / handler / http / reconcile / pipeline).
// Filter chips by category + level. Click a pipeline row to drill into a runId.

const LOG_CATEGORIES: LogEvent['category'][] = ['spawn', 'cron', 'handler', 'http', 'reconcile', 'pipeline', 'boss', 'admin'];
const LOG_LEVELS: LogEvent['level'][] = ['info', 'warn', 'error'];

const LogsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<LogEvent['category']>>(new Set(LOG_CATEGORIES));
  const [activeLevels, setActiveLevels] = useState<Set<LogEvent['level']>>(new Set(['warn', 'error', 'info']));
  const [filterRunId, setFilterRunId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = React.useCallback(async () => {
    const data = await fetchAdminLogs({
      hours,
      runId: filterRunId ?? undefined,
      limit: filterRunId ? 1000 : 500,
    });
    setEvents(data);
  }, [hours, filterRunId]);

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [open, load]);

  const filtered = events.filter(ev =>
    activeCategories.has(ev.category) && activeLevels.has(ev.level)
  );

  const toggleCategory = (c: LogEvent['category']) => {
    const next = new Set(activeCategories);
    if (next.has(c)) next.delete(c); else next.add(c);
    setActiveCategories(next);
  };
  const toggleLevel = (l: LogEvent['level']) => {
    const next = new Set(activeLevels);
    if (next.has(l)) next.delete(l); else next.add(l);
    setActiveLevels(next);
  };

  const fmtTs = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  const levelColor = (l: LogEvent['level']) =>
    l === 'error' ? 'text-red-400' : l === 'warn' ? 'text-yellow-400' : 'text-muted-foreground';
  const levelDot = (l: LogEvent['level']) =>
    l === 'error' ? 'bg-red-500' : l === 'warn' ? 'bg-yellow-400' : 'bg-blue-400';

  const errorCount = events.filter(e => e.level === 'error').length;
  const warnCount = events.filter(e => e.level === 'warn').length;

  return (
    <div className="rounded-xl border border-border/50 p-2.5">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Журнал событий</span>
          {!open && (
            <span className="text-xs text-muted-foreground">
              {errorCount > 0 && <span className="text-red-400 mr-2">{errorCount} ошибок</span>}
              {warnCount > 0 && <span className="text-yellow-400 mr-2">{warnCount} предупреждений</span>}
              <span>(за {hours}ч)</span>
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Категории:</span>
            {LOG_CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`px-2 py-0.5 rounded border ${activeCategories.has(c) ? 'border-foreground/40 bg-muted/40' : 'border-border/30 text-muted-foreground'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Уровень:</span>
            {LOG_LEVELS.map(l => (
              <button
                key={l}
                onClick={() => toggleLevel(l)}
                className={`px-2 py-0.5 rounded border ${activeLevels.has(l) ? 'border-foreground/40 bg-muted/40' : 'border-border/30 text-muted-foreground'} ${levelColor(l)}`}
              >
                {l}
              </button>
            ))}
            <span className="text-muted-foreground ml-2">Окно:</span>
            {[1, 6, 24, 72].map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`px-2 py-0.5 rounded border ${hours === h ? 'border-foreground/40 bg-muted/40' : 'border-border/30 text-muted-foreground'}`}
              >
                {h}ч
              </button>
            ))}
            {filterRunId && (
              <button
                onClick={() => setFilterRunId(null)}
                className="ml-2 px-2 py-0.5 rounded border border-foreground/40 bg-muted/40"
                title="Сбросить фильтр по runId"
              >
                runId={filterRunId.slice(0, 8)} ✕
              </button>
            )}
            <button onClick={load} className="ml-auto text-muted-foreground hover:text-foreground" title="Обновить">⟳</button>
          </div>
          <div className="flex flex-col gap-0.5 max-h-[460px] overflow-y-auto" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
            {filtered.length === 0 ? (
              <div className="text-muted-foreground italic px-1.5 py-1">Нет событий по выбранным фильтрам.</div>
            ) : filtered.slice().reverse().map((ev, i) => {
              const isExpanded = expanded.has(i);
              const hasFields = ev.fields && Object.keys(ev.fields).length > 0;
              return (
                <div key={i} className="flex items-start gap-2 px-1.5 py-0.5 rounded hover:bg-muted/30">
                  <span className={`size-1.5 rounded-full mt-1.5 ${levelDot(ev.level)}`} />
                  <span className="text-muted-foreground shrink-0">{fmtTs(ev.ts)}</span>
                  <span className={`shrink-0 ${levelColor(ev.level)} w-10`}>{ev.level}</span>
                  <span className="text-muted-foreground shrink-0 w-20 truncate">[{ev.category}{ev.service ? '/' + ev.service : ''}]</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {ev.runId && (
                        <button
                          onClick={() => setFilterRunId(ev.runId!)}
                          className="text-blue-400 hover:underline shrink-0"
                          title="Все события этого запуска"
                        >
                          run={ev.runId.slice(0, 8)}
                        </button>
                      )}
                      {ev.pipeline && <span className="text-muted-foreground shrink-0">{ev.pipeline}</span>}
                      {ev.date && <span className="text-muted-foreground shrink-0">{ev.date}{ev.shift ? ' ' + ev.shift : ''}</span>}
                      <span className="truncate">{ev.msg}</span>
                      {hasFields && (
                        <button
                          onClick={() => {
                            const next = new Set(expanded);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            setExpanded(next);
                          }}
                          className="ml-auto text-muted-foreground shrink-0"
                        >
                          {isExpanded ? '▾' : '▸'}
                        </button>
                      )}
                    </div>
                    {isExpanded && hasFields && (
                      <pre className="mt-0.5 text-muted-foreground overflow-x-auto" style={{ fontSize: '10px' }}>
                        {JSON.stringify(ev.fields, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>{filtered.length} событий{filtered.length !== events.length ? ` (из ${events.length} в окне)` : ''}</span>
            <span>обновляется каждые 10с</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Cron Status Panel ───────────────────────────────────────────────────────

interface CronScheduleEntry {
  service: string;
  time: string;
  cronUtc: string;
  timezone: string;
  description: string;
  tasks: { shift: string; dayOffset: number; targetDate: string }[];
  nextFireIso: string;
  nextFireInMs: number;
}
interface CronRecentRun {
  run_id: string;
  pipeline_name: string;
  trigger_type: string;
  target_date: string;
  shift_type: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  total_vehicles: number;
  success_count: number;
  error_count: number;
  errors: unknown;
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDateTimeShort(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60), rs = s % 60;
  return `${m}м ${rs}с`;
}
function fmtCountdown(ms: number): string {
  if (ms < 0) return 'скоро';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `через ${h}ч ${m}м`;
  if (m > 0) return `через ${m}м`;
  return 'через <1м';
}

const CronStatusPanel: React.FC = () => {
  const [schedule, setSchedule] = useState<CronScheduleEntry[]>([]);
  const [runs, setRuns] = useState<CronRecentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, rRes] = await Promise.all([
          fetch('/api/admin/cron/schedule'),
          fetch('/api/admin/cron/recent?hours=24'),
        ]);
        if (sRes.ok) {
          const sBody = await sRes.json() as { dumpTrucks: CronScheduleEntry[] };
          setSchedule(sBody.dumpTrucks ?? []);
        }
        if (rRes.ok) {
          const rBody = await rRes.json() as { runs: CronRecentRun[] };
          setRuns(rBody.runs ?? []);
        }
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    };
    load();
    const t = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  // Next entry: minimum nextFireInMs among all entries
  const next = schedule.length > 0
    ? schedule.reduce((a, b) => (a.nextFireInMs < b.nextFireInMs ? a : b))
    : null;
  const nextRemainingMs = next ? new Date(next.nextFireIso).getTime() - now : 0;

  // Filter: only DT cron runs (panel label is "Авто-cron самосвалов")
  const cronRuns = runs.filter(r => r.trigger_type === 'cron' && r.pipeline_name.startsWith('dt_'));

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="size-4" />
        <h2 className="text-sm font-semibold">Авто-cron самосвалов</h2>
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      {next && (
        <div className="text-xs mb-3 flex items-center gap-2 flex-wrap">
          <span className="font-medium">Следующий:</span>
          <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">
            {next.time} ({fmtCountdown(nextRemainingMs)})
          </span>
          <span className="text-muted-foreground">
            {next.description} → {next.tasks.map(t => `${t.shift} ${t.targetDate}`).join(', ')}
          </span>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div className="text-xs font-medium mb-1.5 text-muted-foreground">Расписание (Asia/Yekaterinburg)</div>
          <div className="flex flex-col gap-0.5" style={{ fontSize: '11px' }}>
            {schedule.map(e => {
              const isNext = next?.time === e.time;
              return (
                <div
                  key={e.time}
                  className={`flex items-center gap-2 px-1.5 py-0.5 rounded ${isNext ? 'bg-blue-500/10' : ''}`}
                >
                  <span className="font-mono w-12">{e.time}</span>
                  <span className="text-muted-foreground flex-1 truncate" title={e.description}>
                    {e.tasks.map(t => `${t.shift}${t.dayOffset !== 0 ? `(${t.dayOffset > 0 ? '+' : ''}${t.dayOffset}д)` : ''}`).join(' + ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium mb-1.5 text-muted-foreground">Последние 24ч (cron)</div>
          {cronRuns.length === 0 ? (
            <div className="text-xs text-muted-foreground">Запусков ещё не было</div>
          ) : (
            <div className="flex flex-col gap-0.5 overflow-auto" style={{ fontSize: '11px', maxHeight: '180px' }}>
              {cronRuns.slice(0, 30).map(r => {
                const dot = r.status === 'completed' ? 'bg-green-500'
                  : r.status === 'partial' ? 'bg-yellow-400'
                  : r.status === 'failed' ? 'bg-red-500'
                  : 'bg-blue-400';
                const errors = Array.isArray(r.errors) ? r.errors : [];
                const tooltip = errors.length > 0
                  ? errors.slice(0, 5).map((e: any) => e.note ?? e.message ?? JSON.stringify(e)).join('\n')
                  : `${r.status} (${r.success_count}/${r.total_vehicles})`;
                return (
                  <div key={r.run_id} className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-muted/50" title={tooltip}>
                    <span className={`size-1.5 rounded-full ${dot}`} />
                    <span className="font-mono w-20">{fmtDateTimeShort(r.started_at)}</span>
                    <span className="w-12 text-muted-foreground">{r.shift_type ?? '—'}</span>
                    <span className="w-16 text-muted-foreground">{r.target_date}</span>
                    <span className="flex-1 truncate">
                      {r.status === 'completed' ? `✓ ${r.success_count} ТС` : r.status === 'partial' ? `~ ${r.success_count}/${r.total_vehicles}` : r.status === 'failed' ? '× failed' : r.status}
                    </span>
                    <span className="text-muted-foreground">{fmtDuration(r.duration_ms)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Help Section ─────────────────────────────────────────────────────────────

const HelpSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs cursor-pointer bg-transparent border-none text-muted-foreground hover:text-foreground p-0 transition-colors"
        style={{ fontSize: '11px' }}
      >
        <HelpCircle className="size-3" />
        Справка по обновлению данных
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && (
        <div className="mt-2 bg-muted/40 rounded-lg p-3 text-xs text-muted-foreground flex flex-col gap-1.5" style={{ fontSize: '11px' }}>
          <div><span className="font-medium text-foreground">Загрузить</span> — первичная загрузка новых дат из TIS API</div>
          <div><span className="font-medium text-foreground">Перезагрузить</span> — заново из TIS (после изменения зон). Перезаписывает данные.</div>
          <div><span className="font-medium text-foreground">Пересчитать</span> — пересчёт формул БЕЗ запросов к TIS:</div>
          <div className="pl-3">
            <div>КИП: полный пересчёт (raw данные хранят трек)</div>
            <div>Самосвалы: ТОЛЬКО формулы KPI (трек НЕ хранится — для зон нужна Перезагрузка!)</div>
          </div>
          <div><span className="font-medium text-foreground">Сегменты</span> — 30-мин детализация для onsite-ТС</div>
          <div className="mt-1 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
            При изменении зон в Гео-Администраторе система автоматически ставит в очередь перезагрузку данных за последние 7 дней.
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Pipeline Run History ─────────────────────────────────────────────────────

const PipelineRunHistory: React.FC<{ runs: PipelineRun[] }> = ({ runs }) => {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;

  const statusIcon = (s: string) => {
    switch (s) {
      case 'completed': return <span className="text-green-500">✓</span>;
      case 'failed': return <span className="text-red-500">✗</span>;
      case 'running': return <RotateCcw className="size-3 text-yellow-400 animate-spin inline" />;
      default: return <span className="text-muted-foreground">?</span>;
    }
  };

  const triggerLabel = (t: string) => {
    switch (t) {
      case 'cron': return 'cron';
      case 'manual': return 'ручной';
      case 'cascade': return 'каскад';
      default: return t;
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-semibold mb-2 cursor-pointer bg-transparent border-none text-foreground p-0"
      >
        <Clock className="size-4" />
        История запусков ({runs.length})
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && (
        <div className="glass-card rounded-xl p-3">
          <div className="overflow-auto rounded-lg border border-border/50" style={{ maxHeight: '300px' }}>
            <table className="w-full text-left border-collapse" style={{ fontSize: '10px' }}>
              <thead className="sticky top-0 bg-muted z-10">
                <tr>
                  {['', 'Pipeline', 'Дата', 'Trigger', 'Статус', 'Длит.', 'Ошибки'].map(h => (
                    <th key={h} className="px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-b border-border/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.run_id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-2 py-1 border-b border-border/30">{statusIcon(r.status)}</td>
                    <td className="px-2 py-1 border-b border-border/30 font-mono">{PIPELINE_LABELS[r.pipeline_name] ?? r.pipeline_name}</td>
                    <td className="px-2 py-1 border-b border-border/30 whitespace-nowrap">{fmtDate(r.target_date)}</td>
                    <td className="px-2 py-1 border-b border-border/30">{triggerLabel(r.trigger_type)}</td>
                    <td className="px-2 py-1 border-b border-border/30">{r.status}</td>
                    <td className="px-2 py-1 border-b border-border/30 whitespace-nowrap">
                      {r.duration_ms != null ? (
                        r.duration_ms < 60000 ? `${Math.round(r.duration_ms / 1000)}с` : `${Math.round(r.duration_ms / 60000)}м`
                      ) : '—'}
                    </td>
                    <td className="px-2 py-1 border-b border-border/30">
                      {r.error_count > 0 ? <span className="text-red-400">{r.error_count}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Coverage Dashboard ──────────────────────────────────────────────────────

function fmtDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const DayCardPopover: React.FC<{
  card: DayCard;
  baseline: { kipExpected: number; dtExpected: number };
  onAction: (action: string, date: string) => void;
  onClose: () => void;
  busy: boolean;
}> = ({ card, baseline, onAction, onClose, busy }) => {
  const kipPct = baseline.kipExpected > 0 ? Math.round(card.kip.vehicleCount / baseline.kipExpected * 100) : 0;
  const dtPct = baseline.dtExpected > 0 ? Math.round(card.dt.vehicleCount / baseline.dtExpected * 100) : 0;

  // Determine contextual actions
  const kipActions: { label: string; action: string }[] = [];
  const dtActions: { label: string; action: string }[] = [];

  if (card.kip.vehicleCount === 0) {
    kipActions.push({ label: 'Загрузить КИП', action: 'fetch-kip' });
  } else if (card.kip.rawPct < 90) {
    kipActions.push({ label: 'Перевыгрузить raw', action: 'force-kip' });
  } else {
    kipActions.push({ label: 'Пересчитать КИП', action: 'recalc-kip' });
  }
  if (!card.kip.hasSegments && card.kip.vehicleCount > 0) {
    kipActions.push({ label: 'Загрузить сегменты КИП', action: 'fetch-kip-segments' });
  }

  const dtFullyCovered = baseline.dtExpected > 0
    ? card.dt.vehicleCount / baseline.dtExpected >= 0.85
    : card.dt.vehicleCount > 0;

  if (card.dt.vehicleCount === 0) {
    dtActions.push({ label: 'Загрузить DT', action: 'fetch-dt' });
  } else if (!dtFullyCovered) {
    dtActions.push({ label: 'Перевыгрузить DT', action: 'refresh-dt' });
    dtActions.push({ label: 'Пересчитать DT', action: 'recalc-dt' });
  } else {
    dtActions.push({ label: 'Пересчитать DT', action: 'recalc-dt' });
  }
  if (!card.dt.hasSegments && card.dt.vehicleCount > 0) {
    dtActions.push({ label: 'Загрузить сегменты DT', action: 'fetch-dt-segments' });
  }

  if (card.lastRunStatus === 'failed') {
    kipActions.unshift({ label: 'Повторить загрузку', action: 'refresh-kip' });
  }

  return (
    <div
      className="absolute z-50 bg-popover border border-border rounded-xl shadow-lg p-3 flex flex-col gap-2"
      style={{ width: '300px', fontSize: '11px' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{fmtDateLong(card.date)}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-0 text-sm">&times;</button>
      </div>
      <div className="border-t border-border/50" />

      {/* KIP details */}
      <div>
        <div className="font-medium mb-0.5">КИП техники</div>
        <div className="pl-2 flex flex-col gap-0.5 text-muted-foreground">
          <div>
            ТС: <span className={`font-mono ${kipPct >= 85 ? 'text-green-500' : kipPct >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
              {card.kip.vehicleCount}
            </span>
            {baseline.kipExpected > 0 && <span> / ~{baseline.kipExpected} ({kipPct}%)</span>}
          </div>
          <div>
            Raw: <span className={`font-mono ${card.kip.rawPct >= 90 ? 'text-green-500' : card.kip.rawPct > 0 ? 'text-yellow-500' : 'text-muted-foreground'}`}>
              {card.kip.rawCount}
            </span>
            {card.kip.vehicleCount > 0 && <span> / {card.kip.vehicleCount} ({card.kip.rawPct}%)</span>}
          </div>
          <div>Сегменты: {card.kip.hasSegments ? <span className="text-green-500">есть</span> : <span>—</span>}</div>
        </div>
      </div>

      {/* DT details */}
      <div>
        <div className="font-medium mb-0.5">Самосвалы</div>
        <div className="pl-2 flex flex-col gap-0.5 text-muted-foreground">
          <div>
            ТС: <span className={`font-mono ${dtPct >= 85 ? 'text-green-500' : dtPct >= 50 ? 'text-yellow-500' : card.dt.vehicleCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
              {card.dt.vehicleCount}
            </span>
            {baseline.dtExpected > 0 && <span> / ~{baseline.dtExpected} ({dtPct}%)</span>}
          </div>
          <div>Рейсы: <span className="font-mono">{card.dt.tripCount}</span></div>
          <div>Смены: {card.dt.shiftCount === 0 ? '—' : card.dt.shiftCount}</div>
          <div>Сегменты: {card.dt.hasSegments ? <span className="text-green-500">есть</span> : <span>—</span>}</div>
        </div>
      </div>

      {/* Pipeline status */}
      {card.lastRunStatus && (
        <div>
          <span className="text-muted-foreground">Pipeline: </span>
          <span className={card.lastRunStatus === 'completed' ? 'text-green-500' : card.lastRunStatus === 'failed' ? 'text-red-500' : 'text-yellow-500'}>
            {card.lastRunStatus}
          </span>
          {card.lastRunAt && <span className="text-muted-foreground ml-1">{new Date(card.lastRunAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border/50 pt-1.5 flex flex-wrap gap-1.5">
        {busy && (
          <div className="w-full text-muted-foreground italic" style={{ fontSize: '10px' }}>
            Операция уже выполняется — дождитесь завершения
          </div>
        )}
        {kipActions.map(a => (
          <button
            key={a.action}
            onClick={() => onAction(a.action, card.date)}
            disabled={busy}
            className="px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontSize: '10px' }}
          >
            {a.label}
          </button>
        ))}
        {dtActions.map(a => (
          <button
            key={a.action}
            onClick={() => onAction(a.action, card.date)}
            disabled={busy}
            className="px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-violet-500/15 text-violet-600 hover:bg-violet-500/25 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontSize: '10px' }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const CoverageDashboard: React.FC<{
  from: string;
  to: string;
  fetchStatus: FetchStatus;
  recalcStatus: RecalcStatus;
  onFetch: (service: 'kip' | 'dump-trucks', from: string, to: string, opts?: { force?: boolean; refresh?: boolean }) => void;
  onRecalc: (service: 'kip' | 'dump-trucks', from: string, to: string) => void;
  onCancel: () => void;
  onCancelRecalc: () => void;
}> = ({ from, to, fetchStatus, recalcStatus, onFetch, onRecalc, onCancel, onCancelRecalc }) => {
  const [data, setData] = useState<CoverageDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    const result = await fetchCoverageDashboard(from, to);
    setData(result);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Faster refresh when operations are active, slower when idle
  const anyActive = fetchStatus.active || recalcStatus.active;
  useEffect(() => {
    const interval = anyActive ? 8_000 : 30_000;
    const t = setInterval(loadDashboard, interval);
    return () => clearInterval(t);
  }, [from, to, anyActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = (action: string, date: string) => {
    setSelectedDate(null);
    switch (action) {
      case 'fetch-kip':
        onFetch('kip', date, date);
        break;
      case 'force-kip':
        onFetch('kip', date, date, { force: true });
        break;
      case 'refresh-kip':
        onFetch('kip', date, date, { refresh: true });
        break;
      case 'recalc-kip':
        onRecalc('kip', date, date);
        break;
      case 'fetch-dt':
        onFetch('dump-trucks', date, date);
        break;
      case 'refresh-dt':
        onFetch('dump-trucks', date, date, { refresh: true });
        break;
      case 'recalc-dt':
        onRecalc('dump-trucks', date, date);
        break;
      case 'fetch-dt-segments':
        fetch(`/api/admin/fetch-segments?from=${date}&to=${date}`, { method: 'POST' })
          .then(async res => {
            if (res.status === 409) alert('Загрузка сегментов самосвалов уже выполняется.');
            else if (!res.ok) alert(`Ошибка загрузки сегментов DT (${res.status})`);
            else alert(`Загрузка сегментов самосвалов за ${date} запущена. Прогресс — в разделе «Расширенные инструменты».`);
          })
          .catch(() => alert('Сеть: не удалось отправить запрос на загрузку сегментов DT.'));
        break;
      case 'fetch-kip-segments':
        fetch(`/api/admin/kip-segments/fetch?from=${date}&to=${date}`, { method: 'POST' })
          .then(async res => {
            if (res.status === 409) alert('Загрузка сегментов КИП уже выполняется.');
            else if (!res.ok) alert(`Ошибка загрузки сегментов КИП (${res.status})`);
            else alert(`Загрузка сегментов КИП за ${date} запущена. Прогресс — в разделе «Расширенные инструменты».`);
          })
          .catch(() => alert('Сеть: не удалось отправить запрос на загрузку сегментов КИП.'));
        break;
    }
  };

  const handleBatchFetchMissing = async () => {
    if (!data) return;
    const THRESHOLD = 0.85;
    const kipExp = data.baseline.kipExpected;
    const dtExp = data.baseline.dtExpected;

    const kipMissing = data.days
      .filter(d => kipExp > 0 && d.kip.vehicleCount / kipExp < THRESHOLD)
      .map(d => d.date);
    const dtMissing = data.days
      .filter(d => dtExp > 0 && d.dt.vehicleCount / dtExp < THRESHOLD)
      .map(d => d.date);

    if (kipMissing.length === 0 && dtMissing.length === 0) {
      alert(`Нет дат с покрытием <${Math.round(THRESHOLD * 100)}%. Всё ок.`);
      return;
    }

    const parts: string[] = [];
    if (kipMissing.length > 0) parts.push(`КИП: ${kipMissing.length} дн. (${kipMissing[0]} … ${kipMissing[kipMissing.length - 1]})`);
    if (dtMissing.length > 0) parts.push(`DT: ${dtMissing.length} дн. (${dtMissing[0]} … ${dtMissing[dtMissing.length - 1]})`);
    if (!confirm(`Запустить перевыгрузку?\n\n${parts.join('\n')}\n\nДиапазон будет перевыгружен целиком (force).`)) return;

    if (kipMissing.length > 0) {
      await onFetch('kip', kipMissing[0], kipMissing[kipMissing.length - 1], { force: true });
    }
    if (dtMissing.length > 0) {
      await onFetch('dump-trucks', dtMissing[0], dtMissing[dtMissing.length - 1], { refresh: true });
    }
  };

  const handleBatchRecalc = () => {
    onRecalc('kip', from, to);
  };

  // Derived state for progress display
  const isAnyFetch = fetchStatus.active;
  const isAnyRecalc = recalcStatus.active;
  const fetchTotal = fetchStatus.done.length + fetchStatus.queue.length + (fetchStatus.current ? 1 : 0);
  const recalcTotal = recalcStatus.done.length + recalcStatus.queue.length + (recalcStatus.current ? 1 : 0);

  if (!data) {
    return (
      <div className="glass-card rounded-xl p-3">
        <div className="text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
          {loading ? 'Загрузка...' : 'Нет данных'}
        </div>
      </div>
    );
  }

  const { baseline, days, summary } = data;

  // Alerts
  const alerts: string[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const missingKipDays = days.filter(d => d.kip.vehicleCount === 0 && d.date <= todayStr);
  if (missingKipDays.length > 0) {
    const dates = missingKipDays.map(d => fmtDateLong(d.date));
    alerts.push(`${missingKipDays.length} дн. без данных КИП (${dates.slice(0, 3).join(', ')}${dates.length > 3 ? '...' : ''})`);
  }
  const failedDays = days.filter(d => d.lastRunStatus === 'failed');
  if (failedDays.length > 0) {
    alerts.push(`Pipeline failed: ${failedDays.map(d => fmtDateLong(d.date)).slice(0, 3).join(', ')}`);
  }

  return (
    <div className="glass-card rounded-xl p-3 flex flex-col gap-3">
      {/* Summary header */}
      <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: '11px' }}>
        <span className="text-muted-foreground">
          Baseline (7д): КИП ~<span className="text-foreground font-mono">{baseline.kipExpected}</span>
          {' | '}DT ~<span className="text-foreground font-mono">{baseline.dtExpected}</span>
          {' | '}Ghost: <span className="text-foreground font-mono">{summary.ghostCount}</span>
          {' | '}Pipeline: <span className={`font-mono ${summary.pipelineFail > 0 ? 'text-red-500' : 'text-green-500'}`}>
            {summary.pipelineOk}/{summary.pipelineOk + summary.pipelineFail}
          </span>
          {summary.pipelineFail === 0 ? ' ✓' : ` (${summary.pipelineFail} fail)`}
        </span>
        <button
          onClick={loadDashboard}
          disabled={loading}
          className="ml-auto px-2 py-1 rounded-lg text-xs border-none cursor-pointer bg-muted text-foreground hover:bg-muted/80 disabled:opacity-60 transition-opacity"
          style={{ fontSize: '10px' }}
        >
          {loading ? '...' : 'Обновить'}
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="text-xs bg-red-500/10 text-red-500 rounded-lg px-3 py-1.5" style={{ fontSize: '11px' }}>
          {alerts.join(' | ')}
        </div>
      )}

      {/* Progress: fetch */}
      {isAnyFetch && (
        <div className="flex flex-col gap-1.5 bg-primary/5 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
            <span className="text-muted-foreground">
              <RotateCcw className="size-3 animate-spin inline mr-1" />
              Загрузка ({fetchStatus.service === 'kip' ? 'КИП' : 'Самосвалы'}): <span className="text-foreground font-mono">
                {fetchStatus.current ? fmtDate(fetchStatus.current) : '...'}
              </span>
            </span>
            <span className="text-muted-foreground">
              {fetchStatus.done.length} из {fetchTotal} дн.
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: fetchTotal > 0 ? `${(fetchStatus.done.length / fetchTotal) * 100}%` : '0%' }}
            />
          </div>
          {fetchStatus.queue.length > 0 && (
            <div className="text-muted-foreground" style={{ fontSize: '10px' }}>
              В очереди: {fetchStatus.queue.slice(0, 5).map(fmtDate).join(', ')}
              {fetchStatus.queue.length > 5 ? ` ...ещё ${fetchStatus.queue.length - 5}` : ''}
            </div>
          )}
          {fetchStatus.errors.length > 0 && (
            <div className="text-xs text-destructive" style={{ fontSize: '10px' }}>
              {fetchStatus.errors.slice(-2).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          <button
            onClick={onCancel}
            className="self-start flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
            style={{ fontSize: '10px' }}
          >
            <XCircle className="size-3" /> Отмена
          </button>
        </div>
      )}

      {/* Progress: recalc */}
      {isAnyRecalc && (
        <div className="flex flex-col gap-1.5 bg-amber-500/5 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
            <span className="text-muted-foreground">
              <RotateCcw className="size-3 animate-spin inline mr-1" />
              Пересчёт ({recalcStatus.service === 'kip' ? 'КИП' : 'Самосвалы'}): <span className="text-foreground font-mono">
                {recalcStatus.current ? fmtDate(recalcStatus.current) : '...'}
              </span>
            </span>
            <span className="text-muted-foreground">
              {recalcStatus.done.length} из {recalcTotal} дн.
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: recalcTotal > 0 ? `${(recalcStatus.done.length / recalcTotal) * 100}%` : '0%' }}
            />
          </div>
          {recalcStatus.errors.length > 0 && (
            <div className="text-xs text-destructive" style={{ fontSize: '10px' }}>
              {recalcStatus.errors.slice(-2).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          <button
            onClick={onCancelRecalc}
            className="self-start flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
            style={{ fontSize: '10px' }}
          >
            <XCircle className="size-3" /> Отмена
          </button>
        </div>
      )}

      {/* Batch actions */}
      <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: '11px' }}>
        <button
          onClick={handleBatchFetchMissing}
          disabled={isAnyFetch || isAnyRecalc}
          className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors font-medium"
          style={{ fontSize: '11px' }}
        >
          Загрузить пропущенные
        </button>
        <button
          onClick={handleBatchRecalc}
          disabled={isAnyFetch || isAnyRecalc}
          className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 disabled:opacity-50 transition-colors font-medium"
          style={{ fontSize: '11px' }}
        >
          Пересчитать всё
        </button>
      </div>

      {/* Day cards grid */}
      <div className="flex flex-wrap gap-1.5 relative" onClick={() => setSelectedDate(null)}>
        {[...days].reverse().map(card => {
          const healthBg =
            card.health === 'green' ? 'bg-green-500/20 border-green-500/30'
            : card.health === 'yellow' ? 'bg-yellow-400/20 border-yellow-400/30'
            : card.health === 'red' ? 'bg-red-500/20 border-red-500/30'
            : 'bg-muted/40 border-border/30';

          const kipCountColor = baseline.kipExpected > 0
            ? (card.kip.vehicleCount / baseline.kipExpected >= 0.85 ? 'text-green-500'
              : card.kip.vehicleCount / baseline.kipExpected >= 0.50 ? 'text-yellow-500'
              : card.kip.vehicleCount > 0 ? 'text-red-500' : 'text-muted-foreground')
            : 'text-foreground';

          const dtCountColor = baseline.dtExpected > 0
            ? (card.dt.vehicleCount / baseline.dtExpected >= 0.85 ? 'text-green-500'
              : card.dt.vehicleCount / baseline.dtExpected >= 0.50 ? 'text-yellow-500'
              : card.dt.vehicleCount > 0 ? 'text-red-500' : 'text-muted-foreground')
            : 'text-foreground';

          return (
            <div
              key={card.date}
              className={`relative rounded-lg border p-1.5 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all select-none ${healthBg}`}
              style={{ width: '110px', fontSize: '10px' }}
              onClick={e => { e.stopPropagation(); setSelectedDate(prev => prev === card.date ? null : card.date); }}
            >
              <div className="font-medium text-center mb-0.5" style={{ fontSize: '11px' }}>
                {fmtDateLong(card.date)}
                {card.lastRunStatus === 'failed' && <span className="text-red-500 ml-0.5">✗</span>}
                {card.health === 'green' && <span className="text-green-500 ml-0.5">✓</span>}
                {card.health === 'yellow' && <span className="text-yellow-500 ml-0.5">⚠</span>}
              </div>
              <div className={`font-mono ${kipCountColor}`}>
                КИП: {card.kip.vehicleCount}
              </div>
              <div className={`font-mono ${dtCountColor}`}>
                DT: {card.dt.vehicleCount}
                {card.dt.tripCount > 0 && <span className="text-muted-foreground"> ({card.dt.tripCount}р)</span>}
              </div>
              <div className="text-muted-foreground">
                Seg: {card.kip.hasSegments ? '✓' : '—'} {card.dt.hasSegments ? '✓' : '—'}
              </div>

              {/* Popover */}
              {selectedDate === card.date && (
                <DayCardPopover
                  card={card}
                  baseline={baseline}
                  onAction={handleAction}
                  onClose={() => setSelectedDate(null)}
                  busy={isAnyFetch || isAnyRecalc}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3" style={{ fontSize: '10px' }}>
        <div className="flex items-center gap-1">
          <div className="size-2.5 rounded-sm bg-green-500/40 border border-green-500/50" />
          <span className="text-muted-foreground">&ge;85%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="size-2.5 rounded-sm bg-yellow-400/40 border border-yellow-400/50" />
          <span className="text-muted-foreground">50-85%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="size-2.5 rounded-sm bg-red-500/40 border border-red-500/50" />
          <span className="text-muted-foreground">&lt;50%</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="size-2.5 rounded-sm bg-muted/60 border border-border/50" />
          <span className="text-muted-foreground">Нет данных</span>
        </div>
        <span className="text-muted-foreground ml-auto">Клик на карточку — детали + действия</span>
      </div>
    </div>
  );
};

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
  const [segmentStatus, setSegmentStatus] = useState<SegmentFetchStatus>({
    active: false, current: null, startedAt: null, queue: [], done: [], errors: [],
  });
  const [segmentElapsed, setSegmentElapsed] = useState(0);
  const [segResultsOpen, setSegResultsOpen] = useState(false);

  // KIP Segment progress (per-vehicle from KIP server)
  const [kipSegProgress, setKipSegProgress] = useState<KipSegmentProgress>({
    queue: [], active: [], completed: [], maxConcurrent: 1,
  });

  // KIP Segment bulk fetch (admin-managed queue of dates)
  const [kipSegBulk, setKipSegBulk] = useState({
    active: false, current: null as string | null, queue: [] as string[],
    done: [] as string[], errors: [] as string[],
    totalEnqueued: 0, totalSkipped: 0,
  });

  // Advanced tools collapsed
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // DB Viewer state
  // Pipeline health + run history
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealthCard[]>([]);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [pipelineErrors, setPipelineErrors] = useState<PipelineErrorEntry[]>([]);

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

  const loadSegmentStatus = async () => {
    const s = await fetchSegmentStatus();
    setSegmentStatus(s);
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

  // Поллинг статуса сегментов каждые 10с
  useEffect(() => {
    const t = setInterval(loadSegmentStatus, 10000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Счётчик секунд для текущей даты сегментов
  useEffect(() => {
    if (!segmentStatus.active || !segmentStatus.startedAt) {
      setSegmentElapsed(0);
      return;
    }
    setSegmentElapsed(Math.floor((Date.now() - segmentStatus.startedAt) / 1000));
    const t = setInterval(() => {
      setSegmentElapsed(Math.floor((Date.now() - (segmentStatus.startedAt ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [segmentStatus.active, segmentStatus.startedAt]);

  // Poll KIP segment progress every 5s (per-vehicle + bulk)
  useEffect(() => {
    const loadKipSeg = async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch('/api/admin/kip-segments/status'),
          fetch('/api/admin/kip-segments/bulk-status'),
        ]);
        if (r1.ok) setKipSegProgress(await r1.json());
        if (r2.ok) setKipSegBulk(await r2.json());
      } catch { /* KIP/admin not running */ }
    };
    loadKipSeg();
    const t = setInterval(loadKipSeg, 5000);
    return () => clearInterval(t);
  }, []);

  // Load DB tables once
  useEffect(() => {
    fetchDbTables().then(tables => {
      setDbTables(tables);
      if (tables.length > 0) setDbSelectedTable(tables[0].key);
    });
  }, []);

  // Poll pipeline health every 30s
  useEffect(() => {
    const load = () => {
      fetchPipelineHealth().then(setPipelineHealth);
      fetchPipelineRuns(20).then(setPipelineRuns);
      fetchPipelineErrors(7).then(setPipelineErrors);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
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

  const handleStartSegmentFetch = async (force: boolean) => {
    const result = await startSegmentFetch(coverageFrom, coverageTo, force);
    if (result.count === 0) {
      alert('Нет данных самосвалов в выбранном периоде.');
      return;
    }
    await loadSegmentStatus();
  };

  const handleCancelSegmentFetch = async () => {
    await cancelSegmentFetch();
    await loadSegmentStatus();
  };

  const handleKipSegFetch = async (force: boolean) => {
    try {
      const res = await fetch(`/api/admin/kip-segments/fetch?from=${coverageFrom}&to=${coverageTo}${force ? '&force=true' : ''}`, { method: 'POST' });
      const body = await res.json();
      if (body.count === 0) {
        alert('Нет данных КИП за выбранный период. Сначала выполните загрузку КИП.');
        return;
      }
    } catch (e) {
      alert(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleKipSegCancel = async () => {
    await fetch('/api/admin/kip-segments/cancel', { method: 'POST' });
  };

  const allDays = daysInRange(coverageFrom, coverageTo);
  const kipSet = new Set(coverage?.kip ?? []);
  const dtSet = new Set(coverage?.dumpTrucks ?? []);
  const dtPartialSet = new Set(coverage?.dtPartial ?? []);
  const rawSet = new Set(coverage?.rawDates ?? []);
  const rawPartialSet = new Set(coverage?.rawPartial ?? []);
  const fetchDoneSet = new Set(fetchStatus.done);

  const isKipFetching = fetchStatus.active && fetchStatus.service === 'kip';
  const isDTFetching = fetchStatus.active && fetchStatus.service === 'dump-trucks';
  const totalFetch = fetchStatus.done.length + fetchStatus.queue.length + (fetchStatus.current ? 1 : 0);

  const isKipRecalcing = recalcStatus.active && recalcStatus.service === 'kip';
  const isDTRecalcing  = recalcStatus.active && recalcStatus.service === 'dump-trucks';
  const totalRecalc = recalcStatus.done.length + recalcStatus.queue.length + (recalcStatus.current ? 1 : 0);

  const isSegmentFetching = segmentStatus.active;
  const totalSegments = segmentStatus.done.length + segmentStatus.queue.length + (segmentStatus.current ? 1 : 0);

  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-4">

      {/* Pipeline Health */}
      <PipelineHealthCards cards={pipelineHealth} />

      {/* Real errors (filtered, actionable) */}
      <PipelineErrorsPanel
        entries={pipelineErrors}
        onReload={() => fetchPipelineErrors(7).then(setPipelineErrors)}
        onRefetch={async (service, date) => {
          const res = await fetch(`/api/admin/fetch/${service}?from=${date}&to=${date}&refresh=true`, { method: 'POST' });
          const body = await res.json();
          if (res.status === 409) alert('Уже выполняется загрузка — дождитесь и повторите.');
          else if (body.missing === 0) alert(body.message ?? 'Нечего выгружать');
          else alert(`Перевыгрузка ${date} (${service}) запущена`);
          fetchPipelineErrors(7).then(setPipelineErrors);
        }}
      />

      {/* Soft signals (sanity-watchdog warns from admin.jsonl) */}
      <PipelineWarningsPanel />

      {/* Structured event log */}
      <LogsPanel />

      {/* Cron Status */}
      <CronStatusPanel />

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

      {/* Coverage Dashboard (new) */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Покрытие данных</h2>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <DateRangePicker
            dateFrom={coverageFrom}
            dateTo={coverageTo}
            onRangeChange={(from, to) => { setCoverageFrom(from); setCoverageTo(to); }}
          />
        </div>
        <CoverageDashboard
          from={coverageFrom}
          to={coverageTo}
          fetchStatus={fetchStatus}
          recalcStatus={recalcStatus}
          onFetch={async (service, f, t, opts) => {
            const force = opts?.force ? '&force=true' : '';
            const refresh = opts?.refresh ? '&refresh=true' : '';
            const res = await fetch(`/api/admin/fetch/${service}?from=${f}&to=${t}${force}${refresh}`, { method: 'POST' });
            if (res.status === 409) {
              alert('Выгрузка уже выполняется. Дождитесь завершения или отмените её.');
            } else if (!res.ok) {
              const txt = await res.text().catch(() => '');
              alert(`Ошибка запуска выгрузки (${res.status}): ${txt.slice(0, 200)}`);
            } else {
              const body = await res.json().catch(() => ({} as any));
              if (body?.started !== true) {
                const msg = body?.message ?? 'Нечего выгружать';
                alert(`Выгрузка не запущена: ${msg}.\n\nЕсли данные неполные — используйте «Перевыгрузить» (refresh) или force-режим.`);
              }
            }
            await loadFetchStatus();
          }}
          onRecalc={async (service, f, t) => {
            const res = await fetch(`/api/admin/recalc/${service}?from=${f}&to=${t}`, { method: 'POST' });
            if (res.status === 409) {
              alert('Пересчёт уже выполняется. Дождитесь завершения или отмените его.');
            } else if (!res.ok) {
              const txt = await res.text().catch(() => '');
              alert(`Ошибка запуска пересчёта (${res.status}): ${txt.slice(0, 200)}`);
            }
            await loadRecalcStatus();
          }}
          onCancel={async () => {
            await cancelFetch();
            await loadFetchStatus();
          }}
          onCancelRecalc={async () => {
            await cancelRecalc();
            await loadRecalcStatus();
          }}
        />
      </div>

      {/* Advanced tools — collapsible */}
      <div>
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          className="flex items-center gap-2 text-sm font-semibold mb-2 cursor-pointer bg-transparent border-none text-foreground p-0"
        >
          {advancedOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          Расширенные инструменты
        </button>
      </div>

      {advancedOpen && <>

      {/* Data coverage (old) */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Покрытие данных (календарь)</h2>
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

          {/* Help docs */}
          <HelpSection />

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
              {allDays.length} дн. | КИП: {kipSet.size} | Raw: {rawSet.size}{rawPartialSet.size > 0 ? `+${rawPartialSet.size}⚠️` : ''} | Самосвалы: {dtSet.size}{dtPartialSet.size > 0 ? `+${dtPartialSet.size}⚠️` : ''}
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
                partial={dtPartialSet}
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

      {/* Segment fetch (Gantt) */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Загрузка сегментов (Gantt onsite)</h2>
        <div className="glass-card rounded-xl p-3 flex flex-col gap-3">
          <div className="text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
            Загрузить 30-мин сегменты для onsite-машин (24 слайса на смену).
            Требует TIS API. Период — тот же, что и для покрытия данных.
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleStartSegmentFetch(false)}
              disabled={isSegmentFetching}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                isSegmentFetching
                  ? 'bg-violet-500 text-white'
                  : 'bg-violet-500/15 text-violet-600 hover:bg-violet-500/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {isSegmentFetching && <RotateCcw className="size-3 animate-spin" />}
              Загрузить сегменты
            </button>
            <button
              onClick={() => handleStartSegmentFetch(true)}
              disabled={isSegmentFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 disabled:opacity-50"
              style={{ fontSize: '11px' }}
            >
              Перезагрузить (force)
            </button>
            {isSegmentFetching && (
              <button
                onClick={handleCancelSegmentFetch}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors font-medium"
                style={{ fontSize: '11px' }}
              >
                <XCircle className="size-3" />
                Отмена
              </button>
            )}
          </div>

          {isSegmentFetching && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
                <span className="text-muted-foreground">
                  Загружается: <span className="text-foreground font-mono">
                    {segmentStatus.current ? fmtDate(segmentStatus.current) : '...'}
                  </span>
                  {segmentElapsed > 0 && (
                    <span className="text-muted-foreground ml-1.5">
                      {segmentElapsed < 60
                        ? `${segmentElapsed}с`
                        : `${Math.floor(segmentElapsed / 60)}м ${segmentElapsed % 60}с`}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {segmentStatus.done.length} из {totalSegments} дн.
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-500"
                  style={{ width: totalSegments > 0 ? `${(segmentStatus.done.length / totalSegments) * 100}%` : '0%' }}
                />
              </div>
              {segmentStatus.queue.length > 0 && (
                <div className="text-muted-foreground" style={{ fontSize: '10px' }}>
                  В очереди: {segmentStatus.queue.slice(0, 5).map(fmtDate).join(', ')}
                  {segmentStatus.queue.length > 5 ? ` ...ещё ${segmentStatus.queue.length - 5}` : ''}
                </div>
              )}
            </div>
          )}

          {segmentStatus.errors.length > 0 && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
              {segmentStatus.errors.slice(-3).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {(segmentStatus.results?.length ?? 0) > 0 && (
            <div>
              <button
                onClick={() => setSegResultsOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs cursor-pointer bg-transparent border-none text-foreground p-0 hover:text-primary transition-colors"
                style={{ fontSize: '11px' }}
              >
                {segResultsOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                Результаты ({segmentStatus.results!.length} дат)
              </button>
              {segResultsOpen && (
                <div className="mt-1.5 flex flex-col gap-2 bg-muted/40 rounded-lg p-2" style={{ fontSize: '11px' }}>
                  {segmentStatus.results!.map(r => (
                    <div key={r.date}>
                      <div className="font-medium">
                        {fmtDate(r.date)} — {r.vehiclesWithSegments} машин, {r.totalSegments} сегм.
                      </div>
                      <div className="pl-3 text-muted-foreground" style={{ fontSize: '10px' }}>
                        {r.vehicles.filter(v => v.segmentCount > 0).map(v => (
                          <div key={`${v.regNumber}-${v.shiftType}`}>
                            {v.regNumber} ({v.shiftType === 'shift1' ? 'день' : 'ночь'}) — {v.segmentCount} сегм.
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isSegmentFetching && segmentStatus.done.length > 0 && (
            <div className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
              Последняя загрузка: {segmentStatus.done.length} дн. выполнено
              {segmentStatus.errors.length > 0 ? `, ${segmentStatus.errors.length} ошибок` : ''}
            </div>
          )}
        </div>
      </div>

      {/* KIP Segments — bulk fetch + progress */}
      <div>
        <h2 className="text-sm font-semibold mb-2">КИП Сегменты (ДСТ диаграммы)</h2>
        <div className="glass-card rounded-xl p-3 flex flex-col gap-3">
          <div className="text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
            Загрузить 30-мин сегменты для диаграмм ДСТ-техники (24 слайса на смену).
            Период — тот же, что и для покрытия данных. ~12 мин на ТС (параллельно по числу токенов).
          </div>

          {/* Bulk fetch buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleKipSegFetch(false)}
              disabled={kipSegBulk.active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium ${
                kipSegBulk.active
                  ? 'bg-blue-500 text-white'
                  : 'bg-blue-500/15 text-blue-600 hover:bg-blue-500/25'
              } disabled:opacity-50`}
              style={{ fontSize: '11px' }}
            >
              {kipSegBulk.active && <RotateCcw className="size-3 animate-spin" />}
              Загрузить сегменты
            </button>
            <button
              onClick={() => handleKipSegFetch(true)}
              disabled={kipSegBulk.active}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer transition-colors font-medium bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 disabled:opacity-50"
              style={{ fontSize: '11px' }}
            >
              Перезагрузить (force)
            </button>
            {kipSegBulk.active && (
              <button
                onClick={handleKipSegCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors font-medium"
                style={{ fontSize: '11px' }}
              >
                <XCircle className="size-3" />
                Отмена
              </button>
            )}
          </div>

          {/* Bulk progress */}
          {kipSegBulk.active && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between" style={{ fontSize: '11px' }}>
                <span className="text-muted-foreground">
                  Ставим в очередь: <span className="text-foreground font-mono">
                    {kipSegBulk.current ? fmtDate(kipSegBulk.current) : '...'}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {kipSegBulk.done.length} из {kipSegBulk.done.length + kipSegBulk.queue.length + (kipSegBulk.current ? 1 : 0)} дн.
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{
                    width: (() => {
                      const total = kipSegBulk.done.length + kipSegBulk.queue.length + (kipSegBulk.current ? 1 : 0);
                      return total > 0 ? `${(kipSegBulk.done.length / total) * 100}%` : '0%';
                    })(),
                  }}
                />
              </div>
              {kipSegBulk.totalEnqueued > 0 && (
                <div className="text-muted-foreground" style={{ fontSize: '10px' }}>
                  Поставлено: {kipSegBulk.totalEnqueued} ТС, пропущено: {kipSegBulk.totalSkipped}
                </div>
              )}
            </div>
          )}

          {!kipSegBulk.active && (kipSegBulk.totalEnqueued > 0 || kipSegBulk.done.length > 0) && (
            <div className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
              Последний запуск: {kipSegBulk.done.length} дн., поставлено {kipSegBulk.totalEnqueued} ТС, пропущено {kipSegBulk.totalSkipped}
              {kipSegBulk.errors.length > 0 ? `, ${kipSegBulk.errors.length} ошибок` : ''}
            </div>
          )}

          {kipSegBulk.errors.length > 0 && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg p-2" style={{ fontSize: '10px' }}>
              {kipSegBulk.errors.slice(-3).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* Per-vehicle realtime progress from KIP server */}
          {(kipSegProgress.active.length > 0 || kipSegProgress.queue.length > 0) && (
            <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--border)' }}>
              <div className="text-xs font-medium mb-1" style={{ fontSize: '11px' }}>
                Выгрузка ТС ({kipSegProgress.active.length} актив. + {kipSegProgress.queue.length} очередь):
              </div>
              {kipSegProgress.active.map(j => (
                <div key={`${j.vehicleId}-${j.date}-${j.shift}`} className="flex items-center gap-2" style={{ fontSize: '11px' }}>
                  <span className="font-mono">{j.vehicleId}</span>
                  <span className="text-muted-foreground">{fmtDate(j.date)} {j.shift === 'morning' ? 'день' : 'ночь'}</span>
                  <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden" style={{ maxWidth: 100 }}>
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(j.segmentsDone / 24) * 100}%` }} />
                  </div>
                  <span className="text-muted-foreground">{j.segmentsDone}/24</span>
                </div>
              ))}
            </div>
          )}

          {kipSegProgress.completed.length > 0 && kipSegProgress.active.length === 0 && kipSegProgress.queue.length === 0 && (
            <div className="flex flex-col gap-0.5">
              <div className="text-xs text-muted-foreground" style={{ fontSize: '10px' }}>
                Завершено (последние):
              </div>
              {kipSegProgress.completed.slice(-5).map(j => (
                <div key={`${j.vehicleId}-${j.date}-${j.shift}`} className="flex items-center gap-2" style={{ fontSize: '10px' }}>
                  <span className="font-mono">{j.vehicleId}</span>
                  <span className="text-muted-foreground">{fmtDate(j.date)} {j.shift === 'morning' ? 'день' : 'ночь'}</span>
                  <span className={j.status === 'done' ? 'text-green-500' : 'text-destructive'}>
                    {j.status === 'done' ? '24/24' : j.error ?? 'ошибка'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline Run History */}
      <PipelineRunHistory runs={pipelineRuns} />

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

      </>}

    </div>
  );
};
