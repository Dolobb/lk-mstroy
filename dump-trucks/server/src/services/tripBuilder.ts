/**
 * Trip Builder
 * Строит рейсы из событий зон.
 *
 * Рейс = выход из dt_loading → вход+выход из dt_unloading.
 *
 * Ключевой нюанс (Тобольск):
 *   Зона выгрузки географически стоит МЕЖДУ двумя группами зон погрузки
 *   (речпорт/Башковский на севере и Качипова на юге). Машина может
 *   проехать через полигон выгрузки транзитом, не выгружаясь.
 *   Решение: фильтр по минимальному времени в зоне.
 *
 * Пороги:
 *   MAX_TRIP_DURATION_MIN  — максимальная длительность одного рейса
 *
 * Транзитные проезды отфильтрованы на уровне zoneAnalyzer через
 * geo.zones.min_duration_sec (per-zone). Дополнительный фильтр здесь
 * раньше резал реальные короткие выгрузки на мо-9 (≈135–180s) и приводил
 * к матчингу погрузок с дальними выгрузками через ночь.
 */

import type { ZoneEvent, Trip } from '../types/domain';

const MAX_TRIP_DURATION_MIN = 6 * 60;   // 6 часов — явная аномалия

export function buildTrips(events: ZoneEvent[]): Trip[] {
  const loadingEvents   = events.filter(e => e.zoneTag === 'dt_loading');
  const unloadingEvents = events.filter(e => e.zoneTag === 'dt_unloading');

  const trips: Trip[] = [];
  const usedUnloadings = new Set<number>(); // индексы использованных выгрузок

  // Сортируем по времени выхода из зоны погрузки
  const sortedLoadings = [...loadingEvents].sort((a, b) =>
    (a.exitedAt?.getTime() ?? 0) - (b.exitedAt?.getTime() ?? 0)
  );

  for (const loading of sortedLoadings) {
    const loadedAt = loading.exitedAt;
    if (!loadedAt) continue;

    // Ближайшая неиспользованная выгрузка ПОСЛЕ завершения погрузки
    let bestUnloading: ZoneEvent | null = null;
    let bestIdx = -1;

    for (let i = 0; i < unloadingEvents.length; i++) {
      if (usedUnloadings.has(i)) continue;
      const u = unloadingEvents[i];
      if (u.enteredAt <= loadedAt) continue;

      // Проверка разумности времени доставки: от выезда с погрузки до въезда на выгрузку.
      // НЕ используем exitedAt у выгрузки — машина может остаться там до конца смены
      // (валидный сценарий: разгрузилась и заночевала на объекте).
      const deliveryMin = (u.enteredAt.getTime() - loadedAt.getTime()) / 60_000;
      if (deliveryMin > MAX_TRIP_DURATION_MIN) continue;

      bestUnloading = u;
      bestIdx = i;
      break; // берём первую подходящую (уже отсортированы по времени)
    }

    if (!bestUnloading) continue;
    usedUnloadings.add(bestIdx);

    const unloadedAt = bestUnloading.exitedAt;
    const durationMin = unloadedAt
      ? Math.round((unloadedAt.getTime() - loading.enteredAt.getTime()) / 60_000)
      : null;

    // Время в пути к выгрузке: от выхода из зоны погрузки до входа в зону выгрузки
    const travelToUnloadMin = bestUnloading.enteredAt
      ? Math.round((bestUnloading.enteredAt.getTime() - loadedAt.getTime()) / 60_000)
      : null;

    trips.push({
      tripNumber:        trips.length + 1,
      loadedAt:          loading.exitedAt,
      unloadedAt:        bestUnloading.exitedAt,
      loadingZone:       loading.zoneName,
      unloadingZone:     bestUnloading.zoneName,
      durationMin,
      distanceKm:        null,
      volumeM3:          null,
      travelToUnloadMin: travelToUnloadMin !== null && travelToUnloadMin >= 0 ? travelToUnloadMin : null,
      returnToLoadMin:   null, // заполняется вторым проходом ниже
      _loadingEnteredAt: loading.enteredAt, // internal: для расчёта returnToLoad
    } as Trip & { _loadingEnteredAt: Date });
  }

  // Второй проход: returnToLoadMin[i] = trips[i+1]._loadingEnteredAt - trips[i].unloadedAt
  // (время от выезда с выгрузки до въезда в следующую погрузку)
  for (let i = 0; i < trips.length - 1; i++) {
    const curUnloadedAt = trips[i]!.unloadedAt;
    const nextEnteredAt = (trips[i + 1] as Trip & { _loadingEnteredAt?: Date })._loadingEnteredAt;
    if (curUnloadedAt && nextEnteredAt) {
      const returnMin = Math.round((nextEnteredAt.getTime() - curUnloadedAt.getTime()) / 60_000);
      trips[i]!.returnToLoadMin = returnMin >= 0 ? returnMin : null;
    }
  }

  // Убираем внутреннее поле
  for (const t of trips) {
    delete (t as any)._loadingEnteredAt;
  }

  return trips;
}
