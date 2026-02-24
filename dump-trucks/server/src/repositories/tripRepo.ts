import { PoolClient } from 'pg';
import type { Trip } from '../types/domain';

/**
 * Атомарная замена рейсов для смены:
 * 1. DELETE все рейсы для shift_record_id
 * 2. INSERT новые
 * Должно выполняться в транзакции.
 */
export async function replaceTrips(
  client: PoolClient,
  shiftRecordId: number,
  trips: Trip[],
): Promise<void> {
  // Удаляем старые (CASCADE уже есть, но для ясности делаем явно)
  await client.query(
    'DELETE FROM dump_trucks.trips WHERE shift_record_id = $1',
    [shiftRecordId],
  );

  if (trips.length === 0) return;

  for (const trip of trips) {
    await client.query(`
      INSERT INTO dump_trucks.trips (
        shift_record_id, trip_number,
        loaded_at, unloaded_at,
        loading_zone, unloading_zone,
        duration_min, distance_km, volume_m3
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      shiftRecordId,
      trip.tripNumber,
      trip.loadedAt ?? null,
      trip.unloadedAt ?? null,
      trip.loadingZone ?? null,
      trip.unloadingZone ?? null,
      trip.durationMin ?? null,
      trip.distanceKm ?? null,
      trip.volumeM3 ?? null,
    ]);
  }
}
