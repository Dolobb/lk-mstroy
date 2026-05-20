/**
 * Zone Analyzer
 * Анализирует GPS-трек (TisTrackPoint[]) против геозон (GeoZone[]).
 * Возвращает события входа/выхода из каждой зоны.
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { TisTrackPoint } from '../types/tis-api';
import type { GeoZone, ZoneEvent } from '../types/domain';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

/**
 * Максимальный зазор между выходом и повторным входом в ОДНУ И ТУ ЖЕ зону,
 * при котором это считается одним визитом (склеиваем фрагменты).
 *
 * Зачем: на границе полигона погрузки/выгрузки GPS-трек «дёргается» —
 * один физический заезд (взвешивание → погрузка → ожидание) бьётся на 2–3
 * события `dt_loading` с зазорами 1–3 мин. Без склейки tripBuilder цепляет
 * каждый фрагмент к отдельной выгрузке 1:1 → завышенный trips_count и
 * абсурдные времена «в пути» (см. С225МН72 18.05 смена 1: 4 рейса вместо 3).
 *
 * 10 мин — заведомо больше GPS-джиттера и манёвров на площадке, но на порядок
 * меньше реального плеча «карьер → выгрузка → назад» (≥1ч), поэтому два разных
 * визита никогда не склеит. Это коррекция артефакта дискретизации GPS, а не
 * бизнес-порог транзита (тот живёт per-zone в geo.zones.min_duration_sec).
 * Если когда-нибудь понадобится разный зазор по зонам — выносить в geo-admin
 * аналогично min_duration_sec, но сейчас site-specific причины нет.
 */
const MAX_REENTRY_GAP_SEC = 5 * 60;

export function analyzeZones(
  track: TisTrackPoint[],
  zones: GeoZone[],
): ZoneEvent[] {
  if (track.length === 0 || zones.length === 0) return [];

  const events: ZoneEvent[] = [];

  for (const zone of zones) {
    let insideFrom: Date | null = null;

    for (const pt of track) {
      const timestamp = parseDdMmYyyyHhmm(pt.time);
      if (!timestamp) continue;

      const turfPoint = point([pt.lon, pt.lat]);
      const inside = booleanPointInPolygon(turfPoint, zone.geojson);

      if (inside && insideFrom === null) {
        // Вошли в зону
        insideFrom = timestamp;
      } else if (!inside && insideFrom !== null) {
        // Вышли из зоны
        const durationSec = Math.round((timestamp.getTime() - insideFrom.getTime()) / 1000);
        if (zone.minDurationSec > 0 && durationSec < zone.minDurationSec) {
          insideFrom = null;
          continue; // transit — skip this event
        }
        events.push({
          zoneUid:     zone.uid,
          zoneName:    zone.name,
          zoneTag:     zone.tag,
          objectUid:   zone.objectUid,
          enteredAt:   insideFrom,
          exitedAt:    timestamp,
          durationSec,
        });
        insideFrom = null;
      }
    }

    // Если трек закончился внутри зоны
    if (insideFrom !== null && track.length > 0) {
      const lastPt = track[track.length - 1];
      const lastTime = parseDdMmYyyyHhmm(lastPt.time);
      const durationSec = lastTime
        ? Math.round((lastTime.getTime() - insideFrom.getTime()) / 1000)
        : null;
      // Skip if below min duration (or duration unknown)
      if (zone.minDurationSec > 0 && (durationSec === null || durationSec < zone.minDurationSec)) {
        // transit — skip
      } else {
        events.push({
          zoneUid:     zone.uid,
          zoneName:    zone.name,
          zoneTag:     zone.tag,
          objectUid:   zone.objectUid,
          enteredAt:   insideFrom,
          exitedAt:    lastTime,
          durationSec,
        });
      }
    }
  }

  // Сортируем по времени входа
  events.sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());

  return coalesceReentries(events);
}

/**
 * Склейка фрагментов одного визита: соседние события ОДНОЙ зоны (по zoneUid),
 * между которыми зазор `exitedAt → enteredAt` <= MAX_REENTRY_GAP_SEC,
 * объединяются в одно событие [первый enteredAt … последний exitedAt].
 *
 * Вход уже отсортирован по enteredAt, поэтому предыдущее событие той же зоны
 * в результате — это непосредственно предшествующий визит в неё. Большой
 * зазор (реальный рейс между двумя погрузками) склейку не вызывает.
 */
function coalesceReentries(events: ZoneEvent[]): ZoneEvent[] {
  const result: ZoneEvent[] = [];
  const lastByZone = new Map<string, ZoneEvent>();

  for (const ev of events) {
    const prev = lastByZone.get(ev.zoneUid);

    if (prev && prev.exitedAt !== null) {
      const gapSec = (ev.enteredAt.getTime() - prev.exitedAt.getTime()) / 1000;
      if (gapSec >= 0 && gapSec <= MAX_REENTRY_GAP_SEC) {
        // Тот же визит: расширяем предыдущее событие до конца текущего
        prev.exitedAt = ev.exitedAt;
        prev.durationSec =
          prev.exitedAt !== null
            ? Math.round((prev.exitedAt.getTime() - prev.enteredAt.getTime()) / 1000)
            : null;
        continue;
      }
    }

    const copy: ZoneEvent = { ...ev };
    result.push(copy);
    lastByZone.set(copy.zoneUid, copy);
  }

  return result;
}

/**
 * Суммарное время в зоне boundary (onsite) в секундах
 */
export function calcOnsiteSec(events: ZoneEvent[], objectUid: string): number {
  return events
    .filter(e => e.zoneTag === 'dt_boundary' && e.objectUid === objectUid)
    .reduce((acc, e) => acc + (e.durationSec ?? 0), 0);
}
