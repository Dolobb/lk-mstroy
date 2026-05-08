# Изменения вкладки «Ганта» (самосвалы) — 2026-05-08

Все правки в `src/features/samosvaly/`. Затрагивают только `GlobalGanttTab` (третья вкладка `/samosvaly` → «Ганта»). Прочие гантты (внутри карточек заявок, аналитики) не трогали.

## 1. Заметный кастомный скроллбар у `.sv-gg-wrap`

Файл: `samosvaly.css`

- Высота полос: `width: 14px; height: 17px` (горизонтальная на 3px толще для наглядности)
- Цвет ползунка: `rgba(96,165,250,0.55)` (голубой), при `:hover` 0.85, `:active` 1.0
- Видимый трек `rgba(255,255,255,0.06)` + `border-top: 1px solid rgba(255,255,255,0.08)`
- `scrollbar-gutter: stable` — место под полосу резервируется всегда
- `scrollbar-width: auto` + явный `scrollbar-color` — переопределяет наследуемый `thin`/тусклый цвет от родителя `.sv-gantt`, нормальная видимость в Firefox
- `min-width: 40px` / `min-height: 40px` на `::-webkit-scrollbar-thumb` — ползунок не вырождается в точку при большом контенте
- Отдельные правила для `[data-theme="light"]` (синие тона `rgba(59,130,246,...)`)

## 2. Удалена пагинация, скролл стал основной навигацией

Файл: `DumpTrucksPage.tsx` (компонент `GlobalGanttTab`)

**Удалено:**
- `scrollOffset` state, `setScrollOffset`
- `dragRef`, drag-to-scroll handlers (`onMouseDown`, `onMouseMove`, `onMouseUp`)
- `needsNav`, `maxOffset`, `clampedOffset`
- Кнопки ◀▶ из левого верхнего угла шапки
- `sv-gantt-draggable` класс на строках с датами
- `setScrollOffset(0)` из `zoomIn`/`zoomOut`/effect загрузки данных

**Стало:**
- `visibleDates = filteredDates` — рендерятся ВСЕ даты сразу, scrollLeft контейнера управляет навигацией
- Новый `useEffect` с `initialScrollRef` — на первом рендере после загрузки данных автоматически прокручивает к сегодняшнему дню (today становится у правого края). При смене месяца/режима `isAllTime` флаг сбрасывается → авто-скролл срабатывает заново

## 3. Sticky первый столбец (номера машин)

Файл: `samosvaly.css`

```
.sv-gg-wrap thead th:first-child       — sticky top+left, z-index: 8
.sv-gg-wrap tbody tr:not(.sv-gg-obj-header) > td:first-child — sticky left, z-index: 5
```

- Solid background `#0A1220` (тёмная тема) / `#F1F5F9` (светлая) на закреплённой ячейке тела — прокручиваемый контент не просвечивает
- Тень справа через `::after` (`linear-gradient(rgba(0,0,0,0.35), transparent)`) — визуальное отделение sticky-зоны от прокручиваемой части

**Слои z-index:**
- 8 — corner cell (пересечение sticky-top + sticky-left)
- 6 — thead (sticky-top, было)
- 5 — body td:first-child (sticky-left)
- 4 — obj-header td (sticky-left, см. §4)

## 4. Sticky строки заголовков объектов (`.sv-gg-obj-header`)

Файл: `samosvaly.css`

```
.sv-gg-wrap tbody tr.sv-gg-obj-header > td {
  position: sticky;
  left: 0;
  z-index: 4;
}
```

- Ячейка с `colSpan={colSpanAll}` пиннится по левому краю — название объекта не уезжает при горизонтальном скролле
- Фон сделан непрозрачным: `linear-gradient(rgba(59,130,246,0.06), rgba(59,130,246,0.06)), #0A1220` (стек на solid base) — sticky-ячейка не просвечивает прокручиваемое содержимое

## 5. Убран padding-зазор слева

Файл: `samosvaly.css`

`.sv-gg-wrap { padding: 0 }` — раньше от родителя `.sv-gantt` приходило `padding: 8px`, и эти 8px создавали зазор слева от sticky-столбца, через который при скролле просвечивал прокручиваемый контент. Теперь sticky-столбец прижат вплотную к левому краю scroll-контейнера.

## 6. Фиксация ширины первого столбца

Файл: `samosvaly.css`

Симптом: при малом количестве дат первая колонка растягивалась.

Причина: `min-width: 100%` на таблице растягивал её до ширины контейнера; с `table-layout: fixed` + `width: auto` спецификация переключает layout на auto, который игнорирует `max-width` ячеек и распределяет лишнюю ширину по всем колонкам пропорционально контенту.

Решение:

```
.sv-gg-wrap table { width: max-content; table-layout: auto; }
.sv-gg-wrap th:not(:first-child),
.sv-gg-wrap td:not(:first-child) { width: 40px; min-width: 40px; }
.sv-gg-wrap thead th:first-child,
.sv-gg-wrap tbody tr:not(.sv-gg-obj-header) > td:first-child {
  width: 180px;
  min-width: 180px;
  max-width: 180px;
}
```

- `width: max-content` — таблица ровно той ширины, что нужна (180 + N*80px), без растягивания
- Первый столбец строго 180px (`width/min/max`)
- Дата-ячейки 40px (без `max-width` — чтобы `colSpan=2` корректно занимал 80px)

**Trade-off:** если дат мало, таблица у́же контейнера → справа от неё пустое место с фоном ганта. Принято в обмен на стабильную ширину первой колонки.
