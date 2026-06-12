// Интеграционные тесты ядра /sync (A7, Claude). Гоняются против локальной mstroy_fuel.
import { randomUUID } from "node:crypto";

import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "../db/client.js";
import {
  atz,
  drivers,
  eventEdits,
  fuelDispenseEvents,
  fuelReceiptEvents,
  organizations,
  shifts,
  vehicles
} from "../db/schema.js";
import { syncService } from "./sync.js";
import type { SyncRequest } from "./sync.types.js";

const driverId = randomUUID();
const otherDriverId = randomUUID();
const atzId = randomUUID();
const baseOrgId = randomUUID();
const baseVehicleId = randomUUID();

const newOrgId = randomUUID();
const newVehicleId = randomUUID();
const shiftId = randomUUID();
const otherShiftId = randomUUID();
const blockedShiftId = randomUUID();
const dispenseId = randomUUID();
const lateDispenseId = randomUUID();
const receiptId = randomUUID();

const T0 = "2026-06-12T07:00:00.000Z";

function batch(events: SyncRequest["events"]): SyncRequest {
  return { deviceId: "test-tablet", events };
}

const happyBatch = batch([
  { type: "org_add", id: newOrgId, name: "Тест-наёмники sync" },
  {
    type: "vehicle_add",
    id: newVehicleId,
    gosNumber: "Т001СН77",
    mark: "Тестовый экскаватор",
    organizationId: newOrgId
  },
  { type: "shift_open", id: shiftId, atzId, startedAtClient: T0 },
  {
    type: "dispense_upsert",
    id: dispenseId,
    shiftId,
    vehicleId: newVehicleId,
    liters: 100,
    happenedAtClient: "2026-06-12T08:00:00.000Z"
  },
  {
    type: "receipt_upsert",
    id: receiptId,
    shiftId,
    liters: 50,
    happenedAtClient: "2026-06-12T09:00:00.000Z"
  },
  { type: "shift_close", id: shiftId, endedAtClient: "2026-06-12T19:00:00.000Z" }
]);

async function atzBalance(): Promise<number> {
  const [row] = await db
    .select({ remainingLiters: atz.remainingLiters })
    .from(atz)
    .where(eq(atz.id, atzId));
  return Number(row.remainingLiters);
}

async function editsCount(eventId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(eventEdits)
    .where(eq(eventEdits.eventId, eventId));
  return row.value;
}

beforeAll(async () => {
  await db.insert(drivers).values([
    { id: driverId, login: `test-sync-${driverId}`, pinHash: "x", fullName: "Тест Синков" },
    { id: otherDriverId, login: `test-sync-${otherDriverId}`, pinHash: "x", fullName: "Другой Водитель" }
  ]);
  await db.insert(atz).values({ id: atzId, gosNumber: "ТЕСТ-АТЗ-SYNC", remainingLiters: "1000.00" });
  await db
    .insert(organizations)
    .values({ id: baseOrgId, name: "Тест-орг sync base", kind: "internal", source: "admin" });
  await db.insert(vehicles).values({
    id: baseVehicleId,
    gosNumber: "Т002СН77",
    organizationId: baseOrgId,
    source: "admin"
  });
});

afterAll(async () => {
  await db
    .delete(eventEdits)
    .where(inArray(eventEdits.eventId, [dispenseId, lateDispenseId, receiptId]));
  await db
    .delete(fuelDispenseEvents)
    .where(inArray(fuelDispenseEvents.shiftId, [shiftId, otherShiftId]));
  await db
    .delete(fuelReceiptEvents)
    .where(inArray(fuelReceiptEvents.shiftId, [shiftId, otherShiftId]));
  await db.delete(shifts).where(inArray(shifts.id, [shiftId, otherShiftId, blockedShiftId]));
  await db.delete(vehicles).where(inArray(vehicles.id, [baseVehicleId, newVehicleId]));
  await db.delete(organizations).where(inArray(organizations.id, [baseOrgId, newOrgId]));
  await db.delete(atz).where(eq(atz.id, atzId));
  await db.delete(drivers).where(inArray(drivers.id, [driverId, otherDriverId]));
  await pool.end();
});

describe("sync core", () => {
  it("applies a full happy-path batch and recomputes the balance", async () => {
    const response = await syncService.process(driverId, happyBatch);

    expect(response.results).toHaveLength(6);
    expect(response.results.every((result) => result.status === "applied")).toBe(true);
    // 1000 − 100 (выдача) + 50 (получение) = 950
    expect(await atzBalance()).toBe(950);
    expect(response.atzBalances).toEqual([{ atzId, remainingLiters: 950 }]);

    const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(shift.status).toBe("closed");
    expect(shift.driverId).toBe(driverId);
  });

  it("is idempotent: the same batch twice creates no duplicates and keeps the balance", async () => {
    const response = await syncService.process(driverId, happyBatch);

    expect(response.results.every((result) => result.status === "applied")).toBe(true);
    expect(await atzBalance()).toBe(950);

    const [dispenseCount] = await db
      .select({ value: count() })
      .from(fuelDispenseEvents)
      .where(eq(fuelDispenseEvents.id, dispenseId));
    expect(dispenseCount.value).toBe(1);
    expect(await editsCount(dispenseId)).toBe(0); // ретрай оригинала — не правка
  });

  it("applies a newer edit, logs event_edits, and adjusts the balance by the diff", async () => {
    const response = await syncService.process(
      driverId,
      batch([
        {
          type: "dispense_upsert",
          id: dispenseId,
          shiftId,
          vehicleId: newVehicleId,
          liters: 80,
          happenedAtClient: "2026-06-12T08:00:00.000Z",
          editedAt: "2026-06-12T20:00:00.000Z"
        }
      ])
    );

    expect(response.results[0].status).toBe("applied");
    expect(await atzBalance()).toBe(970); // было −100, стало −80
    expect(await editsCount(dispenseId)).toBe(1);
  });

  it("rejects a stale edit without touching balance or data", async () => {
    const response = await syncService.process(
      driverId,
      batch([
        {
          type: "dispense_upsert",
          id: dispenseId,
          shiftId,
          vehicleId: newVehicleId,
          liters: 999,
          happenedAtClient: "2026-06-12T08:00:00.000Z",
          editedAt: "2026-06-12T10:00:00.000Z" // старше серверного 20:00
        }
      ])
    );

    expect(response.results[0]).toMatchObject({ status: "conflict", code: "stale" });
    expect(await atzBalance()).toBe(970);
    const [row] = await db
      .select({ liters: fuelDispenseEvents.liters })
      .from(fuelDispenseEvents)
      .where(eq(fuelDispenseEvents.id, dispenseId));
    expect(Number(row.liters)).toBe(80);
  });

  it("soft-deletes via edit and returns the liters to the balance", async () => {
    const response = await syncService.process(
      driverId,
      batch([
        {
          type: "dispense_upsert",
          id: dispenseId,
          shiftId,
          vehicleId: newVehicleId,
          liters: 80,
          happenedAtClient: "2026-06-12T08:00:00.000Z",
          isDeleted: true,
          editedAt: "2026-06-12T21:00:00.000Z"
        }
      ])
    );

    expect(response.results[0].status).toBe("applied");
    expect(await atzBalance()).toBe(1050); // 970 + 80 — выдача отменена
    expect(await editsCount(dispenseId)).toBe(2);
    const [row] = await db
      .select({ isDeleted: fuelDispenseEvents.isDeleted })
      .from(fuelDispenseEvents)
      .where(eq(fuelDispenseEvents.id, dispenseId));
    expect(row.isDeleted).toBe(true);
  });

  it("enforces one open shift per ATZ across drivers (atz_busy)", async () => {
    const openByOther = await syncService.process(
      otherDriverId,
      batch([{ type: "shift_open", id: otherShiftId, atzId, startedAtClient: T0 }])
    );
    expect(openByOther.results[0].status).toBe("applied"); // s1 закрыта — АТЗ свободен

    const blocked = await syncService.process(
      driverId,
      batch([{ type: "shift_open", id: blockedShiftId, atzId, startedAtClient: T0 }])
    );
    expect(blocked.results[0]).toMatchObject({ status: "conflict", code: "atz_busy" });

    const closeByOther = await syncService.process(
      otherDriverId,
      batch([
        { type: "shift_close", id: otherShiftId, endedAtClient: "2026-06-12T20:00:00.000Z" }
      ])
    );
    expect(closeByOther.results[0].status).toBe("applied");
  });

  it("rejects writes into another driver's shift (single-writer-per-shift)", async () => {
    const response = await syncService.process(
      otherDriverId,
      batch([
        {
          type: "dispense_upsert",
          id: randomUUID(),
          shiftId, // смена driverId
          vehicleId: baseVehicleId,
          liters: 10,
          happenedAtClient: T0
        }
      ])
    );
    expect(response.results[0]).toMatchObject({ status: "conflict", code: "forbidden" });
  });

  it("allows a late event into a closed shift, rejects unknown vehicle", async () => {
    const response = await syncService.process(
      driverId,
      batch([
        {
          type: "dispense_upsert",
          id: lateDispenseId,
          shiftId, // уже закрыта — офлайн-ретраи допустимы
          vehicleId: baseVehicleId,
          liters: 10,
          happenedAtClient: "2026-06-12T18:00:00.000Z"
        },
        {
          type: "dispense_upsert",
          id: randomUUID(),
          shiftId,
          vehicleId: randomUUID(),
          liters: 10,
          happenedAtClient: T0
        }
      ])
    );

    expect(response.results[0].status).toBe("applied");
    expect(response.results[1]).toMatchObject({ status: "conflict", code: "vehicle_not_found" });
    expect(await atzBalance()).toBe(1040);
  });

  it("reports conflicts for unknown org and unknown shift", async () => {
    const response = await syncService.process(
      driverId,
      batch([
        {
          type: "vehicle_add",
          id: randomUUID(),
          gosNumber: "Т003СН77",
          organizationId: randomUUID()
        },
        { type: "shift_close", id: randomUUID(), endedAtClient: T0 }
      ])
    );

    expect(response.results[0]).toMatchObject({ status: "conflict", code: "org_not_found" });
    expect(response.results[1]).toMatchObject({ status: "conflict", code: "shift_not_found" });
  });
});
