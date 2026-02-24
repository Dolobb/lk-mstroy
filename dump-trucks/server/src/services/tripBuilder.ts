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
 * Пороги (настраиваемые):
 *   MIN_LOADING_DWELL_SEC  — минимум в зоне погрузки (реальная погрузка)
 *   MIN_UNLOADING_DWELL_SEC — минимум в зоне выгрузки (реальная выгрузка)
 *   MAX_TRIP_DURATION_MIN  — максимальная длительность одного рейса
 */

import type { ZoneEvent, Trip } from '../types/domain';

const MIN_LOADING_DWELL_SEC   = 3 * 60;   // 3 мин — погрузка
const MIN_UNLOADING_DWELL_SEC = 3 * 60;   // 3 мин — выгрузка
const MAX_TRIP_DURATION_MIN   = 4 * 60;   // 4 часа — явная аномалия

export function buildTrips(events: ZoneEvent[]): Trip[] {
  // Только реальные остановки (не транзит)
  const loadingEvents = events.filter(e =>
    e.zoneTag === 'dt_loading' &&
    (e.durationSec ?? 0) >= MIN_LOADING_DWELL_SEC
  );
  const unloadingEvents = events.filter(e =>
    e.zoneTag === 'dt_unloading' &&
    (e.durationSec ?? 0) >= MIN_UNLOADING_DWELL_SEC
  );

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

      // Проверка разумности длительности рейса
      if (u.exitedAt) {
        const tripMin = (u.exitedAt.getTime() - loading.enteredAt.getTime()) / 60_000;
        if (tripMin > MAX_TRIP_DURATION_MIN) continue;
      }

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

    trips.push({
      tripNumber:   trips.length + 1,
      loadedAt:     loading.exitedAt,
      unloadedAt:   bestUnloading.exitedAt,
      loadingZone:  loading.zoneName,
      unloadingZone: bestUnloading.zoneName,
      durationMin,
      distanceKm:   null,
      volumeM3:     null,
    });
  }

  return trips;
}
