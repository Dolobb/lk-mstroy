import { PoolClient } from 'pg';
import type { ZoneEvent, ShiftType } from '../types/domain';

/**
 * Атомарная замена zone_events для vehicle × date × shift.
 * Должно выполняться в транзакции.
 */
export async function replaceZoneEvents(
  client: PoolClient,
  vehicleId: number,
  reportDate: Date,
  shiftType: ShiftType,
  events: ZoneEvent[],
): Promise<void> {
  await client.query(`
    DELETE FROM dump_trucks.zone_events
    WHERE vehicle_id = $1
      AND report_date = $2
      AND shift_type  = $3
  `, [vehicleId, reportDate, shiftType]);

  if (events.length === 0) return;

  for (const event of events) {
    await client.query(`
      INSERT INTO dump_trucks.zone_events (
        vehicle_id, report_date, shift_type,
        zone_uid, zone_name, zone_tag, object_uid,
        entered_at, exited_at, duration_sec
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      vehicleId,
      reportDate,
      shiftType,
      event.zoneUid,
      event.zoneName,
      event.zoneTag,
      event.objectUid,
      event.enteredAt,
      event.exitedAt ?? null,
      event.durationSec ?? null,
    ]);
  }
}
