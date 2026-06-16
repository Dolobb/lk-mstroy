import { useEffect, useMemo, useRef, useState } from 'react';

export function uniqueSortedBy<T>(
  records: T[],
  getValue: (r: T) => string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const r of records) {
    const v = getValue(r)?.trim();
    if (!v) continue;
    const lower = v.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(v);
  }
  return result.sort((a, b) => a.localeCompare(b, 'ru'));
}

interface FilterDropdownProps<T extends string = string> {
  values: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  onClear: () => void;
  onClose: () => void;
}

export function FilterDropdown<T extends string = string>({
  values,
  selected,
  onToggle,
  onClear,
  onClose,
}: FilterDropdownProps<T>) {
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = values.filter(v => {
    try { return v.toLowerCase().includes(search.toLowerCase()); }
    catch { return true; }
  });

  const selectedLower = useMemo(() => new Set([...selected].map(v => v.toLowerCase())), [selected]);
  const isSelected = (v: string) => selectedLower.has(v.toLowerCase());

  return (
    <div ref={ref} className="absolute top-full mt-1 left-0 right-0 z-50 border border-border rounded-xl shadow-xl overflow-hidden min-w-64"
      style={{ background: 'var(--popover)' }}
      onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 px-3 py-1.5 border-b border-border/40">
        <button
          type="button"
          onClick={() => {
            const allVisibleSelected = filtered.every(v => isSelected(v));
            filtered.forEach(v => {
              if (allVisibleSelected ? isSelected(v) : !isSelected(v)) onToggle(v);
            });
          }}
          className="px-2 py-0.5 rounded-lg bg-card-inner hover:bg-card-inner/80 border border-border/40 cursor-pointer text-text-secondary"
          style={{ fontSize: 10 }}
        >
          {filtered.every(v => isSelected(v)) ? 'Снять' : 'Все'}
        </button>
        <button
          type="button"
          onClick={() => { filtered.forEach(v => { if (isSelected(v)) onToggle(v); }); }}
          className="px-2 py-0.5 rounded-lg bg-card-inner hover:bg-card-inner/80 border border-border/40 cursor-pointer text-text-secondary"
          style={{ fontSize: 10 }}
        >
          Снять ({filtered.filter(v => isSelected(v)).length})
        </button>
      </div>
      {values.length > 10 && (
        <div className="px-3 py-2 border-b border-border/40">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="w-full px-2.5 py-1.5 rounded-lg bg-card-inner border border-border text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            style={{ fontSize: 12 }}
          />
        </div>
      )}
      <div className="max-h-56 overflow-y-auto custom-scrollbar">
        {filtered.map(v => (
          <div
            key={v}
            onClick={() => onToggle(v)}
            className="flex items-start gap-2 px-3 py-1.5 hover:bg-card-inner cursor-pointer"
          >
            <div
              className={`w-3.5 h-3.5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                isSelected(v) ? 'bg-secondary border-secondary' : 'border-text-muted'
              }`}
            >
              {isSelected(v) && (
                <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-text-secondary leading-snug" style={{ fontSize: 11 }}>{v}</span>
          </div>
        ))}
        {filtered.length === 0 && <div className="px-3 py-2 text-text-muted" style={{ fontSize: 11 }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}
