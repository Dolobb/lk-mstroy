/**
 * Work Type Classifier
 * Определяет тип работы ТС на основе анализа зон.
 *
 * delivery: ТС доставляет что-то (есть рейсы с погрузкой и выгрузкой)
 * onsite:   ТС работает на объекте (>= 60% времени в dt_boundary, нет рейсов)
 * unknown:  нет данных
 */

import type { ZoneEvent, WorkType, Trip } from '../types/domain';

/**
 * @param engineTimeSec  общее время работы двигателя за смену
 * @param onsiteSec      время в зоне dt_boundary
 * @param trips          построенные рейсы
 * @param onsetPctThreshold  порог % (по умолчанию 60%)
 * @param hasOnsiteZones  есть ли у объекта dt_onsite зоны (default true)
 */
export function classifyWorkType(
  engineTimeSec: number,
  onsiteSec: number,
  trips: Trip[],
  onsitePctThreshold = 60,
  hasOnsiteZones = true,
): WorkType {
  if (trips.length > 0) {
    return 'delivery';
  }

  if (hasOnsiteZones && engineTimeSec > 0) {
    const onsitePct = (onsiteSec / engineTimeSec) * 100;
    if (onsitePct >= onsitePctThreshold) {
      return 'onsite';
    }
  }

  return 'unknown';
}
