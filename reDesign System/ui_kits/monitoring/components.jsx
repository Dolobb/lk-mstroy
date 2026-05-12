// components.jsx — atomic UI components for the monitoring kit
// Loaded in browser as Babel-transpiled JSX, attaches components to window.

const { useState, useMemo } = React;

function kipClass(v) { return v >= 75 ? 'kg' : v >= 50 ? 'kb' : 'kr'; }
function kipBg(v) { return v >= 75 ? 'bg-kg' : v >= 50 ? 'bg-kb' : 'bg-kr'; }

// ─── Icons (lucide-style minimal stroke) ─────────────────
function Icon({ d, viewBox = '0 0 24 24', size = 14 }) {
  return <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
}
const I = {
  home: <Icon d={<><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>} />,
  settings: <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V22a2 2 0 1 1-4 0v-.1a2 2 0 0 0-1.2-1.8 2 2 0 0 0-2.2.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a2 2 0 0 0 .4-2.2 2 2 0 0 0-1.8-1.2H2a2 2 0 1 1 0-4h.1a2 2 0 0 0 1.8-1.2 2 2 0 0 0-.4-2.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a2 2 0 0 0 2.2.4h.1a2 2 0 0 0 1.2-1.8V2a2 2 0 1 1 4 0v.1a2 2 0 0 0 1.2 1.8 2 2 0 0 0 2.2-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0-.4 2.2v.1a2 2 0 0 0 1.8 1.2H22a2 2 0 1 1 0 4h-.1a2 2 0 0 0-1.8 1.2z"/></>} />,
  sun: <Icon d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>} />,
  moon: <Icon d={<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>} />,
  map: <Icon d={<><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></>} />,
  table: <Icon d={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></>} />,
  cards: <Icon d={<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>} />,
  bars: <Icon d={<><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>} />,
  expand: <Icon d={<><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>} />,
  shrink: <Icon d={<><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>} />,
  plus: <Icon d={<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>} />,
  minus: <Icon d={<line x1="5" y1="12" x2="19" y2="12"/>} />,
  search: <Icon d={<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>} />,
  file: <Icon d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>} />,
  spark: <Icon d={<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>} />,
  term: <Icon d={<><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>} />,
  wrench: <Icon d={<path d="M14.7 6.3a4.5 4.5 0 0 0-5.85 5.85L3 17.99V21h3.01l5.84-5.85a4.5 4.5 0 0 0 5.85-5.85z"/>} />,
};

// ─── Vehicle pictograms ──────────────────────────────────
function VehicleIcon({ kind, color }) {
  const stroke = color || 'currentColor';
  if (kind === 'samosvaly') return (
    <svg viewBox="0 0 64 40" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="veh-icon">
      <path d="M4 26 L8 8 L36 8 L36 26 Z"/><line x1="20" y1="26" x2="22" y2="12" strokeWidth="1.4"/>
      <rect x="37" y="14" width="20" height="12" rx="2"/><path d="M37 18 L43 18 L43 14"/>
      <line x1="4" y1="26" x2="57" y2="26"/><circle cx="14" cy="31" r="5"/><circle cx="44" cy="31" r="5"/><circle cx="55" cy="31" r="4"/>
    </svg>
  );
  if (kind === 'ekskav') return (
    <svg viewBox="0 0 64 40" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="veh-icon ekskav">
      <rect x="4" y="26" width="40" height="6" rx="2"/><circle cx="10" cy="33" r="3"/><circle cx="20" cy="33" r="3"/><circle cx="30" cy="33" r="3"/><circle cx="40" cy="33" r="3"/>
      <rect x="16" y="14" width="20" height="12" rx="2"/><path d="M36 16 L48 6 L54 12 L60 22 L56 24 L52 18 Z"/>
    </svg>
  );
  if (kind === 'kip') return (
    <svg viewBox="0 0 64 40" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="veh-icon kip">
      <circle cx="14" cy="28" r="9"/><circle cx="14" cy="28" r="5" strokeWidth="1.1"/>
      <rect x="24" y="16" width="26" height="14" rx="2"/><rect x="30" y="8" width="14" height="10" rx="2"/>
      <circle cx="54" cy="30" r="7"/>
    </svg>
  );
  // krany
  return (
    <svg viewBox="0 0 64 40" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="veh-icon krany">
      <rect x="14" y="24" width="34" height="8" rx="1"/><circle cx="22" cy="34" r="3"/><circle cx="38" cy="34" r="3"/>
      <line x1="32" y1="24" x2="32" y2="6"/><line x1="32" y1="6" x2="58" y2="14"/><line x1="50" y1="11" x2="50" y2="22"/>
    </svg>
  );
}

// ─── TopNav ──────────────────────────────────────────────
function TopNav({ theme, onTheme }) {
  return (
    <nav className="topnav glass">
      <div className="topnav-left">
        <button className="nav-btn">{I.home}<span>Главная</span></button>
        <button className="nav-btn">{I.settings}<span>КИП техники</span></button>
        <button className="nav-btn"><VehicleIcon kind="samosvaly" color="currentColor" /><span>Тягачи</span></button>
        <button className="nav-btn"><VehicleIcon kind="samosvaly" color="currentColor" /><span>Самосвалы</span></button>
        <button className="nav-btn active">{I.bars}<span>Аналитика</span></button>
      </div>
      <div className="topnav-right">
        <span className="topnav-link">{I.file}<span>Отчёты</span></span>
        <span className="topnav-link">{I.spark}<span>AI Demo</span></span>
        <span className="topnav-link">{I.term}<span>Серверы</span></span>
        <span className="topnav-link">{I.wrench}<span>Состояние ТС</span></span>
        <span className="topnav-link">{I.map}<span>Гео</span></span>
        <span className="topnav-link" onClick={onTheme} style={{cursor:'pointer'}}>
          {theme === 'dark' ? I.sun : I.moon}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </span>
        <div className="brand"><b>НПС</b><span>/</span><i>МОНИТОРИНГ</i></div>
      </div>
    </nav>
  );
}

// ─── Filters bar ─────────────────────────────────────────
function FiltersBar({ view, onView, query, onQuery, filter, onFilter }) {
  const types = ['Все','Самосв. доставка','Самосв. по месту','Краны авт.','Краны гусен.','Краны пневмо','Бульдозер','Каток','Погрузчик','Эксков. гусен.'];
  return (
    <div className="filters glass">
      <div className="title">Аналитика</div>
      <button className="pill"><span>30.04 — 12.05.2026</span></button>
      <button className="pill orange active">Σ %</button>
      <div className="sep" />
      {types.map((t,i) => (
        <button key={i} className={`pill sm ${filter === t ? 'active' : ''}`} onClick={() => onFilter(t)}>{t}</button>
      ))}
      <div className="sep" />
      <input className="search" placeholder="Поиск ТС…" value={query} onChange={e => onQuery(e.target.value)} />
      <div style={{flex:1}} />
      <div className="view-tabs">
        <button className={`view-tab ${view === 'table' ? 'active' : ''}`} onClick={() => onView('table')}>{I.table}<span>Таблица</span></button>
        <button className={`view-tab ${view === 'cards' ? 'active' : ''}`} onClick={() => onView('cards')}>{I.cards}<span>Карточки</span></button>
        <button className={`view-tab ${view === 'map' ? 'active' : ''}`} onClick={() => onView('map')}>{I.map}<span>Карта</span></button>
      </div>
    </div>
  );
}

// ─── KPI strip ───────────────────────────────────────────
function KpiStrip({ objects, activeId, onPick }) {
  const all = { id: 'all', short: 'ВСЕ', vehicles: objects.reduce((s,o) => s+o.vehicles, 0), trips: objects.reduce((s,o) => s+o.trips, 0), kip: 49 };
  return (
    <div className="kpi-strip">
      {[all, ...objects].map(o => (
        <div key={o.id} className={`kpi-box ${activeId === o.id ? 'active' : ''}`} onClick={() => onPick(o.id)}>
          <div className="eyebrow" title={o.name || 'Все'}>{o.short || o.name}</div>
          <div className="row"><span>ТС</span><b>{o.vehicles}</b></div>
          <div className="row"><span>Работа</span><b>{o.trips} рейс.</b></div>
          <div className="row"><span>Ср.КИП</span><b className={kipClass(o.kip)}>{o.kip}%</b></div>
        </div>
      ))}
    </div>
  );
}

// ─── KIP mini bar (compact) ───────────────────────────────
function KipBar({ kip, mov }) {
  return (
    <div className="kipbar">
      <div className="row">
        <div className="track"><i className={kipBg(kip)} style={{width: kip + '%'}} /></div>
        <div className={`v ${kipClass(kip)}`}>{kip}%</div>
      </div>
      <div className="row">
        <div className="track" style={{opacity:.7}}><i className={kipBg(mov)} style={{width: mov + '%'}} /></div>
        <div className={`v ${kipClass(mov)}`} style={{opacity:.7}}>{mov}%</div>
      </div>
    </div>
  );
}

// ─── Shift chip ───────────────────────────────────────────
function ShiftChip({ date, shift, trips, kip, active }) {
  const zero = trips === 0;
  return (
    <span className={`chip ${zero ? 'zero' : ''} ${active ? 'active-day' : ''}`} title={`${date} С${shift} · КИП ${kip}%`}>
      <span>{date}</span><span style={{opacity:.4}}>·</span><span>C{shift}</span><span style={{opacity:.4}}>·</span>
      <span>{zero ? 'Op' : `${trips}р`}</span>
      {!zero && <span className="bar"><i className={kipBg(kip)} style={{width: kip + '%'}}/></span>}
    </span>
  );
}

Object.assign(window, { TopNav, FiltersBar, KpiStrip, KipBar, ShiftChip, VehicleIcon, kipClass, kipBg, I });
