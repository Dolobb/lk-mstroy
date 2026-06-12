import { desc, eq, gt, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db/client.js";
import {
  atz,
  fuelDispenseEvents,
  fuelReceiptEvents,
  organizations,
  shifts,
  vehicles
} from "../db/schema.js";
import { requireDriver } from "../middleware/auth.js";

const bootstrapQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional()
});

export const bootstrapRouter = Router();

bootstrapRouter.get("/", requireDriver, async (req, res) => {
  const input = bootstrapQuerySchema.parse(req.query);
  const since = input.since ? new Date(input.since) : null;
  // Метка до запросов: иначе строка, обновлённая между SELECT и ответом, выпадет из следующей дельты
  const serverTime = new Date().toISOString();

  const [organizationRows, vehicleRows, atzRows, shiftRows] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        kind: organizations.kind,
        source: organizations.source
      })
      .from(organizations)
      .where(since ? gt(organizations.updatedAt, since) : undefined),
    db
      .select({
        id: vehicles.id,
        gosNumber: vehicles.gosNumber,
        mark: vehicles.mark,
        vehicleType: vehicles.vehicleType,
        organizationId: vehicles.organizationId,
        source: vehicles.source,
        isActive: vehicles.isActive
      })
      .from(vehicles)
      .where(since ? gt(vehicles.updatedAt, since) : undefined),
    db
      .select({
        id: atz.id,
        gosNumber: atz.gosNumber,
        title: atz.title,
        remainingLiters: atz.remainingLiters,
        isActive: atz.isActive
      })
      .from(atz)
      .where(since ? gt(atz.updatedAt, since) : undefined),
    getDriverShifts(req.driverId!)
  ]);

  res.json({
    serverTime,
    organizations: organizationRows,
    vehicles: vehicleRows,
    atz: atzRows.map((row) => ({
      ...row,
      remainingLiters: Number(row.remainingLiters ?? 0)
    })),
    shifts: shiftRows
  });
});

async function getDriverShifts(driverId: string) {
  const dispenseAgg = db
    .select({
      shiftId: fuelDispenseEvents.shiftId,
      dispenseCount: sql<number>`count(*)::int`.as("dispense_count"),
      dispenseLiters: sql<string>`coalesce(sum(${fuelDispenseEvents.liters}), 0)`.as(
        "dispense_liters"
      )
    })
    .from(fuelDispenseEvents)
    .where(eq(fuelDispenseEvents.isDeleted, false))
    .groupBy(fuelDispenseEvents.shiftId)
    .as("dispense_agg");

  const receiptAgg = db
    .select({
      shiftId: fuelReceiptEvents.shiftId,
      receiptLiters: sql<string>`coalesce(sum(${fuelReceiptEvents.liters}), 0)`.as(
        "receipt_liters"
      )
    })
    .from(fuelReceiptEvents)
    .where(eq(fuelReceiptEvents.isDeleted, false))
    .groupBy(fuelReceiptEvents.shiftId)
    .as("receipt_agg");

  const rows = await db
    .select({
      id: shifts.id,
      atzId: shifts.atzId,
      atzGosNumber: atz.gosNumber,
      startedAtClient: shifts.startedAtClient,
      endedAtClient: shifts.endedAtClient,
      status: shifts.status,
      openingRemainingLiters: shifts.openingRemainingLiters,
      closingRemainingLiters: shifts.closingRemainingLiters,
      dispenseCount: sql<number>`coalesce(${dispenseAgg.dispenseCount}, 0)::int`,
      dispenseLiters: sql<string>`coalesce(${dispenseAgg.dispenseLiters}, 0)`,
      receiptLiters: sql<string>`coalesce(${receiptAgg.receiptLiters}, 0)`
    })
    .from(shifts)
    .innerJoin(atz, eq(shifts.atzId, atz.id))
    .leftJoin(dispenseAgg, eq(shifts.id, dispenseAgg.shiftId))
    .leftJoin(receiptAgg, eq(shifts.id, receiptAgg.shiftId))
    .where(eq(shifts.driverId, driverId))
    .orderBy(desc(shifts.startedAtClient))
    .limit(30);

  return rows.map((row) => ({
    ...row,
    startedAtClient: row.startedAtClient.toISOString(),
    endedAtClient: row.endedAtClient?.toISOString() ?? null,
    openingRemainingLiters: Number(row.openingRemainingLiters ?? 0),
    closingRemainingLiters:
      row.closingRemainingLiters === null ? null : Number(row.closingRemainingLiters),
    dispenseCount: Number(row.dispenseCount ?? 0),
    dispenseLiters: Number(row.dispenseLiters ?? 0),
    receiptLiters: Number(row.receiptLiters ?? 0)
  }));
}
