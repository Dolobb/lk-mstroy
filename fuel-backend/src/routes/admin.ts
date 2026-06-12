import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";

import { db } from "../db/client.js";
import {
  atz,
  drivers,
  eventEdits,
  fuelDispenseEvents,
  fuelReceiptEvents,
  shifts,
  vehicles
} from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";

const adminShiftsQuerySchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const uuidParamsSchema = z.object({
  id: z.uuid()
});

type ShiftSummaryFilter = {
  id?: string;
  driverId?: string;
  atzId?: string;
  status?: "open" | "closed";
  from?: Date;
  to?: Date;
  limit: number;
};

type ShiftSummaryRow = Awaited<ReturnType<typeof getShiftSummaries>>[number];

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/shifts", async (req, res) => {
  const input = adminShiftsQuerySchema.parse(req.query);

  const rows = await getShiftSummaries({
    status: input.status,
    from: input.from ? new Date(input.from) : undefined,
    to: input.to ? new Date(input.to) : undefined,
    limit: input.limit
  });

  res.json(rows);
});

adminRouter.get("/shifts/:id", async (req, res) => {
  const { id } = uuidParamsSchema.parse(req.params);
  const [shift] = await getShiftSummaries({ id, limit: 1 });

  if (!shift) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [dispenses, receipts] = await Promise.all([
    db
      .select({
        id: fuelDispenseEvents.id,
        vehicleId: vehicles.id,
        vehicleGosNumber: vehicles.gosNumber,
        vehicleMark: vehicles.mark,
        liters: fuelDispenseEvents.liters,
        happenedAtClient: fuelDispenseEvents.happenedAtClient,
        receivedAtServer: fuelDispenseEvents.receivedAtServer,
        isDeleted: fuelDispenseEvents.isDeleted,
        editedAt: fuelDispenseEvents.editedAt
      })
      .from(fuelDispenseEvents)
      .innerJoin(vehicles, eq(fuelDispenseEvents.vehicleId, vehicles.id))
      .where(eq(fuelDispenseEvents.shiftId, id))
      .orderBy(asc(fuelDispenseEvents.happenedAtClient)),
    db
      .select({
        id: fuelReceiptEvents.id,
        liters: fuelReceiptEvents.liters,
        happenedAtClient: fuelReceiptEvents.happenedAtClient,
        receivedAtServer: fuelReceiptEvents.receivedAtServer,
        isDeleted: fuelReceiptEvents.isDeleted,
        editedAt: fuelReceiptEvents.editedAt,
        ttnPhotoStatus: fuelReceiptEvents.ttnPhotoStatus,
        ttnPhotoPath: fuelReceiptEvents.ttnPhotoPath
      })
      .from(fuelReceiptEvents)
      .where(eq(fuelReceiptEvents.shiftId, id))
      .orderBy(asc(fuelReceiptEvents.happenedAtClient))
  ]);

  const eventIds = [id, ...dispenses.map((row) => row.id), ...receipts.map((row) => row.id)];
  const edits = await db
    .select({
      id: eventEdits.id,
      eventId: eventEdits.eventId,
      eventType: eventEdits.eventType,
      before: eventEdits.before,
      after: eventEdits.after,
      editedAt: eventEdits.editedAt
    })
    .from(eventEdits)
    .where(inArray(eventEdits.eventId, eventIds))
    .orderBy(asc(eventEdits.editedAt));

  res.json({
    ...shift,
    dispenses: dispenses.map((row) => ({
      id: row.id,
      vehicle: {
        id: row.vehicleId,
        gosNumber: row.vehicleGosNumber,
        mark: row.vehicleMark
      },
      liters: Number(row.liters),
      happenedAtClient: row.happenedAtClient.toISOString(),
      receivedAtServer: row.receivedAtServer?.toISOString() ?? null,
      isDeleted: row.isDeleted ?? false,
      editedAt: row.editedAt?.toISOString() ?? null,
      wasEdited: row.editedAt !== null
    })),
    receipts: receipts.map((row) => ({
      id: row.id,
      liters: Number(row.liters),
      happenedAtClient: row.happenedAtClient.toISOString(),
      receivedAtServer: row.receivedAtServer?.toISOString() ?? null,
      isDeleted: row.isDeleted ?? false,
      editedAt: row.editedAt?.toISOString() ?? null,
      wasEdited: row.editedAt !== null,
      ttnPhotoStatus: row.ttnPhotoStatus,
      ttnPhotoPath: row.ttnPhotoPath
    })),
    edits: edits.map((row) => ({
      ...row,
      editedAt: row.editedAt?.toISOString() ?? null
    }))
  });
});

adminRouter.get("/drivers/:id", async (req, res) => {
  const { id } = uuidParamsSchema.parse(req.params);

  const [driver] = await db
    .select({
      id: drivers.id,
      login: drivers.login,
      fullName: drivers.fullName,
      isActive: drivers.isActive,
      createdAt: drivers.createdAt
    })
    .from(drivers)
    .where(eq(drivers.id, id))
    .limit(1);

  if (!driver) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const driverShifts = await getShiftSummaries({ driverId: id, limit: 50 });

  res.json({
    ...driver,
    createdAt: driver.createdAt?.toISOString() ?? null,
    shifts: driverShifts
  });
});

adminRouter.get("/atz/:id", async (req, res) => {
  const { id } = uuidParamsSchema.parse(req.params);

  const [atzRow] = await db
    .select({
      id: atz.id,
      gosNumber: atz.gosNumber,
      title: atz.title,
      remainingLiters: atz.remainingLiters,
      isActive: atz.isActive,
      createdAt: atz.createdAt
    })
    .from(atz)
    .where(eq(atz.id, id))
    .limit(1);

  if (!atzRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [openShiftRows, atzShifts] = await Promise.all([
    db
      .select({
        id: shifts.id,
        driverId: drivers.id,
        driverFullName: drivers.fullName,
        startedAtClient: shifts.startedAtClient
      })
      .from(shifts)
      .innerJoin(drivers, eq(shifts.driverId, drivers.id))
      .where(and(eq(shifts.atzId, id), eq(shifts.status, "open")))
      .orderBy(desc(shifts.startedAtClient))
      .limit(1),
    getShiftSummaries({ atzId: id, limit: 50 })
  ]);

  const [openShift] = openShiftRows;

  res.json({
    id: atzRow.id,
    gosNumber: atzRow.gosNumber,
    title: atzRow.title,
    remainingLiters: Number(atzRow.remainingLiters ?? 0),
    isActive: atzRow.isActive,
    createdAt: atzRow.createdAt?.toISOString() ?? null,
    openShift: openShift
      ? {
          id: openShift.id,
          driver: {
            id: openShift.driverId,
            fullName: openShift.driverFullName
          },
          startedAtClient: openShift.startedAtClient.toISOString()
        }
      : null,
    shifts: atzShifts
  });
});

async function getShiftSummaries(filter: ShiftSummaryFilter) {
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

  const editsCount = sql<number>`(
    select count(*)::int
    from ${eventEdits}
    where ${eventEdits.eventId} = ${shifts.id}
      or exists (
        select 1
        from ${fuelDispenseEvents}
        where ${fuelDispenseEvents.id} = ${eventEdits.eventId}
          and ${fuelDispenseEvents.shiftId} = ${shifts.id}
      )
      or exists (
        select 1
        from ${fuelReceiptEvents}
        where ${fuelReceiptEvents.id} = ${eventEdits.eventId}
          and ${fuelReceiptEvents.shiftId} = ${shifts.id}
      )
  )`;

  const conditions = [
    filter.id ? eq(shifts.id, filter.id) : undefined,
    filter.driverId ? eq(shifts.driverId, filter.driverId) : undefined,
    filter.atzId ? eq(shifts.atzId, filter.atzId) : undefined,
    filter.status ? eq(shifts.status, filter.status) : undefined,
    filter.from ? gte(shifts.startedAtClient, filter.from) : undefined,
    filter.to ? lte(shifts.startedAtClient, filter.to) : undefined
  ].filter((condition) => condition !== undefined);

  const rows = await db
    .select({
      id: shifts.id,
      driverId: drivers.id,
      driverFullName: drivers.fullName,
      driverLogin: drivers.login,
      atzId: atz.id,
      atzGosNumber: atz.gosNumber,
      startedAtClient: shifts.startedAtClient,
      endedAtClient: shifts.endedAtClient,
      status: shifts.status,
      openingRemainingLiters: shifts.openingRemainingLiters,
      closingRemainingLiters: shifts.closingRemainingLiters,
      deviceId: shifts.deviceId,
      dispenseCount: sql<number>`coalesce(${dispenseAgg.dispenseCount}, 0)::int`,
      dispenseLiters: sql<string>`coalesce(${dispenseAgg.dispenseLiters}, 0)`,
      receiptLiters: sql<string>`coalesce(${receiptAgg.receiptLiters}, 0)`,
      editsCount
    })
    .from(shifts)
    .innerJoin(drivers, eq(shifts.driverId, drivers.id))
    .innerJoin(atz, eq(shifts.atzId, atz.id))
    .leftJoin(dispenseAgg, eq(shifts.id, dispenseAgg.shiftId))
    .leftJoin(receiptAgg, eq(shifts.id, receiptAgg.shiftId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(shifts.startedAtClient))
    .limit(filter.limit);

  return rows.map(formatShiftSummary);
}

function formatShiftSummary(row: {
  id: string;
  driverId: string;
  driverFullName: string;
  driverLogin: string;
  atzId: string;
  atzGosNumber: string;
  startedAtClient: Date;
  endedAtClient: Date | null;
  status: string | null;
  openingRemainingLiters: string | null;
  closingRemainingLiters: string | null;
  deviceId: string | null;
  dispenseCount: number | null;
  dispenseLiters: string | null;
  receiptLiters: string | null;
  editsCount: number | null;
}) {
  return {
    id: row.id,
    driver: {
      id: row.driverId,
      fullName: row.driverFullName,
      login: row.driverLogin
    },
    atz: {
      id: row.atzId,
      gosNumber: row.atzGosNumber
    },
    startedAtClient: row.startedAtClient.toISOString(),
    endedAtClient: row.endedAtClient?.toISOString() ?? null,
    status: row.status,
    openingRemainingLiters: Number(row.openingRemainingLiters ?? 0),
    closingRemainingLiters:
      row.closingRemainingLiters === null ? null : Number(row.closingRemainingLiters),
    deviceId: row.deviceId,
    dispenseCount: Number(row.dispenseCount ?? 0),
    dispenseLiters: Number(row.dispenseLiters ?? 0),
    receiptLiters: Number(row.receiptLiters ?? 0),
    editsCount: Number(row.editsCount ?? 0)
  };
}
