# Промпт для AI-агента: редизайн React-интерфейса мониторинга техники

## Контекст

Существует React-приложение для мониторинга техники (КИП, выработка МиМ). Текущий интерфейс функционален, но визуально не соответствует целевому дизайн-макету. Необходимо **переверстать UI-компоненты** без изменения бизнес-логики и данных. Карту (Leaflet/OpenStreetMap) и её логику не трогать.

---

## Глобальная структура страницы (Layout)

Корневой компонент `<DashboardPage>` — полноэкранный layout без скролла (`height: 100vh; overflow: hidden`).

```
┌─────────────────────────────────────────────────────────┐
│                    <HeaderBar />                        │  ~70px
├───────────────────────────────┬──────────────────────────┤
│                               │   <VehicleCard />       │  ~65% высоты
│        <MapPanel />           ├──────────────────────────┤
│        (без изменений)        │   <ProductionTable />   │  ~35% высоты
│                               │                          │
└───────────────────────────────┴──────────────────────────┘
         ~65% ширины                  ~35% ширины
```

### CSS для корневого layout:

```css
.dashboard {
  display: grid;
  grid-template-rows: 70px 1fr;
  grid-template-columns: 65fr 35fr;
  height: 100vh;
  overflow: hidden;
}

.header-bar {
  grid-column: 1 / -1; /* на всю ширину */
}

.map-panel {
  grid-row: 2;
  grid-column: 1;
}

.right-panel {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  flex-direction: column;
}

.vehicle-card {
  flex: 0 0 65%;
  overflow-y: auto;
}

.production-table {
  flex: 0 0 35%;
  overflow-y: auto;
}
```

---

## Компонент `<HeaderBar />`

Горизонтальная полоса на всю ширину, фон — `#3300FF` (ярко-синий индиго).

### Текущая проблема:
Все элементы расположены **в одну строку** (inline), из-за чего даты С/По стоят на одном уровне с переключателями Месяц/Неделя. В макете даты находятся **под** переключателями.

### Целевая структура (flex):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Период: [Месяц] [Неделя]   [День|Вечер]  [Филиал▼] [ТипТС▼] [СМУ▼]  [Средний КИП]  Выбор КИП,%  │
│          [01.01.2026] [02.01.2026]                                                   [0-25][25-50] │
│                                                                                      [50-75][75-100]│
└──────────────────────────────────────────────────────────────────────┘
```

### JSX-структура:

```jsx
<header className="header-bar">
  {/* Блок Период — ДВУСТРОЧНЫЙ */}
  <div className="period-block">
    <div className="period-row-top">
      <span className="period-label">Период:</span>
      <button className={`toggle-btn ${mode === 'month' ? 'active' : ''}`}>Месяц</button>
      <button className={`toggle-btn ${mode === 'week' ? 'active' : ''}`}>Неделя</button>
    </div>
    <div className="period-row-bottom">
      <span className="date-badge">{startDate}</span>
      <span className="date-badge">{endDate}</span>
    </div>
  </div>

  {/* День/Вечер */}
  <div className="shift-toggle">
    <button className={`toggle-btn ${shift === 'day' ? 'active' : ''}`}>День</button>
    <button className={`toggle-btn ${shift === 'evening' ? 'active' : ''}`}>Вечер</button>
  </div>

  {/* Дропдауны */}
  <select className="header-select">...</select> {/* Филиал */}
  <select className="header-select">...</select> {/* Тип ТС */}
  <select className="header-select">...</select> {/* СМУ */}

  {/* Средний КИП */}
  <div className="avg-kip-badge">Средний КИП {value && `${value}%`}</div>

  {/* Выбор КИП — сетка 2×2 */}
  <div className="kip-filter-block">
    <span className="kip-filter-title">Выбор КИП, %</span>
    <div className="kip-grid">
      <button className="kip-btn kip-red">0%-25%</button>
      <button className="kip-btn kip-orange">25%-50%</button>
      <button className="kip-btn kip-yellow">50%-75%</button>
      <button className="kip-btn kip-green">75%-100%</button>
    </div>
  </div>
</header>
```

### Ключевые CSS-правила для HeaderBar:

```css
.header-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #3300FF;
  color: #fff;
  height: 70px;
}

/* Критически важно: блок Период — column layout */
.period-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.period-row-top,
.period-row-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-btn {
  padding: 4px 14px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.4);
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}

.toggle-btn.active {
  background: #FFA500;
  color: #000;
  font-weight: 600;
  border-color: #FFA500;
}

.date-badge {
  background: #2ECC40;
  color: #000;
  padding: 3px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
}

.header-select {
  background: transparent;
  color: #fff;
  border: 1px solid rgba(255,255,255,0.4);
  border-radius: 8px;
  padding: 6px 28px 6px 12px;
  font-size: 13px;
  appearance: none;
  /* Добавить кастомную стрелку через background-image SVG */
}

.avg-kip-badge {
  background: #fff;
  color: #000;
  padding: 8px 20px;
  border-radius: 8px;
  font-weight: 600;
  white-space: nowrap;
}

.kip-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}

.kip-btn {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid #000;
  cursor: pointer;
}

.kip-red    { background: #FF0000; color: #fff; }
.kip-orange { background: #FF8C00; color: #000; }
.kip-yellow { background: #FFD700; color: #000; }
.kip-green  { background: #00C853; color: #000; }
```

---

## Компонент `<VehicleCard />`

Правая верхняя панель. Фон — `#3300FF`. Содержит список параметров техники.

### Текущая проблема:
Параметры отображаются как плоские строки текста без визуального разделения. Нет карточек-контейнеров, нет разделителей.

### Целевой вид:
Каждый параметр — **скруглённый горизонтальный контейнер** (pill-shape) с рамкой, внутри которого лейбл и значение разделены вертикальной полоской.

```
┌──────────────────────────────────────────────┐
│  ┌──────────┐ │  Значение                    │
│  │  Лейбл   │ │                              │
│  └──────────┘ │                              │
└──────────────────────────────────────────────┘
```

### JSX-структура:

```jsx
<div className="vehicle-card">
  {/* Кнопка закрытия в правом верхнем углу */}
  <button className="close-btn" onClick={onClose}>✕</button>

  {fields.map((field) => (
    <div className="info-row" key={field.key}>
      <div className="info-label">{field.label}</div>
      <div className="info-divider" />
      <div className="info-value">
        {field.key === 'requestNumber' && (
          <button className="nav-arrow" onClick={onPrev}>‹</button>
        )}
        <span>{field.value}</span>
        {field.key === 'requestNumber' && (
          <button className="nav-arrow" onClick={onNext}>›</button>
        )}
      </div>
    </div>
  ))}
</div>
```

Где `fields` — массив:
```js
const fields = [
  { key: 'vehicleType',   label: 'Тип ТС' },
  { key: 'brand',         label: 'Марка' },
  { key: 'stateNumber',   label: 'Гос №' },
  { key: 'requestNumber', label: `№ Заявки (${count})` },
  { key: 'applicant',     label: 'Заявитель' },
  { key: 'costObject',    label: 'Объект затрат' },
  { key: 'workType',      label: 'Вид работ' },
];
```

### CSS для VehicleCard:

```css
.vehicle-card {
  background: #3300FF;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  overflow-y: auto;
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: #fff;
  font-size: 22px;
  cursor: pointer;
}

.info-row {
  display: flex;
  align-items: stretch;
  border: 2px solid #1a0066;
  border-radius: 25px;
  overflow: hidden;
  min-height: 44px;
  background: transparent;
}

.info-label {
  flex: 0 0 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  text-align: center;
  white-space: nowrap;
}

.info-divider {
  width: 3px;
  background: #1a0066;
  align-self: stretch;
}

.info-value {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 8px 16px;
  color: #fff;
  font-size: 14px;
  word-break: break-word;
  /* Для поля "Объект затрат" — автоматическое увеличение высоты */
}

.nav-arrow {
  background: none;
  border: none;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  padding: 0 8px;
  font-weight: 700;
}

/* Стрелки по краям значения для "№ Заявки" */
.info-value .nav-arrow:first-child {
  margin-right: auto;
}
.info-value .nav-arrow:last-child {
  margin-left: auto;
}
.info-value span {
  flex: 1;
  text-align: center;
}
```

---

## Компонент `<ProductionTable />`

Нижний блок правой панели (фиксированно **35% высоты**). Белый фон.

### Текущая проблема:
Даты отображаются в сыром ISO-формате (`05T19:00:00.000Z.02`). Нужно парсить и форматировать в `ДД.ММ`.

### Целевой вид:

```
           Выработка МиМ по дням
┌─────────┬───────────────┬───────────────┐
│  Дата   │  1 смена, %   │  2 смена, %   │
│         ├───────┬───────┼───────┬───────┤
│         │  КИП  │Нагруз.│  КИП  │Нагруз.│
├─────────┼───────┼───────┼───────┼───────┤
│  01.02  │  90.3 │  98.5 │  0.0  │  0.0  │
│  02.02  │  68.0 │  74.2 │  0.0  │  0.0  │
│  ...    │       │       │       │       │
├─────────┼───────┼───────┼───────┼───────┤
│ Итого:  │  61.0 │  66.5 │  0.0  │  0.0  │
└─────────┴───────┴───────┴───────┴───────┘
```

### JSX-структура:

```jsx
<div className="production-table-wrapper">
  <h3 className="table-title">Выработка МиМ по дням</h3>
  <div className="table-scroll">
    <table className="production-table">
      <thead>
        <tr>
          <th rowSpan={2}>Дата</th>
          <th colSpan={2}>1 смена, %</th>
          <th colSpan={2}>2 смена, %</th>
        </tr>
        <tr>
          <th>КИП</th>
          <th>Нагрузка</th>
          <th>КИП</th>
          <th>Нагрузка</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date}>
            <td>{formatDate(row.date)}</td> {/* ДД.ММ */}
            <td style={{ color: getKipColor(row.shift1Kip) }}>{row.shift1Kip}</td>
            <td style={{ color: getKipColor(row.shift1Load) }}>{row.shift1Load}</td>
            <td style={{ color: getKipColor(row.shift2Kip) }}>{row.shift2Kip}</td>
            <td style={{ color: getKipColor(row.shift2Load) }}>{row.shift2Load}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Итого:</strong></td>
          <td>{totals.shift1Kip}</td>
          <td>{totals.shift1Load}</td>
          <td>{totals.shift2Kip}</td>
          <td>{totals.shift2Load}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>
```

### Утилита форматирования даты:

```js
// Парсинг из ISO-подобного формата в ДД.ММ
function formatDate(raw) {
  // Пример входа: "05T19:00:00.000Z.02" или ISO-строка
  // Нужно извлечь день и месяц
  const date = new Date(raw);
  if (!isNaN(date)) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}`;
  }
  // fallback: попробовать regex
  const match = raw.match(/(\d{2})T.*\.(\d{2})$/);
  if (match) return `${match[1]}.${match[2]}`;
  return raw;
}
```

### CSS для ProductionTable:

```css
.production-table-wrapper {
  background: #fff;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.table-title {
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: #000;
}

.table-scroll {
  flex: 1;
  overflow-y: auto;
}

.production-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.production-table th,
.production-table td {
  border: 2px solid #000080;
  padding: 4px 8px;
  text-align: center;
}

.production-table th {
  background: #fff;
  font-weight: 700;
  color: #000;
}

.production-table tfoot td {
  font-weight: 700;
}
```

---

## Цветовая индикация КИП (утилита)

```js
function getKipColor(value) {
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return '#FF0000';
  if (num < 25) return '#FF0000';
  if (num < 50) return '#FF8C00';
  if (num < 75) return '#FFD700';
  return '#00C853';
}
```

---

## Сводная цветовая палитра (CSS-переменные)

```css
:root {
  --color-primary: #3300FF;        /* Синий индиго — хедер, правая панель */
  --color-primary-dark: #1a0066;   /* Тёмно-синий — рамки, разделители */
  --color-accent: #FFA500;         /* Оранжевый — активные табы */
  --color-date-badge: #2ECC40;     /* Зелёный — бейджи дат */
  --color-kip-red: #FF0000;
  --color-kip-orange: #FF8C00;
  --color-kip-yellow: #FFD700;
  --color-kip-green: #00C853;
  --color-text-light: #FFFFFF;
  --color-text-dark: #000000;
  --color-border-table: #000080;
}
```

---

## Чек-лист для валидации

- [ ] Блок «Период» в хедере — **двустрочный** (переключатели сверху, даты снизу), не в одну линию
- [ ] Даты отображаются как зелёные скруглённые бейджи
- [ ] Переключатели Месяц/Неделя и День/Вечер — оранжевый фон для активного состояния
- [ ] Дропдауны (Филиал, Тип ТС, СМУ) — полупрозрачные со стрелкой на синем фоне
- [ ] «Средний КИП» — белый бейдж с чёрным текстом
- [ ] КИП-фильтры — сетка 2×2, каждая кнопка своего цвета
- [ ] Карточка техники: каждый параметр — скруглённый pill-контейнер с рамкой
- [ ] Внутри pill: лейбл | вертикальный разделитель | значение
- [ ] Лейблы — фиксированная ширина 150px, все выровнены
- [ ] «Объект затрат» — контейнер растягивается по высоте при длинном тексте
- [ ] «№ Заявки» — кнопки навигации `<` и `>` внутри контейнера
- [ ] Таблица выработки занимает строго 35% высоты правой панели
- [ ] Даты в таблице — формат `ДД.ММ`, а не ISO
- [ ] Значения в таблице окрашены по диапазонам КИП
- [ ] Общий layout: `65% карта | 35% правая панель`, без горизонтального скролла
