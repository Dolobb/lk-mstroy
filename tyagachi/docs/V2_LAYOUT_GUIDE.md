# V2 Layout Guide: 3-Column Analytics Page

## Overview

V2 layout transforms the original vertical "matryoshka" layout into a 3-column layout for better usability.

## Structure

```
┌─────────────────┬──────────────────────┬─────────────────┐
│   LEFT (320px)  │    CENTER (flex:1)   │  RIGHT (360px)  │
├─────────────────┼──────────────────────┼─────────────────┤
│ • План заявки   │ • Карта (sticky)     │ • Селектор машин│
│ • Расчетный план│ • Параметры карты    │ • Факт мониторинга│
│ • Список ПЛ     │ • Таймлайн           │ • Стоянки       │
│   (компактный)  │                      │ • Смены         │
└─────────────────┴──────────────────────┴─────────────────┘
```

## Key Changes

### Layout
- **3-column grid layout** instead of vertical stacking
- **Sticky map** in center column - stays visible when scrolling
- **Vehicle selector** in right column for quick switching

### UI Improvements
- Map is always visible when request is expanded (no toggle button)
- Compact PL list with expandable vehicle list
- Vehicle selection highlights on map
- Pre-rendered vehicle panels for instant switching

## File Structure

| File | Description |
|------|-------------|
| `src/output/html_generator.py` | Original layout (unchanged) |
| `src/output/html_generator_v2.py` | New 3-column layout |
| `test_v2_report.py` | Script to generate V2 report |

## Usage

### Generate V2 Report

```bash
# Using existing matched.csv
python test_v2_report.py

# Fetch fresh data first
python test_v2_report.py --fetch --from-pl 01.02.2026 --to-pl 05.02.2026
```

### Output Files

- `output/report.html` - Original layout
- `output/report_v2.html` - New 3-column layout

### A/B Comparison

Open both files in browser tabs to compare:
1. `output/report.html` (current)
2. `output/report_v2.html` (new)

## New JavaScript Functions

```javascript
// Toggle compact PL list expansion
togglePLCompact(element)

// Select vehicle and update right panel
selectVehicleV2(requestId, vehicleUid, vehicleIdx)

// Highlight selected vehicle on map
highlightVehicleOnMapV2(requestId, selectedIdx)
```

## CSS Classes

```css
.request-body-layout     /* 3-column grid container */
.left-column             /* Left column (320px) */
.center-column           /* Center column (flex:1, sticky) */
.right-column            /* Right column (360px) */
.pl-compact-list         /* Compact PL list */
.vehicle-selector        /* Vehicle selector in right column */
.active-vehicle-panel    /* Active vehicle fact panel */
.vehicle-panels-cache    /* Hidden cache of pre-rendered panels */
```

## Responsive Behavior

- **< 992px**: Columns stack vertically
- **992px - 1200px**: Reduced column widths
- **> 1200px**: Full 3-column layout

## Migration Path

After approval, choose one of:

**Option A: Replace Original**
```bash
cp src/output/html_generator_v2.py src/output/html_generator.py
```

**Option B: Add Layout Flag**
Add `--layout=modern` flag to CLI for V2 layout.

## Known Limitations

- Vehicle panels are pre-rendered (increases HTML size)
- Time filter inputs moved to hidden fields (simplified UI)
- No sticky header in columns (would conflict with page header)
