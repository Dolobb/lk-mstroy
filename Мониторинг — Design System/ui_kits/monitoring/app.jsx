// app.jsx — root app for the monitoring UI kit
const { useState, useEffect, useMemo } = React;

function App() {
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('table');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Все');
  const [focusId, setFocusId] = useState('belogor');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const { objects, vehicles } = window.MOCK;

  const filtered = useMemo(() => {
    let v = vehicles;
    if (query) v = v.filter(x => (x.plate + ' ' + x.model).toLowerCase().includes(query.toLowerCase()));
    if (filter !== 'Все') {
      if (filter.startsWith('Самосв')) v = v.filter(x => x.type === 'samosvaly');
      else if (filter.startsWith('Эксков')) v = v.filter(x => x.type === 'ekskav');
      else if (filter.startsWith('Кран')) v = v.filter(x => x.type === 'krany');
    }
    return v;
  }, [vehicles, query, filter]);

  return (
    <div className="app">
      <div className="amb amb-o" />
      <div className="amb amb-b" />
      <TopNav theme={theme} onTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
      <FiltersBar view={view} onView={setView} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} />
      <KpiStrip objects={objects} activeId={focusId} onPick={setFocusId} />
      <main className="main">
        {view === 'table' && <TableView vehicles={filtered} objects={objects} focusId={focusId} />}
        {view === 'cards' && <CardsView vehicles={filtered} objects={objects} focusId={focusId} />}
        {view === 'map'   && <MapView   vehicles={filtered} objects={objects} focusId={focusId} onFocus={setFocusId} />}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
