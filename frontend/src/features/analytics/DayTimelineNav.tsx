// ─── Карточки v2.0 — навигатор день×смена ─────────────────────────────
// 28 ячеек (14 дней × {C1,C2}), сгруппированы по дням. Цвет = флот %КИП,
// подпись = сколько ТС работало. Клик = выбор смены. Заменяет daterangepicker.

export type Shift = 'shift1' | 'shift2';

export interface TlShiftCell {
  shift: Shift;
  kip: number;
  count: number;
  hasData: boolean;
}
export interface TlDay {
  date: string;        // YYYY-MM-DD
  cells: TlShiftCell[];
}

function kipColorV2(v: number): string {
  if (v >= 75) return '#22C55E';
  if (v >= 50) return '#F59E0B';
  return '#EF4444';
}
function dayLabel(date: string): string {
  const p = date.split('-');
  return `${p[2]}.${p[1]}`;
}

interface Props {
  days: TlDay[];
  selectedDate: string | null;
  selectedShift: Shift | null;
  onSelect: (date: string, shift: Shift) => void;
}

export function DayTimelineNav({ days, selectedDate, selectedShift, onSelect }: Props) {
  return (
    <div className="sv-v2-timeline">
      {days.map(d => (
        <div key={d.date} className="sv-v2-tl-day">
          <div className="sv-v2-tl-shifts">
            {d.cells.map(c => {
              const sel = selectedDate === d.date && selectedShift === c.shift;
              const h = c.hasData ? Math.max(2, Math.round((c.kip / 100) * 38)) : 2;
              const shiftLbl = c.shift === 'shift1' ? 'C1' : 'C2';
              return (
                <div
                  key={c.shift}
                  className={`sv-v2-tl-cell${sel ? ' selected' : ''}${c.hasData ? '' : ' empty'}`}
                  onClick={() => c.hasData && onSelect(d.date, c.shift)}
                  title={c.hasData
                    ? `${dayLabel(d.date)} ${shiftLbl} · КИП ${Math.round(c.kip)}% · ${c.count} ТС`
                    : `${dayLabel(d.date)} ${shiftLbl} · нет данных`}
                >
                  <div
                    className="sv-v2-tl-bar"
                    style={{ height: h, background: c.hasData ? kipColorV2(c.kip) : 'var(--sv-text-4)' }}
                  />
                  <span className="sv-v2-tl-cnt">{c.hasData ? c.count : ''}</span>
                  <span className="sv-v2-tl-shift-lbl">{shiftLbl}</span>
                </div>
              );
            })}
          </div>
          <span className="sv-v2-tl-day-lbl">{dayLabel(d.date)}</span>
        </div>
      ))}
    </div>
  );
}
