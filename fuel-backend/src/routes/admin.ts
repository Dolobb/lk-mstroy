import fs from "node:fs/promises";
import path from "node:path";
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
  organizations,
  shifts,
  vehicles
} from "../db/schema.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  applyAtzDelta,
  numericToCenti,
  toCenti,
  toNumeric,
  writeEventEdit
} from "../services/adminMutations.js";
import { getUploadsDir } from "./uploads.js";

const adminShiftsQuerySchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const uuidParamsSchema = z.object({
  id: z.uuid()
});

const adminVehiclesQuerySchema = z.object({
  active: z.enum(["true", "all"]).default("true")
});

const createAtzBodySchema = z.object({
  gosNumber: z.string().min(1),
  title: z.string().optional(),
  tisVehicleId: z.string().optional(),
  remainingLiters: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true)
});

const updateAtzBodySchema = z
  .object({
    title: z.string().optional(),
    tisVehicleId: z.string().optional(),
    isActive: z.boolean().optional(),
    remainingLiters: z.number().nonnegative().optional()
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.tisVehicleId !== undefined ||
      body.isActive !== undefined ||
      body.remainingLiters !== undefined,
    { message: "Нужно указать хотя бы одно поле" }
  );

const closeShiftBodySchema = z.object({
  // Переопределение закрывающего остатка; по умолчанию — авто-снимок текущего остатка АТЗ.
  closingRemainingLiters: z.number().nonnegative().optional(),
  endedAtClient: z.string().datetime({ offset: true }).optional()
});

const eventParamsSchema = z.object({
  type: z.enum(["dispense", "receipt"]),
  id: z.uuid()
});

const editEventBodySchema = z
  .object({
    liters: z.number().positive().optional(),
    isDeleted: z.boolean().optional()
  })
  .refine((body) => body.liters !== undefined || body.isDeleted !== undefined, {
    message: "Нужно указать liters или isDeleted"
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

adminRouter.get("/vehicles", async (req, res) => {
  const input = adminVehiclesQuerySchema.parse(req.query);

  const rows = await db
    .select({
      id: vehicles.id,
      gosNumber: vehicles.gosNumber,
      mark: vehicles.mark,
      vehicleType: vehicles.vehicleType,
      organizationName: organizations.name,
      source: vehicles.source,
      isActive: vehicles.isActive
    })
    .from(vehicles)
    .innerJoin(organizations, eq(vehicles.organizationId, organizations.id))
    .where(input.active === "true" ? eq(vehicles.isActive, true) : undefined)
    .orderBy(asc(vehicles.gosNumber));

  res.json(rows);
});

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
        recipientName: fuelDispenseEvents.recipientName,
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
      recipientName: row.recipientName,
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

// Ручное закрытие смены (в т.ч. зависшей открытой, блокирующей АТЗ по uniq_open_shift_per_atz).
// closingRemainingLiters: по умолчанию авто-снимок текущего остатка АТЗ; можно переопределить.
// Переопределение, отличное от текущего остатка, трактуется как калибровка — двигает остаток АТЗ дельтой.
adminRouter.post("/shifts/:id/close", async (req, res) => {
  const { id } = uuidParamsSchema.parse(req.params);
  const body = closeShiftBodySchema.parse(req.body ?? {});

  const outcome = await db.transaction(async (tx) => {
    const [shift] = await tx
      .select({
        id: shifts.id,
        atzId: shifts.atzId,
        status: shifts.status,
        endedAtClient: shifts.endedAtClient,
        closingRemainingLiters: shifts.closingRemainingLiters
      })
      .from(shifts)
      .where(eq(shifts.id, id))
      .limit(1);

    if (!shift) {
      return { error: "not_found" as const };
    }
    if (shift.status === "closed") {
      return { error: "already_closed" as const };
    }

    const [atzRow] = await tx
      .select({ remainingLiters: atz.remainingLiters })
      .from(atz)
      .where(eq(atz.id, shift.atzId))
      .limit(1);

    const currentRemaining = Number(atzRow?.remainingLiters ?? 0);
    const closing = body.closingRemainingLiters ?? currentRemaining;
    const endedAtClient = body.endedAtClient ? new Date(body.endedAtClient) : new Date();

    await tx
      .update(shifts)
      .set({
        status: "closed",
        endedAtClient,
        endedAtServer: new Date(),
        closingRemainingLiters: toNumeric(closing)
      })
      .where(eq(shifts.id, id));

    // Override ≠ текущий остаток → ручная калибровка АТЗ по факту закрытия.
    const deltaCenti = toCenti(closing) - toCenti(currentRemaining);
    if (deltaCenti !== 0) {
      await applyAtzDelta(tx, shift.atzId, deltaCenti);
    }

    await writeEventEdit(tx, {
      eventId: id,
      eventType: "shift",
      before: {
        status: shift.status,
        endedAtClient: shift.endedAtClient?.toISOString() ?? null,
        closingRemainingLiters: shift.closingRemainingLiters
      },
      after: {
        status: "closed",
        endedAtClient: endedAtClient.toISOString(),
        closingRemainingLiters: toNumeric(closing)
      }
    });

    return { error: null };
  });

  if (outcome.error === "not_found") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (outcome.error === "already_closed") {
    res.status(409).json({ error: "Shift already closed", code: "already_closed" });
    return;
  }

  const [shift] = await getShiftSummaries({ id, limit: 1 });
  res.json(shift);
});

// Правка события заправки/получения: литры и/или мягкое удаление.
// Двигает остаток АТЗ знаковой дельтой (dispense: −Δ, receipt: +Δ), пишет журнал, ставит edited_at (LWW).
adminRouter.patch("/events/:type/:id", async (req, res) => {
  const { type, id } = eventParamsSchema.parse(req.params);
  const body = editEventBodySchema.parse(req.body ?? {});
  const table = type === "dispense" ? fuelDispenseEvents : fuelReceiptEvents;

  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(table).where(eq(table.id, id)).limit(1);
    if (!existing) {
      return { error: "not_found" as const };
    }

    const [shift] = await tx
      .select({ atzId: shifts.atzId })
      .from(shifts)
      .where(eq(shifts.id, existing.shiftId))
      .limit(1);
    if (!shift) {
      return { error: "not_found" as const };
    }

    const isDeleted = body.isDeleted ?? existing.isDeleted ?? false;
    const newLiters = body.liters ?? Number(existing.liters);
    const editedAt = new Date();

    const oldEffectiveCenti = existing.isDeleted ? 0 : numericToCenti(existing.liters);
    const newEffectiveCenti = isDeleted ? 0 : toCenti(newLiters);

    await writeEventEdit(tx, {
      eventId: id,
      eventType: type,
      before: {
        liters: existing.liters,
        isDeleted: existing.isDeleted,
        editedAt: existing.editedAt?.toISOString() ?? null
      },
      after: {
        liters: toNumeric(newLiters),
        isDeleted,
        editedAt: editedAt.toISOString()
      }
    });

    await tx
      .update(table)
      .set({ liters: toNumeric(newLiters), isDeleted, editedAt })
      .where(eq(table.id, id));

    const signedDeltaCenti =
      type === "dispense"
        ? -(newEffectiveCenti - oldEffectiveCenti)
        : newEffectiveCenti - oldEffectiveCenti;
    if (signedDeltaCenti !== 0) {
      await applyAtzDelta(tx, shift.atzId, signedDeltaCenti);
    }

    return { error: null, atzId: shift.atzId, liters: newLiters, isDeleted, editedAt };
  });

  if (outcome.error === "not_found") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [atzRow] = await db
    .select({ id: atz.id, remainingLiters: atz.remainingLiters })
    .from(atz)
    .where(eq(atz.id, outcome.atzId))
    .limit(1);

  res.json({
    id,
    type,
    liters: outcome.liters,
    isDeleted: outcome.isDeleted,
    editedAt: outcome.editedAt.toISOString(),
    atz: {
      id: outcome.atzId,
      remainingLiters: Number(atzRow?.remainingLiters ?? 0)
    }
  });
});

adminRouter.get("/drivers", async (_req, res) => {
  const lastShift = db
    .select({
      driverId: shifts.driverId,
      lastShiftAt: sql<Date | null>`max(${shifts.startedAtClient})`.as("last_shift_at")
    })
    .from(shifts)
    .groupBy(shifts.driverId)
    .as("last_shift");

  const rows = await db
    .select({
      id: drivers.id,
      login: drivers.login,
      fullName: drivers.fullName,
      isActive: drivers.isActive,
      lastShiftAt: lastShift.lastShiftAt
    })
    .from(drivers)
    .leftJoin(lastShift, eq(drivers.id, lastShift.driverId))
    .orderBy(asc(drivers.fullName));

  res.json(
    rows.map((row) => ({
      id: row.id,
      login: row.login,
      fullName: row.fullName,
      isActive: row.isActive,
      lastShiftAt: row.lastShiftAt ? new Date(row.lastShiftAt).toISOString() : null
    }))
  );
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

adminRouter.get("/atz", async (_req, res) => {
  const [atzRows, openShiftRows] = await Promise.all([
    db
      .select({
        id: atz.id,
        gosNumber: atz.gosNumber,
        title: atz.title,
        remainingLiters: atz.remainingLiters,
        isActive: atz.isActive
      })
      .from(atz)
      .orderBy(asc(atz.gosNumber)),
    db
      .select({
        atzId: shifts.atzId,
        id: shifts.id,
        driverId: drivers.id,
        driverFullName: drivers.fullName,
        startedAtClient: shifts.startedAtClient
      })
      .from(shifts)
      .innerJoin(drivers, eq(shifts.driverId, drivers.id))
      .where(eq(shifts.status, "open"))
      .orderBy(desc(shifts.startedAtClient))
  ]);

  const openShiftByAtzId = new Map<
    string,
    {
      id: string;
      driverId: string;
      driverFullName: string;
      startedAtClient: Date;
    }
  >();

  for (const openShift of openShiftRows) {
    if (!openShiftByAtzId.has(openShift.atzId)) {
      openShiftByAtzId.set(openShift.atzId, openShift);
    }
  }

  res.json(
    atzRows.map((atzRow) => {
      const openShift = openShiftByAtzId.get(atzRow.id);

      return {
        id: atzRow.id,
        gosNumber: atzRow.gosNumber,
        title: atzRow.title,
        remainingLiters: Number(atzRow.remainingLiters ?? 0),
        isActive: atzRow.isActive,
        openShift: openShift
          ? {
              id: openShift.id,
              driver: {
                id: openShift.driverId,
                fullName: openShift.driverFullName
              },
              startedAtClient: openShift.startedAtClient.toISOString()
            }
          : null
      };
    })
  );
});

adminRouter.post("/atz", async (req, res) => {
  const body = createAtzBodySchema.parse(req.body);

  const [createdAtz] = await db
    .insert(atz)
    .values({
      gosNumber: body.gosNumber,
      title: body.title,
      tisVehicleId: body.tisVehicleId,
      remainingLiters: body.remainingLiters.toFixed(2),
      isActive: body.isActive,
      updatedAt: new Date()
    })
    .returning({
      id: atz.id,
      gosNumber: atz.gosNumber,
      title: atz.title,
      remainingLiters: atz.remainingLiters,
      isActive: atz.isActive
    });

  res.status(201).json({
    id: createdAtz.id,
    gosNumber: createdAtz.gosNumber,
    title: createdAtz.title,
    remainingLiters: Number(createdAtz.remainingLiters ?? 0),
    isActive: createdAtz.isActive,
    openShift: null
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

adminRouter.patch("/atz/:id", async (req, res) => {
  const { id } = uuidParamsSchema.parse(req.params);
  const body = updateAtzBodySchema.parse(req.body ?? {});

  const set: Partial<typeof atz.$inferInsert> = {
    updatedAt: new Date()
  };

  if (body.title !== undefined) {
    set.title = body.title;
  }
  if (body.tisVehicleId !== undefined) {
    set.tisVehicleId = body.tisVehicleId;
  }
  if (body.isActive !== undefined) {
    set.isActive = body.isActive;
  }
  if (body.remainingLiters !== undefined) {
    set.remainingLiters = body.remainingLiters.toFixed(2);
  }

  const [updatedAtz] = await db
    .update(atz)
    .set(set)
    .where(eq(atz.id, id))
    .returning({
      id: atz.id,
      gosNumber: atz.gosNumber,
      title: atz.title,
      remainingLiters: atz.remainingLiters,
      isActive: atz.isActive
    });

  if (!updatedAtz) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({
    id: updatedAtz.id,
    gosNumber: updatedAtz.gosNumber,
    title: updatedAtz.title,
    remainingLiters: Number(updatedAtz.remainingLiters ?? 0),
    isActive: updatedAtz.isActive,
    openShift: null
  });
});

adminRouter.get("/receipts/:id/photo", async (req, res, next) => {
  const { id } = uuidParamsSchema.parse(req.params);

  const [receipt] = await db
    .select({
      id: fuelReceiptEvents.id,
      ttnPhotoStatus: fuelReceiptEvents.ttnPhotoStatus,
      ttnPhotoPath: fuelReceiptEvents.ttnPhotoPath
    })
    .from(fuelReceiptEvents)
    .where(eq(fuelReceiptEvents.id, id))
    .limit(1);

  if (!receipt || receipt.ttnPhotoStatus !== "uploaded" || !receipt.ttnPhotoPath) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const imageType = getPhotoImageType(receipt.ttnPhotoPath);
  if (!imageType) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const photoPath = path.join(getUploadsDir(), `${id}.${imageType.ext}`);

  try {
    await fs.access(photoPath);
  } catch {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.type(imageType.mime);
  res.sendFile(photoPath, (error) => {
    if (error) {
      next(error);
    }
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

function getPhotoImageType(photoPath: string):
  | { ext: "jpg"; mime: "image/jpeg" }
  | { ext: "png"; mime: "image/png" }
  | { ext: "webp"; mime: "image/webp" }
  | null {
  const ext = path.extname(photoPath).toLowerCase().slice(1);

  if (ext === "jpg" || ext === "jpeg") {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  if (ext === "png") {
    return { ext, mime: "image/png" };
  }

  if (ext === "webp") {
    return { ext, mime: "image/webp" };
  }

  return null;
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
