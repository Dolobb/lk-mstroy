import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface KipVehicle {
  regNumber: string;
  type: string;
  branch: string;
  fuelNorm: number;
}

interface VehiclesResponse {
  vehicles: KipVehicle[];
  types: string[];
  branches: string[];
  updatedAt: string;
  error?: string;
}

type EditState = { mode: 'add' } | { mode: 'edit'; original: KipVehicle };

interface Monitoring {
  kip: Record<string, { lastWork: string | null; lastRecord: string | null; workDays7: number }>;
  dumpTrucks: Array<{ regNumber: string; model: string; lastDate: string; days7: number; objects: string }>;
  tyagachi: Array<{ regNumber: string; model: string; firstSeen: string; lastSeen: string; requests: number }> | null;
  error?: string;
}

type DataStatus = 'working' | 'idle' | 'stale' | 'none';

const STATUS_LABEL: Record<DataStatus, string> = {
  working: 'Работает',
  idle: 'Стоит',
  stale: 'Нет данных',
  none: 'Ни разу',
};

const STATUS_HINT: Record<DataStatus, string> = {
  working: 'Работал (мотор > 0) за последние 2 дня',
  idle: 'Данные идут, но мотор не работал последние 2 дня',
  stale: 'Последние данные старше 2 дней — проверьте трекер/ПЛ',
  none: 'За 90 дней данных не было ни разу — проверьте госномер (как в TIS)',
};

const STATUS_CLS: Record<DataStatus, string> = {
  working: 'bg-green-500/15 text-green-600 dark:text-green-400',
  idle: 'bg-muted/60 text-muted-foreground',
  stale: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  none: 'bg-destructive/15 text-destructive',
};

function daysAgo(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function fmtDay(isoDate: string | null): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function kipStatus(m: Monitoring['kip'][string] | undefined): DataStatus {
  if (!m || !m.lastRecord) return 'none';
  const work = daysAgo(m.lastWork);
  if (work !== null && work <= 2) return 'working';
  const rec = daysAgo(m.lastRecord);
  return rec !== null && rec <= 2 ? 'idle' : 'stale';
}

function useMonitoring() {
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/admin/vehicles/monitoring')
      .then(async r => {
        const body = await r.json() as Monitoring;
        if (!r.ok) throw new Error(body.error || r.statusText);
        setData(body);
      })
      .catch(err => setError(`Не удалось загрузить данные мониторинга: ${(err as Error).message}`));
  }, []);
  return { data, error };
}

type SubTab = 'kip' | 'dt' | 'tyagachi';

/**
 * Раздел «Техника»: КИП — редактируемый список (kip/config/vehicle-registry.json) + статус данных;
 * Самосвалы и Тягачи — только просмотр: своих списков нет, техника берётся из путевых листов TIS.
 */
export const VehiclesPanel: React.FC = () => {
  const [tab, setTab] = useState<SubTab>('kip');
  const monitoring = useMonitoring();
  const tabs: Array<{ key: SubTab; label: string }> = [
    { key: 'kip', label: 'КИП и Аналитика (список)' },
    { key: 'dt', label: 'Самосвалы' },
    { key: 'tyagachi', label: 'Тягачи' },
  ];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 pt-3 shrink-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-2.5 py-1 rounded-md text-xs border-none cursor-pointer transition-colors ${
              tab === t.key ? 'bg-foreground/10 text-foreground font-medium' : 'bg-transparent text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'kip' && <KipVehiclesTab monitoring={monitoring.data} monitoringError={monitoring.error} />}
        {tab === 'dt' && <DumpTrucksTab monitoring={monitoring.data} error={monitoring.error} />}
        {tab === 'tyagachi' && <TyagachiTab monitoring={monitoring.data} error={monitoring.error} />}
      </div>
    </div>
  );
};

const DumpTrucksTab: React.FC<{ monitoring: Monitoring | null; error: string | null }> = ({ monitoring, error }) => {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s+/g, '');
    return (monitoring?.dumpTrucks ?? []).filter(v => !q || v.regNumber.toUpperCase().includes(q) || v.objects.toUpperCase().includes(q));
  }, [monitoring, query]);
  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-3">
      <div className="glass-card rounded-xl p-3 text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
        <div className="font-semibold text-sm text-foreground mb-1">Самосвалы, попавшие в ЛК за 30 дней</div>
        Отдельного списка нет — вручную добавлять не нужно. Берутся все машины из путевых листов TIS и паспортов TIS
        со словом «самосвал» в модели. Смена записывается, только если машина побывала внутри <b>границы объекта</b>
        (зона «Граница объекта» в Гео-Администраторе). Нет машины здесь — проверьте ПЛ в TIS и границу объекта, где она работает.
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Поиск: госномер или объект" />
      {error && <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">{error}</div>}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border/60">
              <th className="px-3 py-2 font-medium">Госномер</th>
              <th className="px-3 py-2 font-medium">Модель</th>
              <th className="px-3 py-2 font-medium">Объекты (7 дней)</th>
              <th className="px-3 py-2 font-medium text-right">Смен-дней из 7</th>
              <th className="px-3 py-2 font-medium text-right">Последние данные</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(v => (
              <tr key={v.regNumber + v.model} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono">{v.regNumber}</td>
                <td className="px-3 py-1.5">{v.model}</td>
                <td className="px-3 py-1.5">{v.objects || <span className="text-muted-foreground italic">—</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{v.days7}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtDay(v.lastDate)}</td>
              </tr>
            ))}
            {!monitoring && !error && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Загрузка…</td></tr>}
            {monitoring && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TyagachiTab: React.FC<{ monitoring: Monitoring | null; error: string | null }> = ({ monitoring, error }) => {
  const [query, setQuery] = useState('');
  const list = monitoring?.tyagachi;
  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s+/g, '');
    return [...(list ?? [])]
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .filter(v => !q || v.regNumber.toUpperCase().includes(q) || v.model.toUpperCase().includes(q));
  }, [list, query]);
  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-3">
      <div className="glass-card rounded-xl p-3 text-xs text-muted-foreground" style={{ fontSize: '11px' }}>
        <div className="font-semibold text-sm text-foreground mb-1">Тягачи, известные разделу «Тягачи»</div>
        Отдельного списка нет — вручную добавлять не нужно. Берутся машины из путевых листов TIS со словом «тягач» в названии.
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Поиск: госномер или модель" />
      {error && <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">{error}</div>}
      {monitoring && list === null && <div className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600">Сервис «Тягачи» не ответил — список временно недоступен.</div>}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border/60">
              <th className="px-3 py-2 font-medium">Госномер</th>
              <th className="px-3 py-2 font-medium">Модель</th>
              <th className="px-3 py-2 font-medium text-right">Заявок</th>
              <th className="px-3 py-2 font-medium text-right">Впервые</th>
              <th className="px-3 py-2 font-medium text-right">Последний раз</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(v => (
              <tr key={v.regNumber + v.model} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono">{v.regNumber}</td>
                <td className="px-3 py-1.5">{v.model}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{v.requests}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtDay(v.firstSeen)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtDay(v.lastSeen)}</td>
              </tr>
            ))}
            {!monitoring && !error && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Загрузка…</td></tr>}
            {list && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Ничего не найдено</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative self-start">
    <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="pl-8 pr-7 py-1.5 rounded-lg text-xs bg-background/60 border border-border w-56 focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
    {value && (
      <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-muted-foreground" aria-label="Очистить поиск">
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

const EMPTY_FORM = { regNumber: '', type: '', branch: '', fuelNorm: '' };

/** Список техники КИП (kip/config/vehicle-registry.json): правка + статус поступления данных. */
const KipVehiclesTab: React.FC<{ monitoring: Monitoring | null; monitoringError: string | null }> = ({ monitoring, monitoringError }) => {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [status, setStatus] = useState<DataStatus | ''>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [toDelete, setToDelete] = useState<KipVehicle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/vehicles/kip');
      const body = await res.json() as VehiclesResponse;
      if (!res.ok) throw new Error(body.error || res.statusText);
      setData(body);
      setLoadError(null);
    } catch (err) {
      setLoadError(`Не удалось загрузить список: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase().replace(/\s+/g, '');
    return data.vehicles.filter(v =>
      (!status || (monitoring && kipStatus(monitoring.kip[v.regNumber.toUpperCase()]) === status)) &&
      (!branch || v.branch === branch) &&
      (!type || v.type === type) &&
      (!q || v.regNumber.toUpperCase().includes(q) || v.type.toUpperCase().replace(/\s+/g, '').includes(q)),
    );
  }, [data, query, branch, type, status, monitoring]);

  const statusCounts = useMemo(() => {
    const c: Record<DataStatus, number> = { working: 0, idle: 0, stale: 0, none: 0 };
    if (data && monitoring) for (const v of data.vehicles) c[kipStatus(monitoring.kip[v.regNumber.toUpperCase()])]++;
    return c;
  }, [data, monitoring]);

  const onSaved = (body: VehiclesResponse, message: string) => {
    setData(body);
    setNotice(message);
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-3">
      <div className="glass-card rounded-xl p-3 flex flex-col gap-1.5 text-xs">
        <div className="font-semibold text-sm">Техника, которую выгружает «КИП техники»</div>
        <div className="text-muted-foreground" style={{ fontSize: '11px' }}>
          КИП, «Аналитика» и отчёты считают только технику из этого списка. Изменения вступают в силу сразу, без перезапуска:
          новая машина попадёт в данные при ближайшей плановой выгрузке (утром). Чтобы получить её данные за прошлые дни —
          перевыгрузите нужные даты на вкладке «Сервисы и данные». Группировка по типу в «Конструкторе отчётов» обновится
          после перезапуска сервиса «AI Отчёты».
        </div>
        <details className="text-muted-foreground" style={{ fontSize: '11px' }}>
          <summary className="cursor-pointer select-none text-foreground/80">Как другие разделы выбирают технику</summary>
          <ul className="list-disc pl-4 mt-1 flex flex-col gap-0.5">
            <li><b>Самосвалы</b> — отдельного списка нет: все машины из путевых листов TIS и из паспортов TIS, в названии модели которых есть «самосвал». Объект определяется по геозонам «Граница объекта» в Гео-Администраторе.</li>
            <li><b>Тягачи</b> — отдельного списка нет: все машины из путевых листов, в названии которых есть «тягач».</li>
            <li><b>Аналитика</b> — своего списка нет: берёт технику КИП, по которой были данные за последние 30 дней.</li>
          </ul>
        </details>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск: госномер или тип"
            className="pl-8 pr-7 py-1.5 rounded-lg text-xs bg-background/60 border border-border w-56 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-muted-foreground" aria-label="Очистить поиск">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <select value={branch} onChange={e => setBranch(e.target.value)} className="py-1.5 px-2 rounded-lg text-xs bg-background/60 border border-border">
          <option value="">Все филиалы</option>
          {data?.branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} className="py-1.5 px-2 rounded-lg text-xs bg-background/60 border border-border max-w-64">
          <option value="">Все типы</option>
          {data?.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as DataStatus | '')} disabled={!monitoring} className="py-1.5 px-2 rounded-lg text-xs bg-background/60 border border-border">
          <option value="">Любой статус данных</option>
          {(Object.keys(STATUS_LABEL) as DataStatus[]).map(k => (
            <option key={k} value={k}>{STATUS_LABEL[k]}{monitoring ? ` (${statusCounts[k]})` : ''}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {data ? `Показано ${filtered.length} из ${data.vehicles.length}` : ''}
        </span>
        <button
          onClick={() => setEdit({ mode: 'add' })}
          disabled={!data}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium"
        >
          <Plus className="size-3.5" /> Добавить технику
        </button>
      </div>

      {notice && <div className="text-xs rounded-lg px-3 py-2 bg-green-500/10 text-green-600 dark:text-green-400">{notice}</div>}
      {loadError && <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">{loadError}</div>}
      {monitoringError && <div className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600">{monitoringError}</div>}

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border/60">
              <th className="px-3 py-2 font-medium">Госномер</th>
              <th className="px-3 py-2 font-medium">Тип техники</th>
              <th className="px-3 py-2 font-medium">Филиал</th>
              <th className="px-3 py-2 font-medium text-right">Норма, л/ч</th>
              <th className="px-3 py-2 font-medium">Данные</th>
              <th className="px-3 py-2 font-medium text-right" title="Сколько дней из последних 7 мотор работал">Работал, дн. из 7</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(v => (
              <tr key={v.regNumber} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono">{v.regNumber}</td>
                <td className="px-3 py-1.5">{v.type}</td>
                <td className={`px-3 py-1.5 ${v.branch === 'Не указан' ? 'text-muted-foreground italic' : ''}`}>{v.branch}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {v.fuelNorm > 0 ? v.fuelNorm : <span className="text-muted-foreground italic" title="Норма не задана — загрузка считаться не будет">не задана</span>}
                </td>
                <KipStatusCells m={monitoring?.kip[v.regNumber.toUpperCase()]} loaded={!!monitoring} />
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => setEdit({ mode: 'edit', original: v })} className="p-1 rounded border-none bg-transparent cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Изменить" aria-label={`Изменить ${v.regNumber}`}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button onClick={() => setToDelete(v)} className="p-1 rounded border-none bg-transparent cursor-pointer text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Удалить" aria-label={`Удалить ${v.regNumber}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Ничего не найдено</td></tr>
            )}
            {!data && !loadError && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Загрузка…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && data && (
        <VehicleDialog
          state={edit}
          types={data.types}
          branches={data.branches}
          onClose={() => setEdit(null)}
          onSaved={(body, regNumber) => {
            setEdit(null);
            onSaved(body, edit.mode === 'add' ? `Техника ${regNumber} добавлена` : `Изменения по ${regNumber} сохранены`);
          }}
        />
      )}

      {toDelete && (
        <DeleteDialog
          vehicle={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={body => {
            const reg = toDelete.regNumber;
            setToDelete(null);
            onSaved(body, `Техника ${reg} удалена из списка`);
          }}
        />
      )}
    </div>
  );
};

const KipStatusCells: React.FC<{ m: Monitoring['kip'][string] | undefined; loaded: boolean }> = ({ m, loaded }) => {
  if (!loaded) return (<><td className="px-3 py-1.5 text-muted-foreground">…</td><td /></>);
  const st = kipStatus(m);
  const when = st === 'working' || st === 'idle' ? '' : st === 'stale' ? ` с ${fmtDay(m?.lastRecord ?? null)}` : '';
  return (
    <>
      <td className="px-3 py-1.5">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap ${STATUS_CLS[st]}`} title={`${STATUS_HINT[st]}. Последняя работа: ${fmtDay(m?.lastWork ?? null)}`}>
          {STATUS_LABEL[st]}{when}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{m ? m.workDays7 : 0}</td>
    </>
  );
};

const VehicleDialog: React.FC<{
  state: EditState;
  types: string[];
  branches: string[];
  onClose: () => void;
  onSaved: (body: VehiclesResponse, regNumber: string) => void;
}> = ({ state, types, branches, onClose, onSaved }) => {
  const [form, setForm] = useState(() =>
    state.mode === 'edit'
      ? { regNumber: state.original.regNumber, type: state.original.type, branch: state.original.branch, fuelNorm: String(state.original.fuelNorm || '') }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = state.mode === 'edit'
        ? `/api/admin/vehicles/kip/${encodeURIComponent(state.original.regNumber)}`
        : '/api/admin/vehicles/kip';
      const res = await fetch(url, {
        method: state.mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json() as VehiclesResponse & { saved?: string };
      if (!res.ok) throw new Error(body.error || res.statusText);
      onSaved(body, body.saved ?? form.regNumber);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full py-1.5 px-2 rounded-lg text-sm bg-background/60 border border-border focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{state.mode === 'add' ? 'Добавить технику' : `Изменить ${state.original.regNumber}`}</DialogTitle>
            <DialogDescription>Поля, отмеченные *, обязательны.</DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 text-xs">
            <span>Госномер *</span>
            <input value={form.regNumber} onChange={set('regNumber')} className={`${inputCls} font-mono uppercase`} placeholder="например, 6931ОЕ72" autoFocus required />
            <span className="text-muted-foreground" style={{ fontSize: '11px' }}>Как в TIS, без пробелов. Буквы — кириллицей (кроме инвентарных номеров вида A00002670).</span>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span>Тип техники *</span>
            <input value={form.type} onChange={set('type')} list="lk-vehicle-types" className={inputCls} placeholder="выберите из списка или впишите новый" required />
            <datalist id="lk-vehicle-types">{types.map(t => <option key={t} value={t} />)}</datalist>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span>Филиал *</span>
            <input value={form.branch} onChange={set('branch')} list="lk-vehicle-branches" className={inputCls} placeholder="если неизвестен — «Не указан»" required />
            <datalist id="lk-vehicle-branches">{branches.map(b => <option key={b} value={b} />)}</datalist>
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span>Норма расхода топлива, л/ч</span>
            <input value={form.fuelNorm} onChange={set('fuelNorm')} inputMode="decimal" className={`${inputCls} w-32`} placeholder="0" />
            <span className="text-muted-foreground" style={{ fontSize: '11px' }}>Пусто или 0 — норма не задана: КИП посчитается, а загрузка по топливу — нет.</span>
          </label>

          {error && <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">{error}</div>}

          <DialogFooter>
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-muted/50 hover:bg-muted">Отмена</button>
            <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium">
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const DeleteDialog: React.FC<{
  vehicle: KipVehicle;
  onClose: () => void;
  onDeleted: (body: VehiclesResponse) => void;
}> = ({ vehicle, onClose, onDeleted }) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/vehicles/kip/${encodeURIComponent(vehicle.regNumber)}`, { method: 'DELETE' });
      const body = await res.json() as VehiclesResponse;
      if (!res.ok) throw new Error(body.error || res.statusText);
      onDeleted(body);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить {vehicle.regNumber}?</DialogTitle>
          <DialogDescription>
            {vehicle.type}, филиал «{vehicle.branch}». Машина перестанет выгружаться в КИП и «Аналитику» начиная со следующей выгрузки.
            Уже собранные данные за прошлые дни останутся. Копия списка до удаления сохраняется автоматически.
          </DialogDescription>
        </DialogHeader>
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">{error}</div>}
        <DialogFooter>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-muted/50 hover:bg-muted">Отмена</button>
          <button type="button" onClick={remove} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-destructive text-white hover:opacity-90 disabled:opacity-50 font-medium">
            {busy ? 'Удаление…' : 'Удалить'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
