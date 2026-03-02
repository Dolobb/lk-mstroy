import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Play, Square, ChevronDown, ChevronUp } from 'lucide-react';
import type { ServiceStatus, DataCoverage } from './types';

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
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`size-2 rounded-full shrink-0 ${statusColor}`} />
          <span className="text-sm font-medium truncate">{svc.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">:{svc.port}</span>
        </div>
        <span
          className="text-xs text-muted-foreground shrink-0"
          style={{ fontSize: '10px' }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Actions */}
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

      {/* Log viewer */}
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
              <div key={i} className={l.startsWith('[err]') ? 'text-red-400' : l.startsWith('[admin]') ? 'text-yellow-400' : ''}>
                {l}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─── Coverage calendar ────────────────────────────────────────────────────────

const CoverageRow: React.FC<{
  label: string;
  dates: Set<string>;
  allDays: string[];
}> = ({ label, dates, allDays }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs text-muted-foreground shrink-0 w-24 text-right" style={{ fontSize: '11px' }}>
      {label}
    </span>
    <div className="flex flex-wrap gap-0.5">
      {allDays.map(d => {
        const has = dates.has(d);
        return (
          <div
            key={d}
            title={`${fmtDate(d)}${has ? ' ✓' : ' — нет данных'}`}
            className={`rounded-sm transition-colors ${has ? 'bg-green-500/70' : 'bg-muted/60'}`}
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
  const [coverageFrom, setCoverageFrom] = useState(monthStart());
  const [coverageTo, setCoverageTo] = useState(today());
  const [loadingCov, setLoadingCov] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const loadServices = async () => {
    try {
      const data = await fetchServices();
      setServices(data);
      setAdminError(null);
    } catch {
      setAdminError('Не удалось подключиться к admin-серверу (:3005). Запустите: cd admin && npm run dev');
    }
  };

  useEffect(() => {
    loadServices();
    const t = setInterval(loadServices, 3000);
    return () => clearInterval(t);
  }, []);

  const loadCoverage = async () => {
    setLoadingCov(true);
    const data = await fetchCoverage(coverageFrom, coverageTo);
    setCoverage(data);
    setLoadingCov(false);
  };

  useEffect(() => {
    loadCoverage();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allDays = daysInRange(coverageFrom, coverageTo);
  const kipSet = new Set(coverage?.kip ?? []);
  const dtSet = new Set(coverage?.dumpTrucks ?? []);

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
          {/* Period picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={coverageFrom}
              onChange={e => setCoverageFrom(e.target.value)}
              className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
              style={{ fontSize: '11px' }}
            />
            <span className="text-xs text-muted-foreground">—</span>
            <input
              type="date"
              value={coverageTo}
              onChange={e => setCoverageTo(e.target.value)}
              className="text-xs px-2 py-1 rounded-lg bg-muted border-none text-foreground cursor-pointer"
              style={{ fontSize: '11px' }}
            />
            <button
              onClick={loadCoverage}
              disabled={loadingCov}
              className="px-3 py-1 rounded-lg text-xs border-none cursor-pointer bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity"
              style={{ fontSize: '11px' }}
            >
              {loadingCov ? 'Загрузка...' : 'Обновить'}
            </button>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3" style={{ fontSize: '10px' }}>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-green-500/70" />
              <span className="text-muted-foreground">Есть данные</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="size-2.5 rounded-sm bg-muted/60" />
              <span className="text-muted-foreground">Нет данных</span>
            </div>
            <span className="text-muted-foreground ml-auto">
              Период: {allDays.length} дн.  | КИП: {kipSet.size} дн. | Самосвалы: {dtSet.size} дн.
            </span>
          </div>

          {/* Calendar rows */}
          {coverage && (
            <div className="flex flex-col gap-1.5">
              <CoverageRow label="КИП техники" dates={kipSet} allDays={allDays} />
              <CoverageRow label="Самосвалы" dates={dtSet} allDays={allDays} />
            </div>
          )}

          {/* Date labels (every 7th day) */}
          {allDays.length > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <span className="w-24 shrink-0" />
              <div className="flex flex-wrap gap-0.5 overflow-hidden">
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
