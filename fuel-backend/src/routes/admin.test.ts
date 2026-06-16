import { inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminToken = `test-admin-${crypto.randomUUID()}`;
process.env.ADMIN_BEARER_TOKEN = adminToken;

const { app } = await import("../app.js");
const { db, pool } = await import("../db/client.js");
const {
  atz,
  drivers,
  eventEdits,
  fuelDispenseEvents,
  fuelReceiptEvents,
  organizations,
  shifts,
  vehicles
} = await import("../db/schema.js");

const testId = crypto.randomUUID();
const prefix = `test-admin-${testId}`;
const authHeader = { Authorization: `Bearer ${adminToken}` };

let driverId: string;
let openDriverId: string;
let organizationId: string;
let vehicleId: string;
let inactiveVehicleId: string;
let atzId: string;
let openAtzId: string;
let noShiftAtzId: string;
let patchAtzId: string;
let shiftId: string;
let openShiftId: string;
let overrideAtzId: string;
let overrideShiftId: string;
let activeDispenseId: string;
let deletedDispenseId: string;
let receiptId: string;
let pendingReceiptId: string;
let editId: string;
const createdAtzIds: string[] = [];

describe("admin routes", () => {
  beforeAll(async () => {
    const [driver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-driver`,
        pinHash: "admin-test-pin-hash",
        fullName: "Test Admin Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    driverId = driver.id;

    const [openDriver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-open-driver`,
        pinHash: "admin-test-open-pin-hash",
        fullName: "Test Admin Open Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    openDriverId = openDriver.id;

    const [organization] = await db
      .insert(organizations)
      .values({
        name: `${prefix}-org`,
        kind: "hired",
        source: "admin"
      })
      .returning({ id: organizations.id });

    organizationId = organization.id;

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        gosNumber: `${prefix}-vehicle`,
        mark: "Test Mark",
        vehicleType: "dump-truck",
        organizationId,
        source: "admin",
        tisId: prefix,
        isActive: true
      })
      .returning({ id: vehicles.id });

    vehicleId = vehicle.id;

    const [inactiveVehicle] = await db
      .insert(vehicles)
      .values({
        gosNumber: `${prefix}-inactive-vehicle`,
        mark: "Inactive Test Mark",
        vehicleType: "loader",
        organizationId,
        source: "admin",
        tisId: `${prefix}-inactive`,
        isActive: false
      })
      .returning({ id: vehicles.id });

    inactiveVehicleId = inactiveVehicle.id;

    const [testAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-atz`,
        title: "Test Admin ATZ",
        remainingLiters: "777.50",
        isActive: true
      })
      .returning({ id: atz.id });

    atzId = testAtz.id;

    const [openAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-open-atz`,
        title: "Test Admin Open ATZ",
        remainingLiters: "123.45",
        isActive: true
      })
      .returning({ id: atz.id });

    openAtzId = openAtz.id;

    const [noShiftAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-no-shift-atz`,
        title: "Test Admin No Shift ATZ",
        remainingLiters: "0",
        isActive: true
      })
      .returning({ id: atz.id });

    noShiftAtzId = noShiftAtz.id;

    const [patchAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-patch-atz`,
        title: "Test Admin Patch ATZ",
        remainingLiters: "250.00",
        isActive: true
      })
      .returning({ id: atz.id });

    patchAtzId = patchAtz.id;

    const [overrideAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-override-atz`,
        title: "Test Admin Override ATZ",
        remainingLiters: "500.00",
        isActive: true
      })
      .returning({ id: atz.id });

    overrideAtzId = overrideAtz.id;
    overrideShiftId = crypto.randomUUID();

    shiftId = crypto.randomUUID();
    openShiftId = crypto.randomUUID();
    activeDispenseId = crypto.randomUUID();
    deletedDispenseId = crypto.randomUUID();
    receiptId = crypto.randomUUID();
    pendingReceiptId = crypto.randomUUID();

    await db.insert(shifts).values({
      id: shiftId,
      driverId,
      atzId,
      startedAtClient: new Date("2026-06-12T07:30:00.000Z"),
      endedAtClient: new Date("2026-06-12T19:30:00.000Z"),
      status: "closed",
      openingRemainingLiters: "1000.00",
      closingRemainingLiters: "1157.75",
      deviceId: "admin-test-device"
    });

    await db.insert(shifts).values({
      id: openShiftId,
      driverId: openDriverId,
      atzId: openAtzId,
      startedAtClient: new Date("2026-06-13T07:30:00.000Z"),
      status: "open",
      openingRemainingLiters: "500.00",
      deviceId: "admin-test-open-device"
    });

    await db.insert(shifts).values({
      id: overrideShiftId,
      driverId: openDriverId,
      atzId: overrideAtzId,
      startedAtClient: new Date("2026-06-13T07:45:00.000Z"),
      status: "open",
      openingRemainingLiters: "500.00",
      deviceId: "admin-test-override-device"
    });

    await db.insert(fuelDispenseEvents).values([
      {
        id: activeDispenseId,
        shiftId,
        vehicleId,
        liters: "42.50",
        happenedAtClient: new Date("2026-06-12T08:00:00.000Z"),
        receivedAtServer: new Date("2026-06-12T08:01:00.000Z"),
        isDeleted: false
      },
      {
        id: deletedDispenseId,
        shiftId,
        vehicleId,
        liters: "99.00",
        happenedAtClient: new Date("2026-06-12T09:00:00.000Z"),
        receivedAtServer: new Date("2026-06-12T09:01:00.000Z"),
        isDeleted: true,
        editedAt: new Date("2026-06-12T09:05:00.000Z")
      }
    ]);

    await db.insert(fuelReceiptEvents).values({
      id: receiptId,
      shiftId,
      liters: "200.25",
      happenedAtClient: new Date("2026-06-12T10:00:00.000Z"),
      receivedAtServer: new Date("2026-06-12T10:01:00.000Z"),
      isDeleted: false,
      ttnPhotoStatus: "uploaded",
      ttnPhotoPath: `/tmp/${prefix}-ttn.jpg`
    });

    await db.insert(fuelReceiptEvents).values({
      id: pendingReceiptId,
      shiftId: openShiftId,
      liters: "300.00",
      happenedAtClient: new Date("2026-06-13T08:00:00.000Z"),
      receivedAtServer: new Date("2026-06-13T08:01:00.000Z"),
      isDeleted: false
    });

    const [edit] = await db
      .insert(eventEdits)
      .values({
        eventId: deletedDispenseId,
        eventType: "dispense",
        before: { isDeleted: false, liters: 99 },
        after: { isDeleted: true, liters: 99 },
        editedAt: new Date("2026-06-12T09:05:00.000Z")
      })
      .returning({ id: eventEdits.id });

    editId = edit.id;
  });

  afterAll(async () => {
    // Тесты close/edit пишут новые event_edits — чистим по eventId, а не только по фиксированному editId.
    await db
      .delete(eventEdits)
      .where(
        inArray(eventEdits.eventId, [
          openShiftId,
          overrideShiftId,
          activeDispenseId,
          deletedDispenseId,
          receiptId
        ])
      );
    await db.delete(eventEdits).where(inArray(eventEdits.id, [editId]));
    await db.delete(fuelReceiptEvents).where(inArray(fuelReceiptEvents.id, [receiptId, pendingReceiptId]));
    await db
      .delete(fuelDispenseEvents)
      .where(inArray(fuelDispenseEvents.id, [activeDispenseId, deletedDispenseId]));
    await db.delete(shifts).where(inArray(shifts.id, [shiftId, openShiftId, overrideShiftId]));
    await db.delete(vehicles).where(inArray(vehicles.id, [vehicleId, inactiveVehicleId]));
    await db
      .delete(atz)
      .where(
        inArray(atz.id, [
          atzId,
          openAtzId,
          noShiftAtzId,
          patchAtzId,
          overrideAtzId,
          ...createdAtzIds
        ])
      );
    await db.delete(organizations).where(inArray(organizations.id, [organizationId]));
    await db.delete(drivers).where(inArray(drivers.id, [driverId, openDriverId]));
    await pool.end();
  });

  it("returns 401 without a bearer token", async () => {
    await request(app).get("/admin/shifts").expect(401).expect({ error: "Unauthorized" });
  });

  it("returns 401 for an invalid bearer token", async () => {
    await request(app)
      .get("/admin/shifts")
      .set("Authorization", "Bearer wrong-token")
      .expect(401)
      .expect({ error: "Unauthorized" });
  });

  it("returns 401 for drivers list without a bearer token", async () => {
    await request(app).get("/admin/drivers").expect(401).expect({ error: "Unauthorized" });
  });

  it("returns 401 for vehicles list without a bearer token", async () => {
    await request(app).get("/admin/vehicles").expect(401).expect({ error: "Unauthorized" });
  });

  it("lists active vehicles with organization names", async () => {
    const response = await request(app).get("/admin/vehicles").set(authHeader).expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const vehicle = response.body.find((row: { id: string }) => row.id === vehicleId);

    expect(vehicle).toEqual({
      id: vehicleId,
      gosNumber: `${prefix}-vehicle`,
      mark: "Test Mark",
      vehicleType: "dump-truck",
      organizationName: `${prefix}-org`,
      source: "admin",
      isActive: true
    });
    expect(response.body.find((row: { id: string }) => row.id === inactiveVehicleId)).toBeUndefined();
  });

  it("returns at least as many vehicles with active=all as the default list", async () => {
    const [defaultResponse, allResponse] = await Promise.all([
      request(app).get("/admin/vehicles").set(authHeader).expect(200),
      request(app).get("/admin/vehicles").query({ active: "all" }).set(authHeader).expect(200)
    ]);

    expect(allResponse.body.length).toBeGreaterThanOrEqual(defaultResponse.body.length);
    expect(allResponse.body.find((row: { id: string }) => row.id === inactiveVehicleId)).toMatchObject({
      id: inactiveVehicleId,
      organizationName: `${prefix}-org`,
      isActive: false
    });
  });

  it("lists drivers without pin hashes and with lastShiftAt", async () => {
    const response = await request(app).get("/admin/drivers").set(authHeader).expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.text).not.toContain("pinHash");
    expect(response.text).not.toContain("pin_hash");

    const driver = response.body.find((row: { id: string }) => row.id === driverId);

    expect(driver).toEqual({
      id: driverId,
      login: `${prefix}-driver`,
      fullName: "Test Admin Driver",
      isActive: true,
      lastShiftAt: "2026-06-12T07:30:00.000Z"
    });
  });

  it("lists shifts with aggregates from non-deleted events and visible edits", async () => {
    const response = await request(app)
      .get("/admin/shifts")
      .query({
        status: "closed",
        from: "2026-06-12T00:00:00.000Z",
        to: "2026-06-13T00:00:00.000Z",
        limit: 100
      })
      .set(authHeader)
      .expect(200);

    const shift = response.body.find((row: { id: string }) => row.id === shiftId);

    expect(shift).toMatchObject({
      id: shiftId,
      driver: {
        id: driverId,
        fullName: "Test Admin Driver",
        login: `${prefix}-driver`
      },
      atz: {
        id: atzId,
        gosNumber: `${prefix}-atz`
      },
      startedAtClient: "2026-06-12T07:30:00.000Z",
      endedAtClient: "2026-06-12T19:30:00.000Z",
      status: "closed",
      openingRemainingLiters: 1000,
      closingRemainingLiters: 1157.75,
      deviceId: "admin-test-device",
      dispenseCount: 1,
      dispenseLiters: 42.5,
      receiptLiters: 200.25,
      editsCount: 1
    });
  });

  it("returns shift drill-in with deleted events and edits", async () => {
    const response = await request(app)
      .get(`/admin/shifts/${shiftId}`)
      .set(authHeader)
      .expect(200);

    expect(response.body.id).toBe(shiftId);
    expect(response.body.dispenses).toEqual([
      expect.objectContaining({
        id: activeDispenseId,
        liters: 42.5,
        isDeleted: false,
        wasEdited: false
      }),
      expect.objectContaining({
        id: deletedDispenseId,
        liters: 99,
        isDeleted: true,
        editedAt: "2026-06-12T09:05:00.000Z",
        wasEdited: true
      })
    ]);
    expect(response.body.receipts).toEqual([
      expect.objectContaining({
        id: receiptId,
        liters: 200.25,
        isDeleted: false,
        wasEdited: false,
        ttnPhotoStatus: "uploaded",
        ttnPhotoPath: `/tmp/${prefix}-ttn.jpg`
      })
    ]);
    expect(response.body.edits).toEqual([
      expect.objectContaining({
        id: editId,
        eventId: deletedDispenseId,
        eventType: "dispense",
        before: { isDeleted: false, liters: 99 },
        after: { isDeleted: true, liters: 99 },
        editedAt: "2026-06-12T09:05:00.000Z"
      })
    ]);
  });

  it("returns 400 for an invalid shift uuid", async () => {
    await request(app).get("/admin/shifts/not-a-uuid").set(authHeader).expect(400);
  });

  it("returns 404 for a missing shift uuid", async () => {
    await request(app)
      .get(`/admin/shifts/${crypto.randomUUID()}`)
      .set(authHeader)
      .expect(404)
      .expect({ error: "Not found" });
  });

  it("returns a driver without pin hash fields", async () => {
    const response = await request(app)
      .get(`/admin/drivers/${driverId}`)
      .set(authHeader)
      .expect(200);

    expect(response.text).not.toContain("pinHash");
    expect(response.text).not.toContain("pin_hash");
    expect(response.body).toMatchObject({
      id: driverId,
      login: `${prefix}-driver`,
      fullName: "Test Admin Driver",
      isActive: true
    });
    expect(response.body.shifts).toEqual([expect.objectContaining({ id: shiftId })]);
  });

  it("returns an atz with null openShift for a closed shift", async () => {
    const response = await request(app).get(`/admin/atz/${atzId}`).set(authHeader).expect(200);

    expect(response.body).toMatchObject({
      id: atzId,
      gosNumber: `${prefix}-atz`,
      title: "Test Admin ATZ",
      remainingLiters: 777.5,
      isActive: true,
      openShift: null
    });
    expect(response.body.shifts).toEqual([expect.objectContaining({ id: shiftId })]);
  });

  it("returns 401 for atz list without a bearer token", async () => {
    await request(app).get("/admin/atz").expect(401).expect({ error: "Unauthorized" });
  });

  it("lists atz with remaining liters and open shift details", async () => {
    const response = await request(app).get("/admin/atz").set(authHeader).expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const noShiftAtz = response.body.find((row: { id: string }) => row.id === noShiftAtzId);
    const openAtz = response.body.find((row: { id: string }) => row.id === openAtzId);

    expect(noShiftAtz).toMatchObject({
      id: noShiftAtzId,
      gosNumber: `${prefix}-no-shift-atz`,
      title: "Test Admin No Shift ATZ",
      remainingLiters: 0,
      isActive: true,
      openShift: null
    });
    expect(openAtz).toMatchObject({
      id: openAtzId,
      gosNumber: `${prefix}-open-atz`,
      title: "Test Admin Open ATZ",
      remainingLiters: 123.45,
      isActive: true,
      openShift: {
        id: openShiftId,
        driver: {
          id: openDriverId,
          fullName: "Test Admin Open Driver"
        },
        startedAtClient: "2026-06-13T07:30:00.000Z"
      }
    });
  });

  it("returns 401 when creating an atz without a bearer token", async () => {
    await request(app)
      .post("/admin/atz")
      .send({ gosNumber: `${prefix}-created-atz` })
      .expect(401)
      .expect({ error: "Unauthorized" });
  });

  it("creates an atz and stores updatedAt", async () => {
    const response = await request(app)
      .post("/admin/atz")
      .set(authHeader)
      .send({
        gosNumber: `${prefix}-created-atz`,
        title: "Created Admin ATZ",
        tisVehicleId: `${prefix}-created-tis`,
        remainingLiters: 345.67,
        isActive: false
      })
      .expect(201);

    createdAtzIds.push(response.body.id);

    expect(response.body).toEqual({
      id: expect.any(String),
      gosNumber: `${prefix}-created-atz`,
      title: "Created Admin ATZ",
      remainingLiters: 345.67,
      isActive: false,
      openShift: null
    });

    const [createdAtz] = await db
      .select({
        remainingLiters: atz.remainingLiters,
        updatedAt: atz.updatedAt
      })
      .from(atz)
      .where(inArray(atz.id, [response.body.id]));

    expect(Number(createdAtz.remainingLiters)).toBe(345.67);
    expect(createdAtz.updatedAt).toBeInstanceOf(Date);
  });

  it("returns 404 when patching a missing atz", async () => {
    await request(app)
      .patch(`/admin/atz/${crypto.randomUUID()}`)
      .set(authHeader)
      .send({ title: "Missing" })
      .expect(404)
      .expect({ error: "Not found" });
  });

  it("updates atz fields and bumps updatedAt", async () => {
    const [before] = await db
      .select({ updatedAt: atz.updatedAt })
      .from(atz)
      .where(inArray(atz.id, [patchAtzId]));

    const response = await request(app)
      .patch(`/admin/atz/${patchAtzId}`)
      .set(authHeader)
      .send({
        title: "Patched Admin ATZ",
        remainingLiters: 123.45,
        isActive: false
      })
      .expect(200);

    expect(response.body).toEqual({
      id: patchAtzId,
      gosNumber: `${prefix}-patch-atz`,
      title: "Patched Admin ATZ",
      remainingLiters: 123.45,
      isActive: false,
      openShift: null
    });

    const [after] = await db
      .select({
        remainingLiters: atz.remainingLiters,
        isActive: atz.isActive,
        updatedAt: atz.updatedAt
      })
      .from(atz)
      .where(inArray(atz.id, [patchAtzId]));

    expect(Number(after.remainingLiters)).toBe(123.45);
    expect(after.isActive).toBe(false);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("rejects an empty atz patch body", async () => {
    await request(app).patch(`/admin/atz/${patchAtzId}`).set(authHeader).send({}).expect(400);
  });

  it("returns 401 for receipt photo without a bearer token", async () => {
    await request(app)
      .get(`/admin/receipts/${pendingReceiptId}/photo`)
      .expect(401)
      .expect({ error: "Unauthorized" });
  });

  it("returns 404 for an existing receipt without an uploaded photo", async () => {
    await request(app)
      .get(`/admin/receipts/${pendingReceiptId}/photo`)
      .set(authHeader)
      .expect(404)
      .expect({ error: "Not found" });
  });

  it("returns 404 for a missing receipt photo", async () => {
    await request(app)
      .get(`/admin/receipts/${crypto.randomUUID()}/photo`)
      .set(authHeader)
      .expect(404)
      .expect({ error: "Not found" });
  });

  // ---- POST /admin/shifts/:id/close ----

  it("requires a bearer token to close a shift", async () => {
    await request(app)
      .post(`/admin/shifts/${openShiftId}/close`)
      .expect(401)
      .expect({ error: "Unauthorized" });
  });

  it("returns 404 when closing a missing shift", async () => {
    await request(app)
      .post(`/admin/shifts/${crypto.randomUUID()}/close`)
      .set(authHeader)
      .expect(404)
      .expect({ error: "Not found" });
  });

  it("rejects closing an already closed shift", async () => {
    await request(app)
      .post(`/admin/shifts/${shiftId}/close`)
      .set(authHeader)
      .expect(409)
      .expect({ error: "Shift already closed", code: "already_closed" });
  });

  it("closes an open shift with an auto-snapshot of the atz remaining liters", async () => {
    const response = await request(app)
      .post(`/admin/shifts/${openShiftId}/close`)
      .set(authHeader)
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      id: openShiftId,
      status: "closed",
      closingRemainingLiters: 123.45 // авто-снимок текущего остатка openAtz
    });
    expect(response.body.endedAtClient).not.toBeNull();

    // Без override остаток АТЗ не двигается.
    const [openAtzRow] = await db
      .select({ remainingLiters: atz.remainingLiters })
      .from(atz)
      .where(inArray(atz.id, [openAtzId]));
    expect(Number(openAtzRow.remainingLiters)).toBe(123.45);

    // Журнал получает запись типа shift.
    const edits = await db
      .select({ eventType: eventEdits.eventType })
      .from(eventEdits)
      .where(inArray(eventEdits.eventId, [openShiftId]));
    expect(edits).toEqual([{ eventType: "shift" }]);
  });

  it("closes a shift with an override that calibrates the atz remaining liters", async () => {
    const response = await request(app)
      .post(`/admin/shifts/${overrideShiftId}/close`)
      .set(authHeader)
      .send({ closingRemainingLiters: 480.25 }) // current = 500.00 → дельта −19.75
      .expect(200);

    expect(response.body).toMatchObject({
      id: overrideShiftId,
      status: "closed",
      closingRemainingLiters: 480.25
    });

    const [overrideAtzRow] = await db
      .select({ remainingLiters: atz.remainingLiters })
      .from(atz)
      .where(inArray(atz.id, [overrideAtzId]));
    expect(Number(overrideAtzRow.remainingLiters)).toBe(480.25);
  });

  // ---- PATCH /admin/events/:type/:id ----

  it("requires a bearer token to edit an event", async () => {
    await request(app)
      .patch(`/admin/events/dispense/${activeDispenseId}`)
      .send({ liters: 10 })
      .expect(401)
      .expect({ error: "Unauthorized" });
  });

  it("rejects an empty edit body", async () => {
    await request(app)
      .patch(`/admin/events/dispense/${activeDispenseId}`)
      .set(authHeader)
      .send({})
      .expect(400);
  });

  it("returns 404 for a missing event", async () => {
    await request(app)
      .patch(`/admin/events/receipt/${crypto.randomUUID()}`)
      .set(authHeader)
      .send({ liters: 10 })
      .expect(404)
      .expect({ error: "Not found" });
  });

  it("edits dispense liters and increases atz remaining when liters drop", async () => {
    // atzId remaining = 777.50, dispense was 42.50. Снижаем до 30.00 → вернётся 12.50 в остаток.
    const response = await request(app)
      .patch(`/admin/events/dispense/${activeDispenseId}`)
      .set(authHeader)
      .send({ liters: 30 })
      .expect(200);

    expect(response.body).toMatchObject({
      id: activeDispenseId,
      type: "dispense",
      liters: 30,
      isDeleted: false,
      atz: { id: atzId, remainingLiters: 790 } // 777.50 + 12.50
    });
    expect(response.body.editedAt).not.toBeNull();
  });

  it("soft-deletes a dispense and returns its liters to the atz remaining", async () => {
    // После предыдущего теста: dispense = 30.00, atz remaining = 790.00. Удаление вернёт 30 → 820.00.
    const response = await request(app)
      .patch(`/admin/events/dispense/${activeDispenseId}`)
      .set(authHeader)
      .send({ isDeleted: true })
      .expect(200);

    expect(response.body).toMatchObject({
      id: activeDispenseId,
      isDeleted: true,
      atz: { id: atzId, remainingLiters: 820 }
    });

    const [row] = await db
      .select({ isDeleted: fuelDispenseEvents.isDeleted })
      .from(fuelDispenseEvents)
      .where(inArray(fuelDispenseEvents.id, [activeDispenseId]));
    expect(row.isDeleted).toBe(true);
  });

  it("edits receipt liters and decreases atz remaining when liters drop", async () => {
    // atzId remaining = 820.00, receipt was 200.25. Снижаем до 150.25 → −50 из остатка → 770.00.
    const response = await request(app)
      .patch(`/admin/events/receipt/${receiptId}`)
      .set(authHeader)
      .send({ liters: 150.25 })
      .expect(200);

    expect(response.body).toMatchObject({
      id: receiptId,
      type: "receipt",
      liters: 150.25,
      atz: { id: atzId, remainingLiters: 770 }
    });

    // Журнал правок receipt записан.
    const edits = await db
      .select({ eventType: eventEdits.eventType })
      .from(eventEdits)
      .where(inArray(eventEdits.eventId, [receiptId]));
    expect(edits).toEqual([{ eventType: "receipt" }]);
  });
});
