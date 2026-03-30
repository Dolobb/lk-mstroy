export interface ColumnDef {
  id: string;
  label: string;
  group: string;
  defaultIncluded: boolean;
  fixed?: boolean;       // cannot be removed by user
  width?: number;        // Excel column width
}

// ─── КИП ────────────────────────────────────────────────────────────────────

export const KIP_COLUMNS: ColumnDef[] = [
  // Identity — always included, fixed
  { id: 'report_date',       label: 'Дата',                    group: 'Основные',  defaultIncluded: true, fixed: true, width: 12 },
  { id: 'shift_type',        label: 'Смена',                   group: 'Основные',  defaultIncluded: true, fixed: true, width: 8 },
  { id: 'vehicle_id',        label: 'Марка / гос.№',          group: 'Основные',  defaultIncluded: true, fixed: true, width: 18 },
  { id: 'vehicle_model',     label: 'Модель',                  group: 'Основные',  defaultIncluded: true, fixed: true, width: 14 },
  { id: 'department_unit',   label: 'СМУ',                     group: 'Основные',  defaultIncluded: true, fixed: true, width: 20 },
  // Default metrics
  { id: 'utilization_ratio',   label: 'КИП, %',                group: 'Метрики',  defaultIncluded: true,  width: 8 },
  { id: 'total_stay_time',    label: 'Время на объекте, ч',    group: 'Метрики',  defaultIncluded: true,  width: 10 },
  { id: 'engine_on_time',     label: 'Моточасы, ч',            group: 'Метрики',  defaultIncluded: true,  width: 10 },
  { id: 'load_efficiency_pct', label: 'Нагрузка, %',           group: 'Метрики',  defaultIncluded: true,  width: 8 },
  // Optional
  { id: 'idle_time',           label: 'Простой, ч',            group: 'Доп.',     defaultIncluded: false, width: 10 },
  { id: 'fuel_consumed_total', label: 'Расход, л',             group: 'Топливо',  defaultIncluded: false, width: 10 },
  { id: 'fuel_rate_fact',     label: 'Расход факт, л/ч',       group: 'Топливо',  defaultIncluded: false, width: 10 },
  { id: 'fuel_rate_norm',     label: 'Расход норма, л/ч',      group: 'Топливо',  defaultIncluded: false, width: 10 },
  { id: 'fuel_variance',      label: 'Коэфф. расхода',         group: 'Топливо',  defaultIncluded: false, width: 10 },
];

// ─── Самосвалы — рейсы ──────────────────────────────────────────────────────

export const DT_TRIPS_COLUMNS: ColumnDef[] = [
  // Fixed trip data
  { id: 'reg_number',        label: 'ГосНомер',                group: 'Основные',    defaultIncluded: true, fixed: true, width: 16 },
  { id: 'trips_count',       label: 'Кол-во рейсов',          group: 'Основные',    defaultIncluded: true, fixed: true, width: 11 },
  { id: 'shift_start',       label: 'Начало смены',            group: 'Основные',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'loading_enter',     label: 'Погрузка: Въезд',         group: 'Погрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'loading_exit',      label: 'Погрузка: Выезд',         group: 'Погрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'loading_dwell',     label: 'Погрузка: Стоянка',       group: 'Погрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'unloading_enter',   label: 'Выгрузка: Въезд',         group: 'Выгрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'unloading_exit',    label: 'Выгрузка: Выезд',         group: 'Выгрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'unloading_dwell',   label: 'Выгрузка: Стоянка',       group: 'Выгрузка',    defaultIncluded: true, fixed: true, width: 9 },
  { id: 'shift_end',         label: 'Конец смены',              group: 'Основные',    defaultIncluded: true, fixed: true, width: 9 },
  // Optional aggregates
  { id: 'avg_loading_dwell',      label: 'Ср. стоянка П',       group: 'Агрегаты',  defaultIncluded: true,  width: 11 },
  { id: 'avg_unloading_dwell',    label: 'Ср. стоянка В',       group: 'Агрегаты',  defaultIncluded: true,  width: 11 },
  { id: 'avg_travel_load_unload', label: 'Ср. путь П→В',        group: 'Агрегаты',  defaultIncluded: false, width: 11 },
  { id: 'avg_travel_unload_load', label: 'Ср. путь В→П',        group: 'Агрегаты',  defaultIncluded: false, width: 11 },
  { id: 'comment',                label: 'Комментарий',          group: 'Доп.',      defaultIncluded: false, width: 21 },
];

export function getColumnsForType(type: string): ColumnDef[] {
  switch (type) {
    case 'kip': return KIP_COLUMNS;
    case 'dump-truck-trips': return DT_TRIPS_COLUMNS;
    default: return [];
  }
}
