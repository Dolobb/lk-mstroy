import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Fuel,
  Image,
  Pencil,
  RefreshCw,
  Truck,
  Users,
} from 'lucide-react';
import { DateRangePicker } from '@/components/DateRangePicker';
import {
  fetchAtz,
  fetchDrivers,
  fetchShiftDetail,
  fetchShifts,
  ttnPhotoUrl,
} from './api';
import type {
  AtzStatus,
  DispenseEvent,
  Driver,
  EventEdit,
  ReceiptEvent,
  ShiftDetail,
  ShiftFilters,
  ShiftSummary,
} from './types';

type TabId = 'atz' | 'shifts' | 'drivers';
type ShiftStatusFilter = 'all' | 'open' | 'closed';

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'atz', label: 'АТЗ', icon: <Truck className="size-3.5" /> },
  { id: 'shifts', label: 'Смены', icon: <CalendarDays className="size-3.5" /> },
  { id: 'drivers', label: 'Водители', icon: <Users className="size-3.5" /> },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const d = String(dt.getDate()).padStart(2, '0');
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${d}.${mo}.${dt.getFullYear()} ${h}:${mi}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${mi}`;
}

function formatLiters(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, '');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function todayYmd(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function daysAgoYmd(days: number): string {
  return format(subDays(new Date(), days), 'yyyy-MM-dd');
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'green' | 'amber' | 'muted' | 'red' | 'blue';
}) {
  const tones: Record<typeof tone, string> = {
    green: 'bg-green-500/15 text-green-700 dark:text-green-400',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    muted: 'bg-muted text-muted-foreground',
    red: 'bg-destructive/15 text-destructive',
    blue: 'bg-primary/15 text-primary',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StateMessage({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Загрузка…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return null;
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function jsonPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function AtzCard({ atz }: { atz: AtzStatus }) {
  const busy = atz.openShift !== null;

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm transition-colors ${
        atz.isActive === false ? 'opacity-50' : 'hover:bg-muted/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-lg font-semibold leading-tight">{atz.gosNumber}</div>
          {atz.title && (
            <div className="mt-1 truncate text-xs text-muted-foreground">{atz.title}</div>
          )}
        </div>
        <StatusBadge tone={busy ? 'amber' : 'green'}>
          {busy ? 'Занят' : 'Свободен'}
        </StatusBadge>
      </div>

      <div className="mt-5 flex items-end gap-2">
        <Fuel className="mb-1 size-5 text-muted-foreground" />
        <div className="text-3xl font-semibold tracking-normal">{formatLiters(atz.remainingLiters)}</div>
        <div className="mb-1 text-sm text-muted-foreground">л</div>
      </div>

      <div className="mt-4 min-h-8 text-xs text-muted-foreground">
        {atz.openShift ? (
          <>
            <div className="font-medium text-foreground">{atz.openShift.driver.fullName}</div>
            <div>с {formatTime(atz.openShift.startedAtClient)}</div>
          </>
        ) : (
          <div>Открытых смен нет</div>
        )}
      </div>
    </div>
  );
}

function EventFlags({ isDeleted, wasEdited }: { isDeleted: boolean; wasEdited: boolean }) {
  if (!isDeleted && !wasEdited) return null;

  return (
    <div className="flex items-center gap-1">
      {isDeleted && <StatusBadge tone="red">удалено</StatusBadge>}
      {wasEdited && (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-300">
          <Pencil className="size-3" />
          правлено
        </span>
      )}
    </div>
  );
}

function DispenseRow({ event }: { event: DispenseEvent }) {
  return (
    <div className={`grid grid-cols-[56px_1fr_auto] gap-3 rounded-md px-2 py-1.5 text-xs ${event.isDeleted ? 'opacity-60' : ''}`}>
      <div className="font-mono text-muted-foreground">{formatTime(event.happenedAtClient)}</div>
      <div className={event.isDeleted ? 'line-through' : ''}>
        <span className="font-mono font-medium">{event.vehicle.gosNumber}</span>
        {event.vehicle.mark && <span className="ml-2 text-muted-foreground">{event.vehicle.mark}</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className={`font-semibold ${event.isDeleted ? 'line-through' : ''}`}>
          {formatLiters(event.liters)} л
        </span>
        <EventFlags isDeleted={event.isDeleted} wasEdited={event.wasEdited} />
      </div>
    </div>
  );
}

function ReceiptRow({ event }: { event: ReceiptEvent }) {
  const photoUrl = ttnPhotoUrl(event.id);

  return (
    <div className={`grid grid-cols-[56px_90px_1fr] gap-3 rounded-md px-2 py-1.5 text-xs ${event.isDeleted ? 'opacity-60' : ''}`}>
      <div className="font-mono text-muted-foreground">{formatTime(event.happenedAtClient)}</div>
      <div className={`font-semibold ${event.isDeleted ? 'line-through' : ''}`}>
        {formatLiters(event.liters)} л
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {event.ttnPhotoStatus === 'uploaded' ? (
            <button
              type="button"
              onClick={() => window.open(photoUrl, '_blank', 'noopener,noreferrer')}
              className="group flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              <img
                src={photoUrl}
                alt="Фото ТТН"
                className="h-9 w-12 rounded border border-border object-cover"
              />
              <span className="text-[10px]">открыть</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Image className="size-3.5" />
              фото не загружено
            </span>
          )}
        </div>
        <EventFlags isDeleted={event.isDeleted} wasEdited={event.wasEdited} />
      </div>
    </div>
  );
}

function EditsList({ edits }: { edits: EventEdit[] }) {
  if (edits.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 text-xs font-semibold">Правки</div>
      <div className="space-y-2">
        {edits.map(edit => (
          <div key={edit.id} className="rounded-md bg-muted/40 p-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono font-semibold">{edit.eventType}</span>
              <span className="text-muted-foreground">{formatDateTime(edit.editedAt)}</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <pre className="max-h-32 overflow-auto rounded border border-border bg-card p-2 text-[10px] text-muted-foreground">
                {jsonPreview(edit.before)}
              </pre>
              <pre className="max-h-32 overflow-auto rounded border border-border bg-card p-2 text-[10px] text-muted-foreground">
                {jsonPreview(edit.after)}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShiftDetailPanel({
  detail,
  loading,
  error,
}: {
  detail: ShiftDetail | undefined;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <div className="p-4 text-xs text-muted-foreground">Загрузка деталей…</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-destructive">{error}</div>;
  }

  if (!detail) return null;

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 text-xs font-semibold">Выдачи</div>
        {detail.dispenses.length > 0 ? (
          <div className="divide-y divide-border/40">
            {detail.dispenses.map(event => <DispenseRow key={event.id} event={event} />)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Нет выдач</div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background/60 p-3">
        <div className="mb-2 text-xs font-semibold">Получения</div>
        {detail.receipts.length > 0 ? (
          <div className="divide-y divide-border/40">
            {detail.receipts.map(event => <ReceiptRow key={event.id} event={event} />)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Нет получений</div>
        )}
      </div>

      <EditsList edits={detail.edits} />
    </div>
  );
}

export function FuelAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('atz');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [atz, setAtz] = useState<AtzStatus[]>([]);
  const [atzLoading, setAtzLoading] = useState(false);
  const [atzError, setAtzError] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversError, setDriversError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => daysAgoYmd(13));
  const [dateTo, setDateTo] = useState(() => todayYmd());
  const [shiftStatus, setShiftStatus] = useState<ShiftStatusFilter>('all');
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ShiftDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const shiftFilters = useMemo(() => {
    const filters: ShiftFilters = {
      from: `${dateFrom}T00:00:00.000Z`,
      to: `${dateTo}T23:59:59.999Z`,
    };
    if (shiftStatus !== 'all') filters.status = shiftStatus;
    return filters;
  }, [dateFrom, dateTo, shiftStatus]);

  const loadAtz = useCallback(async () => {
    setAtzLoading(true);
    setAtzError(null);
    try {
      setAtz(await fetchAtz());
      setLastUpdatedAt(new Date());
    } catch (error) {
      setAtzError(formatError(error));
    } finally {
      setAtzLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setDriversLoading(true);
    setDriversError(null);
    try {
      setDrivers(await fetchDrivers());
      setLastUpdatedAt(new Date());
    } catch (error) {
      setDriversError(formatError(error));
    } finally {
      setDriversLoading(false);
    }
  }, []);

  const loadShifts = useCallback(async () => {
    setShiftsLoading(true);
    setShiftsError(null);
    try {
      setShifts(await fetchShifts(shiftFilters));
      setLastUpdatedAt(new Date());
    } catch (error) {
      setShiftsError(formatError(error));
    } finally {
      setShiftsLoading(false);
    }
  }, [shiftFilters]);

  useEffect(() => {
    if (activeTab === 'atz') void loadAtz();
  }, [activeTab, loadAtz]);

  useEffect(() => {
    if (activeTab === 'drivers') void loadDrivers();
  }, [activeTab, loadDrivers]);

  useEffect(() => {
    if (activeTab === 'shifts') void loadShifts();
  }, [activeTab, loadShifts]);

  // Auto-poll: refresh active tab every 30s
  useEffect(() => {
    const id = setInterval(() => {
      if (activeTab === 'atz') void loadAtz();
      else if (activeTab === 'drivers') void loadDrivers();
      else if (activeTab === 'shifts') void loadShifts();
    }, 30_000);
    return () => clearInterval(id);
  }, [activeTab, loadAtz, loadDrivers, loadShifts]);

  const refreshCurrent = () => {
    if (activeTab === 'atz') void loadAtz();
    if (activeTab === 'drivers') void loadDrivers();
    if (activeTab === 'shifts') void loadShifts();
  };

  const refreshLoading =
    (activeTab === 'atz' && atzLoading)
    || (activeTab === 'drivers' && driversLoading)
    || (activeTab === 'shifts' && shiftsLoading);

  const toggleShift = async (id: string) => {
    if (expandedShiftId === id) {
      setExpandedShiftId(null);
      return;
    }

    setExpandedShiftId(id);
    if (details[id]) return;

    setDetailLoadingId(id);
    setDetailErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const detail = await fetchShiftDetail(id);
      setDetails(prev => ({ ...prev, [id]: detail }));
    } catch (error) {
      setDetailErrors(prev => ({ ...prev, [id]: formatError(error) }));
    } finally {
      setDetailLoadingId(current => (current === id ? null : current));
    }
  };

  const renderAtz = () => {
    if (atzLoading || atzError || atz.length === 0) {
      return (
        <StateMessage
          loading={atzLoading}
          error={atzError}
          empty={!atzLoading && !atzError && atz.length === 0}
          emptyText="АТЗ не найдены"
        />
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {atz.map(item => <AtzCard key={item.id} atz={item} />)}
      </div>
    );
  };

  const renderDrivers = () => {
    if (driversLoading || driversError || drivers.length === 0) {
      return (
        <StateMessage
          loading={driversLoading}
          error={driversError}
          empty={!driversLoading && !driversError && drivers.length === 0}
          emptyText="Водители не найдены"
        />
      );
    }

    return (
      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Логин</th>
              <th className="px-3 py-2 text-left font-medium">ФИО</th>
              <th className="px-3 py-2 text-left font-medium">Активен</th>
              <th className="px-3 py-2 text-left font-medium">Последняя смена</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(driver => (
              <tr key={driver.id} className="border-b border-border/40 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono">{driver.login}</td>
                <td className="px-3 py-2 font-medium">{driver.fullName}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={driver.isActive === false ? 'muted' : 'green'}>
                    {driver.isActive === false ? 'нет' : 'да'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(driver.lastShiftAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderShifts = () => {
    const showState = shiftsLoading || !!shiftsError || shifts.length === 0;

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onRangeChange={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />
          <div className="flex rounded-lg bg-muted/60 p-1">
            <SegmentButton active={shiftStatus === 'all'} onClick={() => setShiftStatus('all')}>
              Все
            </SegmentButton>
            <SegmentButton active={shiftStatus === 'open'} onClick={() => setShiftStatus('open')}>
              Открытые
            </SegmentButton>
            <SegmentButton active={shiftStatus === 'closed'} onClick={() => setShiftStatus('closed')}>
              Закрытые
            </SegmentButton>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {shiftsLoading ? 'Загрузка…' : `${shifts.length} смен`}
          </div>
        </div>

        {showState ? (
          <StateMessage
            loading={shiftsLoading}
            error={shiftsError}
            empty={!shiftsLoading && !shiftsError && shifts.length === 0}
            emptyText="Смены не найдены"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Водитель</th>
                  <th className="px-3 py-2 text-left font-medium">АТЗ</th>
                  <th className="px-3 py-2 text-left font-medium">Начало</th>
                  <th className="px-3 py-2 text-left font-medium">Конец</th>
                  <th className="px-3 py-2 text-left font-medium">Статус</th>
                  <th className="px-3 py-2 text-right font-medium">Выдано</th>
                  <th className="px-3 py-2 text-right font-medium">Получено</th>
                  <th className="px-3 py-2 text-right font-medium">Правки</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map(shift => {
                  const expanded = expandedShiftId === shift.id;
                  return (
                    <Fragment key={shift.id}>
                      <tr
                        onClick={() => void toggleShift(shift.id)}
                        className="cursor-pointer border-b border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2 text-muted-foreground">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{shift.driver.fullName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{shift.driver.login}</div>
                        </td>
                        <td className="px-3 py-2 font-mono">{shift.atz.gosNumber}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(shift.startedAtClient)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(shift.endedAtClient)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={shift.status === 'open' ? 'amber' : 'muted'}>
                            {shift.status === 'open' ? 'open' : 'closed'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {formatLiters(shift.dispenseLiters)} л / {shift.dispenseCount} шт
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{formatLiters(shift.receiptLiters)} л</td>
                        <td className="px-3 py-2 text-right">
                          <span className={shift.editsCount > 0 ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}>
                            {shift.editsCount}
                          </span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${shift.id}-details`} className="border-b border-border bg-muted/20">
                          <td colSpan={9} className="p-0">
                            <ShiftDetailPanel
                              detail={details[shift.id]}
                              loading={detailLoadingId === shift.id}
                              error={detailErrors[shift.id] ?? null}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-card p-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastUpdatedAt && (
            <span className="text-[11px] text-muted-foreground">
              обновлено {lastUpdatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={refreshCurrent}
            disabled={refreshLoading}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${refreshLoading ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === 'atz' && renderAtz()}
        {activeTab === 'shifts' && renderShifts()}
        {activeTab === 'drivers' && renderDrivers()}
      </div>
    </div>
  );
}
