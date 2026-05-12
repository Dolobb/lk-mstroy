---
name: monitoring-design
description: Use this skill to generate well-branded interfaces and assets for NPS Monitoring (Личный кабинет мониторинга строительного транспорта — самосвалы, тягачи, КИП-техника, аналитика смен, карты с зонами объектов), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Monitoring Design Skill

Read `README.md` within this skill first — it covers product context, content fundamentals, visual foundations and iconography. Then explore the other files:

- `colors_and_type.css` — все CSS-переменные (brand, КИП-светофор, радиусы, тени, темы), семантические классы (`.t-h1`, `.t-eyebrow`, `.t-metric-xl`, …). Импортируйте в HTML-артефакт первым.
- `assets/icons/` — кастомные иконки ТС (dump-truck, excavator, heavy-machinery, semi-truck). Используйте их или скопируйте из `ui_kits/monitoring/components.jsx` (там же есть встроенные SVG-пиктограммы).
- `preview/` — превью-карточки токенов и атомов. Хороший справочник «как должен выглядеть N».
- `ui_kits/monitoring/` — полная рекреация интерфейса:
  - `index.html` — кликабельный прототип (Таблица / Карточки / Карта).
  - `app.jsx`, `views.jsx`, `components.jsx` — реакт-компоненты.
  - `data.js` — мок объектов и ТС.
  - `styles.css` — все стили продукта.

## Если вы создаёте визуальный артефакт (mock, prototype, slide):

1. Скопируйте `colors_and_type.css` в новый файл и подключите `<link rel="stylesheet">`.
2. Поставьте `data-theme="dark"` на `<html>` или `<body>` (dark — основная тема).
3. Для верстки экранов мониторинга начните с компонентов из `ui_kits/monitoring/components.jsx` и `views.jsx` (TopNav, FiltersBar, KpiStrip, ShiftChip, KipBar, VehicleCard, TableView, CardsView, MapView).
4. Применяйте КИП-светофор: `≥75% → #22C55E`, `50–74% → #60A5FA`, `<50% → #EF4444`.
5. Никаких эмодзи. Заголовки рубрик UPPERCASE + tracking 0.4–0.6em. Все числовые поля `font-variant-numeric: tabular-nums`.
6. Карточки — glass-style: `background: var(--card)` + `backdrop-filter: blur(16px)` + `border: 1px solid var(--card-border)`.
7. Анимации короткие (.15–.35s ease), без bounce/spring/parallax.

## Если вы работаете над production-кодом:

1. Источник правды — `src/features/samosvaly/samosvaly.css` (переменные `--sv-*`); в нашем CSS они переименованы в семантические (`--fg-1`, `--brand-primary`, `--kip-good` и т.д.), но соответствуют 1:1.
2. Используйте Tailwind v4 классы + shadcn/ui. Lucide React для иконок (Home, Settings, Map, Wrench, Terminal, Sparkles, FileSpreadsheet, BarChart3, Sun, Moon, ChevronRight/Down).
3. Кастомные пиктограммы ТС (`DumpTruckIcon`, `SemiTruckIcon`) — в `src/components/dashboard/VehicleIcons.tsx`.
4. Группировка таблиц: объект → тип ТС → ТС → смены. Сохраняйте полный visual vocabulary: чипы смен, мини-бары КИП, иерархические заголовки.

## Если вас вызвали без других указаний

Спросите пользователя:
- Что нужно собрать — слайд, мок, прототип, экран в продукте?
- Какой раздел — Аналитика, Самосвалы, КИП техники, Карта?
- Целевая ширина/устройство?
- Нужны ли вариации (карта vs таблица, dark vs light)?

Затем работайте как эксперт-дизайнер. Все HTML-артефакты — кликабельные, с реальной типографикой и КИП-светофором. Никакого generic-AI-вида.
