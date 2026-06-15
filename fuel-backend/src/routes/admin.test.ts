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
let atzId: string;
let openAtzId: string;
let noShiftAtzId: string;
let shiftId: string;
let openShiftId: string;
let activeDispenseId: string;
let deletedDispenseId: string;
let receiptId: string;
let pendingReceiptId: string;
let editId: string;

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
    await db.delete(eventEdits).where(inArray(eventEdits.id, [editId]));
    await db.delete(fuelReceiptEvents).where(inArray(fuelReceiptEvents.id, [receiptId, pendingReceiptId]));
    await db
      .delete(fuelDispenseEvents)
      .where(inArray(fuelDispenseEvents.id, [activeDispenseId, deletedDispenseId]));
    await db.delete(shifts).where(inArray(shifts.id, [shiftId, openShiftId]));
    await db.delete(vehicles).where(inArray(vehicles.id, [vehicleId]));
    await db.delete(atz).where(inArray(atz.id, [atzId, openAtzId, noShiftAtzId]));
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
});
