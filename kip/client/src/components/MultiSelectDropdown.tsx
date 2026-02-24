import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  width?: number;
  grouped?: boolean;
}

interface Group {
  name: string;
  items: string[];
  fullValues: string[];
}

function parseGroups(options: string[]): { groups: Group[]; flat: string[] } {
  const groups: Group[] = [];
  const flat: string[] = [];
  const groupMap = new Map<string, { items: string[]; fullValues: string[] }>();

  for (const opt of options) {
    const gpIdx = opt.indexOf(', г/п');
    if (gpIdx !== -1) {
      const groupName = opt.substring(0, gpIdx);
      const subItem = opt.substring(gpIdx + 2);
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, { items: [], fullValues: [] });
      }
      groupMap.get(groupName)!.items.push(subItem);
      groupMap.get(groupName)!.fullValues.push(opt);
    } else {
      flat.push(opt);
    }
  }

  for (const [name, data] of groupMap) {
    groups.push({ name, items: data.items, fullValues: data.fullValues });
  }

  return { groups, flat };
}

const ACTIVE_BG = '#f97316';

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  options,
  selected,
  onChange,
  width = 150,
  grouped = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState<string[]>(selected);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalSelected(selected);
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, []);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(lower));
  }, [options, search]);

  const { groups, flat } = useMemo(() => {
    if (!grouped) return { groups: [], flat: filteredOptions };
    return parseGroups(filteredOptions);
  }, [filteredOptions, grouped]);

  const toggleItem = (value: string) => {
    setLocalSelected(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
    );
  };

  const toggleGroup = (group: Group) => {
    const allSelected = group.fullValues.every(v => localSelected.includes(v));
    if (allSelected) {
      setLocalSelected(prev => prev.filter(v => !group.fullValues.includes(v)));
    } else {
      setLocalSelected(prev => {
        const s = new Set(prev);
        group.fullValues.forEach(v => s.add(v));
        return Array.from(s);
      });
    }
  };

  const toggleGroupExpand = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setLocalSelected([...options]);
  const clearAll = () => setLocalSelected([]);
  const apply = () => {
    onChange(localSelected);
    setOpen(false);
    setSearch('');
  };

  let displayText = 'Все';
  if (selected.length === 1) displayText = selected[0];
  else if (selected.length > 1) displayText = `выбрано: ${selected.length}`;

  const hasSelection = selected.length > 0;

  const popup = open ? ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="fixed flex flex-col overflow-hidden bg-white rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.25)] z-[99999]"
      style={{
        top: popupPos.top,
        left: popupPos.left,
        width: Math.max(width, 280),
        maxHeight: 380,
      }}
    >
      {/* Search */}
      <div className="px-2.5 py-2 border-b border-gray-200">
        <input
          type="text"
          placeholder="Поиск..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-[0.85rem] outline-none font-[inherit]"
        />
      </div>

      {/* Options list */}
      <div className="flex-1 overflow-y-auto py-1">
        {grouped && groups.length > 0 && groups.map(group => {
          const isExpanded = expandedGroups.has(group.name);
          const allGroupSelected = group.fullValues.every(v => localSelected.includes(v));
          const someGroupSelected = !allGroupSelected && group.fullValues.some(v => localSelected.includes(v));
          return (
            <div key={group.name}>
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer font-bold text-[0.85rem] text-gray-700 select-none ${
                  someGroupSelected || allGroupSelected ? 'bg-indigo-50' : ''
                }`}
                onClick={() => toggleGroupExpand(group.name)}
              >
                <span className="text-[0.7rem] w-3.5 text-center shrink-0">
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
                <input
                  type="checkbox"
                  checked={allGroupSelected}
                  ref={el => { if (el) el.indeterminate = someGroupSelected; }}
                  onChange={e => { e.stopPropagation(); toggleGroup(group); }}
                  onClick={e => e.stopPropagation()}
                  className="w-4 h-4 cursor-pointer shrink-0 accent-[#2600FF]"
                />
                <span>{group.name}</span>
              </div>
              {isExpanded && group.items.map((item, idx) => {
                const fullValue = group.fullValues[idx];
                return (
                  <label
                    key={fullValue}
                    className={`flex items-center gap-1.5 py-1 px-2.5 pl-10 cursor-pointer text-[0.83rem] text-gray-600 ${
                      localSelected.includes(fullValue) ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={localSelected.includes(fullValue)}
                      onChange={() => toggleItem(fullValue)}
                      className="w-4 h-4 cursor-pointer shrink-0 accent-[#2600FF]"
                    />
                    <span>{item}</span>
                  </label>
                );
              })}
            </div>
          );
        })}

        {flat.map(opt => (
          <label
            key={opt}
            className={`flex items-center gap-1.5 py-1 px-2.5 cursor-pointer text-[0.85rem] text-gray-700 ${
              localSelected.includes(opt) ? 'bg-indigo-50' : ''
            }`}
          >
            <input
              type="checkbox"
              checked={localSelected.includes(opt)}
              onChange={() => toggleItem(opt)}
              className="w-4 h-4 cursor-pointer shrink-0 accent-[#2600FF]"
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
              {opt}
            </span>
          </label>
        ))}

        {filteredOptions.length === 0 && (
          <div className="p-2.5 text-center text-gray-400 text-[0.85rem]">
            Ничего не найдено
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-2.5 py-2 border-t border-gray-200">
        <button
          onClick={selectAll}
          className="flex-1 py-1 border border-gray-300 rounded-md bg-white cursor-pointer text-[0.8rem] font-[inherit] hover:bg-gray-50"
        >
          Все
        </button>
        <button
          onClick={clearAll}
          className="flex-1 py-1 border border-gray-300 rounded-md bg-white cursor-pointer text-[0.8rem] font-[inherit] hover:bg-gray-50"
        >
          Сбросить
        </button>
        <button
          onClick={apply}
          className="flex-1 py-1 border-none rounded-md bg-[#2600FF] text-white cursor-pointer text-[0.8rem] font-semibold font-[inherit] hover:bg-[#1a00cc]"
        >
          Применить
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={triggerRef} className="relative shrink-0" style={{ width, minWidth: width, maxWidth: width }}>
      {/* Trigger */}
      <div
        onClick={() => { setOpen(!open); if (!open) setLocalSelected(selected); }}
        className="w-full h-7 flex items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-md cursor-pointer relative"
        style={{
          padding: '0 28px 0 10px',
          background: hasSelection ? ACTIVE_BG : 'var(--muted)',
          color: hasSelection ? '#fff' : 'var(--muted-foreground)',
          border: `1px solid ${hasSelection ? ACTIVE_BG : 'var(--border)'}`,
          fontWeight: hasSelection ? 600 : 400,
          fontSize: '11px',
        }}
      >
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {displayText}
        </span>
        <ChevronDown
          className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{ color: hasSelection ? '#fff' : 'var(--muted-foreground)' }}
        />
      </div>
      {/* Floating label */}
      <span
        className="absolute -top-2 left-2 text-[9px] px-1 leading-none pointer-events-none rounded-sm font-medium uppercase tracking-wider"
        style={{
          background: hasSelection ? ACTIVE_BG : 'var(--background)',
          color: hasSelection ? 'rgba(255,255,255,0.9)' : 'var(--muted-foreground)',
        }}
      >
        {label}
      </span>

      {popup}
    </div>
  );
};

export default MultiSelectDropdown;
