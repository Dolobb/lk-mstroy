# D0 — Детектор impeccable (детерминированный скан frontend/src)

Запуск: `impeccable detect --json frontend/src` → .ui-audit/findings/_detector.json (718 находок, exit 2).

## Как читать
- frontend/DESIGN.md — это **разбор дизайн-системы Linear** (референс для скилла `ui`), а не дизайн-система ЛК. Поэтому 705 advisory «вне DESIGN.md» (цвета/радиусы/размеры) — ложные срабатывания относительно палитры. **Но сам разброс — реальный сигнал**: в коде нет токенов шрифтовой шкалы и цветов, всё литералами.
- Реальные выводы:

### D0-01 [P1] 70 мест с кеглем 6–9px (9px×31, 8px×27, 7px×11, 6px×1) — на видео/скриншотах нечитаемо
- Где: samosvaly.css, DumpTrucksPage.tsx, analytics/*, DateRangePicker.css (полный список — `_detector.json`, antipattern=design-system-font-size, ignoreValue 6px..9px)
- Фикс: минимальный кегль интерфейса 10px (подписи-капс 10px/600, вторичный текст 11px). Механически: 6/7/8px → 10px, 9px → 10px с проверкой переполнений после замены (особенно Гант-ячейки, чипы смен, подписи таймлайна).
- Объём: M

### D0-02 [P2] Две гарнитуры приложения: Roboto (index.css:146) и DM Sans (samosvaly.css:4, 62; MiniDonut fontFamily) — DM Sans без кириллицы
- Связано с C2-02, C2-09. Фикс: одна гарнитура с кириллицей на весь фронт.
- Объём: S

### D0-03 [P3] 9 анимаций layout-свойств (width/max-height): MiniBar.tsx:35, reports-column.tsx:332/346/376, samosvaly.css:247/295/298/422/435
- Фикс: transform: scaleX для баров; для раскрытий — grid-template-rows 0fr→1fr. Низкий приоритет.
