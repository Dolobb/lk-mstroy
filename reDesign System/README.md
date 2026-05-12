# Monitoring — Design System

Internal back-office dashboard for analyzing construction transport operations at NPS: dump trucks (samosvaly), tractor units (tyagachi), KIP equipment (heavy machinery / utilization-tracked fleet), shift analytics, trip counters. Web app on React + Tailwind v4 + shadcn/ui, dark and light themes, Russian-language UI.

> Note: the product UI is in Russian (МСК timezones, DD.MM dates, м³/л/р). This README is in English for cross-tool readability. All in-app strings, copy examples and label samples are kept verbatim in Cyrillic where they appear.

## What it is

A logistics back-office dashboard. It joins telemetry, trip-sheets and dispatcher tickets into a single analytics table:

- **Самосвалы (Dump trucks)** — order cards with per-day Gantt strips, vehicle distribution, KIP metrics, trip counts, load, fuel consumption.
- **Тягачи (Tractors)** — separate section.
- **КИП техники (Equipment utilization)** — donut indicator (≥75% green, 50–74 blue, <50 red).
- **Аналитика (Analytics)** — large pivot table grouped by object → vehicle type → vehicle → shift, with Gantt strip chips and KIP mini-bars.
- **Состояние ТС / Отчёты / AI Demo / Серверы / Гео** — utility sections.

## Product summary

| Attribute | Value |
|---|---|
| Type | Internal enterprise dashboard |
| Platform | Web (desktop, 14"+, high density) |
| Stack | React 18 · TypeScript · Tailwind v4 · shadcn/ui · next-themes · lucide-react |
| Themes | dark (default) / light |
| Language | Russian (МСК+N timezones, DD.MM dates, RUB/л/м³/часы) |
| Density | Very high. Base text 11–14 px, chips 8–10 px |

## Sources

- **Codebase**: mounted as `src/` (read-only via File System Access). Key files:
  - `src/index.css` — Tailwind tokens `:root` / `.dark` (shadcn structure)
  - `src/features/samosvaly/samosvaly.css` — main CSS palette `--sv-*` (1467 lines, two themes)
  - `src/features/samosvaly/DumpTrucksPage.tsx` — main page with order cards
  - `src/features/samosvaly/types.ts` — data types (OrderCard, ShiftRecord, GanttRecord, …)
  - `src/features/analytics/AnalyticsPage.tsx` — pivot analytics table
  - `src/components/TopNavBar.tsx` — top navigation
  - `src/components/MiniBar.tsx`, `ShiftChip.tsx`, `ShiftGanttBar.tsx` — atoms
  - `src/components/ui/*` — full shadcn component set
- **Screenshots**: `uploads/photo_1`, `photo_2`, `photo_3` — current analytics (dark + light), shift detail with trips.
- **User brief**: keep every piece of information currently visible in rows and chips; preserve grouping/separation logic; **add a map view** — each object owns a zone (polygon) which expands to fullscreen on selection, each zone can hold several vehicle types that must be displayed compactly with the same information they show in the table.

## Folder contents

```
/
├── README.md                       ← you are here
├── SKILL.md                        ← agent / Claude Code instructions
├── colors_and_type.css             ← all CSS variables + semantic aliases
├── assets/
│   └── icons/                      ← dump-truck, excavator, heavy-machinery, semi-truck SVGs
├── preview/                        ← cards for the Design System tab
└── ui_kits/
    └── monitoring/                 ← recreation of the existing interface
        ├── README.md
        ├── index.html              ← clickable prototype
        ├── app.jsx                 ← root + view switcher
        ├── views.jsx               ← TableView, CardsView, MapView (new)
        ├── components.jsx          ← TopNav, FiltersBar, KpiStrip, ShiftChip, KipBar, VehicleIcon
        ├── data.js                 ← mock objects & vehicles
        └── styles.css              ← scoped UI kit styles (imports colors_and_type.css)
```

---

## Content Fundamentals — voice and copy

### Tone
**Operational, technical, unemotional.** This is a dispatcher tool, not a marketing site. Copy serves data: labels are terse, no introductions, no greetings. No "вы"/"ты" forms, no vocatives.

### Register and casing
- **SMALL-CAPS UPPERCASE FOR ALL HEADINGS, RUBRICS, COLUMN LABELS, DIVIDERS**: `СМЕНЫ`, `РЕЙСЫ / РАСХОД`, `КИП`, `ДВИГ. ИТОГО`, `АНАЛИТИКА`. Tight letter-spacing (0.3–0.8 px), font-weight 600–700, usually 8–11 px.
- Top-nav labels are also UPPERCASE: `ГЛАВНАЯ`, `КИП ТЕХНИКИ`, `ТЯГАЧИ`, `САМОСВАЛЫ`, `АНАЛИТИКА`.
- **Object names** appear exactly as they come from ERP, with no editing: `СМУ Г. БЕЛОГОРСК, СТР-ВО А/Д ПУТЕПРОВОДА Ч/З ТРАНССИБИРСКУЮ МАГИСТРАЛЬ`. Long, uppercase, full of Russian abbreviations (А/Д = автодорога, Ч/З = через, СМУ, ПКО, КАРЬЕР).
- **Org-abbreviations** come from `orgAbbrev.ts` — `МО-36`, `НПС`.

### Acronyms and units
- **КИП** — коэффициент использования парка (the main KPI; "fleet utilization coefficient")
- **ТС** — транспортное средство (vehicle)
- **ПЛ** — путевой лист (trip sheet)
- **С1 / С2** — shift 1 / shift 2; `2см` = both shifts aggregated
- **МСК+N** — timezone offset from Moscow
- **л** liters, **р** or **р.** trips (e.g. `1272 л`, `24 р`, `Op` = no ticket assigned, `--` = no data)
- **ч/мм** for engine time (`8:02`), `DD.MM` for dates (`30.04 — 12.05.2026`)

### Copy examples (taken straight from the app)
```
АКИВЫ ПОГРУЗКА · 1 ТС
БЕЗ ПОДРАЗДЕЛЕНИЯ · 140 ТС
Г. БОДАЙБО, КАРЬЕР · 9 ТС
№ заявки   Тип   Организация   Смены   Рейсы / расход   КИП   Двиг. итого
Эксковатор гусеничный Caterpillar 329CL
Слежка по месту
Поиск ТС…
Отчёты   AI Demo   Серверы   Состояние ТС   Гео   Dark
```

### Emoji / Unicode
**Not used** in main UI. Emoji placeholders are tolerated only in empty states (`📭`, `🚛`) and spinners may use `⟳`. Direction chip arrows use the Unicode characters `→ ←`.

### Numeric style
- Every numeric column uses `font-variant-numeric: tabular-nums`.
- Percentages are colored according to the KIP traffic light.
- Money / liters / hours have no thousand separators today (`14074 л`, `66835 л`) — this is a known improvement area.

---

## Visual Foundations

### Themes
Two-theme interface with global flip via `next-themes`. Dark is the default and most used (matches screenshot 1).
- **Dark**: deep blue-black gradient background `linear-gradient(145deg, #040812 0%, #0B1120 30%, #111B2E 60%, #0D1526 100%)`, cards `rgba(15,23,42,0.65)` with `backdrop-filter: blur(16px)`.
- **Light**: cold-milk gradient `#F0F4F8 → #E2E8F0 → #EEF2F7 → #F8FAFC`, white glass cards `rgba(255,255,255,0.75)`.

### Color palette (short list — full set in `colors_and_type.css`)

**Brand / semantic:**
- `#F97316` — primary (orange САМОСВАЛЫ, active tab, NPS mark)
- `#3B82F6` / `#60A5FA` — secondary (blue, КИП-техника, links, info)
- `#22C55E` — accent (green, success, КИП ≥75%, report CTA)
- `#A78BFA` — violet (donut KIP center, level-2 groups, "other order")
- `#EF4444` — destructive (red, КИП <50%, breakdowns)
- `#F59E0B` — warning (amber, "on object without trip-sheet")

**КИП traffic light** (business rule):
- `≥ 75%` — green `#22C55E`
- `50–74%` — blue `#60A5FA`
- `< 50%` — red `#EF4444`

**Text in dark theme** (4 levels):
`--fg-1 #F1F5F9` (primary) → `fg-2 #94A3B8` → `fg-3 #64748B` → `fg-4 #475569` (smallest labels). Mirrored in light theme from `#0F172A` down to `#94A3B8`.

### Typography
- **Family**: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif` — deliberately native, no web fonts. **No custom font files in the repo.** Closest substitutes if needed: **Inter 4** or **IBM Plex Sans**. **Flag for the user**: confirm whether to introduce a web font.
- **Scale**: very dense.
  - 28 px — donut metric (top KIP)
  - 22 px — large metric / h1
  - 14 px — table body, h3
  - 13 px — card heading, object name, h4
  - 12 px — base body
  - 11 px — compact (search field, chips, nav labels)
  - 10 px — smaller chips, gantt cells
  - 9 px — rubric eyebrow
  - 8 px — UPPERCASE tracked label (sv-fg-label)
- **Weights**: 400, 500, 600, 700, 800 (800 only for large numbers; rubrics 600–700).
- **`font-variant-numeric: tabular-nums`** — always on for tabular columns.

### Radii
| Use | Radius |
|---|---|
| Order cards | `14 px` |
| Section cards / popovers | `10 px` |
| Filter chips, small KPI boxes | `8 px` |
| Pills | `6 px` |
| Small buttons | `5 px` |
| Donut / dot | `50%` |
| Gantt cells | `4 px` |

`--radius: 0.75rem` (12 px) — shadcn variable, rarely used inside samosvaly.

### Shadows and elevation
- **Cards**: `box-shadow: 0 4px 16px rgba(0,0,0,.12)` on hover.
- **Popovers**: `0 8px 24px rgba(0,0,0,0.6)` dark, `0 8px 24px rgba(0,0,0,0.15)` light.
- **Overlay panels**: `-8px 0 30px rgba(0,0,0,.2)` for side drawers.
- **Primary CTA glow**: `0 0 20px rgba(249,115,22,0.15)` for active tabs; report button `0 4px 14px rgba(34,197,94,.3)` on hover.

### Borders
Mostly translucent hairlines: `rgba(255,255,255,0.04…0.12)` dark, `rgba(0,0,0,0.04…0.10)` light. **Always 1 px**, occasionally 2 px for group dividers, 1.5 px for tree-line pipes.

### Backdrop blur and glass
- `backdrop-filter: blur(12 px…20 px)` on every glass surface: top nav, order cards, popovers, side panels.
- In dark theme over the blue gradient this produces the signature depth look.

### Background and atmosphere
- Base — linear-gradient 145° across 4 stops (see themes above).
- Two ambient halos on dark:
  - `.sv-amb-o` — orange radial top-right `rgba(249,115,22,0.04) → transparent 70%`, 600×600
  - `.sv-amb-b` — blue radial bottom-left `rgba(59,130,246,0.03) → transparent 70%`, 500×500
- No photography, no repeating textures, no hand-drawn illustrations. **Color and glass only.**

### Animation
- `transition: all .15s | .2s | .35s` — fast, never above 0.35 s
- Easing: default `ease`/`ease-in-out` (no cubic-bezier in use)
- Gantt expand via `max-height` 0 → 600 px over 0.35 s
- Progress bars `width` 0.4 s
- Donut/spinner: `@keyframes sv-spin` 1 s linear infinite
- `@keyframes shimmer` 1.5 s for skeleton
- **No bounce / spring**, no parallax, no orbital motion.

### Hover / press
- **Cards**: `transform: translateY(-1px)` + shadow `0 4px 16px rgba(0,0,0,.12)`
- **Pills / buttons**: background to `--sel-bg` (blue 8% alpha), text to `--pill-a-text` (`#60A5FA` dark / `#2563EB` light)
- **Report button**: `translateY(-1px)` + green glow
- **Row hover**: `background: rgba(255,255,255,0.03)` dark / `rgba(0,0,0,0.02)` light
- **Popover icons**: `opacity 0.5 → 1`
- **Disabled**: `opacity 0.3` + `cursor: default`
- No distinct press state (hover doubles for it).

### Layout
- Fixed viewport height (`overflow: hidden` on body); inner regions scroll independently
- **Sticky thead** — `position: sticky; top: 0; z-index: 5–8` (above data, below filters)
- **Sticky first column** in global Gantt — `position: sticky; left: 0` with right-edge gradient
- **CSS Grid** for two-column layouts: orders + side panel `grid-template-columns: 1fr 320px`
- **Flex** for everything else
- Side panels slide in via `transform: translateX(100%) → 0` over 0.3 s

### Transparency
- Cards are translucent with blur — background bleeds through
- `rgba(*, 0.04…0.12)` — main alpha range for borders and dividers
- Hatching (`repeating-linear-gradient 135deg`) for "absent from object" Gantt cells

### Icons (short version)
**Lucide React** — single source for line icons: `Home, Settings, Sun, Moon, Map, Wrench, Terminal, Sparkles, FileSpreadsheet, BarChart3`. Stroke 1.8. Plus two custom SVGs: `DumpTruckIcon`, `SemiTruckIcon` for vehicle types. Full guide in the **Iconography** section.

### Charts
- **Donut KIP**: SVG arcs, stroke 8–12 px, color violet `#8B5CF6` for the overall value, blue + violet for movement / zone bars.
- **Mini bar (two-track)**: 5 px tall, primary KIP colored per traffic light, secondary movement semi-transparent.
- **Scales**: vertical bars ~10 px wide, violet/blue, track background `rgba(255,255,255,0.06)`.

### Map (new in the redesign)
The original app has **no map**. This is a new layer we are adding. Object zones are drawn as polygons; vehicle types on an object are cluster pins colored by semantic (orange dump truck, blue KIP, violet excavator, green crane).

---

## Iconography

### Source
**lucide-react ^0.x** — primary set for UI (line, stroke 1.5–2). Wired via npm in the source code; in this design system we use it via CDN `https://unpkg.com/lucide@latest`. Used names visible in `TopNavBar.tsx`:
- Home, Settings, Sun, Moon — navigation and theme
- Map, Wrench, Terminal, Sparkles, FileSpreadsheet, BarChart3 — utility sections
- ChevronRight/Down — expanders

### Custom icons
- `DumpTruckIcon` and `SemiTruckIcon` (in `src/components/dashboard/VehicleIcons.tsx`) — SVG silhouettes of a dump truck and a tractor unit. Copied to `assets/icons/`. Stroke 1.8, viewBox 24×24. Two more shapes — `excavator.svg`, `heavy-machinery.svg` — were drawn to match the same line weight.
- Inside sub-tables we use text markers: `▶ ◀` (trip start/end).

### Emoji / Unicode
- **Emoji** are not used (see Content Fundamentals). Exception: placeholders in empty states (`📭`, `🚛`) which can be removed without loss.
- **Unicode arrows** in Gantt: `→`, `←`, `▶`.
- **Unicode chevrons** are not used — all chevrons are CSS/SVG.

### Logo
Text-only logo `НПС / МОНИТОРИНГ` in the top-right of the top nav. Colors: `НПС` orange primary, separator gray, `МОНИТОРИНГ` primary text, font-weight 600, wide letter-spacing. There is no graphic logo in the codebase. **Flag**: if an НПС SVG logo exists, please attach it.

### Placeholders
If a glyph is missing from lucide — use a text placeholder (`№`, `Σ`, etc.) instead of a hand-rolled SVG.

---

## Index — file manifest

| File | Why |
|---|---|
| `README.md` | This file |
| `SKILL.md` | Cross-compatible skill for agents / Claude Code |
| `colors_and_type.css` | All CSS variables (brand, KIP traffic light, both themes) + semantic classes |
| `assets/icons/dump-truck.svg`, `excavator.svg`, `heavy-machinery.svg`, `semi-truck.svg` | Custom vehicle icons |
| `preview/colors-brand.html` | Card — brand palette |
| `preview/colors-kip-traffic-light.html` | Card — KIP traffic light (≥75 / 50–74 / <50 rule) |
| `preview/colors-text-hierarchy.html` | Card — text hierarchy |
| `preview/type-scale.html` | Card — typographic scale |
| `preview/spacing-radii-shadows.html` | Card — radii and shadows |
| `preview/components-pills-tabs.html` | Card — pills, nav buttons, view tabs |
| `preview/components-shift-chips.html` | Card — shift chips and KIP mini-bar |
| `preview/components-kpi-boxes.html` | Card — KPI strip across objects |
| `preview/components-vehicle-card.html` | Card — compact vehicle card (row → card redesign) |
| `preview/components-map-zones.html` | Card — map with zones and cluster pins |
| `preview/components-side-panel.html` | Card — weekly side panel |
| `preview/brand-vehicle-icons.html` | Card — vehicle pictograms |
| `ui_kits/monitoring/index.html` | Clickable prototype (table / cards / map) |
| `ui_kits/monitoring/{app,views,components}.jsx` | UI kit React components |
| `ui_kits/monitoring/data.js` | Mock objects, vehicles, shifts |
| `ui_kits/monitoring/styles.css` | UI kit styles (imports `colors_and_type.css`) |

## Not done / needs confirmation

- **Web fonts**: source uses `system-ui`. Cards and prototype also use the system stack. If you need visual guarantees across machines — pick a web font (Inter / IBM Plex / other).
- **NPS logo**: no SVG available. Reproduced as text mark.
- **Full map**: not present in current code. The prototype shows a static SVG mock (background, zone polygons, cluster pins) — not a real Leaflet/Mapbox.
- **Light/dark map tiles**: prod will need themed tiles — flag to confirm provider.
