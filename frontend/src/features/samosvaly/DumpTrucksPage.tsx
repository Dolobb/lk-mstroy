import React, { useState, useEffect } from 'react';
import './samosvaly.css';
import {
  fetchObjects, fetchOrders, fetchOrderGantt,
  fetchShiftRecords, fetchShiftDetail, fetchRepairs,
} from './api';
import type {
  DtObject, OrderSummary, OrderCard, GanttRecord,
  ShiftRecord, TripRecord, ZoneEvent, Repair,
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

/** Преобразует OrderSummary (raw от API) в удобный OrderCard */
function toOrderCard(o: OrderSummary): OrderCard {
  const ord = o.rawJson?.orders?.[0];
  const pts = ord?.route?.points ?? [];
  const cargo = ord?.nameCargo ?? '—';
  const weightPerTrip = ord?.weightCargo ?? 0;
  const volumePerTrip = ord?.volumeCargo ?? 0;
  const planTrips = ord?.cntTrip ?? 0;
  const routeFrom = pts[0]?.address ?? '—';
  const routeTo = pts[pts.length - 1]?.address ?? '—';
  const routeDistance = ord?.route?.distance ?? 0;
  const routeTimeMins = ord?.route?.time ? Math.round(ord.route.time / 60) : 0;
  const objectExpend = ord?.objectExpend?.name ?? '';

  const actualTrips = Number(o.actual_trips);
  const pct = planTrips > 0 ? Math.min(100, Math.round((actualTrips / planTrips) * 100)) : 0;

  // Статус: SUCCESSFULLY_COMPLETED или pct >= 100 → done
  const isDone = o.status === 'SUCCESSFULLY_COMPLETED' || pct >= 100;

  // Город: берём из object_names (первый) — упрощённо
  const city = (o.object_names ?? [])[0] ?? 'Прочие';

  // Дата: из shift_records
  const dateFrom = o.first_date ? fmtDate(o.first_date) : (pts[0]?.date ? pts[0].date.slice(0, 5) : '—');
  const dateTo = o.last_date ? fmtDate(o.last_date) : (pts[pts.length - 1]?.date ? pts[pts.length - 1].date!.slice(0, 5) : '—');

  return {
    number: o.number,
    status: o.status,
    cargo,
    weightPerTrip,
    volumePerTrip,
    planTrips,
    routeFrom,
    routeTo,
    routeDistance,
    routeTimeMins,
    objectExpend,
    dateFrom,
    dateTo,
    actualTrips,
    pct,
    vehicles: o.vehicles ?? [],
    vehicleNames: o.vehicle_names ?? [],
    objectNames: o.object_names ?? [],
    plCount: Number(o.pl_count),
    city,
    isDone,
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
//  Gantt table for an order
// ─────────────────────────────────────────────
function GanttTable({ orderNumber }: { orderNumber: number }) {
  const [rows, setRows] = useState<GanttRecord[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetchOrderGantt(orderNumber)
      .then(setRows)
      .catch(() => setErr(true));
  }, [orderNumber]);

  if (err) return <div className="sv-loading-cell" style={{ color: '#EF4444' }}>Ошибка загрузки</div>;
  if (!rows) return <div className="sv-loading-cell">Загрузка...</div>;
  if (!rows.length) return <div className="sv-loading-cell">Нет данных</div>;

  // Collect unique dates and vehicles
  const dateSet = new Set<string>();
  const vehicleSet = new Map<string, string>(); // regNumber → nameMO
  rows.forEach(r => {
    dateSet.add(r.report_date);
    vehicleSet.set(r.reg_number, r.name_mo);
  });
  const dates = [...dateSet].sort();

  // Build cell map: regNumber → date → {s1, s2}
  type Cell = { s1: number; s2: number };
  const cellMap = new Map<string, Map<string, Cell>>();
  rows.forEach(r => {
    if (!cellMap.has(r.reg_number)) cellMap.set(r.reg_number, new Map());
    const dm = cellMap.get(r.reg_number)!;
    if (!dm.has(r.report_date)) dm.set(r.report_date, { s1: 0, s2: 0 });
    const cell = dm.get(r.report_date)!;
    if (r.shift_type === 'shift1') cell.s1 = Number(r.trips_count);
    else cell.s2 = Number(r.trips_count);
  });

  // Total trips per vehicle
  const totalByVeh = new Map<string, number>();
  rows.forEach(r => {
    totalByVeh.set(r.reg_number, (totalByVeh.get(r.reg_number) ?? 0) + Number(r.trips_count));
  });

  return (
    <div className="sv-gantt">
      <table>
        <thead>
          <tr>
            <th></th>
            {dates.map(d => (
              <th key={d} className="sv-gantt-date-h" colSpan={2}>{fmtDateShort(d)}</th>
            ))}
          </tr>
          <tr>
            <th style={{ width: 150, minWidth: 150 }}>Самосвал</th>
            {dates.map(d => (
              <React.Fragment key={d}>
                <th>1</th><th>2</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...vehicleSet.entries()].map(([reg, name]) => {
            const dm = cellMap.get(reg) ?? new Map();
            const total = totalByVeh.get(reg) ?? 0;
            return (
              <tr key={reg}>
                <td>{name} <span className="sv-truck-trips">[{total}]</span></td>
                {dates.map(d => {
                  const cell = dm.get(d) ?? { s1: 0, s2: 0 };
                  return (
                    <React.Fragment key={d}>
                      <td><div className={`sv-gc ${cell.s1 ? 'f' : ''}`}>{cell.s1 || ''}</div></td>
                      <td><div className={`sv-gc ${cell.s2 ? 'f' : ''}`}>{cell.s2 || ''}</div></td>
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
//  Order card
// ─────────────────────────────────────────────
function OrderCardView({ card, expanded, onToggle }: {
  card: OrderCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pc = card.isDone ? '#22c55e' : '#3B82F6';
  return (
    <div
      className={`sv-order-card ${card.isDone ? 'done sv-order-done' : 'sv-order-active'} ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
    >
      <div className="sv-order-content">
        <div className="sv-order-label-area">
          <div className="sv-order-num"><span>Заявка #{card.number}</span></div>
          <div className="sv-order-route-mini" title={`${card.routeFrom} → ${card.routeTo}`}>
            {card.routeFrom} → {card.routeTo}
          </div>
        </div>
        <div className="sv-order-data-area">
          <div className="sv-order-progress-fill" style={{ width: `${card.pct}%` }} />
          <div className="sv-order-badges">
            {!card.isDone && <span className="sv-badge-sm sv-badge-pct">{card.pct}%</span>}
            <span className={`sv-badge-sm ${card.isDone ? 'sv-badge-done' : 'sv-badge-active'}`}>
              {card.isDone ? '✓ готово' : '● работа'}
            </span>
          </div>
          <div className="sv-order-data-inner">
            <div className="sv-order-meta">
              <div className="sv-om-item"><div className="sv-om-label">Даты</div><div className="sv-om-val">{card.dateFrom}—{card.dateTo}</div></div>
              {card.routeDistance > 0 && <div className="sv-om-item"><div className="sv-om-label">Расст.</div><div className="sv-om-val">{card.routeDistance} км</div></div>}
              {card.routeTimeMins > 0 && <div className="sv-om-item"><div className="sv-om-label">Время</div><div className="sv-om-val">{Math.floor(card.routeTimeMins / 60)}ч{card.routeTimeMins % 60 ? `${card.routeTimeMins % 60}м` : ''}</div></div>}
              <div className="sv-om-item"><div className="sv-om-label">ТС</div><div className="sv-om-val">{card.vehicles.length}</div></div>
              <div className="sv-om-item"><div className="sv-om-label">ПЛ</div><div className="sv-om-val">{card.plCount}</div></div>
              {card.cargo !== '—' && <div className="sv-om-item"><div className="sv-om-label">Груз</div><div className="sv-om-val">{card.cargo}</div></div>}
              {card.weightPerTrip > 0 && <div className="sv-om-item"><div className="sv-om-label">Всего тонн</div><div className="sv-om-val" style={{ color: '#F97316', fontWeight: 700 }}>{card.weightPerTrip * card.actualTrips} т</div></div>}
              {card.volumePerTrip > 0 && <div className="sv-om-item"><div className="sv-om-label">Всего м³</div><div className="sv-om-val" style={{ color: '#A78BFA', fontWeight: 700 }}>{(card.volumePerTrip * card.actualTrips).toFixed(1)} м³</div></div>}
            </div>
            <div className="sv-order-foot">
              <div className="sv-order-obj">
                <b>Объект</b>
                {card.objectExpend || card.objectNames[0] || '—'}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {card.weightPerTrip > 0 && (
                  <div className="sv-ow-item">
                    <span className="sv-ow-val" style={{ color: pc }}>{card.weightPerTrip}</span>
                    <span className="sv-ow-unit">т/рейс</span>
                  </div>
                )}
                {card.volumePerTrip > 0 && (
                  <div className="sv-ow-item">
                    <span className="sv-ow-val" style={{ color: pc }}>{card.volumePerTrip}</span>
                    <span className="sv-ow-unit">м³/рейс</span>
                  </div>
                )}
              </div>
            </div>
            <div className="sv-progress-bar-mini">
              <div className="sv-progress-bar-mini-fill" style={{ width: `${card.pct}%`, background: pc }} />
            </div>
          </div>
        </div>
      </div>
      <svg className="sv-expand-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="6 9 12 15 18 9" />
      </svg>
      <div className={`sv-gantt-wrap ${expanded ? 'open' : ''}`}>
        {expanded && <GanttTable orderNumber={card.number} />}
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
function ShiftSubTable({ shiftRecord }: { shiftRecord: ShiftRecord }) {
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
  const idleSec    = Math.max(0, recs.length * IDLE_SHIFT_SEC - movingSec);
  const lds = recs.map(r => r.avgLoadingDwellSec).filter((v): v is number => v !== null && v > 0);
  const uds = recs.map(r => r.avgUnloadingDwellSec).filter((v): v is number => v !== null && v > 0);
  const avgLoad   = lds.length   ? Math.round(lds.reduce((a, b) => a + b, 0) / lds.length)   : null;
  const avgUnload = uds.length   ? Math.round(uds.reduce((a, b) => a + b, 0) / uds.length)   : null;
  return { engineSec, movingSec, idleSec, avgLoad, avgUnload };
}

function shiftCntLabel(recs: ShiftRecord[], showOnsite: boolean): string {
  const del = recs.filter(r => r.workType === 'delivery').length;
  if (!showOnsite) return String(del);
  const ons = recs.filter(r => r.workType === 'onsite').length;
  return `${del}/${ons}`;
}

const DEFAULT_DATE_FROM = '2026-02-17';
const DEFAULT_DATE_TO   = '2026-02-19';

function AnalyticsTab({ objects, period, filters, onFiltersChange, reportOpen, onToggleReport, records, loading }: {
  objects: DtObject[];
  period: PeriodState;
  filters: AnalyticsFilters;
  onFiltersChange: (f: AnalyticsFilters) => void;
  reportOpen: boolean;
  onToggleReport: () => void;
  records: ShiftRecord[];
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const togOrder = (key: string) => setExpanded(prev => {
    const s = new Set(prev);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });
  const togDay = (key: string) => setExpandedDays(prev => {
    const s = new Set(prev);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  });

  // Apply client-side filters
  const filteredRecords = records.filter(r => {
    if (filters.shift !== 'all' && r.shiftType !== filters.shift) return false;
    if (filters.objectUid && r.objectUid !== filters.objectUid) return false;
    if (!filters.showOnsite && r.workType !== 'delivery') return false;
    return true;
  });

  // Group records: vehicle → order → day → shift
  // vehicle key = regNumber
  const vehicleMap = new Map<string, { nameMO: string; records: ShiftRecord[] }>();
  filteredRecords.forEach(r => {
    const key = r.regNumber;
    if (!vehicleMap.has(key)) vehicleMap.set(key, { nameMO: r.nameMO ?? key, records: [] });
    vehicleMap.get(key)!.records.push(r);
  });

  // For each vehicle, group by requestNumbers (use first request number)
  type OrderGroup = { reqNum: string; objName: string; records: ShiftRecord[] };
  type VehicleRow = { regNumber: string; nameMO: string; orders: OrderGroup[] };

  const vehicleRows: VehicleRow[] = [...vehicleMap.entries()].map(([reg, { nameMO, records: vRecs }]) => {
    const orderMap = new Map<string, OrderGroup>();
    vRecs.forEach(r => {
      const nums = Array.isArray(r.requestNumbers) ? r.requestNumbers : [];
      const reqKey = nums.length > 0 ? String(nums[0]) : '—';
      if (!orderMap.has(reqKey)) orderMap.set(reqKey, { reqNum: reqKey, objName: r.objectName ?? '—', records: [] });
      orderMap.get(reqKey)!.records.push(r);
    });
    return { regNumber: reg, nameMO, orders: [...orderMap.values()] };
  });

  return (
    <div className="sv-tab-analytics" style={{ display: 'flex' }}>
      {/* Filters sub-bar */}
      {/* (rendered in parent sub-header) */}

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
              <tr>
                <th className="sv-th-g1" rowSpan={2} style={{ minWidth: 200, textAlign: 'left', paddingLeft: 10 }}>ТС / Заявка / День</th>
                <th className="sv-th-g2" colSpan={2}>Заявки</th>
                <th className="sv-th-g3" rowSpan={2}>{filters.showOnsite ? 'дост/место' : 'Смены'}</th>
                <th className="sv-th-g3" rowSpan={2}>Рейсы</th>
                <th className="sv-th-g3" rowSpan={2}>Объём</th>
                <th className="sv-th-g4" colSpan={2}>1 смена</th>
                <th className="sv-th-g4" colSpan={2}>2 смена</th>
                <th className="sv-th-g5" rowSpan={2}>Двиг.</th>
                <th className="sv-th-g5" rowSpan={2}>Движ.</th>
                <th className="sv-th-g5" rowSpan={2}>Стоянка</th>
                <th className="sv-th-g5" rowSpan={2}>Ср.П</th>
                <th className="sv-th-g5" rowSpan={2}>Ср.В</th>
              </tr>
              <tr>
                <th className="sv-th-sub">№ заявки</th>
                <th className="sv-th-sub">Объект</th>
                <th className="sv-th-sub">КИП</th>
                <th className="sv-th-sub">Движ.</th>
                <th className="sv-th-sub">КИП</th>
                <th className="sv-th-sub">Движ.</th>
              </tr>
            </thead>
            <tbody>
              {vehicleRows.map((v, vi) => {
                const k0 = `v${vi}`;
                const isOpen = expanded.has(k0);
                const allRecs = v.orders.flatMap(o => o.records);
                const totalTrips = allRecs.reduce((s, r) => s + r.tripsCount, 0);
                const kip1s = allRecs.filter(r => r.shiftType === 'shift1').map(r => r.kipPct);
                const mov1s = allRecs.filter(r => r.shiftType === 'shift1').map(r => r.movementPct);
                const kip2s = allRecs.filter(r => r.shiftType === 'shift2' && r.kipPct > 0).map(r => r.kipPct);
                const mov2s = allRecs.filter(r => r.shiftType === 'shift2' && r.kipPct > 0).map(r => r.movementPct);
                const ak1 = avgOrDash(kip1s); const am1 = avgOrDash(mov1s);
                const ak2 = avgOrDash(kip2s); const am2 = avgOrDash(mov2s);
                const reqList = [...new Set(v.orders.map(o => o.reqNum))].join(', ');
                const vAgg = aggRecs(allRecs);
                const isOnsite = allRecs.some(r => r.workType === 'onsite') && allRecs.every(r => r.workType !== 'delivery');

                return (
                  <React.Fragment key={k0}>
                    <tr className={`sv-lv0 ${isOnsite ? 'sv-onsite-row' : ''}`} onClick={() => togOrder(k0)} style={{ cursor: 'pointer' }}>
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
                      <td style={{ fontSize: 10, textAlign: 'left' }}>{reqList}</td>
                      <td style={{ fontSize: 9, textAlign: 'left' }}>{[...new Set(v.orders.map(o => o.objName))].join('; ')}</td>
                      <td>{shiftCntLabel(allRecs, filters.showOnsite)}</td>
                      <td style={{ fontWeight: 700 }}>{totalTrips}</td>
                      <td>—</td>
                      <td className={ak1 !== '—' ? kipColor(Number(ak1)) : ''}>{ak1}</td>
                      <td className={am1 !== '—' ? kipColor(Number(am1)) : ''}>{am1}</td>
                      <td className={ak2 !== '—' ? kipColor(Number(ak2)) : ''}>{ak2}</td>
                      <td className={am2 !== '—' ? kipColor(Number(am2)) : ''}>{am2}</td>
                      <td className="sv-td-agg">{fmtHours(vAgg.engineSec)}</td>
                      <td className="sv-td-agg">{fmtHours(vAgg.movingSec)}</td>
                      <td className="sv-td-agg">{fmtHours(vAgg.idleSec)}</td>
                      <td className="sv-td-agg">{fmtDwell(vAgg.avgLoad)}</td>
                      <td className="sv-td-agg">{fmtDwell(vAgg.avgUnload)}</td>
                    </tr>

                    {isOpen && v.orders.map((ord, oi) => {
                      const k1 = `${k0}_o${oi}`;
                      const isLast1 = oi === v.orders.length - 1;
                      const ordTrips = ord.records.reduce((s, r) => s + r.tripsCount, 0);
                      const ok1s = ord.records.filter(r => r.shiftType === 'shift1').map(r => r.kipPct);
                      const om1s = ord.records.filter(r => r.shiftType === 'shift1').map(r => r.movementPct);
                      const ok2s = ord.records.filter(r => r.shiftType === 'shift2' && r.kipPct > 0).map(r => r.kipPct);
                      const om2s = ord.records.filter(r => r.shiftType === 'shift2' && r.kipPct > 0).map(r => r.movementPct);
                      const oAk1 = avgOrDash(ok1s); const oAm1 = avgOrDash(om1s);
                      const oAk2 = avgOrDash(ok2s); const oAm2 = avgOrDash(om2s);
                      const oAgg = aggRecs(ord.records);

                      const dayMap = new Map<string, ShiftRecord[]>();
                      ord.records.forEach(r => {
                        const key = toDateStr(r.reportDate);
                        if (!dayMap.has(key)) dayMap.set(key, []);
                        dayMap.get(key)!.push(r);
                      });
                      const days = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));

                      return (
                        <React.Fragment key={k1}>
                          <tr className="sv-lv1" onClick={e => { e.stopPropagation(); togOrder(k1); }} style={{ cursor: 'pointer' }}>
                            <td>
                              <div className="sv-tree-cell">
                                <div className="sv-tree-indent">
                                  <div className={`sv-tree-pipe ${isLast1 ? 'last' : 'branch'}`} />
                                </div>
                                <div className={`sv-tree-expand ${expanded.has(k1) ? 'open' : ''}`}>▶</div>
                                <span className="sv-tree-label">#{ord.reqNum} · {ord.objName}</span>
                                {days.length > 1 && <span className="sv-lv-badge days">{days.length} дн.</span>}
                              </div>
                            </td>
                            <td>{ord.reqNum}</td>
                            <td style={{ fontSize: 9 }}>{ord.objName}</td>
                            <td>{shiftCntLabel(ord.records, filters.showOnsite)}</td>
                            <td style={{ fontWeight: 700 }}>{ordTrips}</td>
                            <td>—</td>
                            <td className={oAk1 !== '—' ? kipColor(Number(oAk1)) : ''}>{oAk1}</td>
                            <td className={oAm1 !== '—' ? kipColor(Number(oAm1)) : ''}>{oAm1}</td>
                            <td className={oAk2 !== '—' ? kipColor(Number(oAk2)) : ''}>{oAk2}</td>
                            <td className={oAm2 !== '—' ? kipColor(Number(oAm2)) : ''}>{oAm2}</td>
                            <td className="sv-td-agg">{fmtHours(oAgg.engineSec)}</td>
                            <td className="sv-td-agg">{fmtHours(oAgg.movingSec)}</td>
                            <td className="sv-td-agg">{fmtHours(oAgg.idleSec)}</td>
                            <td className="sv-td-agg">{fmtDwell(oAgg.avgLoad)}</td>
                            <td className="sv-td-agg">{fmtDwell(oAgg.avgUnload)}</td>
                          </tr>

                          {expanded.has(k1) && days.map(([date, dayRecs], di) => {
                            const k2 = `${k1}_d${di}`;
                            const isLast2 = di === days.length - 1;
                            const dayTrips = dayRecs.reduce((s, r) => s + r.tripsCount, 0);
                            const s1Rec = dayRecs.find(r => r.shiftType === 'shift1');
                            const s2Rec = dayRecs.find(r => r.shiftType === 'shift2');
                            const dAk1 = s1Rec?.kipPct ?? 0;
                            const dAm1 = s1Rec?.movementPct ?? 0;
                            const dAk2 = s2Rec?.kipPct ?? 0;
                            const dAm2 = s2Rec?.movementPct ?? 0;
                            const isDayOpen = expandedDays.has(k2);
                            const dAgg = aggRecs(dayRecs);

                            return (
                              <React.Fragment key={k2}>
                                <tr className="sv-lv2" onClick={e => { e.stopPropagation(); togDay(k2); }} style={{ cursor: 'pointer' }}>
                                  <td>
                                    <div className="sv-tree-cell">
                                      <div className="sv-tree-indent">
                                        <div className={`sv-tree-pipe ${isLast1 ? '' : 'line'}`} />
                                        <div className={`sv-tree-pipe ${isLast2 ? 'last' : 'branch'}`} />
                                      </div>
                                      <div className={`sv-tree-expand ${isDayOpen ? 'open' : ''}`}>▶</div>
                                      <span className="sv-tree-label">{fmtDateShort(date)}</span>
                                      {dayRecs.length > 1 && <span className="sv-lv-badge shifts">2 см.</span>}
                                    </div>
                                  </td>
                                  <td></td><td></td>
                                  <td>{dayRecs.length}</td>
                                  <td style={{ fontWeight: 600 }}>{dayTrips}</td>
                                  <td>—</td>
                                  <td className={dAk1 > 0 ? kipColor(dAk1) : ''}>{dAk1 > 0 ? dAk1 : '—'}</td>
                                  <td className={dAm1 > 0 ? kipColor(dAm1) : ''}>{dAm1 > 0 ? dAm1 : '—'}</td>
                                  <td className={dAk2 > 0 ? kipColor(dAk2) : ''}>{dAk2 > 0 ? dAk2 : '—'}</td>
                                  <td className={dAm2 > 0 ? kipColor(dAm2) : ''}>{dAm2 > 0 ? dAm2 : '—'}</td>
                                  <td className="sv-td-agg">{fmtHours(dAgg.engineSec)}</td>
                                  <td className="sv-td-agg">{fmtHours(dAgg.movingSec)}</td>
                                  <td className="sv-td-agg">{fmtHours(dAgg.idleSec)}</td>
                                  <td className="sv-td-agg">{fmtDwell(dAgg.avgLoad)}</td>
                                  <td className="sv-td-agg">{fmtDwell(dAgg.avgUnload)}</td>
                                </tr>

                                {isDayOpen && (
                                  <tr className="sv-sub-row">
                                    <td colSpan={15}>
                                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        {dayRecs
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
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Report overlay */}
      <div className={`sv-an-right ${reportOpen ? 'open' : ''}`}>
        <button className="sv-an-right-close" onClick={onToggleReport}>✕</button>
        <div className="sv-report-placeholder">
          <div className="sv-report-placeholder-emoji">🤌</div>
          <div className="sv-report-placeholder-text">Тут будут формироваться Excel-отчёты</div>
          <div className="sv-report-placeholder-sub">Выберите параметры отчёта, период и нажмите «Сформировать» — файл скачается автоматически</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────
export function DumpTrucksPage() {
  const [activeTab, setActiveTab] = useState<'orders' | 'analytics'>('orders');
  const [reportOpen, setReportOpen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());

  // Shared date range for both tabs
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo]     = useState(DEFAULT_DATE_TO);

  // Analytics-only filters
  const [analyticsFilters, setAnalyticsFilters] = useState<AnalyticsFilters>({ shift: 'all', objectUid: '', showOnsite: false });

  const [objects, setObjects] = useState<DtObject[]>([]);
  const [orders, setOrders] = useState<OrderCard[]>([]);
  const [shiftRecords, setShiftRecords] = useState<ShiftRecord[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);

  // Load objects and repairs once
  useEffect(() => {
    fetchObjects().then(setObjects).catch(console.error);
    fetchRepairs().then(setRepairs).catch(console.error);
  }, []);

  // Load orders when date range changes
  useEffect(() => {
    setLoadingOrders(true);
    fetchOrders(dateFrom, dateTo)
      .then(raw => setOrders(raw.map(toOrderCard)))
      .catch(console.error)
      .finally(() => setLoadingOrders(false));
  }, [dateFrom, dateTo]);

  // Load shift records when date range changes (shared by analytics + sidebar)
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

  // Group orders by city
  const cityMap = new Map<string, OrderCard[]>();
  orders.forEach(o => {
    if (!cityMap.has(o.city)) cityMap.set(o.city, []);
    cityMap.get(o.city)!.push(o);
  });

  return (
    <div className="sv-root flex-1 min-h-0">
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
        </div>

        {/* Date range — shown on both tabs */}
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
              <input type="checkbox" style={{ accentColor: 'var(--sv-accent)' }}
                checked={analyticsFilters.showOnsite}
                onChange={e => setAnalyticsFilters(f => ({ ...f, showOnsite: e.target.checked }))} />
            </label>
            <button className="sv-btn-report" onClick={() => setReportOpen(p => !p)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Формирование отчёта
            </button>
          </>
        )}
      </div>

      {/* Main content */}
      <div className="sv-main-wrap">
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
              ) : orders.length === 0 ? (
                <div className="sv-empty">
                  <span className="sv-empty-icon">📭</span>
                  <span className="sv-empty-text">Заявок не найдено</span>
                </div>
              ) : (
                [...cityMap.entries()].map(([city, cityOrders]) => {
                  const active = cityOrders.filter(o => !o.isDone);
                  const done = cityOrders.filter(o => o.isDone);
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
                          {active.map(o => (
                            <OrderCardView key={o.number} card={o}
                              expanded={expandedOrders.has(o.number)}
                              onToggle={() => toggleOrder(o.number)} />
                          ))}
                        </>
                      )}
                      {done.length > 0 && (
                        <>
                          <div className="sv-status-label">
                            <div className="sv-status-dot" style={{ background: '#22c55e' }} />
                            Выполненные ({done.length})
                          </div>
                          {done.map(o => (
                            <OrderCardView key={o.number} card={o}
                              expanded={expandedOrders.has(o.number)}
                              onToggle={() => toggleOrder(o.number)} />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })
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
            reportOpen={reportOpen}
            onToggleReport={() => setReportOpen(p => !p)}
            records={shiftRecords}
            loading={loadingRecords}
          />
        )}
      </div>
    </div>
  );
}

export default DumpTrucksPage;
