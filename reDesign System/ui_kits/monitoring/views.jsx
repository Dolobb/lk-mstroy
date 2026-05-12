// views.jsx — full app views (Table, Cards, Map) using components from components.jsx
const { useState: useStateV, useEffect: useEffectV, useMemo: useMemoV, useRef: useRefV } = React;

// ─── Vehicle row in the analytics table ──────────────────
function VehicleRow({ v }) {
  const last = v.chips.slice(-8);
  return (
    <tr>
      <td>
        <div className="plate">{v.plate}</div>
        <div className="model">{v.model}</div>
      </td>
      <td><span className="pill sm">{v.type === 'samosvaly' ? 'Самосвал' : v.type === 'ekskav' ? 'Эксков.' : v.type === 'kip' ? 'КИП' : 'Кран'}</span></td>
      <td><span className="lit">{v.org}</span></td>
      <td>
        <div className="chips-row">
          {last.map((c, i) => <ShiftChip key={i} {...c} active={i === last.length - 1} />)}
        </div>
      </td>
      <td>
        <div style={{display:'flex',flexDirection:'column',gap:1}}>
          <span style={{fontWeight:700,color:'var(--fg-1)',fontSize:13}}>{v.trips24} р</span>
          <span style={{fontSize:10,color:'var(--fg-3)'}}>{v.liters} л</span>
        </div>
      </td>
      <td><KipBar kip={v.kip} mov={v.idle * 2 < 100 ? v.idle * 2 : v.idle} /></td>
      <td><span style={{fontWeight:700,color:'var(--fg-1)',fontVariantNumeric:'tabular-nums'}}>{v.engineTotal}</span></td>
    </tr>
  );
}

// ─── TABLE VIEW ───────────────────────────────────────────
function TableView({ vehicles, objects, focusId }) {
  const focus = objects.find(o => o.id === focusId) || objects[0];
  const [openTypes, setOpenTypes] = useStateV({ samosvaly: true, ekskav: true, kip: true, krany: true });
  const groups = {
    samosvaly: vehicles.filter(v => v.type === 'samosvaly'),
    ekskav: vehicles.filter(v => v.type === 'ekskav'),
    kip: vehicles.filter(v => v.type === 'kip'),
    krany: vehicles.filter(v => v.type === 'krany'),
  };
  const labels = { samosvaly: 'Самосвалы', ekskav: 'Экскаваторы', kip: 'КИП-техника', krany: 'Краны' };

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>ТС / Модель</th>
            <th>Тип</th>
            <th>Орг.</th>
            <th>Смены (последние 8)</th>
            <th>Рейсы / расход</th>
            <th>КИП / Движение</th>
            <th>Двиг. итого</th>
          </tr>
        </thead>
        <tbody>
          <tr className="group-row">
            <td colSpan="7">
              <span className="group-arrow open">▶</span>
              {focus.name} <span style={{color:'var(--fg-3)'}}>· {focus.vehicles} ТС · КИП {focus.kip}%</span>
              <span className="count-badge">{vehicles.length}</span>
            </td>
          </tr>
          {Object.entries(groups).map(([key, vs]) => vs.length > 0 && (
            <React.Fragment key={key}>
              <tr className="group-row" onClick={() => setOpenTypes(o => ({...o, [key]: !o[key]}))} style={{cursor:'pointer'}}>
                <td colSpan="7" style={{paddingLeft:24}}>
                  <span className={`group-arrow ${openTypes[key] ? 'open' : ''}`}>▶</span>
                  {labels[key]}
                  <span className="count-badge">{vs.length} ТС</span>
                </td>
              </tr>
              {openTypes[key] && vs.map(v => <VehicleRow key={v.plate} v={v} />)}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── CARDS VIEW ───────────────────────────────────────────
function VehicleCard({ v }) {
  const last = v.chips.slice(-10);
  return (
    <div className="veh-card">
      <div className="veh-head">
        <VehicleIcon kind={v.type} />
        <div>
          <div className="veh-plate">{v.plate}</div>
          <div className="veh-model">{v.model}</div>
        </div>
        <span className="veh-org">{v.org}</span>
      </div>
      <div className="veh-meta-row">
        <div className="meta"><span className="lbl">КИП</span><span className={`val ${kipClass(v.kip)}`}>{v.kip}%</span></div>
        <div className="meta"><span className="lbl">Смены</span><span className="val">{v.shifts}</span></div>
        <div className="meta"><span className="lbl">Рейсы 24ч</span><span className="val">{v.trips24}</span></div>
        <div className="meta"><span className="lbl">Расход</span><span className="val">{v.liters} л</span></div>
        <div className="meta"><span className="lbl">Двиг.</span><span className="val">{v.engineTotal}</span></div>
      </div>
      <div className="veh-chips">
        {last.map((c, i) => <ShiftChip key={i} {...c} />)}
      </div>
    </div>
  );
}
function CardsView({ vehicles, objects, focusId }) {
  const focus = objects.find(o => o.id === focusId) || objects[0];
  const sideObjs = objects.slice(0, 4);
  return (
    <div className="cards-wrap">
      <div className="cards-scroll">
        {vehicles.map(v => <VehicleCard key={v.plate} v={v} />)}
      </div>
      <aside className="side-panel">
        <div className="side-week">
          <button className="arr">‹</button>
          <div>
            <div className="side-week-t">30.04 — 12.05.2026</div>
            <div className="side-week-s">13 дней · 8 объектов</div>
          </div>
          <button className="arr">›</button>
        </div>
        {sideObjs.map(o => (
          <div key={o.id} className="obj-section">
            <div className="obj-h">
              <span className="obj-dot" style={{background: kipClass(o.kip) === 'kg' ? 'var(--kip-good)' : kipClass(o.kip) === 'kb' ? 'var(--kip-mid)' : 'var(--kip-bad)'}}/>
              <span className="obj-n">{o.short}</span>
              <span className={kipClass(o.kip)} style={{fontWeight:800,fontSize:12}}>{o.kip}%</span>
            </div>
            <div className="obj-kpi-row">
              <div className="mini-kpi"><div className="l">ТС</div><div className="v">{o.vehicles}</div></div>
              <div className="mini-kpi"><div className="l">Рейсы</div><div className="v">{o.trips}</div></div>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

// ─── MAP VIEW (новое — карта с зонами) ────────────────────
function MapView({ vehicles, objects, focusId, onFocus }) {
  const [fs, setFs] = useStateV(false);
  const [zoom, setZoom] = useStateV(1);
  const [pan, setPan] = useStateV({ x: 0, y: 0 });

  const focus = objects.find(o => o.id === focusId) || objects[0];

  // Map objects to fictional positions on viewport
  const positions = useMemoV(() => {
    const W = 1100, H = 600;
    const seed = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; };
    const layout = {
      ekb:     { x: 460, y: 200, r: 110 },
      omsk:    { x: 590, y: 240, r: 95  },
      pyt:     { x: 680, y: 130, r: 80  },
      vsm:     { x: 720, y: 320, r: 105 },
      bod:     { x: 870, y: 240, r: 95  },
      belogor: { x: 980, y: 360, r: 130 },
      amur:    { x: 1010,y: 410, r: 100 },
      akiv:    { x: 800, y: 160, r: 80  },
    };
    return objects.map(o => ({ ...o, pos: layout[o.id] || { x: 200 + (seed(o.id) % 700), y: 100 + (seed(o.id) % 400), r: 90 } }));
  }, [objects]);

  // Build a polygon (irregular hex) around the center for each object
  function makeZone(cx, cy, r, id) {
    const seed = (n) => { let x = n; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return (x / 0x7fffffff); }; };
    let salt = 0; for (let i = 0; i < id.length; i++) salt = (salt * 31 + id.charCodeAt(i)) >>> 0;
    const rnd = seed(salt);
    const points = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const rr = r * (0.78 + rnd() * 0.35);
      points.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr * 0.78]);
    }
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join(' ') + ' Z';
  }

  // Pins for focused object's vehicles
  const vehiclesForFocus = vehicles; // already pre-filtered by parent
  const typeGroups = useMemoV(() => {
    const g = {};
    vehiclesForFocus.forEach(v => { (g[v.type] = g[v.type] || []).push(v); });
    return g;
  }, [vehiclesForFocus]);

  const typeColors = { samosvaly: '#F97316', kip: '#60A5FA', ekskav: '#A78BFA', krany: '#22C55E' };
  const typeLabels = { samosvaly: 'Самосвалы', kip: 'КИП-техника', ekskav: 'Экскаваторы', krany: 'Краны' };

  // Pin positions inside the focused zone (cluster around center)
  const focusedPos = positions.find(p => p.id === focus.id)?.pos || { x: 600, y: 300, r: 110 };
  const pinPositions = useMemoV(() => {
    const pts = [];
    let typeIdx = 0;
    for (const t of Object.keys(typeGroups)) {
      const items = typeGroups[t];
      const baseAngle = (typeIdx / Object.keys(typeGroups).length) * Math.PI * 2;
      items.forEach((v, i) => {
        const a = baseAngle + (i / items.length) * (Math.PI * 2 / Object.keys(typeGroups).length) + 0.3;
        const r = focusedPos.r * (0.35 + (i % 3) * 0.18);
        pts.push({ v, x: focusedPos.x + Math.cos(a) * r, y: focusedPos.y + Math.sin(a) * r * 0.7 });
      });
      typeIdx++;
    }
    return pts;
  }, [typeGroups, focusedPos]);

  const [openGroups, setOpenGroups] = useStateV({ samosvaly: true, kip: true, ekskav: true, krany: true });

  return (
    <div className={`map-wrap ${fs ? 'fs' : ''}`}>
      <div className="map-canvas">
        <svg viewBox="0 0 1100 600" className="map-svg" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(96,165,250,0.10)" strokeWidth="1.2"/>
            </pattern>
            <radialGradient id="zoneActive" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="rgba(249,115,22,0.20)"/>
              <stop offset="100%" stopColor="rgba(249,115,22,0.05)"/>
            </radialGradient>
          </defs>
          <rect width="1100" height="600" className="map-tile-bg"/>
          <rect width="1100" height="600" fill="url(#hatch)"/>
          {/* grid */}
          <g className="map-grid">
            {Array.from({length: 14}, (_,i) => <line key={'h'+i} x1="0" y1={i*45} x2="1100" y2={i*45}/>)}
            {Array.from({length: 22}, (_,i) => <line key={'v'+i} x1={i*55} y1="0" x2={i*55} y2="600"/>)}
          </g>

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {/* zones */}
            {positions.map(o => {
              const d = makeZone(o.pos.x, o.pos.y, o.pos.r, o.id);
              const active = o.id === focus.id;
              return (
                <g key={o.id} onClick={() => onFocus(o.id)}>
                  <path className={`zone ${active ? 'active' : ''}`} d={d} fill={active ? 'url(#zoneActive)' : undefined}/>
                  <text className="zone-label" x={o.pos.x} y={o.pos.y - 8} textAnchor="middle">{o.short}</text>
                  <text className="zone-sub" x={o.pos.x} y={o.pos.y + 8} textAnchor="middle">{o.vehicles} ТС · КИП {o.kip}%</text>
                </g>
              );
            })}
            {/* pins for focused */}
            {pinPositions.map((p, i) => (
              <g key={i} className="pin">
                <circle cx={p.x} cy={p.y} r="11" fill={typeColors[p.v.type]} fillOpacity="0.95"/>
                <text x={p.x} y={p.y + 3.5}>{p.v.type[0].toUpperCase()}</text>
              </g>
            ))}
          </g>
        </svg>

        <div className="map-controls">
          <button className="map-btn" onClick={() => setFs(!fs)} title={fs ? 'Свернуть' : 'На весь экран'}>{fs ? '⤡' : '⤢'}</button>
          <button className="map-btn" onClick={() => setZoom(z => Math.min(3, z + 0.2))}>＋</button>
          <button className="map-btn" onClick={() => setZoom(z => Math.max(0.6, z - 0.2))}>−</button>
          <button className="map-btn" onClick={() => { setZoom(1); setPan({x:0,y:0}); }} title="Сброс">⟲</button>
        </div>

        <div className="map-legend">
          <span className="l"><span className="d" style={{background:'#F97316'}}/>Самосв.</span>
          <span className="l"><span className="d" style={{background:'#60A5FA'}}/>КИП</span>
          <span className="l"><span className="d" style={{background:'#A78BFA'}}/>Эксков.</span>
          <span className="l"><span className="d" style={{background:'#22C55E'}}/>Краны</span>
          <span style={{color:'var(--fg-4)',fontSize:9,marginLeft:8}}>Клик по зоне — выбор объекта</span>
        </div>
      </div>

      {!fs && (
        <aside className="inspector">
          <h3>{focus.name}</h3>
          <div className="sub">{focus.vehicles} ТС · {focus.trips.toLocaleString('ru-RU')} рейсов</div>
          <div className="stats">
            <div className="stat"><div className="l">Ср. КИП</div><div className={`v ${kipClass(focus.kip)}`}>{focus.kip}%</div></div>
            <div className="stat"><div className="l">Типов ТС</div><div className="v">{Object.keys(typeGroups).length}</div></div>
            <div className="stat"><div className="l">Зона, км²</div><div className="v">{(focus.vehicles * 0.7).toFixed(1)}</div><div className="vs">оценочно</div></div>
            <div className="stat"><div className="l">Период</div><div className="v" style={{fontSize:13}}>13дн</div><div className="vs">30.04 — 12.05</div></div>
          </div>

          {Object.entries(typeGroups).map(([t, vs]) => (
            <div className="tg" key={t}>
              <div className="tg-h" onClick={() => setOpenGroups(g => ({...g, [t]: !g[t]}))}>
                <span className="tg-name">
                  <span className="d" style={{background: typeColors[t]}}/>{typeLabels[t]}
                  <span className="c">{vs.length}</span>
                </span>
                <span style={{fontSize:10,color:'var(--fg-3)'}}>{openGroups[t] ? '−' : '+'}</span>
              </div>
              {openGroups[t] && vs.map(v => (
                <div className="vrow" key={v.plate}>
                  <div className="p">{v.plate}</div>
                  <div className="meta-mini">
                    <span>см. <b>{v.shifts}</b></span>
                    <span>р. <b>{v.trips24}</b></span>
                    <span>дв. <b>{v.engineTotal}</b></span>
                  </div>
                  <KipBar kip={v.kip} mov={Math.min(99, v.idle*2)} />
                </div>
              ))}
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}

Object.assign(window, { TableView, CardsView, MapView, VehicleRow, VehicleCard });
