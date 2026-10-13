import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { AdminPage } from './AdminPage';
import { VehiclesPanel } from './VehiclesPanel';

type AuthState = 'checking' | 'locked' | 'open';
type Tab = 'pipelines' | 'vehicles';

const TAB_KEY = 'lk-admin-tab';

/**
 * Админ-раздел за PIN-кодом. Проверка — на сервере (admin/src/auth.ts):
 * после верного PIN сервер ставит httpOnly-cookie на 30 дней.
 */
export const AdminSection: React.FC = () => {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [tab, setTab] = useState<Tab>(() => {
    try { return localStorage.getItem(TAB_KEY) === 'vehicles' ? 'vehicles' : 'pipelines'; } catch { return 'pipelines'; }
  });

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/auth/status');
      const body = await res.json() as { authenticated?: boolean };
      setAuth(body.authenticated ? 'open' : 'locked');
    } catch {
      setAuth('locked');
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // Сессия может истечь, пока страница открыта: любой 401 pin_required от /api/admin → экран PIN.
  useEffect(() => {
    if (auth !== 'open') return;
    const origFetch = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await origFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (res.status === 401 && url.includes('/api/admin/') && !url.includes('/api/admin/auth/')) {
        setAuth('locked');
      }
      return res;
    };
    return () => { window.fetch = origFetch; };
  }, [auth]);

  const selectTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* приватный режим — не критично */ }
  };

  const logout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' }).catch(() => null);
    setAuth('locked');
  };

  if (auth === 'checking') {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Проверка доступа…</div>;
  }
  if (auth === 'locked') {
    return <PinScreen onSuccess={() => setAuth('open')} />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-3 pt-3 shrink-0">
        <TabButton active={tab === 'pipelines'} onClick={() => selectTab('pipelines')}>Сервисы и данные</TabButton>
        <TabButton active={tab === 'vehicles'} onClick={() => selectTab('vehicles')}>Техника</TabButton>
        <button
          onClick={logout}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border-none cursor-pointer bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
          title="Выйти из админ-раздела (потребуется снова ввести PIN)"
        >
          <LogOut className="size-3.5" /> Выйти
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        {tab === 'pipelines' ? <AdminPage /> : <VehiclesPanel />}
      </div>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium border-none cursor-pointer transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20'
    }`}
  >
    {children}
  </button>
);

const PinScreen: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedFor, setBlockedFor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (blockedFor <= 0) return;
    const t = setTimeout(() => setBlockedFor(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [blockedFor]);

  useEffect(() => {
    if (blockedFor === 0) inputRef.current?.focus();
  }, [blockedFor]);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      });
      const body = await res.json().catch(() => ({})) as { attemptsLeft?: number; retryAfterSec?: number };
      if (res.ok) { onSuccess(); return; }
      setPin('');
      if (res.status === 429) {
        setBlockedFor(body.retryAfterSec ?? 60);
        setError('Слишком много неверных попыток. Подождите минуту.');
      } else {
        setError(`Неверный PIN${body.attemptsLeft != null ? ` — осталось попыток: ${body.attemptsLeft}` : ''}`);
      }
    } catch {
      setError('Сервер не отвечает. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const onChange = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 4);
    setPin(v);
    if (v.length === 4) submit(v);
  };

  const blocked = blockedFor > 0;

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="glass-card rounded-xl p-6 w-full max-w-xs flex flex-col items-center gap-4 text-center">
        <div className="size-10 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <Lock className="size-5" />
        </div>
        <div>
          <h1 className="text-sm font-semibold">Админ-раздел</h1>
          <p className="text-xs text-muted-foreground mt-1">Введите PIN-код из 4 цифр</p>
        </div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          disabled={busy || blocked}
          onChange={e => onChange(e.target.value)}
          aria-label="PIN-код"
          className="w-40 text-center text-2xl tracking-[0.6em] pl-[0.6em] py-2 rounded-lg bg-background/60 border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <div className="min-h-[2.5em] text-xs">
          {blocked
            ? <span className="text-destructive">Слишком много неверных попыток. Повторите через {blockedFor} с.</span>
            : error && <span className="text-destructive">{error}</span>}
        </div>
        <p className="text-[11px] text-muted-foreground">После входа браузер запомнит доступ на 30 дней.</p>
      </div>
    </div>
  );
};
