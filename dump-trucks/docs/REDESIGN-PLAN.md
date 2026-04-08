# Редизайн вкладки «Аналитика» — Финальный план

> Статус: УТВЕРЖДЁН (решения интервью)
> Дата: 2026-04-06

---

## Принятые решения

| Вопрос | Решение |
|--------|---------|
| KPI + Движение% | Два стэкед мини-бара (~20px): верхний = KPI с цветом, нижний = Движ%/Нагрузка |
| Организации | Хардкод маппинга (полное → сокращённое), `title` для hover |
| Иерархия | Inline chips по сменам, опциональная группировка по заявке |
| Chip клик | Раскрытие вниз (ShiftSubTable / Gantt для onsite) |
| Gantt onsite | Одна полоска, 4 цвета (зона × двигатель) |
| Gantt загрузка | Предзагрузка в pipeline + кнопка «выгрузить» для пропущенных |
| ДСТ данные | Из KIP pipeline (уже есть все ТС) |
| Миграция | Постепенно: Фаза 1 в samosvaly/, Фаза 2 → analytics/ |
| Мультитокены | 19 токенов → 19 машин параллельно, ~12 мин на все onsite |

---

## Фаза 1: Компактный редизайн таблицы

> Цель: переделать UI в текущей структуре samosvaly/, не трогая бэкенд

### 1.1 Компонент MiniBar (переиспользуемый)

```tsx
// frontend/src/components/MiniBar.tsx
<MiniBar
  primary={{ value: 72, label: 'КИП' }}
  secondary={{ value: 54, label: 'Движ' }}
  width={60}
/>
```

**Визуал:**
```
┌──────────────────┐
│ ████████░░░  72% │  ← KPI (зел ≥75 / син 50-74 / крас <50)
│ ██████░░░░░  54% │  ← Движ% или Нагрузка% (серый трек)
└──────────────────┘
```

- Высота: ~16-20px (две полоски по 3-4px + gap 2px)
- Ширина: 50-70px (адаптивная)
- Число справа от бара, fontSize: 10
- Цвет primary: kipColor() — зел/син/крас
- Цвет secondary: приглушённый (#94A3B8 для трека, чуть ярче для заполнения)
- hover title: "КИП: 72%, Движение: 54%"

**Для ДСТ (фаза 2):**
```tsx
<MiniBar
  primary={{ value: 65, label: 'КИП' }}
  secondary={{ value: 78, label: 'Нагр' }}
/>
```

### 1.2 Сокращения организаций

```ts
// frontend/src/features/samosvaly/orgAbbrev.ts
const ORG_ABBREVIATIONS: Record<string, string> = {
  'ТФ "Мостоотряд-36" филиал АО "Мостострой-11"': 'МО-36',
  'ДСУ Мостострой-11': 'ДСУ',
  // ... пополнять по мере появления
};

export function abbreviateOrg(fullName: string): string {
  return ORG_ABBREVIATIONS[fullName] ?? fullName.slice(0, 12) + '…';
}
```

В ячейке:
```tsx
<span style={{ fontSize: 10 }} title={fullOrgName}>
  {abbreviateOrg(fullOrgName)}
</span>
```

### 1.3 Заявки + груз

**Формат ячейки на уровне машины:**
```
№12332, №12333 (щебень)
№12445 (снег)
```

**Реализация:**
- Нужен JOIN: shift_records.requestNumbers → requests.raw_json.orders[].nameCargo
- Группировка по cargo: заявки с одинаковым грузом на одной строке
- Макс 3 заявки, потом кликабельный `…` (Popover с полным списком)

**API изменение:** Добавить cargo в ответ `/api/dt/shift-records`:
```sql
-- Либо в API JOIN к requests, либо денормализовать в shift_records
```

Альтернатива (проще): фронтенд дёргает `/api/dt/orders` и строит маппинг requestNumber → cargo на клиенте. Данные уже загружаются для вкладки "Заявки".

### 1.4 Визуальные разделители блоков

Между блоками столбцов (Определители | Работа | KPI):
- `border-left: 1px solid var(--sv-divider)` на первой ячейке каждого блока
- Уже есть класс `sv-blk-first` — нужно добавить стиль

### 1.5 Новая структура столбцов

```
УРОВЕНЬ 0 (Машина):
┌────────────────────┬──────────────────────┬──────────┬──────────────┐
│ ТС / Заявка / День │ №заявки+груз │ Орг     │ Смены │ Рейсы │ MiniBar    │
│                    │ Определители         │          │ Работа       │ KPI      │
└────────────────────┴──────────────────────┴──────────┴──────────────┘

При раскрытии → inline chips (НЕ вложенные строки таблицы):
┌────────────────────────────────────────────────────────────────────────────┐
│  [Группировка по заявке: опционально]                                      │
│  #12332 (щеб):                                                            │
│    [01.04·С1·5р·███░] [01.04·С2·2р·██░░] [02.04·С1·4р·███░]             │
│  #12445 (снег):                                                           │
│    [03.04·С1·4р·████]                                                     │
│                                                                           │
│  [▼ Развёрнутая таблица рейсов для 01.04·С1]                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1.6 Chip компонент

```tsx
// ShiftChip — один чип для одной смены
<ShiftChip
  date="01.04"
  shift="С1"
  trips={5}
  kip={72}
  movement={54}
  isSelected={selectedChip === key}
  onClick={() => selectChip(key)}
/>
```

**Визуал чипа:**
```
┌──────────────────────────────┐
│ 01.04·С1 · 5р · ███░░ 72%   │
│                  ██░░░ 54%   │
└──────────────────────────────┘
```

- Размер: ~140×24px
- Фон: var(--sv-pill-bg) с hover эффектом
- Рамка: var(--sv-pill-border), при selected — оранжевая (#F97316)
- Клик → разворачивает ShiftSubTable под полоской чипов
- Только один чип может быть развёрнут одновременно

---

## Фаза 2: Gantt смены для onsite-машин

> Цель: заменить «таблицу рейсов» для машин работающих по месту диаграммой активности за смену

### 2.1 Бэкенд: таблица shift_segments

```sql
CREATE TABLE dump_trucks.shift_segments (
  id BIGSERIAL PRIMARY KEY,
  shift_record_id BIGINT NOT NULL REFERENCES dump_trucks.shift_records(id) ON DELETE CASCADE,
  segment_start TIMESTAMPTZ NOT NULL,
  segment_end TIMESTAMPTZ NOT NULL,
  engine_time_sec INTEGER NOT NULL DEFAULT 0,     -- двигатель вкл в этом сегменте
  moving_time_sec INTEGER NOT NULL DEFAULT 0,      -- время движения в сегменте
  in_boundary BOOLEAN NOT NULL DEFAULT false,      -- точки трека попали в dt_boundary
  distance_km NUMERIC(8,2) DEFAULT 0,
  track_points_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shift_segments_record ON dump_trucks.shift_segments(shift_record_id);
```

**Каждый сегмент = 30 минут смены.**
- shift1 (07:30–19:30): 24 сегмента
- shift2 (19:30–07:30): 24 сегмента

**Производные состояния (на фронте):**
```
engine_on  = engine_time_sec > threshold (60 сек?)
in_zone    = in_boundary

Цвет:
🟢 in_zone + engine_on   → объект+работа    (#22c55e)
🟡 in_zone + !engine_on  → объект+стоянка   (#eab308)
🔴 !in_zone + engine_on  → перемещение      (#ef4444)
⚫ !in_zone + !engine_on → простой вне      (#374151)
```

### 2.2 Бэкенд: загрузка сегментов

Новый модуль: `server/src/jobs/segmentFetchJob.ts`

**Алгоритм:**
```
for each onsite shift_record без сегментов:
  for i = 0..23:
    segment_start = shiftStart + (i * 30 мин)
    segment_end   = segment_start + 30 мин
    → getMonitoringStats(idMO, segment_start, segment_end)
    → analyzeZones(track, boundaryZones)  // booleanPointInPolygon
    → INSERT into shift_segments
```

**Параллелизм:**
```
19 токенов → 19 машин параллельно
Rate limit: 1 req/30s per idMO → каждая машина последовательно 24 сегмента
Итого: ~12 мин для ВСЕХ onsite-машин (параллельно)
```

**Вызов:**
- Автоматически в shiftFetchJob после основного цикла (если ТС = onsite)
- Ручная кнопка: `POST /api/dt/admin/fetch-segments?date=YYYY-MM-DD&shift=shift1`

### 2.3 API endpoint

```
GET /api/dt/shift-segments?shiftRecordId=123
→ [{ segment_start, segment_end, engine_time_sec, moving_time_sec, in_boundary, distance_km }]
```

### 2.4 Фронтенд: ShiftGanttBar

```tsx
// Заменяет ShiftSubTable для onsite-машин
<ShiftGanttBar
  segments={segments}           // 24 сегмента
  shiftStart="07:30"
  shiftEnd="19:30"
  timezone="Asia/Yekaterinburg"
/>
```

**Визуал:**
```
07:30     09:00     11:00     13:00     15:00     17:00     19:30
│🟢🟢🟢🟢│🟢🟢🟡🟡│🟢🟢🟢🟢│🔴🔴🟢🟢│🟢🟢🟢🟢│🟢🟡⚫⚫│
└─────────────────────────────────────────────────────────────┘
Легенда: 🟢 работа  🟡 стоянка  🔴 перемещение  ⚫ простой

Hover на сегмент → tooltip:
"11:00–11:30 | На объекте | Двигатель: 28 мин | Движ: 12 мин"
```

- Ширина: 100% контейнера
- Высота: 20-24px
- Каждый из 24 сегментов = равная доля ширины
- Часовые метки сверху (каждые 2 часа)
- Легенда — inline под баром, компактная

---

## Фаза 3: Универсализация для ДСТ (frontend/src/features/analytics/)

> Цель: создать единую вкладку аналитики для всех типов ТС

### 3.1 Миграция

1. Скопировать и адаптировать `samosvaly/DumpTrucksPage.tsx` → `analytics/AnalyticsPage.tsx`
2. Абстрагировать типы: `ShiftRecord` → `UnifiedRecord` с полями:
   ```ts
   interface UnifiedRecord {
     // Общие для всех ТС
     vehicleId: number;
     regNumber: string;
     nameMO: string;
     vehicleType: 'dump_truck' | 'excavator' | 'crane' | 'roller' | ...;
     reportDate: string;
     shiftType: 'shift1' | 'shift2';
     engineTimeSec: number;
     movingTimeSec: number;
     kipPct: number;

     // Специфичные для самосвалов
     tripsCount?: number;
     movementPct?: number;
     workType?: 'delivery' | 'onsite' | 'unknown';

     // Специфичные для ДСТ (из KIP)
     loadEfficiencyPct?: number;    // нагрузка%
     totalStayTime?: number;        // часов
     fuelConsumed?: number;         // литров
   }
   ```
3. MiniBar адаптируется:
   - Самосвалы: primary=КИП%, secondary=Движение%
   - ДСТ: primary=КИП%, secondary=Нагрузка%
4. Chips: для ДСТ без рейсов → `[01.04·С1·6ч·███░]` (часы двигателя вместо рейсов)
5. При клике chip ДСТ → ShiftGanttBar (не таблица рейсов)

### 3.2 API bridge

Новый endpoint на dump-trucks или unified backend:
```
GET /api/dt/unified-records?dateFrom=...&dateTo=...&vehicleTypes=dump_truck,excavator
```
Под капотом:
- dump_trucks.shift_records → для самосвалов
- kip_vehicles.vehicle_records → для остальных ДСТ (cross-DB query или API call)

### 3.3 Навигация

```
Главное меню:
  [Заявки] [Аналитика] [Серверы] ...
                ↑ новая вкладка, заменяет текущую "Аналитика" внутри Самосвалов

Внутри Аналитики — фильтр по типу ТС:
  [Все] [Самосвалы] [Экскаваторы] [Краны] [Катки] ...
```

---

## Порядок реализации

### Спринт 1: Компактные столбцы (Фаза 1.1–1.4)
- [ ] Компонент MiniBar
- [ ] orgAbbrev.ts — хардкод сокращений
- [ ] Заявки + cargo в ячейке (маппинг из orders)
- [ ] border-left разделители между блоками
- [ ] Объединить KPI + Движ% → один столбец с MiniBar
- [ ] Убрать лишние столбцы

### Спринт 2: Inline Chips (Фаза 1.5–1.6)
- [ ] Компонент ShiftChip
- [ ] Рефакторинг AnalyticsTab: убрать вложенные строки, добавить chips-полоску
- [ ] Тоггл группировки по заявке в ChipStrip
- [ ] Раскрытие ShiftSubTable по клику на chip

### Спринт 3: Gantt бэкенд (Фаза 2.1–2.3)
- [ ] Миграция БД: shift_segments
- [ ] segmentFetchJob.ts — параллельная загрузка 30-мин сегментов
- [ ] Интеграция в shiftFetchJob для onsite-ТС
- [ ] API endpoint GET /api/dt/shift-segments
- [ ] Кнопка «Выгрузить» в AdminPage

### Спринт 4: Gantt фронтенд (Фаза 2.4)
- [ ] Компонент ShiftGanttBar
- [ ] Интеграция: chip для onsite → ShiftGanttBar вместо ShiftSubTable
- [ ] Tooltip для сегментов
- [ ] Легенда

### Спринт 5: Миграция + ДСТ (Фаза 3)
- [ ] UnifiedRecord тип
- [ ] API bridge (KIP → dump-trucks или unified)
- [ ] analytics/ feature folder
- [ ] Фильтр по типу ТС
- [ ] Адаптация MiniBar/Chips для ДСТ

---

## Зависимости

```
MiniBar ←── ShiftChip ←── AnalyticsTab рефакторинг
                              ↑
                    orgAbbrev + заявки+cargo
                              ↑
                    border разделители

segmentFetchJob ←── shift_segments миграция
       ↑
ShiftGanttBar ←── API endpoint
       ↑
Chip для onsite ←── ShiftGanttBar
```

---

## Риски

| Риск | Митигация |
|------|-----------|
| Cargo JOIN может быть медленным | Денормализовать cargo в shift_records или маппинг на клиенте из /orders |
| 12 мин на сегменты = долго в pipeline | Загружать только для onsite; после auto-fetch рефакторинга — фоновая задача |
| Cross-DB query (kip_vehicles ↔ mstroy) | Оба на одном PG сервере (Windows), можно через dblink или FDW; либо API call |
| Inline chips на мобильном | Горизонтальный скролл внутри expanded row |
