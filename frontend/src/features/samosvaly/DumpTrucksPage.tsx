import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import './samosvaly.css';
import {
  fetchObjects, fetchOrders, fetchOrderGantt,
  fetchShiftRecords, fetchShiftDetail, fetchRepairs,
} from './api';
import type {
  DtObject, OrderSummary, OrderCard, GanttRecord, GanttResponse,
  ShiftRecord, TripRecord, ZoneEvent, Repair,
  BlockId, UserSettings,
} from './types';

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
  } catch { return '—'; }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch { return '—'; }
}

function fmtDateShort(isoDate: string): string {
  // Handles 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS...' → 'DD.MM'
  const dateOnly = isoDate.split('T')[0] ?? isoDate;
  const p = dateOnly.split('-');
  return `${p[2]}.${p[1]}`;
}

/** Нормализует дату из JSON API к 'YYYY-MM-DD' */
function toDateStr(isoDate: string): string {
  return (isoDate.split('T')[0] ?? isoDate).substring(0, 10);
}

function kipColor(v: number): string {
  return v >= 75 ? 'sv-v-g' : v >= 50 ? 'sv-v-o' : 'sv-v-r';
}

function avgOrDash(arr: number[]): string {
  const nonzero = arr.filter(x => x > 0);
  if (!nonzero.length) return '—';
  return String(Math.round(nonzero.reduce((a, b) => a + b, 0) / nonzero.length));
}

/** Убирает слово "Самосвал" из названия ТС */
function stripSamosvaly(name: string | null | undefined): string {
  if (!name) return '—';
  return name.replace(/^самосвал\s*/i, '').trim();
}

/** Форматирует секунды в ч:мм */
function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Форматирует секунды в минуты с суффиксом (для стоянок в зонах) */
function fmtDwell(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.round(sec / 60);
  return `${m}м`;
}

/** Парсит DD.MM.YYYY → YYYY-MM-DD */
function parseDdMmYyyy(s: string | undefined): string {
  if (!s) return '';
  const p = s.split('.');
  if (p.length === 3 && p[2]!.length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
  return '';
}

const IDLE_SHIFT_SEC = 11 * 3600; // 11ч = рабочее время смены без обеда

/** Понедельник недели, содержащей дату */
function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
//  Block / Column definitions
// ─────────────────────────────────────────────

const BLOCK_LABELS: Record<BlockId, string> = {
  identity:   'Определители',
  work:       'Выполненная работа',
  kpi:        'KPI',
  aggregates: 'Агрегаты',
};

const BLOCK_COLUMNS: Record<BlockId, Array<{ id: string; label: string }>> = {
  identity: [
    { id: 'requestNumber', label: '№ заявки' },
    { id: 'objectName',   label: 'Объект' },
  ],
  work: [
    { id: 'shiftsCount',  label: 'Смены' },
    { id: 'shift1Trips',  label: 'Рейсы 1 см.' },
    { id: 'shift2Trips',  label: 'Рейсы 2 см.' },
    { id: 'totalTrips',   label: 'Рейсы итого' },
  ],
  kpi: [
    { id: 'kip1',         label: 'КИП 1 см.' },
    { id: 'kip2',         label: 'КИП 2 см.' },
    { id: 'movement1',    label: 'Движение% 1' },
    { id: 'movement2',    label: 'Движение% 2' },
  ],
  aggregates: [
    { id: 'engineTotal',       label: 'Двиг. итого' },
    { id: 'movingTotal',       label: 'Движ. итого' },
    { id: 'onsiteMin',         label: 'На объекте' },
    { id: 'avgLoadingDwell',   label: 'Ср. стоянка П' },
    { id: 'avgUnloadingDwell', label: 'Ср. стоянка В' },
    { id: 'travelToUnload',    label: 'Путь к выгрузке' },
    { id: 'returnToLoad',      label: 'Путь к погрузке' },
  ],
};

// ─────────────────────────────────────────────
//  User settings utilities (localStorage)
// ─────────────────────────────────────────────

function getDefaultSettings(): UserSettings {
  const allBlocks: BlockId[] = ['identity', 'work', 'kpi', 'aggregates'];
  return {
    blockOrder: allBlocks,
    blockVisibility: { identity: true, work: true, kpi: true, aggregates: true },
    columnVisibility: Object.fromEntries(
      allBlocks.map(b => [b, Object.fromEntries(BLOCK_COLUMNS[b].map(c => [c.id, true]))])
    ) as Record<BlockId, Record<string, boolean>>,
    columnOrder: Object.fromEntries(
      allBlocks.map(b => [b, BLOCK_COLUMNS[b].map(c => c.id)])
    ) as Record<BlockId, string[]>,
    groupByRequest: true,
    groupByShift: true,
  };
}

function loadUserSettings(name: string): UserSettings {
  try {
    const raw = localStorage.getItem(`dt_user_settings_${name}`);
    if (!raw) return getDefaultSettings();
    const saved = JSON.parse(raw) as Partial<UserSettings>;
    const def = getDefaultSettings();
    return { ...def, ...saved };
  } catch {
    return getDefaultSettings();
  }
}

function saveUserSettings(name: string, settings: UserSettings): void {
  localStorage.setItem(`dt_user_settings_${name}`, JSON.stringify(settings));
}

function getUsersList(): string[] {
  try {
    const raw = localStorage.getItem('dt_users_list');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveUsersList(list: string[]): void {
  localStorage.setItem('dt_users_list', JSON.stringify(list));
}

function getCurrentUser(): string | null {
  return localStorage.getItem('dt_current_user');
}

function setCurrentUser(name: string): void {
  localStorage.setItem('dt_current_user', name);
}

// ─────────────────────────────────────────────
//  UserSelector component
// ─────────────────────────────────────────────

function UserSelector({ currentUser, onSelect }: {
  currentUser: string | null;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const users = getUsersList();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (name: string) => {
    setCurrentUser(name);
    onSelect(name);
    setOpen(false);
  };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const list = getUsersList();
    if (!list.includes(name)) {
      list.push(name);
      saveUsersList(list);
    }
    handleSelect(name);
    setNewName('');
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="sv-fb-pill"
        onClick={() => setOpen(p => !p)}
        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="8" r="5" /><path d="M3 21c0-5 9-5 9-5s9 0 9 5" />
        </svg>
        {currentUser ?? 'Выбрать профиль'}
      </button>
      {open && (
        <div className="sv-user-dropdown">
          {users.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {users.map(u => (
                <div
                  key={u}
                  className={`sv-user-option ${u === currentUser ? 'active' : ''}`}
                  onClick={() => handleSelect(u)}
                >
                  {u}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              className="sv-fb-date"
              style={{ flex: 1, width: 'auto' }}
              placeholder="Новый профиль..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button className="sv-fb-pill" onClick={handleAdd} style={{ padding: '4px 10px' }}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TableConstructorPanel component
// ─────────────────────────────────────────────

function TableConstructorPanel({ settings, onUpdate, onClose }: {
  settings: UserSettings;
  onUpdate: (s: UserSettings) => void;
  onClose: () => void;
}) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<BlockId>>(new Set());

  const toggleBlockExpand = (b: BlockId) => {
    setExpandedBlocks(prev => {
      const s = new Set(prev);
      if (s.has(b)) s.delete(b); else s.add(b);
      return s;
    });
  };

  const toggleBlockVisibility = (b: BlockId) => {
    onUpdate({
      ...settings,
      blockVisibility: { ...settings.blockVisibility, [b]: !settings.blockVisibility[b] },
    });
  };

  const toggleColumnVisibility = (b: BlockId, col: string) => {
    onUpdate({
      ...settings,
      columnVisibility: {
        ...settings.columnVisibility,
        [b]: { ...settings.columnVisibility[b], [col]: !settings.columnVisibility[b][col] },
      },
    });
  };

  const moveBlock = (b: BlockId, dir: -1 | 1) => {
    const order = [...settings.blockOrder];
    const i = order.indexOf(b);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    onUpdate({ ...settings, blockOrder: order });
  };

  return (
    <div className="sv-constructor-panel">
      <div className="sv-constructor-header">
        <span style={{ fontWeight: 700, fontSize: 13 }}>Конструктор таблицы</span>
        <button className="sv-an-right-close" style={{ position: 'static' }} onClick={onClose}>✕</button>
      </div>

      {/* Группировка */}
      <div className="sv-constructor-section">
        <div className="sv-constructor-section-title">Группировка</div>
        <label className="sv-constructor-toggle-row">
          <span>По заявке</span>
          <input type="checkbox" checked={settings.groupByRequest}
            onChange={() => onUpdate({ ...settings, groupByRequest: !settings.groupByRequest })} />
        </label>
        <label className="sv-constructor-toggle-row">
          <span>Смены в одной строке</span>
          <input type="checkbox" checked={settings.groupByShift}
            onChange={() => onUpdate({ ...settings, groupByShift: !settings.groupByShift })} />
        </label>
      </div>

      {/* Блоки */}
      <div className="sv-constructor-section">
        <div className="sv-constructor-section-title">Блоки и столбцы</div>
        {settings.blockOrder.map((b, bi) => (
          <div key={b} className="sv-constructor-block">
            <div className="sv-constructor-block-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                {/* Order controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 2 }}>
                  <button className="sv-constructor-arrow" onClick={() => moveBlock(b, -1)} disabled={bi === 0}>▲</button>
                  <button className="sv-constructor-arrow" onClick={() => moveBlock(b, 1)} disabled={bi === settings.blockOrder.length - 1}>▼</button>
                </div>
                <input type="checkbox" checked={settings.blockVisibility[b]}
                  onChange={() => toggleBlockVisibility(b)}
                  style={{ cursor: 'pointer' }} />
                <span
                  style={{ fontWeight: 600, fontSize: 12, cursor: 'pointer', flex: 1 }}
                  onClick={() => toggleBlockExpand(b)}
                >
                  {BLOCK_LABELS[b]}
                </span>
                <span style={{ fontSize: 10, color: 'var(--sv-text-4)', cursor: 'pointer' }} onClick={() => toggleBlockExpand(b)}>
                  {expandedBlocks.has(b) ? '▲' : '▼'}
                </span>
              </div>
            </div>
            {expandedBlocks.has(b) && (
              <div className="sv-constructor-cols">
                {(settings.columnOrder[b] ?? BLOCK_COLUMNS[b].map(c => c.id)).map(colId => {
                  const colDef = BLOCK_COLUMNS[b].find(c => c.id === colId);
                  if (!colDef) return null;
                  const visible = settings.columnVisibility[b][colId] !== false;
                  return (
                    <label key={colId} className="sv-constructor-col-row">
                      <input type="checkbox" checked={visible}
                        onChange={() => toggleColumnVisibility(b, colId)} />
                      <span style={{ fontSize: 11 }}>{colDef.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Преобразует OrderSummary (raw от API) в удобный OrderCard */
function toOrderCard(o: OrderSummary, today: string): OrderCard {
  const ord = o.raw_json?.orders?.[0];
  const pts = ord?.route?.points ?? [];
  const cargo = ord?.nameCargo ?? '—';
  const weightTotal = ord?.weightCargo ?? 0;
  const volumeTotal = ord?.volumeCargo ?? 0;
  const planTrips = ord?.cntTrip ?? 0;
  const routeFrom = pts[0]?.address ?? '—';
  const routeTo = pts.length > 2
    ? `⚠ ${pts.length} точек`
    : pts[pts.length - 1]?.address ?? '—';
  const routeDistance = ord?.route?.distance ?? 0;
  const routeTimeMins = ord?.route?.time ? Math.round(ord.route.time / 60) : 0;
  const objectExpend = ord?.objectExpend?.name ?? '';
  const countTs = ord?.countTs ?? 0;
  const notes = ord?.notes ?? '';
  const comment = ord?.comment ?? '';

  const actualTrips = Number(o.actual_trips);
  const pct = planTrips > 0 ? Math.min(100, Math.round((actualTrips / planTrips) * 100)) : 0;

  // Город: берём из object_names (первый) — упрощённо
  const city = (o.object_names ?? [])[0] ?? 'Прочие';

  // Даты из маршрутных точек TIS (points[].date в формате DD.MM.YYYY)
  const dateFromIso = parseDdMmYyyy(pts[0]?.date);
  const dateToIso   = pts.length > 0 ? parseDdMmYyyy(pts[pts.length - 1]?.date) : '';
  const dateFrom = dateFromIso ? `${dateFromIso.slice(8, 10)}.${dateFromIso.slice(5, 7)}` : '—';
  const dateTo   = dateToIso   ? `${dateToIso.slice(8, 10)}.${dateToIso.slice(5, 7)}`   : '—';

  // Статус: SUCCESSFULLY_COMPLETED → done; иначе dateToIso < today → done
  const isDone = o.status === 'SUCCESSFULLY_COMPLETED' || (dateToIso !== '' && dateToIso < today);

  return {
    number: o.number,
    status: o.status,
    cargo,
    weightTotal,
    volumeTotal,
    planTrips,
    routeFrom,
    routeTo,
    routeDistance,
    routeTimeMins,
    objectExpend,
    dateFrom,
    dateTo,
    dateFromIso,
    dateToIso,
    actualTrips,
    pct,
    vehicles: o.vehicles ?? [],
    vehicleNames: o.vehicle_names ?? [],
    objectNames: o.object_names ?? [],
    plCount: Number(o.pl_count),
    city,
    isDone,
    countTs,
    notes,
    comment,
  };
}

// ─────────────────────────────────────────────
//  Donut chart (SVG)
// ─────────────────────────────────────────────
function MiniDonut({ mov, size = 70 }: { mov: number; size?: number }) {
  const r = size * 0.34;
  const cx = size / 2;
  const cy = size / 2;
  const sw = size * 0.1;
  const c = 2 * Math.PI * r;
  const idle = 100 - mov;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sv-donut-track)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#22c55e" strokeWidth={sw}
        strokeDasharray={`${c * mov / 100} ${c * (1 - mov / 100)}`}
        strokeDashoffset={c / 4} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EF4444" strokeWidth={sw}
        strokeDasharray={`${c * idle / 100} ${c * (1 - idle / 100)}`}
        strokeDashoffset={c / 4 - c * mov / 100} strokeLinecap="round" />
      <text x={cx} y={cy + 1} textAnchor="middle" fill="var(--sv-text-1)"
        fontSize={size * 0.14} fontWeight="800" fontFamily="DM Sans">{mov}%</text>
      <text x={cx} y={cy + size * 0.14} textAnchor="middle" fill="var(--sv-text-4)"
        fontSize={size * 0.086} fontWeight="500" fontFamily="DM Sans">движ.</text>
    </svg>
  );
}

// ─────────────────────────────────────────────
//  Popover icon (hover to show, click to pin)
// ─────────────────────────────────────────────

function PopoverIcon({ icon, label, text }: { icon: string; label: string; text: string }) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.left - 80) });
    }
    setOpen(p => !p);
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`sv-popover-btn ${open ? 'pinned' : ''}`}
        onClick={handleClick}
        title={label}
      >{icon}</button>
      {open && createPortal(
        <div ref={boxRef} className="sv-popover-box" data-theme={resolvedTheme}
          style={{ top: pos.top, left: pos.left }}
          onClick={e => e.stopPropagation()}>
          <div className="sv-popover-title">{label}</div>
          <div className="sv-popover-body">{text}</div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Fraction display: actual/planned, green if actual >= planned */
function Fraction({ actual, planned, unit }: { actual: number; planned: number; unit: string }) {
  const done = planned > 0 && actual >= planned;
  return (
    <span>
      <span style={{ fontWeight: 700, color: done ? '#22c55e' : 'var(--sv-text-2)' }}>{actual}</span>
      <span style={{ color: 'var(--sv-text-4)' }}>/{planned}</span>
      <span style={{ fontSize: '0.85em', color: 'var(--sv-text-4)', marginLeft: 2 }}>{unit}</span>
    </span>
  );
}

// ─────────────────────────────────────────────
//  Mini-Gantt for unlinked shifts (no request)
// ─────────────────────────────────────────────
function UnlinkedGantt({ shifts, dateFrom, dateTo }: {
  shifts: ShiftRecord[];
  dateFrom: string;
  dateTo: string;
}) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hideEmpty, setHideEmpty] = useState(true);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  // Group by vehicle
  const vehicleMap = new Map<string, { name: string; recs: ShiftRecord[] }>();
  shifts.forEach(r => {
    if (!vehicleMap.has(r.regNumber)) vehicleMap.set(r.regNumber, { name: r.nameMO, recs: [] });
    vehicleMap.get(r.regNumber)!.recs.push(r);
  });

  const allDates = generateDateRange(dateFrom, dateTo);
  const datesWithData = new Set(shifts.map(r => toDateStr(r.reportDate)));
  const filteredDates = hideEmpty ? allDates.filter(d => datesWithData.has(d)) : allDates;

  const needsNav = filteredDates.length > GANTT_PAGE_SIZE;
  const maxOffset = needsNav ? filteredDates.length - GANTT_PAGE_SIZE : 0;
  const visibleDates = needsNav
    ? filteredDates.slice(scrollOffset, scrollOffset + GANTT_PAGE_SIZE)
    : filteredDates;

  // Build cell map
  type UCell = { s1: number; s2: number; s1has: boolean; s2has: boolean };
  const cellMap = new Map<string, Map<string, UCell>>();
  shifts.forEach(r => {
    const d = toDateStr(r.reportDate);
    if (!cellMap.has(r.regNumber)) cellMap.set(r.regNumber, new Map());
    const dm = cellMap.get(r.regNumber)!;
    if (!dm.has(d)) dm.set(d, { s1: 0, s2: 0, s1has: false, s2has: false });
    const c = dm.get(d)!;
    if (r.shiftType === 'shift1') { c.s1 = r.tripsCount; c.s1has = true; }
    else { c.s2 = r.tripsCount; c.s2has = true; }
  });

  // Total trips per vehicle
  const totalByVeh = new Map<string, number>();
  shifts.forEach(r => totalByVeh.set(r.regNumber, (totalByVeh.get(r.regNumber) ?? 0) + r.tripsCount));

  const renderUCell = (trips: number, hasData: boolean) => {
    if (trips > 0) return <div className="sv-gc f">{trips}</div>;
    if (hasData) return <div className="sv-gc gc-warn" title="0 рейсов">!</div>;
    return <div className="sv-gc gc-absent"></div>;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!needsNav) return;
    dragRef.current = { startX: e.clientX, startOffset: scrollOffset };
    e.preventDefault();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    const shift = Math.round(dx / 56);
    setScrollOffset(Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + shift)));
  };
  const onMouseUp = () => { dragRef.current = null; };

  if (vehicleMap.size === 0) return null;

  return (
    <div
      className="sv-gantt"
      onMouseMove={needsNav ? onMouseMove : undefined}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <table>
        <thead>
          <tr>
            <th className="sv-gantt-corner">
              <span className="sv-gantt-nav-group" onMouseDown={e => e.stopPropagation()}>
                <button
                  className={`sv-gantt-nav-btn sv-gantt-eye-btn${hideEmpty ? ' sv-gantt-eye-active' : ''}`}
                  onClick={() => { setHideEmpty(h => !h); setScrollOffset(0); }}
                  title={hideEmpty ? 'Показать все дни' : 'Скрыть пустые дни'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {hideEmpty ? (<>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>) : (<>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>)}
                  </svg>
                </button>
                {needsNav && (<>
                  <button className="sv-gantt-nav-btn" disabled={scrollOffset <= 0}
                    onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}>&#9664;</button>
                  <button className="sv-gantt-nav-btn" disabled={scrollOffset >= maxOffset}
                    onClick={() => setScrollOffset(Math.min(maxOffset, scrollOffset + 1))}>&#9654;</button>
                </>)}
              </span>
            </th>
            {visibleDates.map(d => (
              <th key={d} className="sv-gantt-date-h" colSpan={2}>{fmtDateShort(d)}</th>
            ))}
          </tr>
          <tr
            className={needsNav ? 'sv-gantt-draggable' : ''}
            onMouseDown={onMouseDown}
          >
            <th style={{ width: 150, minWidth: 150 }}></th>
            {visibleDates.map(d => (
              <React.Fragment key={d}><th>1</th><th>2</th></React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...vehicleMap.entries()]
            .sort(([, a], [, b]) => b.recs.reduce((s, r) => s + r.tripsCount, 0) - a.recs.reduce((s, r) => s + r.tripsCount, 0))
            .map(([reg, { name }]) => {
              const dm = cellMap.get(reg) ?? new Map();
              const total = totalByVeh.get(reg) ?? 0;
              return (
                <tr key={reg}>
                  <td>
                    <div className="sv-vehicle-name-cell">
                      <span className="sv-reg-num">{reg} <span className="sv-truck-trips">[{total}]</span></span>
                      <span className="sv-veh-model">{stripSamosvaly(name)}</span>
                    </div>
                  </td>
                  {visibleDates.map(d => {
                    const c = dm.get(d) ?? { s1: 0, s2: 0, s1has: false, s2has: false };
                    return (
                      <React.Fragment key={d}>
                        <td>{renderUCell(c.s1, c.s1has)}</td>
                        <td>{renderUCell(c.s2, c.s2has)}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Gantt table for an order
// ─────────────────────────────────────────────
/** Generate all dates between from and to (inclusive) */
function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from);
  const end = new Date(to);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

const GANTT_PAGE_SIZE = 16;

function GanttTable({ orderNumber, dateFromIso, dateToIso, ordersMap, theme }: {
  orderNumber: number; dateFromIso: string; dateToIso: string;
  ordersMap: Map<number, OrderCard>; theme: string;
}) {
  const [resp, setResp] = useState<GanttResponse | null>(null);
  const [err, setErr] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hideEmpty, setHideEmpty] = useState(false);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);

  type CellPopup =
    | { kind: 'trips'; shiftRecordId: number; shiftType: string; reportDate: string; x: number; y: number }
    | { kind: 'info'; text: string; x: number; y: number }
    | { kind: 'orderInfo'; orders: { number: number; cargo: string; dateFrom: string; dateTo: string }[]; x: number; y: number }
    | { kind: 'multiReq'; reqNumbers: number[]; x: number; y: number };

  const [cellPopup, setCellPopup] = useState<CellPopup | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchOrderGantt(orderNumber)
      .then(setResp)
      .catch(() => setErr(true));
  }, [orderNumber]);

  useEffect(() => { setScrollOffset(0); }, [hideEmpty]);

  // Close popup on outside click
  useEffect(() => {
    if (!cellPopup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setCellPopup(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cellPopup]);

  if (err) return <div className="sv-loading-cell" style={{ color: '#EF4444' }}>Ошибка загрузки</div>;
  if (!resp) return <div className="sv-loading-cell">Загрузка...</div>;

  const rows = resp.data;
  if (!rows.length) return <div className="sv-loading-cell">Нет данных</div>;

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Yekaterinburg' }).format(new Date());
  const datesWithData = new Set(rows.map(r => r.report_date));

  // Generate full date range: union of order dates + API (shift_records) dates + data dates
  const candidateDates: string[] = [];
  if (dateFromIso) candidateDates.push(dateFromIso);
  if (dateToIso) candidateDates.push(dateToIso);
  if (resp.dateFrom) candidateDates.push(resp.dateFrom);
  if (resp.dateTo) candidateDates.push(resp.dateTo);
  datesWithData.forEach(d => candidateDates.push(d));
  const rangeFrom = candidateDates.length ? candidateDates.sort()[0] : undefined;
  const rangeTo = candidateDates.length ? candidateDates.sort()[candidateDates.length - 1] : undefined;
  const allDates = (rangeFrom && rangeTo)
    ? generateDateRange(rangeFrom, rangeTo)
    : [...new Set(rows.map(r => r.report_date))].sort();

  const filteredDates = hideEmpty ? allDates.filter(d => datesWithData.has(d)) : allDates;
  const MIN_DATE_COLS = 7;
  const paddingCols = Math.max(0, MIN_DATE_COLS - filteredDates.length);

  const needsNav = filteredDates.length > GANTT_PAGE_SIZE;
  const maxOffset = needsNav ? filteredDates.length - GANTT_PAGE_SIZE : 0;
  const visibleDates = needsNav
    ? filteredDates.slice(scrollOffset, scrollOffset + GANTT_PAGE_SIZE)
    : filteredDates;

  // Collect vehicles
  const vehicleSet = new Map<string, string>();
  rows.forEach(r => vehicleSet.set(r.reg_number, r.name_mo));

  // Determine which object_uids belong to this order (from rows with trips)
  const orderObjectUids = new Set<string>();
  rows.forEach(r => {
    if (Number(r.trips_count) > 0 && r.object_uid) orderObjectUids.add(r.object_uid);
  });

  // Extended cell type
  type Cell = {
    s1: number; s2: number;
    s1work: string; s2work: string;
    s1mov: number; s2mov: number;
    s1has: boolean; s2has: boolean;
    s1id: number; s2id: number;
    s1reqCount: number; s2reqCount: number;
    s1reqNums: number[]; s2reqNums: number[];
    s1objUid: string; s2objUid: string;
  };
  const DEFAULT_CELL: Cell = { s1: 0, s2: 0, s1work: '', s2work: '', s1mov: 0, s2mov: 0, s1has: false, s2has: false, s1id: 0, s2id: 0, s1reqCount: 0, s2reqCount: 0, s1reqNums: [], s2reqNums: [], s1objUid: '', s2objUid: '' };

  const cellMap = new Map<string, Map<string, Cell>>();
  rows.forEach(r => {
    if (!cellMap.has(r.reg_number)) cellMap.set(r.reg_number, new Map());
    const dm = cellMap.get(r.reg_number)!;
    if (!dm.has(r.report_date)) dm.set(r.report_date, { ...DEFAULT_CELL });
    const cell = dm.get(r.report_date)!;
    const trips = Number(r.trips_count);
    const mov = Math.round(Number(r.movement_pct) || 0);
    const reqNums = r.request_numbers ?? [];
    const reqCount = reqNums.length;
    if (r.shift_type === 'shift1') {
      cell.s1 = trips; cell.s1work = r.work_type || ''; cell.s1mov = mov; cell.s1has = true;
      cell.s1id = Number(r.id); cell.s1reqCount = reqCount; cell.s1reqNums = reqNums; cell.s1objUid = r.object_uid || '';
    } else {
      cell.s2 = trips; cell.s2work = r.work_type || ''; cell.s2mov = mov; cell.s2has = true;
      cell.s2id = Number(r.id); cell.s2reqCount = reqCount; cell.s2reqNums = reqNums; cell.s2objUid = r.object_uid || '';
    }
  });

  // Total trips per vehicle
  const totalByVeh = new Map<string, number>();
  rows.forEach(r => totalByVeh.set(r.reg_number, (totalByVeh.get(r.reg_number) ?? 0) + Number(r.trips_count)));

  // Total trips per date (across all vehicles, both shifts)
  const totalByDate = new Map<string, number>();
  rows.forEach(r => totalByDate.set(r.report_date, (totalByDate.get(r.report_date) ?? 0) + Number(r.trips_count)));

  // Presence map: "→←" only for records on the order's object(s)
  const presenceMap = new Map<string, number[]>();
  (resp.presence ?? []).forEach(p => {
    if (!orderObjectUids.has(p.object_uid)) return;
    const key = `${p.reg_number}|${p.report_date}|${p.shift_type}`;
    const prev = presenceMap.get(key) ?? [];
    const nums = (p.request_numbers ?? []).filter(n => n !== orderNumber);
    presenceMap.set(key, [...new Set([...prev, ...nums])]);
  });

  // Object presence map: key → true (on order object) / false (not)
  const objPresMap = new Map<string, boolean>();
  rows.forEach(r => {
    objPresMap.set(`${r.reg_number}|${r.report_date}|${r.shift_type}`, true);
  });
  (resp.presence ?? []).forEach(p => {
    const key = `${p.reg_number}|${p.report_date}|${p.shift_type}`;
    if (!objPresMap.has(key)) {
      objPresMap.set(key, orderObjectUids.has(p.object_uid));
    }
  });

  // Transition tracking: departure / return / absent
  type Transition = { departure: boolean; return: boolean; absent: boolean };
  const transitionMap = new Map<string, Transition>();

  [...vehicleSet.keys()].forEach(reg => {
    const timeline: { key: string }[] = [];
    for (const d of allDates) {
      timeline.push({ key: `${reg}|${d}|shift1` });
      timeline.push({ key: `${reg}|${d}|shift2` });
    }

    const firstOnIdx = timeline.findIndex(t => objPresMap.get(t.key) === true);
    if (firstOnIdx < 0) return;

    let lastOnIdx = firstOnIdx;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (objPresMap.get(timeline[i]!.key) === true) { lastOnIdx = i; break; }
    }

    for (let i = firstOnIdx; i <= lastOnIdx; i++) {
      const cur = objPresMap.get(timeline[i]!.key) === true;
      const prev = i > 0 ? objPresMap.get(timeline[i - 1]!.key) === true : false;

      const isDeparture = prev && !cur;
      const isReturn = !prev && cur && i > firstOnIdx;
      const isAbsent = !cur;

      if (isDeparture || isReturn || isAbsent) {
        transitionMap.set(timeline[i]!.key, {
          departure: isDeparture,
          return: isReturn,
          absent: isAbsent,
        });
      }
    }
  });

  /** Compute popup position from click event */
  const popupPos = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.left, window.innerWidth - 420);
    const y = rect.bottom + 4 > window.innerHeight - 300
      ? Math.max(4, rect.top - 300)
      : rect.bottom + 4;
    return { x: Math.max(4, x), y };
  };

  /** Render a single gantt cell */
  const renderGanttCell = (
    trips: number, hasData: boolean, shiftId: number, shiftType: string, reportDate: string,
    reqCount: number, reqNums: number[], objUid: string, presKey: string,
  ) => {
    if (trips > 0 && reqCount > 1) {
      const otherNums = reqNums.filter(n => n !== orderNumber);
      return (
        <div className="sv-gc f multi" style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); setCellPopup({ kind: 'multiReq', reqNumbers: otherNums, ...popupPos(e) }); }}>
          ={trips}
        </div>
      );
    }
    if (trips > 0) {
      return (
        <div className="sv-gc f" style={{ cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); setCellPopup({ kind: 'trips', shiftRecordId: shiftId, shiftType, reportDate, ...popupPos(e) }); }}>
          {trips}
        </div>
      );
    }
    if (hasData && orderObjectUids.has(objUid)) {
      return (
        <div className="sv-gc gc-warn" style={{ cursor: 'pointer' }}
          title="На объекте, 0 рейсов"
          onClick={e => { e.stopPropagation(); setCellPopup({ kind: 'info', text: `Машина на объекте заявки, но 0 рейсов за эту смену (${shiftType === 'shift1' ? '1 смена' : '2 смена'}, ${fmtDateShort(reportDate)}).`, ...popupPos(e) }); }}>
          !
        </div>
      );
    }
    if (hasData && !orderObjectUids.has(objUid)) {
      return (
        <div className="sv-gc gc-not-on-obj" style={{ cursor: 'pointer' }}
          title="Есть в ПЛ, но НЕ на объекте заявки"
          onClick={e => { e.stopPropagation(); setCellPopup({ kind: 'info', text: `Машина в путевом листе, но НЕ на объекте заявки (${shiftType === 'shift1' ? '1 смена' : '2 смена'}, ${fmtDateShort(reportDate)}).`, ...popupPos(e) }); }}>
          —
        </div>
      );
    }
    if (presenceMap.has(presKey)) {
      const nums = presenceMap.get(presKey)!;
      if (nums.length > 0) {
        const orderInfos = nums.map(n => {
          const o = ordersMap.get(n);
          return { number: n, cargo: o?.cargo ?? '—', dateFrom: o?.dateFrom ?? '', dateTo: o?.dateTo ?? '' };
        });
        return (
          <div className="sv-gc gc-other-order" style={{ cursor: 'pointer' }}
            title={nums.map(n => `#${n}`).join(', ')}
            onClick={e => { e.stopPropagation(); setCellPopup({ kind: 'orderInfo', orders: orderInfos, ...popupPos(e) }); }}>
            →←
          </div>
        );
      }
      return <div className="sv-gc gc-onsite" title="На объекте без заявки">?</div>;
    }
    return <div className="sv-gc gc-absent" title="Не на объекте"></div>;
  };

  // Drag-to-scroll handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if (!needsNav) return;
    dragRef.current = { startX: e.clientX, startOffset: scrollOffset };
    e.preventDefault();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    const colWidth = 56;
    const shift = Math.round(dx / colWidth);
    setScrollOffset(Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + shift)));
  };
  const onMouseUp = () => { dragRef.current = null; };

  return (
    <div
      className="sv-gantt"
      onMouseMove={needsNav ? onMouseMove : undefined}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <table>
        <thead>
          <tr>
            <th className="sv-gantt-corner">
              <span className="sv-gantt-nav-group" onMouseDown={e => e.stopPropagation()}>
                <button
                  className={`sv-gantt-nav-btn sv-gantt-eye-btn${hideEmpty ? ' sv-gantt-eye-active' : ''}`}
                  onClick={() => setHideEmpty(h => !h)}
                  title={hideEmpty ? 'Показать все дни' : 'Скрыть пустые дни'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {hideEmpty ? (<>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>) : (<>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>)}
                  </svg>
                </button>
                {needsNav && (<>
                  <button
                    className="sv-gantt-nav-btn"
                    disabled={scrollOffset <= 0}
                    onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}
                  >&#9664;</button>
                  <button
                    className="sv-gantt-nav-btn"
                    disabled={scrollOffset >= maxOffset}
                    onClick={() => setScrollOffset(Math.min(maxOffset, scrollOffset + 1))}
                  >&#9654;</button>
                </>)}
              </span>
            </th>
            {visibleDates.map(d => {
              const dt = totalByDate.get(d) ?? 0;
              const emptyPast = !datesWithData.has(d) && d < today;
              return (
                <th key={d} className={`sv-gantt-date-h${emptyPast ? ' sv-gantt-empty-past' : ''}`} colSpan={2}>
                  {fmtDateShort(d)}{dt > 0 && <span className="sv-truck-trips"> [{dt}]</span>}
                </th>
              );
            })}
            {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
              <th key={`pad-${i}`} colSpan={2}></th>
            ))}
          </tr>
          <tr
            className={needsNav ? 'sv-gantt-draggable' : ''}
            onMouseDown={onMouseDown}
          >
            <th style={{ width: 150, minWidth: 150 }}></th>
            {visibleDates.map(d => {
              const emptyPast = !datesWithData.has(d) && d < today;
              return (
                <React.Fragment key={d}>
                  <th className={emptyPast ? 'sv-gantt-empty-past' : ''}>1</th>
                  <th className={emptyPast ? 'sv-gantt-empty-past' : ''}>2</th>
                </React.Fragment>
              );
            })}
            {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
              <React.Fragment key={`pad-${i}`}><th></th><th></th></React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...vehicleSet.entries()].map(([reg, name]) => {
            const dm = cellMap.get(reg) ?? new Map();
            const total = totalByVeh.get(reg) ?? 0;
            return (
              <tr key={reg}>
                <td>
                  <div className="sv-vehicle-name-cell">
                    <span className="sv-reg-num">{reg} <span className="sv-truck-trips">[{total}]</span></span>
                    <span className="sv-veh-model">{stripSamosvaly(name)}</span>
                  </div>
                </td>
                {visibleDates.map(d => {
                  const cell = dm.get(d) ?? DEFAULT_CELL;
                  const emptyPast = !datesWithData.has(d) && d < today;
                  const s1key = `${reg}|${d}|shift1`;
                  const s2key = `${reg}|${d}|shift2`;
                  const t1 = transitionMap.get(s1key);
                  const t2 = transitionMap.get(s2key);

                  const tdClass1 = [
                    emptyPast && 'sv-gantt-empty-past',
                    t1?.absent && 'sv-obj-absent',
                    t1?.departure && 'sv-obj-depart',
                    t1?.return && 'sv-obj-return',
                  ].filter(Boolean).join(' ');

                  const tdClass2 = [
                    emptyPast && 'sv-gantt-empty-past',
                    t2?.absent && 'sv-obj-absent',
                    t2?.departure && 'sv-obj-depart',
                    t2?.return && 'sv-obj-return',
                  ].filter(Boolean).join(' ');

                  return (
                    <React.Fragment key={d}>
                      <td className={tdClass1}>{renderGanttCell(cell.s1, cell.s1has, cell.s1id, 'shift1', d, cell.s1reqCount, cell.s1reqNums, cell.s1objUid, s1key)}</td>
                      <td className={tdClass2}>{renderGanttCell(cell.s2, cell.s2has, cell.s2id, 'shift2', d, cell.s2reqCount, cell.s2reqNums, cell.s2objUid, s2key)}</td>
                    </React.Fragment>
                  );
                })}
                {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
                  <React.Fragment key={`pad-${i}`}><td></td><td></td></React.Fragment>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Cell popup portal */}
      {cellPopup && createPortal(
        <div ref={popupRef} className="sv-gg-popup" data-theme={theme}
          style={{ left: cellPopup.x, top: cellPopup.y }}
          onClick={e => e.stopPropagation()}>
          {cellPopup.kind === 'trips' && (
            <ShiftSubTable shiftRecord={{ id: cellPopup.shiftRecordId, shiftType: cellPopup.shiftType, reportDate: cellPopup.reportDate } as ShiftRecord} />
          )}
          {cellPopup.kind === 'info' && (
            <div className="sv-cell-info-popup">{cellPopup.text}</div>
          )}
          {cellPopup.kind === 'orderInfo' && (
            <div className="sv-cell-info-popup">
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 10 }}>Работа по другой заявке:</div>
              {cellPopup.orders.map(o => (
                <div key={o.number} style={{ fontSize: 11, marginBottom: 2 }}>
                  <b>#{o.number}</b> — {o.cargo}{o.dateFrom ? ` \u00b7 ${o.dateFrom}\u2013${o.dateTo}` : ''}
                </div>
              ))}
            </div>
          )}
          {cellPopup.kind === 'multiReq' && (
            <div className="sv-cell-info-popup">
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 10 }}>Работа по нескольким заявкам:</div>
              {cellPopup.reqNumbers.map(n => {
                const o = ordersMap.get(n);
                return (
                  <div key={n} style={{ fontSize: 11, marginBottom: 2 }}>
                    <b>#{n}</b> — {o?.cargo ?? '—'}{o?.dateFrom ? ` \u00b7 ${o.dateFrom}\u2013${o.dateTo}` : ''}
                  </div>
                );
              })}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Order card
// ─────────────────────────────────────────────
function OrderCardView({ card, expanded, onToggle, ordersMap, theme }: {
  card: OrderCard;
  expanded: boolean;
  onToggle: () => void;
  ordersMap: Map<number, OrderCard>;
  theme: string;
}) {
  const pc = card.isDone ? '#22c55e' : '#3B82F6';
  // Факт: 24т и 15м³ за рейс (константа для самосвала)
  const weightActual = Math.round(card.actualTrips * 24);
  const volActual    = Math.round(card.actualTrips * 15);
  const tripsPerTs   = card.vehicles.length > 0 ? Math.round(card.actualTrips / card.vehicles.length * 10) / 10 : 0;

  return (
    <div
      className={`sv-order-card ${card.isDone ? 'done sv-order-done' : 'sv-order-active'} ${expanded ? 'expanded' : ''}`}
    >
      <div className="sv-order-content" onClick={onToggle}>
        <div className="sv-order-label-area">
          <div className="sv-order-num">
            <span>Заявка #{card.number}</span>
          </div>
          <div className="sv-order-route-two">
            <div className="sv-route-line" title={card.routeFrom}>→ {card.routeFrom}</div>
            <div className="sv-route-line" title={card.routeTo}>← {card.routeTo}</div>
          </div>
        </div>
        <div className="sv-order-data-area">
          <div className="sv-order-progress-fill" style={{ width: `${card.pct}%` }} />
          <div className="sv-order-badges">
            <span className="sv-badge-sm sv-badge-pct">{card.pct}%</span>
            <span className={`sv-badge-sm ${card.isDone ? 'sv-badge-done' : 'sv-badge-active'}`}>
              {card.isDone ? '✓ закрыто' : '● работа'}
            </span>
          </div>
          <div className="sv-order-data-inner">
            <div className="sv-order-meta">
              <div className="sv-om-item"><div className="sv-om-label">Даты</div><div className="sv-om-val">{card.dateFrom}—{card.dateTo}</div></div>
              {card.cargo !== '—' && <div className="sv-om-item"><div className="sv-om-label">Груз</div><div className="sv-om-val">{card.cargo}</div></div>}
              <div className="sv-om-item"><div className="sv-om-label">Рейсы</div><div className="sv-om-val"><Fraction actual={card.actualTrips} planned={card.planTrips} unit="" /></div></div>
              {card.countTs > 0 && <div className="sv-om-item"><div className="sv-om-label">ТС</div><div className="sv-om-val"><Fraction actual={card.vehicles.length} planned={card.countTs} unit="" /></div></div>}
              {card.countTs === 0 && <div className="sv-om-item"><div className="sv-om-label">ТС</div><div className="sv-om-val">{card.vehicles.length}</div></div>}
              {card.weightTotal > 0 && <div className="sv-om-item"><div className="sv-om-label">Вес</div><div className="sv-om-val"><Fraction actual={weightActual} planned={card.weightTotal} unit="т" /></div></div>}
              {card.volumeTotal > 0 && <div className="sv-om-item"><div className="sv-om-label">Объём</div><div className="sv-om-val"><Fraction actual={volActual} planned={card.volumeTotal} unit="м³" /></div></div>}
              {card.routeDistance > 0 && <div className="sv-om-item"><div className="sv-om-label">Расстояние</div><div className="sv-om-val">{Math.round(card.routeDistance / 1000)} км</div></div>}
              <div className="sv-om-item"><div className="sv-om-label">ПЛ</div><div className="sv-om-val">{card.plCount}</div></div>
            </div>
            <div className="sv-order-foot">
              <div className="sv-order-obj">
                <b>Объект</b>
                {card.objectExpend || card.objectNames[0] || '—'}
                {(card.notes || card.comment) && (
                  <span className="sv-order-icons" onClick={e => e.stopPropagation()}>
                    {card.notes && <PopoverIcon icon="&#x1F4CB;" label="Описание" text={card.notes} />}
                    {card.comment && <PopoverIcon icon="&#x1F4AC;" label="Комментарий" text={card.comment} />}
                  </span>
                )}
              </div>
              {card.vehicles.length > 0 && (
                <div className="sv-ow-item">
                  <span className="sv-ow-val" style={{ color: pc }}>{tripsPerTs}</span>
                  <span className="sv-ow-unit">рейс/ТС</span>
                </div>
              )}
            </div>
          </div>
          <div className="sv-progress-bar-mini">
            <div className="sv-progress-bar-mini-fill" style={{ width: `${card.pct}%`, background: pc }} />
          </div>
        </div>
        <svg className="sv-expand-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <div className={`sv-gantt-wrap ${expanded ? 'open' : ''}`}>
        {expanded && <GanttTable orderNumber={card.number} dateFromIso={card.dateFromIso} dateToIso={card.dateToIso} ordersMap={ordersMap} theme={theme} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Weekly sidebar
// ─────────────────────────────────────────────
const OBJ_COLORS = ['#F97316', '#3B82F6', '#A78BFA', '#E11D48', '#22c55e'];

function WeeklySidebar({ shiftRecords, repairs, initialDateFrom }: {
  shiftRecords: ShiftRecord[];
  repairs: Repair[];
  initialDateFrom: string;
}) {
  const [collapsedObjs, setCollapsedObjs] = useState<Set<string>>(new Set());
  const [expandedVeh, setExpandedVeh] = useState<Set<string>>(new Set());
  const [weekOffset, setWeekOffset] = useState(() => {
    const base = new Date(initialDateFrom + 'T00:00:00');
    const diff = Math.floor((base.getTime() - getMonday(new Date()).getTime()) / (7 * 86400 * 1000));
    return diff;
  });
  const onWeekChange = (d: number) => setWeekOffset(prev => prev + d);

  const mon = addDays(getMonday(new Date()), weekOffset * 7);
  const sun = addDays(mon, 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monIso = isoDate(mon);
  const sunIso = isoDate(sun);

  // Filter records for this week
  const weekRecords = shiftRecords.filter(r => {
    const d = toDateStr(r.reportDate);
    return d >= monIso && d <= sunIso;
  });

  // Group by objectName
  const objMap = new Map<string, ShiftRecord[]>();
  weekRecords.forEach(r => {
    const key = r.objectName ?? 'Прочие';
    if (!objMap.has(key)) objMap.set(key, []);
    objMap.get(key)!.push(r);
  });
  const objList = [...objMap.entries()];

  const toggleObj = (name: string) => {
    setCollapsedObjs(prev => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });
  };
  const toggleVeh = (key: string) => {
    setExpandedVeh(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  };

  // Repairs for this week (date_from <= sunIso AND (date_to IS NULL OR date_to >= monIso))
  const weekRepairs = (objName: string) =>
    repairs.filter(r =>
      (r.object_name === objName || !r.object_name) &&
      r.date_from <= sunIso &&
      (!r.date_to || r.date_to >= monIso)
    );

  return (
    <div className="sv-stats-panel">
      <div className="sv-week-nav">
        <button className="sv-week-nav-btn" onClick={() => onWeekChange(-1)}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div className="sv-week-title">{fmt(mon)} — {fmt(sun)}</div>
          <div className="sv-week-sub">
            {weekOffset === 0 ? 'пн — вс · текущая' : `пн — вс · ${weekOffset > 0 ? '+' : ''}${weekOffset} нед.`}
          </div>
        </div>
        <button className="sv-week-nav-btn" onClick={() => onWeekChange(1)}>›</button>
      </div>

      <div className="sv-weekly-body">
        {objList.length === 0 && (
          <div className="sv-empty">
            <span className="sv-empty-icon">📭</span>
            <span className="sv-empty-text">Нет данных за эту неделю</span>
          </div>
        )}
        {objList.map(([objName, recs], oi) => {
          const color = OBJ_COLORS[oi % OBJ_COLORS.length];
          const collapsed = collapsedObjs.has(objName);
          const veKey = `ve_${oi}`;
          const veOpen = expandedVeh.has(veKey);

          // KPI aggregates
          const trips = recs.reduce((s, r) => s + r.tripsCount, 0);
          const trucks = new Set(recs.map(r => r.regNumber)).size;
          const kip1Recs = recs.filter(r => r.shiftType === 'shift1');
          const kip2Recs = recs.filter(r => r.shiftType === 'shift2' && r.kipPct > 0);
          const kip1Avg = kip1Recs.length ? Math.round(kip1Recs.reduce((s, r) => s + r.kipPct, 0) / kip1Recs.length) : 0;
          const mov1Avg = kip1Recs.length ? Math.round(kip1Recs.reduce((s, r) => s + r.movementPct, 0) / kip1Recs.length) : 0;
          const mov2Avg = kip2Recs.length ? Math.round(kip2Recs.reduce((s, r) => s + r.movementPct, 0) / kip2Recs.length) : 0;
          const has2 = kip2Recs.length > 0;

          // Per vehicle trips
          const vehMap = new Map<string, { name: string; trips: number }>();
          recs.forEach(r => {
            if (!vehMap.has(r.regNumber)) vehMap.set(r.regNumber, { name: r.nameMO ?? r.regNumber, trips: 0 });
            vehMap.get(r.regNumber)!.trips += r.tripsCount;
          });

          const objRepairs = weekRepairs(objName);

          return (
            <div key={objName} className={`sv-obj-section ${collapsed ? 'collapsed' : ''}`}>
              <div className="sv-obj-header" onClick={() => toggleObj(objName)}>
                <div className="sv-obj-dot" style={{ background: color }} />
                <div className="sv-obj-name">{objName}</div>
                <span className="sv-obj-toggle">▾</span>
              </div>
              <div className="sv-obj-body">
                {/* KPI cards */}
                <div className="sv-kpi-mini-row">
                  <div className="sv-kpi-mini">
                    <div className="sv-kpi-mini-label">Самосвалов</div>
                    <div className="sv-kpi-mini-val" style={{ color: '#3B82F6' }}>{trucks}</div>
                  </div>
                  <div className="sv-kpi-mini">
                    <div className="sv-kpi-mini-label">Рейсов</div>
                    <div className="sv-kpi-mini-val" style={{ color: '#22c55e' }}>{trips}</div>
                  </div>
                </div>

                {/* Repairs */}
                {objRepairs.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div className="sv-repair-header">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--sv-text-4)' }}>
                        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                      </svg>
                      <span className="sv-repair-title">В ремонте</span>
                      <span className="sv-repair-count">{objRepairs.length}</span>
                    </div>
                    {objRepairs.map(rep => (
                      <div key={rep.id} className="sv-repair-card">
                        <div className={`sv-repair-stripe ${rep.type === 'maintenance' ? 'orange' : 'red'}`} />
                        <div className="sv-repair-body">
                          <div className="sv-repair-info">
                            <div className="sv-repair-name">{rep.name_mo ?? rep.reg_number}</div>
                            <div className="sv-repair-reason">{rep.reason ?? '—'}</div>
                          </div>
                          <div className="sv-repair-dates">
                            <div className="sv-repair-date-from">{fmtDate(rep.date_from)}</div>
                            <div className="sv-repair-date-to">→ {rep.date_to ? fmtDate(rep.date_to) : '...'}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Donuts */}
                <div style={{ marginTop: 8 }}>
                  <div className="sv-donut-mini-row">
                    <div className="sv-donut-mini-wrap">
                      <div className="sv-donut-mini-label">1 смена</div>
                      {mov1Avg > 0 ? <MiniDonut mov={mov1Avg} /> : <span style={{ fontSize: 9, color: 'var(--sv-text-4)' }}>—</span>}
                    </div>
                    <div className="sv-donut-mini-wrap">
                      <div className="sv-donut-mini-label">2 смена</div>
                      {has2 && mov2Avg > 0 ? <MiniDonut mov={mov2Avg} /> : <span style={{ fontSize: 9, color: 'var(--sv-text-4)' }}>—</span>}
                    </div>
                  </div>
                  <div className="sv-donut-mini-legend">
                    <div className="sv-leg-i"><div className="sv-leg-d" style={{ background: '#22c55e' }} />Движение</div>
                    <div className="sv-leg-i"><div className="sv-leg-d" style={{ background: '#EF4444' }} />Стоянка</div>
                  </div>
                </div>

                {/* H-bars */}
                <div className="sv-hbar-section">
                  {kip1Avg > 0 && (
                    <div className="sv-hbar-item">
                      <div className="sv-hbar-top">
                        <span className="sv-hbar-label">КИП</span>
                        <span className="sv-hbar-val">{kip1Avg}%</span>
                      </div>
                      <div className="sv-hbar-track">
                        <div className="sv-hbar-fill" style={{ width: `${kip1Avg}%`, background: 'linear-gradient(90deg,#3B82F6,#60A5FA)' }} />
                      </div>
                    </div>
                  )}
                  <div className="sv-hbar-item">
                    <div className="sv-hbar-top">
                      <span className="sv-hbar-label">Рейсы</span>
                      <span className="sv-hbar-val">{trips}</span>
                    </div>
                    <div className="sv-hbar-track">
                      <div className="sv-hbar-fill" style={{ width: `${Math.min(100, trips / Math.max(1, trips) * 100)}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)' }} />
                    </div>
                  </div>
                </div>

                {/* Per-vehicle list */}
                <button
                  className={`sv-veh-expand-btn ${veOpen ? 'open' : ''}`}
                  onClick={e => { e.stopPropagation(); toggleVeh(veKey); }}
                >
                  <span className="arrow">▶</span> По машинам ({vehMap.size})
                </button>
                <div className={`sv-veh-list ${veOpen ? 'open' : ''}`}>
                  {[...vehMap.entries()].map(([reg, { name, trips: vt }]) => (
                    <div key={reg} className="sv-veh-bar-item">
                      <span className="sv-veh-bar-name">{name}</span>
                      <div className="sv-veh-bar-track">
                        <div className="sv-veh-bar-fill" style={{ width: '100%' }} />
                      </div>
                      <span className="sv-veh-bar-pct">{vt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Analytics sub-table (trips + zone events)
// ─────────────────────────────────────────────
function ShiftSubTable({ shiftRecord }: {
  shiftRecord: Pick<ShiftRecord, 'id' | 'shiftType' | 'reportDate'>;
}) {
  const [data, setData] = useState<{ trips: TripRecord[]; zoneEvents: ZoneEvent[] } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetchShiftDetail(shiftRecord.id)
      .then(setData)
      .catch(() => setErr(true));
  }, [shiftRecord.id]);

  const shiftN = shiftRecord.shiftType === 'shift1' ? 1 : 2;

  if (err) return <div style={{ padding: 8, fontSize: 11, color: '#EF4444' }}>Ошибка загрузки рейсов</div>;
  if (!data) return <div style={{ padding: 8, fontSize: 11, color: 'var(--sv-text-4)' }}>Загрузка...</div>;

  const { trips, zoneEvents } = data;

  if (!trips.length) return (
    <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--sv-text-4)' }}>
      Смена {shiftN} · нет рейсов
    </div>
  );

  const loadEvents  = zoneEvents.filter(e => e.zone_tag === 'dt_loading');
  const unloadEvents = zoneEvents.filter(e => e.zone_tag === 'dt_unloading');

  type EnrichedTrip = {
    trip: TripRecord;
    pIn: string; pOut: string; pStSec: number | null;
    uIn: string; uOut: string; uStSec: number | null;
  };

  const enriched: EnrichedTrip[] = trips.map(trip => {
    const loadedAt   = trip.loaded_at   ? new Date(trip.loaded_at).getTime()   : null;
    const unloadedAt = trip.unloaded_at ? new Date(trip.unloaded_at).getTime() : null;

    const le = loadedAt
      ? loadEvents.reduce<ZoneEvent | null>((best, e) => {
          if (!e.exited_at) return best;
          const diff = Math.abs(new Date(e.exited_at).getTime() - loadedAt);
          if (!best || !best.exited_at) return diff < 5 * 60000 ? e : best;
          return diff < Math.abs(new Date(best.exited_at).getTime() - loadedAt) ? e : best;
        }, null)
      : null;

    const ue = unloadedAt
      ? unloadEvents.reduce<ZoneEvent | null>((best, e) => {
          if (!e.exited_at) return best;
          const diff = Math.abs(new Date(e.exited_at).getTime() - unloadedAt);
          if (!best || !best.exited_at) return diff < 5 * 60000 ? e : best;
          return diff < Math.abs(new Date(best.exited_at).getTime() - unloadedAt) ? e : best;
        }, null)
      : null;

    return {
      trip,
      pIn:    le?.entered_at ? fmtTime(le.entered_at) : '—',
      pOut:   trip.loaded_at   ? fmtTime(trip.loaded_at)   : '—',
      pStSec: le?.duration_sec ?? null,
      uIn:    ue?.entered_at ? fmtTime(ue.entered_at) : '—',
      uOut:   trip.unloaded_at ? fmtTime(trip.unloaded_at) : '—',
      uStSec: ue?.duration_sec ?? null,
    };
  });

  const pStSecs = enriched.map(e => e.pStSec).filter((s): s is number => s !== null && s > 0);
  const uStSecs = enriched.map(e => e.uStSec).filter((s): s is number => s !== null && s > 0);
  const avgPSt = pStSecs.length ? Math.round(pStSecs.reduce((a, b) => a + b, 0) / pStSecs.length) : null;
  const avgUSt = uStSecs.length ? Math.round(uStSecs.reduce((a, b) => a + b, 0) / uStSecs.length) : null;
  const ttuVals = trips.map(t => t.travel_to_unload_min).filter((v): v is number => v !== null && v > 0);
  const rtlVals = trips.map(t => t.return_to_load_min).filter((v): v is number => v !== null && v > 0);
  const avgTtu = ttuVals.length ? Math.round(ttuVals.reduce((a, b) => a + b, 0) / ttuVals.length) : null;
  const avgRtl = rtlVals.length ? Math.round(rtlVals.reduce((a, b) => a + b, 0) / rtlVals.length) : null;
  const centerIdx = Math.floor(enriched.length / 2);

  return (
    <div className="sv-sub-table-wrap">
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-2)', marginBottom: 4 }}>
        Смена {shiftN} · {fmtDateShort(shiftRecord.reportDate)} · {trips.length} рейсов
      </div>
      <table className="sv-sub-t sv-sub-t--compact">
        <thead>
          <tr>
            <th rowSpan={2}>№</th>
            <th className="blk-start" colSpan={3} style={{ fontSize: 7, color: 'var(--sv-text-4)' }}>ПОГРУЗКА</th>
            <th className="blk-start" colSpan={3} style={{ fontSize: 7, color: 'var(--sv-text-4)' }}>ВЫГРУЗКА</th>
            <th className="blk-start" rowSpan={2}>Ср.П</th>
            <th rowSpan={2}>Ср.В</th>
            <th className="blk-start" rowSpan={2}>→ Выгр.</th>
            <th rowSpan={2}>→ Погр.</th>
          </tr>
          <tr>
            <th className="blk-start">Въезд</th>
            <th>Выезд</th>
            <th className="dash-l">Ст.</th>
            <th className="blk-start">Въезд</th>
            <th>Выезд</th>
            <th className="dash-l">Ст.</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map(({ trip, pIn, pOut, pStSec, uIn, uOut, uStSec }, ri) => {
            const isFirst = ri === 0;
            const isLast  = ri === enriched.length - 1;
            return (
              <tr key={trip.id}>
                <td className="trip-n">{trip.trip_number}</td>
                <td className="blk-start">
                  {isFirst
                    ? <><span style={{ color: '#22c55e', fontWeight: 800, marginRight: 2 }}>{'›|'}</span>{pIn}</>
                    : pIn}
                </td>
                <td>{pOut}</td>
                <td className="dash-l">{fmtDwell(pStSec)}</td>
                <td className="blk-start">{uIn}</td>
                <td>
                  {isLast
                    ? <>{uOut}<span style={{ color: '#EF4444', fontWeight: 800, marginLeft: 2 }}>{'|‹'}</span></>
                    : uOut}
                </td>
                <td className="dash-l">{fmtDwell(uStSec)}</td>
                <td className="blk-start">{ri === centerIdx ? fmtDwell(avgPSt) : ''}</td>
                <td>{ri === centerIdx ? fmtDwell(avgUSt) : ''}</td>
                <td className="blk-start">{ri === centerIdx ? (avgTtu ? `${avgTtu}м` : '—') : ''}</td>
                <td>{ri === centerIdx ? (avgRtl ? `${avgRtl}м` : '—') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Analytics tab
// ─────────────────────────────────────────────
// Общий период (для обоих табов)
interface PeriodState {
  dateFrom: string;
  dateTo: string;
}

// Фильтры только для вкладки Аналитика
interface AnalyticsFilters {
  shift: 'all' | 'shift1' | 'shift2';
  objectUid: string;
  showOnsite: boolean;
}

// Агрегаты по набору записей
function aggRecs(recs: ShiftRecord[]) {
  const engineSec  = recs.reduce((s, r) => s + r.engineTimeSec, 0);
  const movingSec  = recs.reduce((s, r) => s + r.movingTimeSec, 0);
  const onsiteMin  = recs.reduce((s, r) => s + r.onsiteMin, 0);
  const lds = recs.map(r => r.avgLoadingDwellSec).filter((v): v is number => v !== null && v > 0);
  const uds = recs.map(r => r.avgUnloadingDwellSec).filter((v): v is number => v !== null && v > 0);
  const avgLoad   = lds.length   ? Math.round(lds.reduce((a, b) => a + b, 0) / lds.length)   : null;
  const avgUnload = uds.length   ? Math.round(uds.reduce((a, b) => a + b, 0) / uds.length)   : null;
  const ttus = recs.map(r => r.avgTravelToUnloadMin).filter((v): v is number => v !== null && v > 0);
  const rtls = recs.map(r => r.avgReturnToLoadMin).filter((v): v is number => v !== null && v > 0);
  const avgTravelToUnload = ttus.length ? Math.round(ttus.reduce((a, b) => a + b, 0) / ttus.length) : null;
  const avgReturnToLoad   = rtls.length ? Math.round(rtls.reduce((a, b) => a + b, 0) / rtls.length) : null;
  return { engineSec, movingSec, onsiteMin, avgLoad, avgUnload, avgTravelToUnload, avgReturnToLoad };
}


const _today = new Date();
const DEFAULT_DATE_FROM = new Date(_today.getFullYear(), _today.getMonth(), 1).toISOString().slice(0, 10);
const DEFAULT_DATE_TO   = _today.toISOString().slice(0, 10);

// Helper: render a single cell value for a given column in a given block
function renderCell(
  colId: string,
  recs: ShiftRecord[],
  level: 'vehicle' | 'order' | 'day',
  ctx: {
    regNumber?: string; nameMO?: string;
    reqNum?: string; objName?: string;
    date?: string;
    s1Rec?: ShiftRecord; s2Rec?: ShiftRecord;
  }
): React.ReactNode {
  const totalTrips = recs.reduce((s, r) => s + r.tripsCount, 0);
  const s1Recs = recs.filter(r => r.shiftType === 'shift1');
  const s2Recs = recs.filter(r => r.shiftType === 'shift2' && r.kipPct > 0);
  const ak1 = avgOrDash(s1Recs.map(r => r.kipPct));
  const am1 = avgOrDash(s1Recs.map(r => r.movementPct));
  const ak2 = avgOrDash(s2Recs.map(r => r.kipPct));
  const am2 = avgOrDash(s2Recs.map(r => r.movementPct));
  const agg = aggRecs(recs);
  const s1trips = s1Recs.reduce((s, r) => s + r.tripsCount, 0);
  const s2trips = s2Recs.reduce((s, r) => s + r.tripsCount, 0);

  switch (colId) {
    case 'requestNumber': return <span style={{ fontSize: 10 }}>{ctx.reqNum ?? '—'}</span>;
    case 'objectName': return <span style={{ fontSize: 10 }}>{ctx.objName ?? '—'}</span>;
    case 'shift1Trips': return <span style={{ fontWeight: 600 }}>{s1trips || '—'}</span>;
    case 'shift2Trips': return <span style={{ fontWeight: 600 }}>{s2trips || '—'}</span>;
    case 'totalTrips': return <span style={{ fontWeight: 700, color: '#F97316' }}>{totalTrips || '—'}</span>;
    case 'kip1': return <span className={ak1 !== '—' ? kipColor(Number(ak1)) : ''}>{ak1}</span>;
    case 'kip2': return <span className={ak2 !== '—' ? kipColor(Number(ak2)) : ''}>{ak2}</span>;
    case 'movement1': return <span className={am1 !== '—' ? kipColor(Number(am1)) : ''}>{am1}</span>;
    case 'movement2': return <span className={am2 !== '—' ? kipColor(Number(am2)) : ''}>{am2}</span>;
    case 'engineTotal': return <span className="sv-td-agg">{fmtHours(agg.engineSec)}</span>;
    case 'movingTotal': return <span className="sv-td-agg">{fmtHours(agg.movingSec)}</span>;
    case 'onsiteMin': return <span className="sv-td-agg">{agg.onsiteMin > 0 ? `${agg.onsiteMin}м` : '—'}</span>;
    case 'avgLoadingDwell': return <span className="sv-td-agg">{fmtDwell(agg.avgLoad)}</span>;
    case 'avgUnloadingDwell': return <span className="sv-td-agg">{fmtDwell(agg.avgUnload)}</span>;
    case 'travelToUnload': return <span className="sv-td-agg">{agg.avgTravelToUnload ? `${agg.avgTravelToUnload}м` : '—'}</span>;
    case 'returnToLoad': return <span className="sv-td-agg">{agg.avgReturnToLoad ? `${agg.avgReturnToLoad}м` : '—'}</span>;
    case 'shiftsCount': return <span>{recs.length}</span>;
    default: return '—';
  }
}

function getVisibleCols(settings: UserSettings, blockId: BlockId): string[] {
  const validIds = new Set(BLOCK_COLUMNS[blockId].map(c => c.id));
  const order = settings.columnOrder[blockId] ?? BLOCK_COLUMNS[blockId].map(c => c.id);
  return order.filter(c => validIds.has(c) && settings.columnVisibility[blockId]?.[c] !== false);
}

function getVisibleBlocks(settings: UserSettings): BlockId[] {
  return settings.blockOrder.filter(b => settings.blockVisibility[b]);
}

// Count total rendered columns
function countCols(settings: UserSettings): number {
  return 1 + getVisibleBlocks(settings).reduce((s, b) => s + getVisibleCols(settings, b).length, 0);
}

const BLOCK_HEADER_COLORS: Record<BlockId, string> = {
  identity:   'sv-th-g1',
  work:       'sv-th-g3',
  kpi:        'sv-th-g4',
  aggregates: 'sv-th-g5',
};

function AnalyticsTab({ objects, period, filters, onFiltersChange, records, loading, settings }: {
  objects: DtObject[];
  period: PeriodState;
  filters: AnalyticsFilters;
  onFiltersChange: (f: AnalyticsFilters) => void;
  records: ShiftRecord[];
  loading: boolean;
  settings: UserSettings;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const togOrder = (key: string) => setExpanded(prev => {
    const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s;
  });
  const togDay = (key: string) => setExpandedDays(prev => {
    const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // Apply client-side filters
  const filteredRecords = records.filter(r => {
    if (filters.shift !== 'all' && r.shiftType !== filters.shift) return false;
    if (filters.objectUid && r.objectUid !== filters.objectUid) return false;
    if (!filters.showOnsite && r.workType !== 'delivery') return false;
    return true;
  });

  // Group records: vehicle → (order) → day → shift
  const vehicleMap = new Map<string, { nameMO: string; records: ShiftRecord[] }>();
  filteredRecords.forEach(r => {
    const key = r.regNumber;
    if (!vehicleMap.has(key)) vehicleMap.set(key, { nameMO: r.nameMO ?? key, records: [] });
    vehicleMap.get(key)!.records.push(r);
  });

  type OrderGroup = { reqNum: string; objName: string; records: ShiftRecord[] };
  type VehicleRow = { regNumber: string; nameMO: string; orders: OrderGroup[]; allRecs: ShiftRecord[] };

  let vehicleRows: VehicleRow[] = [...vehicleMap.entries()].map(([reg, { nameMO, records: vRecs }]) => {
    const orderMap = new Map<string, OrderGroup>();
    vRecs.forEach(r => {
      const nums = Array.isArray(r.requestNumbers) ? r.requestNumbers : [];
      const reqKey = settings.groupByRequest && nums.length > 0 ? String(nums[0]) : '—';
      if (!orderMap.has(reqKey)) orderMap.set(reqKey, { reqNum: reqKey, objName: r.objectName ?? '—', records: [] });
      orderMap.get(reqKey)!.records.push(r);
    });
    return { regNumber: reg, nameMO, orders: [...orderMap.values()], allRecs: vRecs };
  });

  // Sort vehicle rows
  if (sortCol) {
    vehicleRows = [...vehicleRows].sort((a, b) => {
      const getVal = (row: VehicleRow): number => {
        const recs = row.allRecs;
        switch (sortCol) {
          case 'totalTrips': return recs.reduce((s, r) => s + r.tripsCount, 0);
          case 'kip1': return Number(avgOrDash(recs.filter(r => r.shiftType === 'shift1').map(r => r.kipPct)).replace('—', '0'));
          case 'kip2': return Number(avgOrDash(recs.filter(r => r.shiftType === 'shift2').map(r => r.kipPct)).replace('—', '0'));
          case 'engineTotal': return aggRecs(recs).engineSec;
          case 'onsiteMin': return aggRecs(recs).onsiteMin;
          default: return 0;
        }
      };
      const va = getVal(a), vb = getVal(b);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }

  const visibleBlocks = getVisibleBlocks(settings);
  const totalCols = countCols(settings);

  const SortIcon = ({ col }: { col: string }) => sortCol === col
    ? <span style={{ marginLeft: 3, fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
    : null;

  const SORTABLE_COLS = new Set(['totalTrips', 'shift1Trips', 'shift2Trips', 'kip1', 'kip2', 'engineTotal', 'onsiteMin']);

  return (
    <div className="sv-tab-analytics" style={{ display: 'flex' }}>
      <div className="sv-an-table-wrap">
        {loading ? (
          <div className="sv-empty">
            <svg className="sv-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
            </svg>
            <span className="sv-empty-text">Загрузка...</span>
          </div>
        ) : vehicleRows.length === 0 ? (
          <div className="sv-empty">
            <span className="sv-empty-icon">📭</span>
            <span className="sv-empty-text">Нет данных за выбранный период</span>
          </div>
        ) : (
          <table className="sv-at">
            <thead>
              {/* Row 1: block headers */}
              <tr>
                <th className="sv-th-g1" rowSpan={2} style={{ minWidth: 180, textAlign: 'left', paddingLeft: 10 }}>
                  ТС / Заявка / День
                </th>
                {visibleBlocks.map(b => {
                  const cols = getVisibleCols(settings, b);
                  if (!cols.length) return null;
                  return (
                    <th key={b} className={BLOCK_HEADER_COLORS[b]} colSpan={cols.length}>
                      {BLOCK_LABELS[b]}
                    </th>
                  );
                })}
              </tr>
              {/* Row 2: column headers */}
              <tr>
                {visibleBlocks.map(b => {
                  const cols = getVisibleCols(settings, b);
                  return cols.map((colId, ci) => {
                    const colDef = BLOCK_COLUMNS[b].find(c => c.id === colId);
                    const sortable = SORTABLE_COLS.has(colId);
                    return (
                      <th
                        key={`${b}_${colId}`}
                        className={`sv-th-sub${ci === 0 ? ' sv-blk-first' : ''}`}
                        onClick={sortable ? () => handleSort(colId) : undefined}
                        style={sortable ? { cursor: 'pointer' } : {}}
                      >
                        {colDef?.label ?? colId}
                        <SortIcon col={colId} />
                      </th>
                    );
                  });
                })}
              </tr>
            </thead>
            <tbody>
              {vehicleRows.map((v, vi) => {
                const k0 = `v${vi}`;
                const isOpen = expanded.has(k0);
                const allRecs = v.allRecs;
                const totalTrips = allRecs.reduce((s, r) => s + r.tripsCount, 0);
                const isOnsite = allRecs.some(r => r.workType === 'onsite') && allRecs.every(r => r.workType !== 'delivery');
                // row color hint
                const rowKip1 = Number(avgOrDash(allRecs.filter(r => r.shiftType === 'shift1').map(r => r.kipPct)).replace('—', '-1'));
                const rowStyle: React.CSSProperties = totalTrips === 0
                  ? { background: 'rgba(239,68,68,0.06)' }
                  : rowKip1 >= 75 ? { background: 'rgba(34,197,94,0.04)' }
                  : {};

                const ctx0 = { regNumber: v.regNumber, nameMO: v.nameMO,
                  reqNum: [...new Set(v.orders.map(o => o.reqNum))].join(', '),
                  objName: [...new Set(v.orders.map(o => o.objName))].join('; ') };

                return (
                  <React.Fragment key={k0}>
                    <tr
                      className={`sv-lv0 ${isOnsite ? 'sv-onsite-row' : ''}`}
                      style={{ cursor: 'pointer', ...rowStyle }}
                      onClick={() => togOrder(k0)}
                    >
                      <td>
                        <div className="sv-tree-cell">
                          <div className={`sv-tree-expand ${isOpen ? 'open' : ''}`}>▶</div>
                          <div className="sv-vehicle-name-cell">
                            <span className="sv-reg-num">{v.regNumber}</span>
                            <span className="sv-veh-model">{stripSamosvaly(v.nameMO)}</span>
                          </div>
                          {v.orders.length > 1 && <span className="sv-lv-badge orders">{v.orders.length} заяв.</span>}
                        </div>
                      </td>
                      {visibleBlocks.map(b => getVisibleCols(settings, b).map((colId, ci) => (
                        <td key={`${b}_${colId}`} className={ci === 0 ? 'sv-blk-first' : undefined}>{renderCell(colId, allRecs, 'vehicle', ctx0)}</td>
                      )))}
                    </tr>

                    {isOpen && settings.groupByRequest && v.orders.map((ord, oi) => {
                      const k1 = `${k0}_o${oi}`;
                      const isLast1 = oi === v.orders.length - 1;
                      const ctx1 = { reqNum: ord.reqNum, objName: ord.objName };

                      type DayRow = { key: string; label: string; recs: ShiftRecord[]; badge?: string };
                      let dayRows: DayRow[];
                      if (settings.groupByShift) {
                        const dayMap = new Map<string, ShiftRecord[]>();
                        ord.records.forEach(r => {
                          const key = toDateStr(r.reportDate);
                          if (!dayMap.has(key)) dayMap.set(key, []);
                          dayMap.get(key)!.push(r);
                        });
                        dayRows = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))
                          .map(([d, r]) => ({ key: d, label: fmtDateShort(d), recs: r, badge: r.length > 1 ? '2 см.' : undefined }));
                      } else {
                        dayRows = [...ord.records]
                          .sort((a, b) => toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType))
                          .map(r => ({
                            key: `${toDateStr(r.reportDate)}_${r.shiftType}`,
                            label: `${fmtDateShort(r.reportDate)} · ${r.shiftType === 'shift1' ? '1 см.' : '2 см.'}`,
                            recs: [r],
                          }));
                      }

                      return (
                        <React.Fragment key={k1}>
                          <tr className="sv-lv1" style={{ cursor: 'pointer' }}
                            onClick={e => { e.stopPropagation(); togOrder(k1); }}>
                            <td>
                              <div className="sv-tree-cell">
                                <div className="sv-tree-indent">
                                  <div className={`sv-tree-pipe ${isLast1 ? 'last' : 'branch'}`} />
                                </div>
                                <div className={`sv-tree-expand ${expanded.has(k1) ? 'open' : ''}`}>▶</div>
                                <span className="sv-tree-label">#{ord.reqNum} · {ord.objName}</span>
                                {dayRows.length > 1 && <span className="sv-lv-badge days">{dayRows.length} дн.</span>}
                              </div>
                            </td>
                            {visibleBlocks.map(b => getVisibleCols(settings, b).map((colId, ci) => (
                              <td key={`${b}_${colId}`} className={ci === 0 ? 'sv-blk-first' : undefined}>{renderCell(colId, ord.records, 'order', ctx1)}</td>
                            )))}
                          </tr>

                          {expanded.has(k1) && dayRows.map((dr, di) => {
                            const k2 = `${k1}_d${di}`;
                            const isLast2 = di === dayRows.length - 1;
                            const isDayOpen = expandedDays.has(k2);
                            const dayTrips = dr.recs.reduce((s, r) => s + r.tripsCount, 0);
                            const dayStyle: React.CSSProperties = dayTrips === 0
                              ? { background: 'rgba(239,68,68,0.08)' }
                              : (dr.recs.find(r => r.shiftType === 'shift1')?.kipPct ?? 0) >= 75
                              ? { background: 'rgba(34,197,94,0.06)' }
                              : {};
                            const ctx2 = { date: toDateStr(dr.recs[0].reportDate), reqNum: ord.reqNum, objName: ord.objName };

                            return (
                              <React.Fragment key={k2}>
                                <tr className="sv-lv2" style={{ cursor: 'pointer', ...dayStyle }}
                                  onClick={e => { e.stopPropagation(); togDay(k2); }}>
                                  <td>
                                    <div className="sv-tree-cell">
                                      <div className="sv-tree-indent">
                                        <div className={`sv-tree-pipe ${isLast1 ? '' : 'line'}`} />
                                        <div className={`sv-tree-pipe ${isLast2 ? 'last' : 'branch'}`} />
                                      </div>
                                      <div className={`sv-tree-expand ${isDayOpen ? 'open' : ''}`}>▶</div>
                                      <span className="sv-tree-label">{dr.label}</span>
                                      {dr.badge && <span className="sv-lv-badge shifts">{dr.badge}</span>}
                                    </div>
                                  </td>
                                  {visibleBlocks.map(b => getVisibleCols(settings, b).map((colId, ci) => (
                                    <td key={`${b}_${colId}`} className={ci === 0 ? 'sv-blk-first' : undefined}>{renderCell(colId, dr.recs, 'day', ctx2)}</td>
                                  )))}
                                </tr>
                                {isDayOpen && (
                                  <tr className="sv-sub-row">
                                    <td colSpan={totalCols}>
                                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        {dr.recs
                                          .sort((a, b) => a.shiftType.localeCompare(b.shiftType))
                                          .map(sr => (
                                            <div key={sr.id} style={{ flex: '1 1 300px', minWidth: 0 }}>
                                              <ShiftSubTable shiftRecord={sr} />
                                            </div>
                                          ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}

                    {/* Flat days (no groupByRequest) */}
                    {isOpen && !settings.groupByRequest && (() => {
                      type DayRow2 = { key: string; label: string; recs: ShiftRecord[]; badge?: string };
                      let dayRows2: DayRow2[];
                      if (settings.groupByShift) {
                        const dayMap = new Map<string, ShiftRecord[]>();
                        allRecs.forEach(r => {
                          const key = toDateStr(r.reportDate);
                          if (!dayMap.has(key)) dayMap.set(key, []);
                          dayMap.get(key)!.push(r);
                        });
                        dayRows2 = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))
                          .map(([d, r]) => ({ key: d, label: fmtDateShort(d), recs: r, badge: r.length > 1 ? '2 см.' : undefined }));
                      } else {
                        dayRows2 = [...allRecs]
                          .sort((a, b) => toDateStr(a.reportDate).localeCompare(toDateStr(b.reportDate)) || a.shiftType.localeCompare(b.shiftType))
                          .map(r => ({
                            key: `${toDateStr(r.reportDate)}_${r.shiftType}`,
                            label: `${fmtDateShort(r.reportDate)} · ${r.shiftType === 'shift1' ? '1 см.' : '2 см.'}`,
                            recs: [r],
                          }));
                      }
                      return dayRows2.map((dr, di) => {
                        const k2 = `${k0}_d${di}`;
                        const isLast2 = di === dayRows2.length - 1;
                        const isDayOpen = expandedDays.has(k2);
                        const dayTrips = dr.recs.reduce((s, r) => s + r.tripsCount, 0);
                        const dayStyle: React.CSSProperties = dayTrips === 0
                          ? { background: 'rgba(239,68,68,0.08)' }
                          : (dr.recs.find(r => r.shiftType === 'shift1')?.kipPct ?? 0) >= 75
                          ? { background: 'rgba(34,197,94,0.06)' }
                          : {};
                        const reqNums = [...new Set(dr.recs.flatMap(r => r.requestNumbers ?? []))].join(', ');
                        const objNames = [...new Set(dr.recs.map(r => r.objectName ?? ''))].join('; ');
                        const ctx2 = { date: toDateStr(dr.recs[0].reportDate), reqNum: reqNums || '—', objName: objNames || '—' };

                        return (
                          <React.Fragment key={k2}>
                            <tr className="sv-lv1" style={{ cursor: 'pointer', ...dayStyle }}
                              onClick={e => { e.stopPropagation(); togDay(k2); }}>
                              <td>
                                <div className="sv-tree-cell">
                                  <div className="sv-tree-indent">
                                    <div className={`sv-tree-pipe ${isLast2 ? 'last' : 'branch'}`} />
                                  </div>
                                  <div className={`sv-tree-expand ${isDayOpen ? 'open' : ''}`}>▶</div>
                                  <span className="sv-tree-label">{dr.label}</span>
                                  {dr.badge && <span className="sv-lv-badge shifts">{dr.badge}</span>}
                                </div>
                              </td>
                              {visibleBlocks.map(b => getVisibleCols(settings, b).map(colId => (
                                <td key={`${b}_${colId}`}>{renderCell(colId, dr.recs, 'day', ctx2)}</td>
                              )))}
                            </tr>
                            {isDayOpen && (
                              <tr className="sv-sub-row">
                                <td colSpan={totalCols}>
                                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    {dr.recs
                                      .sort((a, b) => a.shiftType.localeCompare(b.shiftType))
                                      .map(sr => (
                                        <div key={sr.id} style={{ flex: '1 1 300px', minWidth: 0 }}>
                                          <ShiftSubTable shiftRecord={sr} />
                                        </div>
                                      ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Global Gantt tab
// ─────────────────────────────────────────────

function GlobalGanttTab({ orderMonth, orders, isAllTime }: {
  orderMonth: string; orders: OrderCard[]; isAllTime: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [records, setRecords] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [tripPopup, setTripPopup] = useState<{ shiftRecord: ShiftRecord; x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const params: { dateFrom?: string; dateTo?: string } = {};
    if (!isAllTime) {
      const [y, m] = orderMonth.split('-').map(Number);
      params.dateFrom = `${orderMonth}-01`;
      params.dateTo = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y!, m!, 0).getDate()).padStart(2, '0')}`;
    }
    fetchShiftRecords(params).then(r => {
      setRecords(r);
      setScrollOffset(0);
    }).finally(() => setLoading(false));
  }, [orderMonth, isAllTime]);

  // Close popup on outside click
  useEffect(() => {
    if (!tripPopup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setTripPopup(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tripPopup]);

  if (loading) return (
    <div className="sv-empty">
      <svg className="sv-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
        <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
      </svg>
      <span className="sv-empty-text">Загрузка...</span>
    </div>
  );

  if (!records.length) return (
    <div className="sv-empty">
      <span className="sv-empty-icon">📭</span>
      <span className="sv-empty-text">Нет данных за выбранный период</span>
    </div>
  );

  const ordersMap = new Map(orders.map(o => [o.number, o]));

  // All records per vehicle (for rendering complete rows)
  const vehicleRecords = new Map<string, ShiftRecord[]>();
  const vehicleNames = new Map<string, string>();
  records.forEach(r => {
    if (!vehicleRecords.has(r.regNumber)) vehicleRecords.set(r.regNumber, []);
    vehicleRecords.get(r.regNumber)!.push(r);
    if (!vehicleNames.has(r.regNumber)) vehicleNames.set(r.regNumber, r.nameMO ?? r.regNumber);
  });

  // Object → vehicles (same vehicle duplicated under each object it worked on)
  const objectVehicles = new Map<string, Set<string>>();
  records.forEach(r => {
    const obj = r.objectName || 'Прочие';
    if (!objectVehicles.has(obj)) objectVehicles.set(obj, new Set());
    objectVehicles.get(obj)!.add(r.regNumber);
  });

  // Date range from records
  const sortedDates = [...new Set(records.map(r => toDateStr(r.reportDate)))].sort();
  const minDate = sortedDates[0]!;
  const maxDate = sortedDates[sortedDates.length - 1]!;
  const allDates = generateDateRange(minDate, maxDate);
  const datesWithData = new Set(sortedDates);
  const filteredDates = hideEmpty ? allDates.filter(d => datesWithData.has(d)) : allDates;
  const MIN_DATE_COLS = 7;
  const paddingCols = Math.max(0, MIN_DATE_COLS - filteredDates.length);

  const needsNav = filteredDates.length > GANTT_PAGE_SIZE;
  const maxOffset = needsNav ? filteredDates.length - GANTT_PAGE_SIZE : 0;
  const visibleDates = needsNav
    ? filteredDates.slice(scrollOffset, scrollOffset + GANTT_PAGE_SIZE)
    : filteredDates;

  // Total trips per date
  const totalByDate = new Map<string, number>();
  records.forEach(r => {
    const d = toDateStr(r.reportDate);
    totalByDate.set(d, (totalByDate.get(d) ?? 0) + r.tripsCount);
  });

  // Cell map builder
  type GGCell = {
    s1: number; s2: number;
    s1work: string; s2work: string;
    s1mov: number; s2mov: number;
    s1has: boolean; s2has: boolean;
    s1reqCount: number; s2reqCount: number;
    s1rec?: ShiftRecord; s2rec?: ShiftRecord;
  };

  const buildCellMap = (recs: ShiftRecord[]): Map<string, GGCell> => {
    const cm = new Map<string, GGCell>();
    recs.forEach(r => {
      const d = toDateStr(r.reportDate);
      if (!cm.has(d)) cm.set(d, { s1: 0, s2: 0, s1work: '', s2work: '', s1mov: 0, s2mov: 0, s1has: false, s2has: false, s1reqCount: 0, s2reqCount: 0 });
      const c = cm.get(d)!;
      const rc = (r.requestNumbers ?? []).length;
      if (r.shiftType === 'shift1') {
        c.s1 = r.tripsCount; c.s1work = r.workType ?? ''; c.s1mov = Math.round(r.movementPct); c.s1has = true; c.s1reqCount = rc; c.s1rec = r;
      } else {
        c.s2 = r.tripsCount; c.s2work = r.workType ?? ''; c.s2mov = Math.round(r.movementPct); c.s2has = true; c.s2reqCount = rc; c.s2rec = r;
      }
    });
    return cm;
  };

  const renderGGCell = (trips: number, workType: string, mov: number, hasData: boolean, reqCount: number, shiftRec?: ShiftRecord) => {
    const handleClick = (e: React.MouseEvent) => {
      if (shiftRec && (trips > 0 || hasData)) {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const rect = el.getBoundingClientRect();
        const x = Math.min(rect.left, window.innerWidth - 520);
        const y = rect.bottom + 4 > window.innerHeight - 420
          ? Math.max(4, rect.top - 404)
          : rect.bottom + 4;
        setTripPopup({ shiftRecord: shiftRec, x: Math.max(4, x), y });
      }
    };
    if (trips > 0 && reqCount > 1) return <div className="sv-gc f multi" onClick={handleClick} style={{ cursor: 'pointer' }}>={trips}</div>;
    if (trips > 0) return <div className="sv-gc f" onClick={handleClick} style={{ cursor: 'pointer' }}>{trips}</div>;
    if (workType === 'onsite' && mov > 0) return <div className="sv-gc f">{mov}%</div>;
    if (hasData) return <div className="sv-gc gc-warn" title="0 рейсов" onClick={handleClick} style={{ cursor: 'pointer' }}>!</div>;
    return <div className="sv-gc gc-absent"></div>;
  };

  const toggleExpand = (key: string) => {
    setExpandedVehicles(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  };

  // Drag-to-scroll
  const onMouseDown = (e: React.MouseEvent) => {
    if (!needsNav) return;
    dragRef.current = { startX: e.clientX, startOffset: scrollOffset };
    e.preventDefault();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    const colWidth = 56;
    const shift = Math.round(dx / colWidth);
    setScrollOffset(Math.max(0, Math.min(maxOffset, dragRef.current.startOffset + shift)));
  };
  const onMouseUp = () => { dragRef.current = null; };

  const colSpanAll = 1 + (visibleDates.length + paddingCols) * 2;
  const objectEntries = [...objectVehicles.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="sv-gantt sv-gg-wrap" onMouseMove={needsNav ? onMouseMove : undefined} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
      <table>
        <thead>
          <tr>
            <th className="sv-gantt-corner" style={{ width: 180, minWidth: 180 }}>
              <span className="sv-gantt-nav-group" onMouseDown={e => e.stopPropagation()}>
                <button
                  className={`sv-gantt-nav-btn sv-gantt-eye-btn${hideEmpty ? ' sv-gantt-eye-active' : ''}`}
                  onClick={() => { setHideEmpty(h => !h); setScrollOffset(0); }}
                  title={hideEmpty ? 'Показать все дни' : 'Скрыть пустые дни'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {hideEmpty ? (<>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>) : (<>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>)}
                  </svg>
                </button>
                {needsNav && (<>
                  <button className="sv-gantt-nav-btn" disabled={scrollOffset <= 0}
                    onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}>&#9664;</button>
                  <button className="sv-gantt-nav-btn" disabled={scrollOffset >= maxOffset}
                    onClick={() => setScrollOffset(Math.min(maxOffset, scrollOffset + 1))}>&#9654;</button>
                </>)}
              </span>
            </th>
            {visibleDates.map(d => {
              const dt = totalByDate.get(d) ?? 0;
              return (
                <th key={d} className="sv-gantt-date-h" colSpan={2}>
                  {fmtDateShort(d)}{dt > 0 && <span className="sv-truck-trips"> [{dt}]</span>}
                </th>
              );
            })}
            {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
              <th key={`pad-${i}`} colSpan={2}></th>
            ))}
          </tr>
          <tr className={needsNav ? 'sv-gantt-draggable' : ''} onMouseDown={onMouseDown}>
            <th style={{ width: 180, minWidth: 180 }}></th>
            {visibleDates.map(d => (
              <React.Fragment key={d}><th>1</th><th>2</th></React.Fragment>
            ))}
            {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
              <React.Fragment key={`pad-${i}`}><th></th><th></th></React.Fragment>
            ))}
          </tr>
        </thead>

        {objectEntries.map(([objName, vehicleSet]) => {
          const sortedVehicles = [...vehicleSet].sort((a, b) => {
            const ta = (vehicleRecords.get(a) ?? []).reduce((s, r) => s + r.tripsCount, 0);
            const tb = (vehicleRecords.get(b) ?? []).reduce((s, r) => s + r.tripsCount, 0);
            return tb - ta;
          });

          return (
            <tbody key={objName}>
              <tr className="sv-gg-obj-header">
                <td colSpan={colSpanAll}>{objName}</td>
              </tr>
              {sortedVehicles.map(reg => {
                const vehRecs = vehicleRecords.get(reg) ?? [];
                const cm = buildCellMap(vehRecs);
                const totalTrips = vehRecs.reduce((s, r) => s + r.tripsCount, 0);
                const nameMO = vehicleNames.get(reg) ?? reg;
                const expandKey = `${objName}|${reg}`;
                const isExpanded = expandedVehicles.has(expandKey);
                const orderNums = [...new Set(vehRecs.flatMap(r => r.requestNumbers ?? []))];
                const hasUnlinked = vehRecs.some(r => !r.requestNumbers || r.requestNumbers.length === 0);

                return (
                  <React.Fragment key={reg}>
                    <tr>
                      <td>
                        <div className="sv-vehicle-name-cell">
                          <span className="sv-reg-num">
                            {reg}
                            {!isAllTime && (orderNums.length > 0 || hasUnlinked) && (
                              <span className="sv-gg-dots"
                                onClick={e => { e.stopPropagation(); toggleExpand(expandKey); }}
                                style={{ cursor: 'pointer', marginLeft: 4 }}>
                                {orderNums.slice(0, 8).map(num => {
                                  const done = ordersMap.get(num)?.isDone ?? false;
                                  return <span key={num} className={`sv-gg-dot ${done ? 'done' : ''}`} title={`#${num}`} />;
                                })}
                                {hasUnlinked && <span className="sv-gg-dot unlinked" title="Без заявки" />}
                              </span>
                            )}
                            {!isAllTime && <span className="sv-truck-trips"> [{totalTrips}]</span>}
                          </span>
                          <span className="sv-veh-model">{stripSamosvaly(nameMO)}</span>
                        </div>
                      </td>
                      {visibleDates.map(d => {
                        const cell = cm.get(d);
                        return (
                          <React.Fragment key={d}>
                            <td>{cell ? renderGGCell(cell.s1, cell.s1work, cell.s1mov, cell.s1has, cell.s1reqCount, cell.s1rec) : <div className="sv-gc gc-absent"></div>}</td>
                            <td>{cell ? renderGGCell(cell.s2, cell.s2work, cell.s2mov, cell.s2has, cell.s2reqCount, cell.s2rec) : <div className="sv-gc gc-absent"></div>}</td>
                          </React.Fragment>
                        );
                      })}
                      {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
                        <React.Fragment key={`pad-${i}`}><td></td><td></td></React.Fragment>
                      ))}
                    </tr>

                    {/* Expanded sub-rows per order */}
                    {isExpanded && orderNums.map(num => {
                      const subRecs = vehRecs.filter(r => (r.requestNumbers ?? []).includes(num));
                      const subCm = buildCellMap(subRecs);
                      const order = ordersMap.get(num);
                      return (
                        <tr key={`${reg}-${num}`} className="sv-gg-sub-row">
                          <td>
                            <span className="sv-gg-sub-label">
                              <span className={`sv-gg-dot ${order?.isDone ? 'done' : ''}`} />
                              #{num}
                            </span>
                          </td>
                          {visibleDates.map(d => {
                            const cell = subCm.get(d);
                            return (
                              <React.Fragment key={d}>
                                <td>{cell ? renderGGCell(cell.s1, cell.s1work, cell.s1mov, cell.s1has, 0, cell.s1rec) : <div className="sv-gc gc-absent"></div>}</td>
                                <td>{cell ? renderGGCell(cell.s2, cell.s2work, cell.s2mov, cell.s2has, 0, cell.s2rec) : <div className="sv-gc gc-absent"></div>}</td>
                              </React.Fragment>
                            );
                          })}
                          {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
                            <React.Fragment key={`pad-${i}`}><td></td><td></td></React.Fragment>
                          ))}
                        </tr>
                      );
                    })}

                    {/* Expanded sub-row: unlinked (no request) */}
                    {isExpanded && hasUnlinked && (() => {
                      const unlinkedRecs = vehRecs.filter(r => !r.requestNumbers || r.requestNumbers.length === 0);
                      const subCm = buildCellMap(unlinkedRecs);
                      return (
                        <tr key={`${reg}-unlinked`} className="sv-gg-sub-row">
                          <td>
                            <span className="sv-gg-sub-label">
                              <span className="sv-gg-dot unlinked" />
                              Без заявки
                            </span>
                          </td>
                          {visibleDates.map(d => {
                            const cell = subCm.get(d);
                            return (
                              <React.Fragment key={d}>
                                <td>{cell ? renderGGCell(cell.s1, cell.s1work, cell.s1mov, cell.s1has, 0, cell.s1rec) : <div className="sv-gc gc-absent"></div>}</td>
                                <td>{cell ? renderGGCell(cell.s2, cell.s2work, cell.s2mov, cell.s2has, 0, cell.s2rec) : <div className="sv-gc gc-absent"></div>}</td>
                              </React.Fragment>
                            );
                          })}
                          {paddingCols > 0 && Array.from({ length: paddingCols }, (_, i) => (
                            <React.Fragment key={`pad-${i}`}><td></td><td></td></React.Fragment>
                          ))}
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </tbody>
          );
        })}
      </table>

      {/* Trip popup */}
      {tripPopup && createPortal(
        <div ref={popupRef} className="sv-gg-popup" data-theme={resolvedTheme}
          style={{ left: tripPopup.x, top: tripPopup.y }}
          onClick={e => e.stopPropagation()}>
          <ShiftSubTable shiftRecord={tripPopup.shiftRecord} />
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────
export function DumpTrucksPage() {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<'orders' | 'analytics' | 'gantt'>('orders');
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [constructorOpen, setConstructorOpen] = useState(false);
  const [groupByCargo, setGroupByCargo] = useState(false);
  const [orderSortKey, setOrderSortKey] = useState<'pct' | 'trips' | 'distance' | 'dateFrom' | 'dateTo'>('pct');
  const [orderSortDir, setOrderSortDir] = useState<'asc' | 'desc'>('desc');
  const [isAllTime, setIsAllTime] = useState(false);

  // User settings
  const [currentUser, setCurrentUserState] = useState<string | null>(() => getCurrentUser());
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const user = getCurrentUser();
    return user ? loadUserSettings(user) : getDefaultSettings();
  });

  const handleUserSelect = (name: string) => {
    setCurrentUserState(name);
    setUserSettings(loadUserSettings(name));
  };

  const handleSettingsUpdate = (s: UserSettings) => {
    setUserSettings(s);
    if (currentUser) saveUserSettings(currentUser, s);
  };

  // Orders tab: month-based navigation
  const [orderMonth, setOrderMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Analytics tab: date range
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo]     = useState(DEFAULT_DATE_TO);

  // Analytics-only filters
  const [analyticsFilters, setAnalyticsFilters] = useState<AnalyticsFilters>({ shift: 'all', objectUid: '', showOnsite: false });

  // Compute month boundaries for orders API
  const orderMonthFrom = `${orderMonth}-01`;
  const orderMonthTo = (() => {
    const [y, m] = orderMonth.split('-').map(Number);
    const last = new Date(y!, m!, 0);
    return `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  })();

  const fmtMonth = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number);
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${months[m! - 1]} ${y}`;
  };

  const shiftMonth = (dir: -1 | 1) => {
    const [y, m] = orderMonth.split('-').map(Number);
    const d = new Date(y!, m! - 1 + dir, 1);
    setOrderMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const [objects, setObjects] = useState<DtObject[]>([]);
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [orderShifts, setOrderShifts] = useState<ShiftRecord[]>([]);
  const [shiftRecords, setShiftRecords] = useState<ShiftRecord[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);

  // Load objects and repairs once
  useEffect(() => {
    fetchObjects().then(setObjects).catch(console.error);
    fetchRepairs().then(setRepairs).catch(console.error);
  }, []);

  // Load orders + month shift records when month changes
  useEffect(() => {
    setLoadingOrders(true);
    const [y, m] = orderMonth.split('-').map(Number);
    const from = new Date(y!, m! - 2, 1); // prev month start
    const to = new Date(y!, m! + 1, 0);   // next month end
    const fromStr = isoDate(from);
    const toStr = isoDate(to);
    Promise.all([
      fetchOrders(fromStr, toStr),
      fetchShiftRecords({ dateFrom: orderMonthFrom, dateTo: orderMonthTo }),
    ]).then(([rawOrders, shifts]) => {
      const today = new Date().toISOString().slice(0, 10);
      setOrders(rawOrders.map(o => toOrderCard(o, today)));
      setOrderShifts(shifts);
    }).catch(console.error)
      .finally(() => setLoadingOrders(false));
  }, [orderMonth]);

  // Load shift records when date range changes
  useEffect(() => {
    setLoadingRecords(true);
    fetchShiftRecords({ dateFrom, dateTo })
      .then(setShiftRecords)
      .catch(console.error)
      .finally(() => setLoadingRecords(false));
  }, [dateFrom, dateTo]);

  const toggleOrder = (num: number) => {
    setExpandedOrders(prev => {
      const s = new Set(prev);
      if (s.has(num)) s.delete(num); else s.add(num);
      return s;
    });
  };

  const sortOrders = (list: OrderCard[]): OrderCard[] => {
    const dir = orderSortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (orderSortKey) {
        case 'pct':      return (a.pct - b.pct) * dir;
        case 'trips':    return (a.actualTrips - b.actualTrips) * dir;
        case 'distance': return (a.routeDistance - b.routeDistance) * dir;
        case 'dateFrom': return (a.dateFromIso || '').localeCompare(b.dateFromIso || '') * dir;
        case 'dateTo':   return (a.dateToIso || '').localeCompare(b.dateToIso || '') * dir;
        default:         return 0;
      }
    });
  };

  // ordersMap for GanttTable popup info
  const ordersMap = React.useMemo(() => new Map(orders.map(o => [o.number, o])), [orders]);

  const renderGrouped = (items: OrderCard[]) => {
    if (!groupByCargo || items.length === 0) {
      return items.map(o => (
        <OrderCardView key={o.number} card={o}
          expanded={expandedOrders.has(o.number)}
          onToggle={() => toggleOrder(o.number)}
          ordersMap={ordersMap} theme={theme ?? 'dark'} />
      ));
    }
    const cargoMap = new Map<string, OrderCard[]>();
    items.forEach(o => {
      const key = o.cargo || '—';
      if (!cargoMap.has(key)) cargoMap.set(key, []);
      cargoMap.get(key)!.push(o);
    });
    return [...cargoMap.entries()].map(([cargo, groupItems]) => (
      <div key={cargo} style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sv-text-4)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3, marginLeft: 4 }}>
          {cargo} ({groupItems.length})
        </div>
        {groupItems.map(o => (
          <OrderCardView key={o.number} card={o}
            expanded={expandedOrders.has(o.number)}
            onToggle={() => toggleOrder(o.number)}
            ordersMap={ordersMap} theme={theme ?? 'dark'} />
        ))}
      </div>
    ));
  };

  // Filter orders: overlap with selected month
  const monthOrders = orders.filter(o => {
    // If no dates from points, fallback: show if API returned it for this range
    if (!o.dateFromIso && !o.dateToIso) return true;
    const oFrom = o.dateFromIso || '0000-01-01';
    const oTo   = o.dateToIso   || '9999-12-31';
    return oFrom <= orderMonthTo && oTo >= orderMonthFrom;
  });

  // Group orders by city
  const cityMap = new Map<string, OrderCard[]>();
  monthOrders.forEach(o => {
    if (!cityMap.has(o.city)) cityMap.set(o.city, []);
    cityMap.get(o.city)!.push(o);
  });

  // Unlinked shifts: shift records without any request_numbers in the order month
  const unlinkedVehicles = new Map<string, { nameMO: string; recs: ShiftRecord[] }>();
  orderShifts
    .filter(r => !r.requestNumbers || r.requestNumbers.length === 0)
    .forEach(r => {
      if (!unlinkedVehicles.has(r.regNumber))
        unlinkedVehicles.set(r.regNumber, { nameMO: r.nameMO, recs: [] });
      unlinkedVehicles.get(r.regNumber)!.recs.push(r);
    });

  return (
    <div className="sv-root flex-1 min-h-0" data-theme={theme}>
      <div className="sv-amb sv-amb-o" />
      <div className="sv-amb sv-amb-b" />

      {/* Sub-header */}
      <div className="sv-sub-header">
        <div className="sv-view-tabs">
          <button className={`sv-view-tab ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')}>
            📋 Заявки
          </button>
          <button className={`sv-view-tab ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
            📊 Аналитика
          </button>
          <button className={`sv-view-tab ${activeTab === 'gantt' ? 'active' : ''}`} onClick={() => setActiveTab('gantt')}>
            📊 Ганта
          </button>
        </div>

        {/* Orders / Gantt: month nav */}
        {(activeTab === 'orders' || activeTab === 'gantt') && (
          <>
            <div className="sv-filter-sep" />
            <div className="sv-fg">
              <div className="sv-fg-label">Месяц</div>
              <div className="sv-fg-row" style={isAllTime && activeTab === 'gantt' ? { opacity: 0.4, pointerEvents: 'none' as const } : {}}>
                <button className="sv-week-nav-btn" style={{ width: 22, height: 22, fontSize: 11 }} onClick={() => shiftMonth(-1)}>‹</button>
                <span style={{ fontSize: 12, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>{fmtMonth(orderMonth)}</span>
                <button className="sv-week-nav-btn" style={{ width: 22, height: 22, fontSize: 11 }} onClick={() => shiftMonth(1)}>›</button>
              </div>
            </div>
            {activeTab === 'gantt' && (
              <button className={`sv-fb-pill ${isAllTime ? 'active' : ''}`}
                onClick={() => setIsAllTime(p => !p)}>
                За всё время
              </button>
            )}
          </>
        )}

        {/* Analytics: date range */}
        {activeTab === 'analytics' && (
          <>
            <div className="sv-filter-sep" />
            <div className="sv-fg">
              <div className="sv-fg-label">Период</div>
              <div className="sv-fg-row">
                <input type="date" className="sv-fb-date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)} />
                <span style={{ fontSize: 9, color: 'var(--sv-text-4)' }}>—</span>
                <input type="date" className="sv-fb-date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* Analytics-only filters */}
        {activeTab === 'analytics' && (
          <>
            <div className="sv-filter-sep" />
            <div className="sv-fg">
              <div className="sv-fg-label">Смена</div>
              <div className="sv-fg-row">
                {(['all', 'shift1', 'shift2'] as const).map(s => (
                  <button key={s} className={`sv-fb-pill ${analyticsFilters.shift === s ? 'active' : ''}`}
                    onClick={() => setAnalyticsFilters(f => ({ ...f, shift: s }))}>
                    {s === 'all' ? 'Все' : s === 'shift1' ? '1-я' : '2-я'}
                  </button>
                ))}
              </div>
            </div>
            <div className="sv-filter-sep" />
            <div className="sv-fg">
              <div className="sv-fg-label">Объект</div>
              <select className="sv-fb-select"
                value={analyticsFilters.objectUid}
                onChange={e => setAnalyticsFilters(f => ({ ...f, objectUid: e.target.value }))}>
                <option value="">Все</option>
                {objects.map(o => <option key={o.uid} value={o.uid}>{o.name}</option>)}
              </select>
            </div>
            <div className="sv-filter-sep" />
            <label className="sv-fg" style={{ cursor: 'pointer', userSelect: 'none' }}>
              <div className="sv-fg-label">По месту</div>
              <input type="checkbox"
                checked={analyticsFilters.showOnsite}
                onChange={e => setAnalyticsFilters(f => ({ ...f, showOnsite: e.target.checked }))} />
            </label>
          </>
        )}

        {/* Right controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserSelector currentUser={currentUser} onSelect={handleUserSelect} />
          {activeTab === 'analytics' && (
            <button
              className={`sv-fb-pill ${constructorOpen ? 'active' : ''}`}
              onClick={() => setConstructorOpen(p => !p)}
              title="Конструктор таблицы"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
              Конструктор
            </button>
          )}
        </div>
      </div>

      {/* Main content + constructor panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div className="sv-main-wrap" style={{ flex: 1, minWidth: 0 }}>
          {/* Tab 1: Orders */}
          {activeTab === 'orders' && (
            <div className="sv-tab-orders">
              <div className="sv-orders-scroll">
                {loadingOrders ? (
                  <div className="sv-empty">
                    <svg className="sv-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
                    </svg>
                    <span className="sv-empty-text">Загрузка заявок...</span>
                  </div>
                ) : (orders.length === 0 && unlinkedVehicles.size === 0) ? (
                  <div className="sv-empty">
                    <span className="sv-empty-icon">📭</span>
                    <span className="sv-empty-text">Заявок не найдено</span>
                  </div>
                ) : (
                  <>
                  {/* Toolbar: grouping + sorting */}
                  <div className="sv-order-toolbar">
                    <button
                      className={`sv-fb-pill ${groupByCargo ? 'active' : ''}`}
                      onClick={() => setGroupByCargo(p => !p)}
                    >
                      По грузу
                    </button>
                    <span className="sv-toolbar-sep" />
                    {([
                      ['pct', 'Выполн.'],
                      ['trips', 'Рейсы'],
                      ['distance', 'Расст.'],
                      ['dateFrom', 'Дата нач.'],
                      ['dateTo', 'Дата кон.'],
                    ] as ['pct' | 'trips' | 'distance' | 'dateFrom' | 'dateTo', string][]).map(([key, label]) => (
                      <button
                        key={key}
                        className={`sv-fb-pill ${orderSortKey === key ? 'active' : ''}`}
                        onClick={() => {
                          if (orderSortKey === key) setOrderSortDir(d => d === 'asc' ? 'desc' : 'asc');
                          else { setOrderSortKey(key); setOrderSortDir('desc'); }
                        }}
                      >
                        {label} {orderSortKey === key ? (orderSortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    ))}
                  </div>

                  {[...cityMap.entries()].map(([city, cityOrders]) => {
                    const active = sortOrders(cityOrders.filter(o => !o.isDone));
                    const closed = sortOrders(cityOrders.filter(o => o.isDone));

                    return (
                      <div key={city} className="sv-city-group">
                        <div className="sv-city-header">
                          <span className="sv-city-name">{city}</span>
                          <span className="sv-city-badge">{cityOrders.length}</span>
                        </div>
                        {active.length > 0 && (
                          <>
                            <div className="sv-status-label">
                              <div className="sv-status-dot" style={{ background: '#F97316' }} />
                              Активные ({active.length})
                            </div>
                            {renderGrouped(active)}
                          </>
                        )}
                        {closed.length > 0 && (
                          <>
                            <div className="sv-status-label">
                              <div className="sv-status-dot" style={{ background: '#22c55e' }} />
                              Закрытые ({closed.length})
                            </div>
                            {renderGrouped(closed)}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {unlinkedVehicles.size > 0 && (
                    <div className="sv-city-group sv-unlinked-group">
                      <div className="sv-city-header">
                        <span className="sv-city-name">Без заявки</span>
                        <span className="sv-city-badge">{unlinkedVehicles.size} ТС</span>
                      </div>
                      <div className="sv-gantt" style={{ maxHeight: 400, overflowY: 'auto' }}>
                        <UnlinkedGantt
                          shifts={orderShifts.filter(r => !r.requestNumbers?.length)}
                          dateFrom={orderMonthFrom}
                          dateTo={orderMonthTo}
                        />
                      </div>
                    </div>
                  )}
                  </>
                )}
              </div>

              <WeeklySidebar
                shiftRecords={shiftRecords}
                repairs={repairs}
                initialDateFrom={dateFrom}
              />
            </div>
          )}

          {/* Tab 2: Analytics */}
          {activeTab === 'analytics' && (
            <AnalyticsTab
              objects={objects}
              period={{ dateFrom, dateTo }}
              filters={analyticsFilters}
              onFiltersChange={setAnalyticsFilters}
              records={shiftRecords}
              loading={loadingRecords}
              settings={userSettings}
            />
          )}

          {/* Tab 3: Global Gantt */}
          {activeTab === 'gantt' && (
            <div style={{ overflow: 'auto', height: '100%', scrollbarWidth: 'thin' as const, scrollbarColor: 'var(--sv-scroll) transparent' }}>
              <GlobalGanttTab
                orderMonth={orderMonth}
                orders={orders}
                isAllTime={isAllTime}
              />
            </div>
          )}
        </div>

        {/* Table constructor panel */}
        {constructorOpen && activeTab === 'analytics' && (
          <TableConstructorPanel
            settings={userSettings}
            onUpdate={handleSettingsUpdate}
            onClose={() => setConstructorOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export default DumpTrucksPage;
