import { Info } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Образцы рисуются теми же классами, что и ячейки Ганта, — легенда не разъедется с таблицей.
const ITEMS: { sample: React.ReactNode; text: string }[] = [
  { sample: <div className="sv-gc f">12</div>, text: 'Рейсов за смену' },
  { sample: <div className="sv-gc f norm-over">14</div>, text: 'Цвет числа: зелёный — план выполнен, жёлтый — почти, красный — ниже плана' },
  { sample: <div className="sv-gc f multi">9</div>, text: 'Рейсы по нескольким заявкам (оранжевый)' },
  { sample: <div className="sv-gc gc-onsite">•</div>, text: 'Работа по месту без рейсов; число в синей ячейке — % времени в движении' },
  { sample: <div className="sv-gc gc-other-order">⇄</div>, text: 'Машина работала по другой заявке' },
  { sample: <div className="sv-gc gc-warn">!</div>, text: 'На объекте заявки, но рейсов нет и тип работы не определён' },
  { sample: <div className="sv-gc gc-not-on-obj">?</div>, text: 'Есть в путевом листе, но не была на объекте заявки' },
  { sample: <div className="sv-gc gc-absent" />, text: 'Нет путевого листа по заявке' },
  { sample: <span className="sv-truck-trips" style={{ marginLeft: 0 }}>[32/40]</span>, text: 'Под датой: рейсы факт / план за день' },
  { sample: <span className="sv-norm-trips">5|3</span>, text: 'Машин с рейсами в 1-й | 2-й смене' },
  { sample: <span style={{ display: 'inline-flex', gap: 6 }}><span style={{ width: 2, height: 16, background: '#22c55e' }} /><span style={{ width: 2, height: 16, background: '#EF4444' }} /></span>, text: 'Вертикальные линии: машина пришла на объект / ушла с объекта' },
];

export function GanttLegend({ compact = false }: { compact?: boolean }) {
  const { resolvedTheme } = useTheme();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="sv-gantt-nav-btn" title="Обозначения" onMouseDown={e => e.stopPropagation()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Info size={12} />{!compact && <span className="sv-view-label">Обозначения</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-3 sv-legend" onMouseDown={e => e.stopPropagation()}>
        {/* sv-root даёт образцам переменные темы раздела — поповер живёт в портале */}
        <div className="sv-root" data-theme={resolvedTheme} style={{ height: 'auto', background: 'transparent', overflow: 'visible', fontSize: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Обозначения диаграммы</div>
        <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: '6px 10px', alignItems: 'center' }}>
          {ITEMS.map(it => (
            <div key={it.text} style={{ display: 'contents' }}>
              <div style={{ width: 36, display: 'flex', justifyContent: 'center' }}>{it.sample}</div>
              <div style={{ fontSize: 11, lineHeight: 1.35, color: 'var(--muted-foreground)' }}>{it.text}</div>
            </div>
          ))}
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
