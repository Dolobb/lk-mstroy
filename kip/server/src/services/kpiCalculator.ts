/**
 * Переводит время ЧЧ:ММ:СС в десятичные часы.
 */
export function timeToHours(time: string): number {
  const [h, m, s] = time.split(':').map(Number);
  return h + m / 60 + (s || 0) / 3600;
}

/**
 * Расчёт всех KPI-показателей для одной записи ТС.
 */
export function calculateKpi(params: {
  total_stay_time: number;  // часы
  engine_on_time: number;   // часы
  fuel_consumed_total: number;
  fuel_rate_norm: number;
}) {
  const { total_stay_time, engine_on_time, fuel_consumed_total, fuel_rate_norm } = params;

  const fuel_rate_fact = engine_on_time > 0
    ? fuel_consumed_total / engine_on_time
    : 0;

  const max_work_allowed = total_stay_time * (22 / 24);

  const fuel_max_calc = engine_on_time * fuel_rate_norm;

  const fuel_variance = fuel_rate_norm > 0
    ? fuel_rate_fact / fuel_rate_norm
    : 0;

  const load_efficiency_pct = fuel_rate_norm > 0
    ? fuel_rate_fact / fuel_rate_norm * 100
    : 0;

  const utilization_ratio = total_stay_time > 0
    ? Math.min(engine_on_time / total_stay_time, 1) * 100
    : 0;

  const idle_time = Math.max(0, total_stay_time - engine_on_time);

  return {
    fuel_rate_fact: Math.max(0, fuel_rate_fact),
    max_work_allowed: Math.max(0, max_work_allowed),
    fuel_max_calc: Math.max(0, fuel_max_calc),
    fuel_variance: Math.max(0, fuel_variance),
    load_efficiency_pct: Math.max(0, load_efficiency_pct),
    utilization_ratio: Math.max(0, utilization_ratio),
    idle_time,
  };
}
