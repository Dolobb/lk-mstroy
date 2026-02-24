import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { FilterState, FilterOptions, WeeklyVehicle } from '../types/vehicle';
import MultiSelectDropdown from './MultiSelectDropdown';
import { getKpiColor, KPI_COLORS, capDisplay } from '../utils/kpi';
import ReactDOM from 'react-dom';

interface Props {
  filters: FilterState;
  options: FilterOptions;
  loading: boolean;
  onChange: (patch: Partial<FilterState>) => void;
  avgKip: number;
  vehicles: WeeklyVehicle[];
  onSelectVehicle: (id: string) => void;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const KPI_SCALE = [
  { label: '0-25%', color: '#ef4444', value: '0-25' },
  { label: '25-50%', color: '#eab308', value: '25-50' },
  { label: '50-75%', color: '#3b82f6', value: '50-75' },
  { label: '75-100%', color: '#22c55e', value: '75-100' },
];

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider leading-none">
        {label}
      </span>
      {children}
    </div>
  );
}

// ---- Vehicle Search ----

interface SearchDropdownProps {
  query: string;
  results: WeeklyVehicle[];
  onSelect: (v: WeeklyVehicle) => void;
  anchorRect: DOMRect | null;
}

function SearchDropdown({ query, results, onSelect, anchorRect }: SearchDropdownProps) {
  if (!anchorRect) return null;

  return (
    <div
      className="glass-card border border-border shadow-xl"
      style={{ marginTop: 4, width: 280, borderRadius: 12, overflow: 'hidden' }}
    >
      {results.length === 0 ? (
        <div className="text-muted-foreground text-center py-4" style={{ fontSize: '12px' }}>
          {query.length < 1 ? 'Начните вводить номер...' : 'Ничего не найдено'}
        </div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {results.map(v => {
            const kpiKey = getKpiColor(capDisplay(v.avg_utilization_ratio ?? 0));
            const dotColor = KPI_COLORS[kpiKey];
            return (
              <button
                key={v.vehicle_id}
                onClick={() => onSelect(v)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer border-none bg-transparent text-left"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                    boxShadow: `0 0 4px ${dotColor}80`,
                  }}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-foreground tracking-wide" style={{ fontSize: '13px', lineHeight: 1.2 }}>
                    {v.vehicle_id}
                  </span>
                  <span className="text-muted-foreground truncate" style={{ fontSize: '10px', lineHeight: 1.3 }}>
                    {v.vehicle_type || v.vehicle_model}
                  </span>
                </div>
                <span className="ml-auto font-semibold shrink-0" style={{ fontSize: '11px', color: dotColor }}>
                  {capDisplay(v.avg_utilization_ratio ?? 0).toFixed(0)}%
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Main FilterPanel ----

const FilterPanel: React.FC<Props> = ({
  filters, options, loading, onChange, avgKip, vehicles, onSelectVehicle,
}) => {
  const now = new Date();
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const isWeekActive = filters.from === formatDate(weekAgo) && filters.to === formatDate(now);
  const isMonthActive = filters.from === formatDate(monthAgo) && filters.to === formatDate(now);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchBtnRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openSearch = useCallback(() => {
    if (searchBtnRef.current) {
      setAnchorRect(searchBtnRef.current.getBoundingClientRect());
    }
    setSearchOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!searchOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current?.contains(e.target as Node)) return;
      // Check if click is inside the portal dropdown
      const portals = document.querySelectorAll('.glass-card');
      for (const el of portals) {
        if (el.contains(e.target as Node)) return;
      }
      closeSearch();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [searchOpen, closeSearch]);

  const results = query.length >= 1
    ? vehicles.filter(v =>
        v.vehicle_id.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 20)
    : [];

  const handleSelect = useCallback((v: WeeklyVehicle) => {
    onSelectVehicle(v.vehicle_id);
    closeSearch();
  }, [onSelectVehicle, closeSearch]);

  const handlePresetMonth = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    onChange({ from: formatDate(from), to: formatDate(to) });
  };

  const handlePresetWeek = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    onChange({ from: formatDate(from), to: formatDate(to) });
  };

  const toggleKpiRange = (value: string) => {
    const isActive = filters.kpiRanges.includes(value);
    const next = isActive
      ? filters.kpiRanges.filter(v => v !== value)
      : [...filters.kpiRanges, value];
    onChange({ kpiRanges: next });
  };

  const kipColor = avgKip >= 75 ? '#22c55e' : avgKip >= 50 ? '#3b82f6' : avgKip >= 25 ? '#eab308' : '#ef4444';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      {/* Период — пресеты */}
      <FilterGroup label="ПЕРИОД">
        <div className="flex gap-0.5">
          {[{ label: 'Месяц', active: isMonthActive, onClick: handlePresetMonth },
            { label: 'Неделя', active: isWeekActive, onClick: handlePresetWeek }].map(btn => (
            <button
              key={btn.label}
              onClick={btn.onClick}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer border-none ${
                btn.active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
              style={{ fontSize: '11px', fontWeight: 600 }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </FilterGroup>

      {/* Период дней — date inputs */}
      <FilterGroup label="ПЕРИОД ДНЕЙ">
        <div className="flex items-center gap-1">
          <span style={{ fontSize: '10px' }} className="text-muted-foreground">с</span>
          <input
            type="date"
            value={filters.from}
            onChange={e => onChange({ from: e.target.value })}
            className="bg-muted text-foreground border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ fontSize: '11px', width: '116px' }}
          />
          <span style={{ fontSize: '10px' }} className="text-muted-foreground">по</span>
          <input
            type="date"
            value={filters.to}
            onChange={e => onChange({ to: e.target.value })}
            className="bg-muted text-foreground border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ fontSize: '11px', width: '116px' }}
          />
        </div>
      </FilterGroup>

      {/* Смена */}
      <FilterGroup label="ДЕНЬ/ВЕЧЕР">
        <div className="flex gap-0.5">
          {[{ value: 'morning', label: 'День' }, { value: 'evening', label: 'Вечер' }].map(s => {
            const isActive = filters.shift === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onChange({ shift: isActive ? null : s.value })}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer border-none ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-foreground hover:bg-muted/80'
                }`}
                style={{ fontSize: '11px', fontWeight: 600 }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </FilterGroup>

      {/* Филиал */}
      <div className="flex items-center shrink-0">
        <MultiSelectDropdown
          label="Филиал"
          options={options.branches}
          selected={filters.branches}
          onChange={v => onChange({ branches: v })}
          width={150}
        />
      </div>

      {/* Тип ТС */}
      <div className="flex items-center shrink-0">
        <MultiSelectDropdown
          label="Тип ТС"
          options={options.types}
          selected={filters.types}
          onChange={v => onChange({ types: v })}
          width={150}
          grouped
        />
      </div>

      {/* СМУ */}
      <div className="flex items-center shrink-0">
        <MultiSelectDropdown
          label="СМУ"
          options={options.departments}
          selected={filters.departments}
          onChange={v => onChange({ departments: v })}
          width={200}
        />
      </div>

      {loading && (
        <div className="flex items-center shrink-0">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Поиск ТС — кнопка всегда в потоке, инпут наплывает поверх через портал */}
      <div ref={containerRef} className="flex items-center shrink-0">
        <button
          ref={searchBtnRef}
          onClick={openSearch}
          className={`flex items-center gap-1 border border-border rounded-lg px-2 transition-colors cursor-pointer ${
            searchOpen
              ? 'text-foreground bg-muted'
              : 'text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80'
          }`}
          style={{ height: 28 }}
          title="Найти ТС"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Оверлей поиска — через портал, не сдвигает элементы */}
      {searchOpen && anchorRect && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            top: anchorRect.top,
            left: anchorRect.left,
            zIndex: 1500,
          }}
        >
          <div
            className="flex items-center gap-1.5 bg-muted border border-ring rounded-lg px-2"
            style={{ height: anchorRect.height, width: 200 }}
          >
            <Search className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && closeSearch()}
              placeholder="Гос. номер..."
              className="bg-transparent text-foreground outline-none border-none flex-1 min-w-0"
              style={{ fontSize: '11px' }}
            />
          </div>
          <SearchDropdown
            query={query}
            results={results}
            onSelect={handleSelect}
            anchorRect={anchorRect}
          />
        </div>,
        document.body,
      )}

      {/* Средний КИП + шкала */}
      <div className="glass-card flex items-center gap-3 px-4 py-1.5 shrink-0">
        <div className="flex flex-col justify-center">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium leading-none">
            Средний КИП
          </div>
          <div
            className="text-xl font-bold leading-tight"
            style={{ color: avgKip > 0 ? kipColor : 'var(--muted-foreground)' }}
          >
            {avgKip > 0 ? `${avgKip.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 max-w-[180px]">
          {KPI_SCALE.map(item => {
            const isActive = filters.kpiRanges.includes(item.value);
            return (
              <button
                key={item.label}
                onClick={() => toggleKpiRange(item.value)}
                className="inline-flex items-center justify-center rounded-md font-semibold leading-tight cursor-pointer select-none border-none transition-all"
                style={{
                  fontSize: '9px',
                  padding: '1px 6px',
                  height: '18px',
                  backgroundColor: item.color,
                  color: '#ffffff',
                  opacity: isActive ? 1 : 0.45,
                  outline: isActive ? '2px solid white' : 'none',
                  outlineOffset: '1px',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FilterPanel;
