/* @ds-bundle: {"format":3,"namespace":"DesignSystem_019e1b","components":[],"sourceHashes":{"ui_kits/monitoring/app.jsx":"a2f866f75b13","ui_kits/monitoring/components.jsx":"518806ce5879","ui_kits/monitoring/data.js":"4ae91674408e","ui_kits/monitoring/views.jsx":"50ef0ba17822"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_019e1b = window.DesignSystem_019e1b || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/monitoring/app.jsx
try { (() => {
// app.jsx — root app for the monitoring UI kit
const {
  useState,
  useEffect,
  useMemo
} = React;
function App() {
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('table');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Все');
  const [focusId, setFocusId] = useState('belogor');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const {
    objects,
    vehicles
  } = window.MOCK;
  const filtered = useMemo(() => {
    let v = vehicles;
    if (query) v = v.filter(x => (x.plate + ' ' + x.model).toLowerCase().includes(query.toLowerCase()));
    if (filter !== 'Все') {
      if (filter.startsWith('Самосв')) v = v.filter(x => x.type === 'samosvaly');else if (filter.startsWith('Эксков')) v = v.filter(x => x.type === 'ekskav');else if (filter.startsWith('Кран')) v = v.filter(x => x.type === 'krany');
    }
    return v;
  }, [vehicles, query, filter]);
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("div", {
    className: "amb amb-o"
  }), /*#__PURE__*/React.createElement("div", {
    className: "amb amb-b"
  }), /*#__PURE__*/React.createElement(TopNav, {
    theme: theme,
    onTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  }), /*#__PURE__*/React.createElement(FiltersBar, {
    view: view,
    onView: setView,
    query: query,
    onQuery: setQuery,
    filter: filter,
    onFilter: setFilter
  }), /*#__PURE__*/React.createElement(KpiStrip, {
    objects: objects,
    activeId: focusId,
    onPick: setFocusId
  }), /*#__PURE__*/React.createElement("main", {
    className: "main"
  }, view === 'table' && /*#__PURE__*/React.createElement(TableView, {
    vehicles: filtered,
    objects: objects,
    focusId: focusId
  }), view === 'cards' && /*#__PURE__*/React.createElement(CardsView, {
    vehicles: filtered,
    objects: objects,
    focusId: focusId
  }), view === 'map' && /*#__PURE__*/React.createElement(MapView, {
    vehicles: filtered,
    objects: objects,
    focusId: focusId,
    onFocus: setFocusId
  })));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/monitoring/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/monitoring/components.jsx
try { (() => {
// components.jsx — atomic UI components for the monitoring kit
// Loaded in browser as Babel-transpiled JSX, attaches components to window.

const {
  useState,
  useMemo
} = React;
function kipClass(v) {
  return v >= 75 ? 'kg' : v >= 50 ? 'kb' : 'kr';
}
function kipBg(v) {
  return v >= 75 ? 'bg-kg' : v >= 50 ? 'bg-kb' : 'bg-kr';
}

// ─── Icons (lucide-style minimal stroke) ─────────────────
function Icon({
  d,
  viewBox = '0 0 24 24',
  size = 14
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: viewBox,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, d);
}
const I = {
  home: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 12l9-9 9 9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M5 10v10h14V10"
    }))
  }),
  settings: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "3"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19.4 15a2 2 0 0 0 .4 2.2l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V22a2 2 0 1 1-4 0v-.1a2 2 0 0 0-1.2-1.8 2 2 0 0 0-2.2.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a2 2 0 0 0 .4-2.2 2 2 0 0 0-1.8-1.2H2a2 2 0 1 1 0-4h.1a2 2 0 0 0 1.8-1.2 2 2 0 0 0-.4-2.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a2 2 0 0 0 2.2.4h.1a2 2 0 0 0 1.2-1.8V2a2 2 0 1 1 4 0v.1a2 2 0 0 0 1.2 1.8 2 2 0 0 0 2.2-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a2 2 0 0 0-.4 2.2v.1a2 2 0 0 0 1.8 1.2H22a2 2 0 1 1 0 4h-.1a2 2 0 0 0-1.8 1.2z"
    }))
  }),
  sun: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
    }))
  }),
  moon: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
    })
  }),
  map: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polygon", {
      points: "3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "9",
      y1: "3",
      x2: "9",
      y2: "18"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "15",
      y1: "6",
      x2: "15",
      y2: "21"
    }))
  }),
  table: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 9h18M3 15h18M9 3v18M15 3v18"
    }))
  }),
  cards: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    }))
  }),
  bars: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "20",
      x2: "12",
      y2: "10"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "18",
      y1: "20",
      x2: "18",
      y2: "4"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "6",
      y1: "20",
      x2: "6",
      y2: "16"
    }))
  }),
  expand: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "15 3 21 3 21 9"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "9 21 3 21 3 15"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "3",
      x2: "14",
      y2: "10"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "3",
      y1: "21",
      x2: "10",
      y2: "14"
    }))
  }),
  shrink: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "4 14 10 14 10 20"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "20 10 14 10 14 4"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "14",
      y1: "10",
      x2: "21",
      y2: "3"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "3",
      y1: "21",
      x2: "10",
      y2: "14"
    }))
  }),
  plus: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "5",
      x2: "12",
      y2: "19"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "5",
      y1: "12",
      x2: "19",
      y2: "12"
    }))
  }),
  minus: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("line", {
      x1: "5",
      y1: "12",
      x2: "19",
      y2: "12"
    })
  }),
  search: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "8"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "21",
      y1: "21",
      x2: "16.65",
      y2: "16.65"
    }))
  }),
  file: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "14 2 14 8 20 8"
    }))
  }),
  spark: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"
    })
  }),
  term: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "4 17 10 11 4 5"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "19",
      x2: "20",
      y2: "19"
    }))
  }),
  wrench: /*#__PURE__*/React.createElement(Icon, {
    d: /*#__PURE__*/React.createElement("path", {
      d: "M14.7 6.3a4.5 4.5 0 0 0-5.85 5.85L3 17.99V21h3.01l5.84-5.85a4.5 4.5 0 0 0 5.85-5.85z"
    })
  })
};

// ─── Vehicle pictograms ──────────────────────────────────
function VehicleIcon({
  kind,
  color
}) {
  const stroke = color || 'currentColor';
  if (kind === 'samosvaly') return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 40",
    fill: "none",
    stroke: stroke,
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "veh-icon"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 26 L8 8 L36 8 L36 26 Z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "20",
    y1: "26",
    x2: "22",
    y2: "12",
    strokeWidth: "1.4"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "37",
    y: "14",
    width: "20",
    height: "12",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M37 18 L43 18 L43 14"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    y1: "26",
    x2: "57",
    y2: "26"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "14",
    cy: "31",
    r: "5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "44",
    cy: "31",
    r: "5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "55",
    cy: "31",
    r: "4"
  }));
  if (kind === 'ekskav') return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 40",
    fill: "none",
    stroke: stroke,
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "veh-icon ekskav"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "26",
    width: "40",
    height: "6",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "10",
    cy: "33",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "20",
    cy: "33",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "30",
    cy: "33",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "40",
    cy: "33",
    r: "3"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "16",
    y: "14",
    width: "20",
    height: "12",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M36 16 L48 6 L54 12 L60 22 L56 24 L52 18 Z"
  }));
  if (kind === 'kip') return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 40",
    fill: "none",
    stroke: stroke,
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "veh-icon kip"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "14",
    cy: "28",
    r: "9"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "14",
    cy: "28",
    r: "5",
    strokeWidth: "1.1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "24",
    y: "16",
    width: "26",
    height: "14",
    rx: "2"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "30",
    y: "8",
    width: "14",
    height: "10",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "54",
    cy: "30",
    r: "7"
  }));
  // krany
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 64 40",
    fill: "none",
    stroke: stroke,
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "veh-icon krany"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "24",
    width: "34",
    height: "8",
    rx: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "22",
    cy: "34",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "38",
    cy: "34",
    r: "3"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "32",
    y1: "24",
    x2: "32",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "32",
    y1: "6",
    x2: "58",
    y2: "14"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "50",
    y1: "11",
    x2: "50",
    y2: "22"
  }));
}

// ─── TopNav ──────────────────────────────────────────────
function TopNav({
  theme,
  onTheme
}) {
  return /*#__PURE__*/React.createElement("nav", {
    className: "topnav glass"
  }, /*#__PURE__*/React.createElement("div", {
    className: "topnav-left"
  }, /*#__PURE__*/React.createElement("button", {
    className: "nav-btn"
  }, I.home, /*#__PURE__*/React.createElement("span", null, "\u0413\u043B\u0430\u0432\u043D\u0430\u044F")), /*#__PURE__*/React.createElement("button", {
    className: "nav-btn"
  }, I.settings, /*#__PURE__*/React.createElement("span", null, "\u041A\u0418\u041F \u0442\u0435\u0445\u043D\u0438\u043A\u0438")), /*#__PURE__*/React.createElement("button", {
    className: "nav-btn"
  }, /*#__PURE__*/React.createElement(VehicleIcon, {
    kind: "samosvaly",
    color: "currentColor"
  }), /*#__PURE__*/React.createElement("span", null, "\u0422\u044F\u0433\u0430\u0447\u0438")), /*#__PURE__*/React.createElement("button", {
    className: "nav-btn"
  }, /*#__PURE__*/React.createElement(VehicleIcon, {
    kind: "samosvaly",
    color: "currentColor"
  }), /*#__PURE__*/React.createElement("span", null, "\u0421\u0430\u043C\u043E\u0441\u0432\u0430\u043B\u044B")), /*#__PURE__*/React.createElement("button", {
    className: "nav-btn active"
  }, I.bars, /*#__PURE__*/React.createElement("span", null, "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430"))), /*#__PURE__*/React.createElement("div", {
    className: "topnav-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "topnav-link"
  }, I.file, /*#__PURE__*/React.createElement("span", null, "\u041E\u0442\u0447\u0451\u0442\u044B")), /*#__PURE__*/React.createElement("span", {
    className: "topnav-link"
  }, I.spark, /*#__PURE__*/React.createElement("span", null, "AI Demo")), /*#__PURE__*/React.createElement("span", {
    className: "topnav-link"
  }, I.term, /*#__PURE__*/React.createElement("span", null, "\u0421\u0435\u0440\u0432\u0435\u0440\u044B")), /*#__PURE__*/React.createElement("span", {
    className: "topnav-link"
  }, I.wrench, /*#__PURE__*/React.createElement("span", null, "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0422\u0421")), /*#__PURE__*/React.createElement("span", {
    className: "topnav-link"
  }, I.map, /*#__PURE__*/React.createElement("span", null, "\u0413\u0435\u043E")), /*#__PURE__*/React.createElement("span", {
    className: "topnav-link",
    onClick: onTheme,
    style: {
      cursor: 'pointer'
    }
  }, theme === 'dark' ? I.sun : I.moon, /*#__PURE__*/React.createElement("span", null, theme === 'dark' ? 'Light' : 'Dark')), /*#__PURE__*/React.createElement("div", {
    className: "brand"
  }, /*#__PURE__*/React.createElement("b", null, "\u041D\u041F\u0421"), /*#__PURE__*/React.createElement("span", null, "/"), /*#__PURE__*/React.createElement("i", null, "\u041C\u041E\u041D\u0418\u0422\u041E\u0420\u0418\u041D\u0413"))));
}

// ─── Filters bar ─────────────────────────────────────────
function FiltersBar({
  view,
  onView,
  query,
  onQuery,
  filter,
  onFilter
}) {
  const types = ['Все', 'Самосв. доставка', 'Самосв. по месту', 'Краны авт.', 'Краны гусен.', 'Краны пневмо', 'Бульдозер', 'Каток', 'Погрузчик', 'Эксков. гусен.'];
  return /*#__PURE__*/React.createElement("div", {
    className: "filters glass"
  }, /*#__PURE__*/React.createElement("div", {
    className: "title"
  }, "\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430"), /*#__PURE__*/React.createElement("button", {
    className: "pill"
  }, /*#__PURE__*/React.createElement("span", null, "30.04 \u2014 12.05.2026")), /*#__PURE__*/React.createElement("button", {
    className: "pill orange active"
  }, "\u03A3 %"), /*#__PURE__*/React.createElement("div", {
    className: "sep"
  }), types.map((t, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: `pill sm ${filter === t ? 'active' : ''}`,
    onClick: () => onFilter(t)
  }, t)), /*#__PURE__*/React.createElement("div", {
    className: "sep"
  }), /*#__PURE__*/React.createElement("input", {
    className: "search",
    placeholder: "\u041F\u043E\u0438\u0441\u043A \u0422\u0421\u2026",
    value: query,
    onChange: e => onQuery(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "view-tabs"
  }, /*#__PURE__*/React.createElement("button", {
    className: `view-tab ${view === 'table' ? 'active' : ''}`,
    onClick: () => onView('table')
  }, I.table, /*#__PURE__*/React.createElement("span", null, "\u0422\u0430\u0431\u043B\u0438\u0446\u0430")), /*#__PURE__*/React.createElement("button", {
    className: `view-tab ${view === 'cards' ? 'active' : ''}`,
    onClick: () => onView('cards')
  }, I.cards, /*#__PURE__*/React.createElement("span", null, "\u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438")), /*#__PURE__*/React.createElement("button", {
    className: `view-tab ${view === 'map' ? 'active' : ''}`,
    onClick: () => onView('map')
  }, I.map, /*#__PURE__*/React.createElement("span", null, "\u041A\u0430\u0440\u0442\u0430"))));
}

// ─── KPI strip ───────────────────────────────────────────
function KpiStrip({
  objects,
  activeId,
  onPick
}) {
  const all = {
    id: 'all',
    short: 'ВСЕ',
    vehicles: objects.reduce((s, o) => s + o.vehicles, 0),
    trips: objects.reduce((s, o) => s + o.trips, 0),
    kip: 49
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "kpi-strip"
  }, [all, ...objects].map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    className: `kpi-box ${activeId === o.id ? 'active' : ''}`,
    onClick: () => onPick(o.id)
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    title: o.name || 'Все'
  }, o.short || o.name), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", null, "\u0422\u0421"), /*#__PURE__*/React.createElement("b", null, o.vehicles)), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", null, "\u0420\u0430\u0431\u043E\u0442\u0430"), /*#__PURE__*/React.createElement("b", null, o.trips, " \u0440\u0435\u0439\u0441.")), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", null, "\u0421\u0440.\u041A\u0418\u041F"), /*#__PURE__*/React.createElement("b", {
    className: kipClass(o.kip)
  }, o.kip, "%")))));
}

// ─── KIP mini bar (compact) ───────────────────────────────
function KipBar({
  kip,
  mov
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "kipbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "track"
  }, /*#__PURE__*/React.createElement("i", {
    className: kipBg(kip),
    style: {
      width: kip + '%'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: `v ${kipClass(kip)}`
  }, kip, "%")), /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "track",
    style: {
      opacity: .7
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: kipBg(mov),
    style: {
      width: mov + '%'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: `v ${kipClass(mov)}`,
    style: {
      opacity: .7
    }
  }, mov, "%")));
}

// ─── Shift chip ───────────────────────────────────────────
function ShiftChip({
  date,
  shift,
  trips,
  kip,
  active
}) {
  const zero = trips === 0;
  return /*#__PURE__*/React.createElement("span", {
    className: `chip ${zero ? 'zero' : ''} ${active ? 'active-day' : ''}`,
    title: `${date} С${shift} · КИП ${kip}%`
  }, /*#__PURE__*/React.createElement("span", null, date), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .4
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, "C", shift), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .4
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, zero ? 'Op' : `${trips}р`), !zero && /*#__PURE__*/React.createElement("span", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    className: kipBg(kip),
    style: {
      width: kip + '%'
    }
  })));
}
Object.assign(window, {
  TopNav,
  FiltersBar,
  KpiStrip,
  KipBar,
  ShiftChip,
  VehicleIcon,
  kipClass,
  kipBg,
  I
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/monitoring/components.jsx", error: String((e && e.message) || e) }); }

// ui_kits/monitoring/data.js
try { (() => {
// data.js — мок данных мониторинга
// Имена объектов и ТС взяты из реальных скриншотов (uploads/).
window.MOCK = (() => {
  const objects = [{
    id: 'ekb',
    name: 'Екатеринбург',
    short: 'Екатеринбург',
    vehicles: 13,
    kip: 95,
    trips: 1496,
    lat: 56.84,
    lng: 60.61,
    polygon: 'M 80 90 L 220 70 L 290 140 L 260 230 L 130 240 L 60 170 Z'
  }, {
    id: 'omsk',
    name: 'Омск',
    short: 'Омск',
    vehicles: 10,
    kip: 78,
    trips: 24,
    lat: 54.99,
    lng: 73.37,
    polygon: 'M 70 80 L 200 60 L 270 130 L 230 220 L 100 230 L 50 160 Z'
  }, {
    id: 'pyt',
    name: 'Пыть-Ях',
    short: 'Пыть-Ях',
    vehicles: 2,
    kip: 63,
    trips: 0,
    lat: 60.74,
    lng: 72.86,
    polygon: 'M 90 60 L 240 80 L 280 180 L 200 240 L 80 220 L 60 140 Z'
  }, {
    id: 'amur',
    name: 'СМУ Амурская область, мост ч/з р. Завитая',
    short: 'СМУ Амурская',
    vehicles: 4,
    kip: 50,
    trips: 0,
    lat: 50.81,
    lng: 128.46,
    polygon: 'M 60 100 L 200 80 L 300 150 L 280 230 L 140 240 L 60 180 Z'
  }, {
    id: 'vsm',
    name: 'СМУ ВСЖМ, 3 этап',
    short: 'СМУ ВСЖМ',
    vehicles: 18,
    kip: 42,
    trips: 0,
    lat: 51.99,
    lng: 85.97,
    polygon: 'M 90 70 L 230 60 L 300 130 L 260 230 L 110 240 L 50 150 Z'
  }, {
    id: 'bod',
    name: 'Г. Бодайбо, карьер',
    short: 'Бодайбо, карьер',
    vehicles: 9,
    kip: 90,
    trips: 1805,
    lat: 57.85,
    lng: 114.20,
    polygon: 'M 70 90 L 210 70 L 280 130 L 270 220 L 120 240 L 60 170 Z'
  }, {
    id: 'belogor',
    name: 'СМУ г. Белогорск, стр-во А/Д путепровода ч/з Транссиб',
    short: 'СМУ Белогорск',
    vehicles: 18,
    kip: 42,
    trips: 14074,
    lat: 50.92,
    lng: 128.47,
    polygon: 'M 80 100 L 220 80 L 290 150 L 250 220 L 130 230 L 60 160 Z'
  }, {
    id: 'akiv',
    name: 'Большие Акивы',
    short: 'Большие Акивы',
    vehicles: 2,
    kip: 84,
    trips: 109,
    lat: 60.10,
    lng: 88.10,
    polygon: 'M 100 80 L 220 60 L 280 140 L 240 230 L 110 240 L 70 160 Z'
  }];
  const vehicleTypes = [{
    id: 'samosvaly',
    label: 'Самосвалы',
    color: '#F97316',
    icon: 'dump'
  }, {
    id: 'kip',
    label: 'КИП-техника',
    color: '#60A5FA',
    icon: 'kip'
  }, {
    id: 'ekskav',
    label: 'Экскаваторы',
    color: '#A78BFA',
    icon: 'excavator'
  }, {
    id: 'krany',
    label: 'Краны',
    color: '#22C55E',
    icon: 'crane'
  }];

  // Vehicles for the focused object (Belogorsk shown in screenshots)
  const vehicles = [{
    plate: 'P322TH196',
    type: 'samosvaly',
    model: 'HINO 600/Bell B40',
    org: 'МО-36',
    shifts: 23,
    kip: 93,
    idle: 3,
    engineTotal: '257:36',
    trips24: 1,
    liters: 1272,
    comment: 'Слежка по месту'
  }, {
    plate: 'K641YK196',
    type: 'samosvaly',
    model: 'HINO 700',
    org: 'МО-36',
    shifts: 24,
    kip: 78,
    idle: 7,
    engineTotal: '209:50',
    trips24: 0,
    liters: 1180
  }, {
    plate: 'P595M0186',
    type: 'samosvaly',
    model: 'SANY 8x4',
    org: 'МО-36',
    shifts: 24,
    kip: 76,
    idle: 6,
    engineTotal: '215:24',
    trips24: 0,
    liters: 1090
  }, {
    plate: 'E340EC138',
    type: 'samosvaly',
    model: 'SHACMAN 8x4',
    org: 'МО-36',
    shifts: 23,
    kip: 87,
    idle: 33,
    engineTotal: '267:43',
    trips24: 0,
    liters: 940
  }, {
    plate: 'P431HT138',
    type: 'samosvaly',
    model: 'SHACMAN 8x4',
    org: 'МО-36',
    shifts: 23,
    kip: 97,
    idle: 38,
    engineTotal: '267:18',
    trips24: 0,
    liters: 1340
  }, {
    plate: 'T724HM138',
    type: 'samosvaly',
    model: 'HINO 700',
    org: 'МО-36',
    shifts: 22,
    kip: 58,
    idle: 12,
    engineTotal: '198:00',
    trips24: 0,
    liters: 880
  }, {
    plate: 'У393МЕ72',
    type: 'ekskav',
    model: 'Volvo EC480',
    org: 'МО-36',
    shifts: 21,
    kip: 79,
    idle: 21,
    engineTotal: '197:14',
    trips24: 0,
    liters: 320,
    comment: '99% КИП за 8 дней'
  }, {
    plate: '00890К72',
    type: 'ekskav',
    model: 'Эксковатор гусеничный',
    org: 'МО-36',
    shifts: 24,
    kip: 67,
    idle: 87,
    engineTotal: '177:09',
    trips24: 0,
    liters: 2459
  }, {
    plate: '69610E72',
    type: 'ekskav',
    model: 'Эксковатор гусеничный Caterpillar 329CL',
    org: 'МО-36',
    shifts: 24,
    kip: 97,
    idle: 90,
    engineTotal: '74:19',
    trips24: 2,
    liters: 1272
  }, {
    plate: 'A111KP66',
    type: 'kip',
    model: 'JCB 4CX',
    org: 'НПС',
    shifts: 18,
    kip: 84,
    idle: 18,
    engineTotal: '142:10',
    trips24: 0,
    liters: 220
  }, {
    plate: 'B250HE66',
    type: 'kip',
    model: 'Komatsu PC200',
    org: 'НПС',
    shifts: 20,
    kip: 65,
    idle: 24,
    engineTotal: '160:55',
    trips24: 0,
    liters: 410
  }, {
    plate: 'C708OO66',
    type: 'krany',
    model: 'Liebherr LTM 1090',
    org: 'НПС',
    shifts: 14,
    kip: 48,
    idle: 10,
    engineTotal: '78:20',
    trips24: 0,
    liters: 90
  }];

  // Build per-day shift chips for the focused vehicle
  function chips(plate) {
    const days = ['30.04', '01.05', '02.05', '03.05', '04.05', '05.05', '06.05', '07.05', '08.05', '09.05', '10.05', '11.05', '12.05'];
    return days.flatMap(d => [{
      date: d,
      shift: 1,
      trips: Math.random() > .25 ? Math.floor(2 + Math.random() * 16) : 0,
      kip: Math.floor(40 + Math.random() * 60)
    }, {
      date: d,
      shift: 2,
      trips: Math.random() > .25 ? Math.floor(2 + Math.random() * 16) : 0,
      kip: Math.floor(40 + Math.random() * 60)
    }]);
  }
  vehicles.forEach(v => v.chips = chips(v.plate));
  return {
    objects,
    vehicleTypes,
    vehicles
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/monitoring/data.js", error: String((e && e.message) || e) }); }

// ui_kits/monitoring/views.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// views.jsx — full app views (Table, Cards, Map) using components from components.jsx
const {
  useState: useStateV,
  useEffect: useEffectV,
  useMemo: useMemoV,
  useRef: useRefV
} = React;

// ─── Vehicle row in the analytics table ──────────────────
function VehicleRow({
  v
}) {
  const last = v.chips.slice(-8);
  return /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
    className: "plate"
  }, v.plate), /*#__PURE__*/React.createElement("div", {
    className: "model"
  }, v.model)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "pill sm"
  }, v.type === 'samosvaly' ? 'Самосвал' : v.type === 'ekskav' ? 'Эксков.' : v.type === 'kip' ? 'КИП' : 'Кран')), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "lit"
  }, v.org)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
    className: "chips-row"
  }, last.map((c, i) => /*#__PURE__*/React.createElement(ShiftChip, _extends({
    key: i
  }, c, {
    active: i === last.length - 1
  }))))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--fg-1)',
      fontSize: 13
    }
  }, v.trips24, " \u0440"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--fg-3)'
    }
  }, v.liters, " \u043B"))), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(KipBar, {
    kip: v.kip,
    mov: v.idle * 2 < 100 ? v.idle * 2 : v.idle
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--fg-1)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, v.engineTotal)));
}

// ─── TABLE VIEW ───────────────────────────────────────────
function TableView({
  vehicles,
  objects,
  focusId
}) {
  const focus = objects.find(o => o.id === focusId) || objects[0];
  const [openTypes, setOpenTypes] = useStateV({
    samosvaly: true,
    ekskav: true,
    kip: true,
    krany: true
  });
  const groups = {
    samosvaly: vehicles.filter(v => v.type === 'samosvaly'),
    ekskav: vehicles.filter(v => v.type === 'ekskav'),
    kip: vehicles.filter(v => v.type === 'kip'),
    krany: vehicles.filter(v => v.type === 'krany')
  };
  const labels = {
    samosvaly: 'Самосвалы',
    ekskav: 'Экскаваторы',
    kip: 'КИП-техника',
    krany: 'Краны'
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "tbl"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\u0422\u0421 / \u041C\u043E\u0434\u0435\u043B\u044C"), /*#__PURE__*/React.createElement("th", null, "\u0422\u0438\u043F"), /*#__PURE__*/React.createElement("th", null, "\u041E\u0440\u0433."), /*#__PURE__*/React.createElement("th", null, "\u0421\u043C\u0435\u043D\u044B (\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 8)"), /*#__PURE__*/React.createElement("th", null, "\u0420\u0435\u0439\u0441\u044B / \u0440\u0430\u0441\u0445\u043E\u0434"), /*#__PURE__*/React.createElement("th", null, "\u041A\u0418\u041F / \u0414\u0432\u0438\u0436\u0435\u043D\u0438\u0435"), /*#__PURE__*/React.createElement("th", null, "\u0414\u0432\u0438\u0433. \u0438\u0442\u043E\u0433\u043E"))), /*#__PURE__*/React.createElement("tbody", null, /*#__PURE__*/React.createElement("tr", {
    className: "group-row"
  }, /*#__PURE__*/React.createElement("td", {
    colSpan: "7"
  }, /*#__PURE__*/React.createElement("span", {
    className: "group-arrow open"
  }, "\u25B6"), focus.name, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-3)'
    }
  }, "\xB7 ", focus.vehicles, " \u0422\u0421 \xB7 \u041A\u0418\u041F ", focus.kip, "%"), /*#__PURE__*/React.createElement("span", {
    className: "count-badge"
  }, vehicles.length))), Object.entries(groups).map(([key, vs]) => vs.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, {
    key: key
  }, /*#__PURE__*/React.createElement("tr", {
    className: "group-row",
    onClick: () => setOpenTypes(o => ({
      ...o,
      [key]: !o[key]
    })),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("td", {
    colSpan: "7",
    style: {
      paddingLeft: 24
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: `group-arrow ${openTypes[key] ? 'open' : ''}`
  }, "\u25B6"), labels[key], /*#__PURE__*/React.createElement("span", {
    className: "count-badge"
  }, vs.length, " \u0422\u0421"))), openTypes[key] && vs.map(v => /*#__PURE__*/React.createElement(VehicleRow, {
    key: v.plate,
    v: v
  })))))));
}

// ─── CARDS VIEW ───────────────────────────────────────────
function VehicleCard({
  v
}) {
  const last = v.chips.slice(-10);
  return /*#__PURE__*/React.createElement("div", {
    className: "veh-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "veh-head"
  }, /*#__PURE__*/React.createElement(VehicleIcon, {
    kind: v.type
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "veh-plate"
  }, v.plate), /*#__PURE__*/React.createElement("div", {
    className: "veh-model"
  }, v.model)), /*#__PURE__*/React.createElement("span", {
    className: "veh-org"
  }, v.org)), /*#__PURE__*/React.createElement("div", {
    className: "veh-meta-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u041A\u0418\u041F"), /*#__PURE__*/React.createElement("span", {
    className: `val ${kipClass(v.kip)}`
  }, v.kip, "%")), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0421\u043C\u0435\u043D\u044B"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, v.shifts)), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0420\u0435\u0439\u0441\u044B 24\u0447"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, v.trips24)), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0420\u0430\u0441\u0445\u043E\u0434"), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, v.liters, " \u043B")), /*#__PURE__*/React.createElement("div", {
    className: "meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0414\u0432\u0438\u0433."), /*#__PURE__*/React.createElement("span", {
    className: "val"
  }, v.engineTotal))), /*#__PURE__*/React.createElement("div", {
    className: "veh-chips"
  }, last.map((c, i) => /*#__PURE__*/React.createElement(ShiftChip, _extends({
    key: i
  }, c)))));
}
function CardsView({
  vehicles,
  objects,
  focusId
}) {
  const focus = objects.find(o => o.id === focusId) || objects[0];
  const sideObjs = objects.slice(0, 4);
  return /*#__PURE__*/React.createElement("div", {
    className: "cards-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "cards-scroll"
  }, vehicles.map(v => /*#__PURE__*/React.createElement(VehicleCard, {
    key: v.plate,
    v: v
  }))), /*#__PURE__*/React.createElement("aside", {
    className: "side-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "side-week"
  }, /*#__PURE__*/React.createElement("button", {
    className: "arr"
  }, "\u2039"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "side-week-t"
  }, "30.04 \u2014 12.05.2026"), /*#__PURE__*/React.createElement("div", {
    className: "side-week-s"
  }, "13 \u0434\u043D\u0435\u0439 \xB7 8 \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432")), /*#__PURE__*/React.createElement("button", {
    className: "arr"
  }, "\u203A")), sideObjs.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    className: "obj-section"
  }, /*#__PURE__*/React.createElement("div", {
    className: "obj-h"
  }, /*#__PURE__*/React.createElement("span", {
    className: "obj-dot",
    style: {
      background: kipClass(o.kip) === 'kg' ? 'var(--kip-good)' : kipClass(o.kip) === 'kb' ? 'var(--kip-mid)' : 'var(--kip-bad)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "obj-n"
  }, o.short), /*#__PURE__*/React.createElement("span", {
    className: kipClass(o.kip),
    style: {
      fontWeight: 800,
      fontSize: 12
    }
  }, o.kip, "%")), /*#__PURE__*/React.createElement("div", {
    className: "obj-kpi-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mini-kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u0422\u0421"), /*#__PURE__*/React.createElement("div", {
    className: "v"
  }, o.vehicles)), /*#__PURE__*/React.createElement("div", {
    className: "mini-kpi"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u0420\u0435\u0439\u0441\u044B"), /*#__PURE__*/React.createElement("div", {
    className: "v"
  }, o.trips)))))));
}

// ─── MAP VIEW (новое — карта с зонами) ────────────────────
function MapView({
  vehicles,
  objects,
  focusId,
  onFocus
}) {
  const [fs, setFs] = useStateV(false);
  const [zoom, setZoom] = useStateV(1);
  const [pan, setPan] = useStateV({
    x: 0,
    y: 0
  });
  const focus = objects.find(o => o.id === focusId) || objects[0];

  // Map objects to fictional positions on viewport
  const positions = useMemoV(() => {
    const W = 1100,
      H = 600;
    const seed = s => {
      let x = 0;
      for (let i = 0; i < s.length; i++) x = x * 31 + s.charCodeAt(i) >>> 0;
      return x;
    };
    const layout = {
      ekb: {
        x: 460,
        y: 200,
        r: 110
      },
      omsk: {
        x: 590,
        y: 240,
        r: 95
      },
      pyt: {
        x: 680,
        y: 130,
        r: 80
      },
      vsm: {
        x: 720,
        y: 320,
        r: 105
      },
      bod: {
        x: 870,
        y: 240,
        r: 95
      },
      belogor: {
        x: 980,
        y: 360,
        r: 130
      },
      amur: {
        x: 1010,
        y: 410,
        r: 100
      },
      akiv: {
        x: 800,
        y: 160,
        r: 80
      }
    };
    return objects.map(o => ({
      ...o,
      pos: layout[o.id] || {
        x: 200 + seed(o.id) % 700,
        y: 100 + seed(o.id) % 400,
        r: 90
      }
    }));
  }, [objects]);

  // Build a polygon (irregular hex) around the center for each object
  function makeZone(cx, cy, r, id) {
    const seed = n => {
      let x = n;
      return () => {
        x = x * 1103515245 + 12345 & 0x7fffffff;
        return x / 0x7fffffff;
      };
    };
    let salt = 0;
    for (let i = 0; i < id.length; i++) salt = salt * 31 + id.charCodeAt(i) >>> 0;
    const rnd = seed(salt);
    const points = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const angle = i / N * Math.PI * 2;
      const rr = r * (0.78 + rnd() * 0.35);
      points.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr * 0.78]);
    }
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join(' ') + ' Z';
  }

  // Pins for focused object's vehicles
  const vehiclesForFocus = vehicles; // already pre-filtered by parent
  const typeGroups = useMemoV(() => {
    const g = {};
    vehiclesForFocus.forEach(v => {
      (g[v.type] = g[v.type] || []).push(v);
    });
    return g;
  }, [vehiclesForFocus]);
  const typeColors = {
    samosvaly: '#F97316',
    kip: '#60A5FA',
    ekskav: '#A78BFA',
    krany: '#22C55E'
  };
  const typeLabels = {
    samosvaly: 'Самосвалы',
    kip: 'КИП-техника',
    ekskav: 'Экскаваторы',
    krany: 'Краны'
  };

  // Pin positions inside the focused zone (cluster around center)
  const focusedPos = positions.find(p => p.id === focus.id)?.pos || {
    x: 600,
    y: 300,
    r: 110
  };
  const pinPositions = useMemoV(() => {
    const pts = [];
    let typeIdx = 0;
    for (const t of Object.keys(typeGroups)) {
      const items = typeGroups[t];
      const baseAngle = typeIdx / Object.keys(typeGroups).length * Math.PI * 2;
      items.forEach((v, i) => {
        const a = baseAngle + i / items.length * (Math.PI * 2 / Object.keys(typeGroups).length) + 0.3;
        const r = focusedPos.r * (0.35 + i % 3 * 0.18);
        pts.push({
          v,
          x: focusedPos.x + Math.cos(a) * r,
          y: focusedPos.y + Math.sin(a) * r * 0.7
        });
      });
      typeIdx++;
    }
    return pts;
  }, [typeGroups, focusedPos]);
  const [openGroups, setOpenGroups] = useStateV({
    samosvaly: true,
    kip: true,
    ekskav: true,
    krany: true
  });
  return /*#__PURE__*/React.createElement("div", {
    className: `map-wrap ${fs ? 'fs' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "map-canvas"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 1100 600",
    className: "map-svg",
    preserveAspectRatio: "xMidYMid slice"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("pattern", {
    id: "hatch",
    patternUnits: "userSpaceOnUse",
    width: "6",
    height: "6",
    patternTransform: "rotate(45)"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "6",
    stroke: "rgba(96,165,250,0.10)",
    strokeWidth: "1.2"
  })), /*#__PURE__*/React.createElement("radialGradient", {
    id: "zoneActive",
    cx: "50%",
    cy: "50%",
    r: "60%"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "rgba(249,115,22,0.20)"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "rgba(249,115,22,0.05)"
  }))), /*#__PURE__*/React.createElement("rect", {
    width: "1100",
    height: "600",
    className: "map-tile-bg"
  }), /*#__PURE__*/React.createElement("rect", {
    width: "1100",
    height: "600",
    fill: "url(#hatch)"
  }), /*#__PURE__*/React.createElement("g", {
    className: "map-grid"
  }, Array.from({
    length: 14
  }, (_, i) => /*#__PURE__*/React.createElement("line", {
    key: 'h' + i,
    x1: "0",
    y1: i * 45,
    x2: "1100",
    y2: i * 45
  })), Array.from({
    length: 22
  }, (_, i) => /*#__PURE__*/React.createElement("line", {
    key: 'v' + i,
    x1: i * 55,
    y1: "0",
    x2: i * 55,
    y2: "600"
  }))), /*#__PURE__*/React.createElement("g", {
    transform: `translate(${pan.x} ${pan.y}) scale(${zoom})`
  }, positions.map(o => {
    const d = makeZone(o.pos.x, o.pos.y, o.pos.r, o.id);
    const active = o.id === focus.id;
    return /*#__PURE__*/React.createElement("g", {
      key: o.id,
      onClick: () => onFocus(o.id)
    }, /*#__PURE__*/React.createElement("path", {
      className: `zone ${active ? 'active' : ''}`,
      d: d,
      fill: active ? 'url(#zoneActive)' : undefined
    }), /*#__PURE__*/React.createElement("text", {
      className: "zone-label",
      x: o.pos.x,
      y: o.pos.y - 8,
      textAnchor: "middle"
    }, o.short), /*#__PURE__*/React.createElement("text", {
      className: "zone-sub",
      x: o.pos.x,
      y: o.pos.y + 8,
      textAnchor: "middle"
    }, o.vehicles, " \u0422\u0421 \xB7 \u041A\u0418\u041F ", o.kip, "%"));
  }), pinPositions.map((p, i) => /*#__PURE__*/React.createElement("g", {
    key: i,
    className: "pin"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: p.x,
    cy: p.y,
    r: "11",
    fill: typeColors[p.v.type],
    fillOpacity: "0.95"
  }), /*#__PURE__*/React.createElement("text", {
    x: p.x,
    y: p.y + 3.5
  }, p.v.type[0].toUpperCase()))))), /*#__PURE__*/React.createElement("div", {
    className: "map-controls"
  }, /*#__PURE__*/React.createElement("button", {
    className: "map-btn",
    onClick: () => setFs(!fs),
    title: fs ? 'Свернуть' : 'На весь экран'
  }, fs ? '⤡' : '⤢'), /*#__PURE__*/React.createElement("button", {
    className: "map-btn",
    onClick: () => setZoom(z => Math.min(3, z + 0.2))
  }, "\uFF0B"), /*#__PURE__*/React.createElement("button", {
    className: "map-btn",
    onClick: () => setZoom(z => Math.max(0.6, z - 0.2))
  }, "\u2212"), /*#__PURE__*/React.createElement("button", {
    className: "map-btn",
    onClick: () => {
      setZoom(1);
      setPan({
        x: 0,
        y: 0
      });
    },
    title: "\u0421\u0431\u0440\u043E\u0441"
  }, "\u27F2")), /*#__PURE__*/React.createElement("div", {
    className: "map-legend"
  }, /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d",
    style: {
      background: '#F97316'
    }
  }), "\u0421\u0430\u043C\u043E\u0441\u0432."), /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d",
    style: {
      background: '#60A5FA'
    }
  }), "\u041A\u0418\u041F"), /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d",
    style: {
      background: '#A78BFA'
    }
  }), "\u042D\u043A\u0441\u043A\u043E\u0432."), /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d",
    style: {
      background: '#22C55E'
    }
  }), "\u041A\u0440\u0430\u043D\u044B"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-4)',
      fontSize: 9,
      marginLeft: 8
    }
  }, "\u041A\u043B\u0438\u043A \u043F\u043E \u0437\u043E\u043D\u0435 \u2014 \u0432\u044B\u0431\u043E\u0440 \u043E\u0431\u044A\u0435\u043A\u0442\u0430"))), !fs && /*#__PURE__*/React.createElement("aside", {
    className: "inspector"
  }, /*#__PURE__*/React.createElement("h3", null, focus.name), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, focus.vehicles, " \u0422\u0421 \xB7 ", focus.trips.toLocaleString('ru-RU'), " \u0440\u0435\u0439\u0441\u043E\u0432"), /*#__PURE__*/React.createElement("div", {
    className: "stats"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u0421\u0440. \u041A\u0418\u041F"), /*#__PURE__*/React.createElement("div", {
    className: `v ${kipClass(focus.kip)}`
  }, focus.kip, "%")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u0422\u0438\u043F\u043E\u0432 \u0422\u0421"), /*#__PURE__*/React.createElement("div", {
    className: "v"
  }, Object.keys(typeGroups).length)), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u0417\u043E\u043D\u0430, \u043A\u043C\xB2"), /*#__PURE__*/React.createElement("div", {
    className: "v"
  }, (focus.vehicles * 0.7).toFixed(1)), /*#__PURE__*/React.createElement("div", {
    className: "vs"
  }, "\u043E\u0446\u0435\u043D\u043E\u0447\u043D\u043E")), /*#__PURE__*/React.createElement("div", {
    className: "stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "\u041F\u0435\u0440\u0438\u043E\u0434"), /*#__PURE__*/React.createElement("div", {
    className: "v",
    style: {
      fontSize: 13
    }
  }, "13\u0434\u043D"), /*#__PURE__*/React.createElement("div", {
    className: "vs"
  }, "30.04 \u2014 12.05"))), Object.entries(typeGroups).map(([t, vs]) => /*#__PURE__*/React.createElement("div", {
    className: "tg",
    key: t
  }, /*#__PURE__*/React.createElement("div", {
    className: "tg-h",
    onClick: () => setOpenGroups(g => ({
      ...g,
      [t]: !g[t]
    }))
  }, /*#__PURE__*/React.createElement("span", {
    className: "tg-name"
  }, /*#__PURE__*/React.createElement("span", {
    className: "d",
    style: {
      background: typeColors[t]
    }
  }), typeLabels[t], /*#__PURE__*/React.createElement("span", {
    className: "c"
  }, vs.length)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--fg-3)'
    }
  }, openGroups[t] ? '−' : '+')), openGroups[t] && vs.map(v => /*#__PURE__*/React.createElement("div", {
    className: "vrow",
    key: v.plate
  }, /*#__PURE__*/React.createElement("div", {
    className: "p"
  }, v.plate), /*#__PURE__*/React.createElement("div", {
    className: "meta-mini"
  }, /*#__PURE__*/React.createElement("span", null, "\u0441\u043C. ", /*#__PURE__*/React.createElement("b", null, v.shifts)), /*#__PURE__*/React.createElement("span", null, "\u0440. ", /*#__PURE__*/React.createElement("b", null, v.trips24)), /*#__PURE__*/React.createElement("span", null, "\u0434\u0432. ", /*#__PURE__*/React.createElement("b", null, v.engineTotal))), /*#__PURE__*/React.createElement(KipBar, {
    kip: v.kip,
    mov: Math.min(99, v.idle * 2)
  })))))));
}
Object.assign(window, {
  TableView,
  CardsView,
  MapView,
  VehicleRow,
  VehicleCard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/monitoring/views.jsx", error: String((e && e.message) || e) }); }

})();
