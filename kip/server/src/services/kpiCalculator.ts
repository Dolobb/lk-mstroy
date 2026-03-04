/**
 * Переводит время ЧЧ:ММ:СС в десятичные часы.
 */
export function timeToHours(time: string): number {
  const [h, m, s] = time.split(':').map(Number);
  return h + m / 60 + (s || 0) / 3600;
}

/**
 * Данные датчика топлива для условия 1.
 * Если rate=0 (датчик сломан/отсутствует) при работающем двигателе — применяется условие 1.
 */
export interface FuelSensorInfo {
  rateSensorValue: number;    // fuel_json[0].rate (0 = сломан/отсутствует)
  actualConsumed: number;     // реальный расход по уровням бака: valueBegin - valueEnd + charges - discharges
  ignitionOffInWeek: boolean; // было ли зажигание выключено хоть раз за последние 7 дней
}

/**
 * Расчёт всех KPI-показателей для одной записи ТС.
 *
 * Условие 1: зажигание вкл., расход = 0.
 *   - Если бак показал реальный расход (> 10 л) — сломан датчик расхода, используем расход по баку.
 *   - Если зажигание выключалось на неделе — КИП = нормальный, нагрузка = 50% (датчик сломан).
 *   - Если зажигание никогда не выключалось — КИП = 0%, нагрузка = 0% (датчик завис).
 *
 * Условие 2: КИП и нагрузка строго 0–100% (клампинг).
 */
export function calculateKpi(params: {
  total_stay_time: number;   // часы
  engine_on_time: number;    // часы
  fuel_consumed_total: number;
  fuel_rate_norm: number;
  fuelSensor?: FuelSensorInfo;
}) {
  const { total_stay_time, engine_on_time, fuel_rate_norm, fuelSensor } = params;
  let fuel_consumed_total = params.fuel_consumed_total;

  // Условие 1: датчик расхода показывает 0 при работающем двигателе
  let loadOverride: number | null = null;
  let kipOverride: number | null = null;

  if (fuelSensor && fuelSensor.rateSensorValue === 0 && engine_on_time > 0) {
    if (fuelSensor.actualConsumed > 10) {
      // Бак показал реальный расход — датчик rate сломан, используем расход по баку
      fuel_consumed_total = fuelSensor.actualConsumed;
    } else if (fuelSensor.ignitionOffInWeek) {
      // Датчик сломан, но ТС реально работает (зажигание выключалось)
      // КИП = нормальный (по времени двигателя), нагрузка = 50% (нельзя измерить)
      loadOverride = 50;
    } else {
      // Датчик завис в «вкл.», ТС скорее всего не работает
      // КИП = 0%, нагрузка = 0%
      kipOverride = 0;
      loadOverride = 0;
    }
  }

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
    fuel_rate_fact:       Math.max(0, fuel_rate_fact),
    max_work_allowed:     Math.max(0, max_work_allowed),
    fuel_max_calc:        Math.max(0, fuel_max_calc),
    fuel_variance:        Math.max(0, fuel_variance),
    // Условие 2: клампинг 0–100% + переопределение условием 1
    load_efficiency_pct:  loadOverride !== null ? loadOverride : Math.min(Math.max(0, load_efficiency_pct), 100),
    utilization_ratio:    kipOverride  !== null ? kipOverride  : Math.max(0, utilization_ratio),
    idle_time,
  };
}
