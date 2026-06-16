import { inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "../app.js";
import { db, pool } from "../db/client.js";
import {
  atz,
  drivers,
  fuelDispenseEvents,
  fuelReceiptEvents,
  organizations,
  shifts,
  vehicles
} from "../db/schema.js";

const testId = crypto.randomUUID();
const prefix = `test-bootstrap-${testId}`;
const jwtSecret = process.env.JWT_SECRET ?? "test-jwt-secret";

let token: string;
let driverId: string;
let otherDriverId: string;
let organizationId: string;
let vehicleId: string;
let atzId: string;
let otherAtzId: string;
let shiftId: string;
let otherShiftId: string;
let dispenseEventIds: string[];
let receiptEventId: string;

describe("GET /bootstrap", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = jwtSecret;

    const [driver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-driver`,
        pinHash: "not-used",
        fullName: "Test Bootstrap Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    const [otherDriver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-other-driver`,
        pinHash: "not-used",
        fullName: "Other Bootstrap Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    driverId = driver.id;
    otherDriverId = otherDriver.id;
    token = jwt.sign({ sub: driverId }, jwtSecret, { expiresIn: "7d" });

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
        vehicleType: "fuel-test",
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
        title: "Test ATZ",
        remainingLiters: "123.45",
        isActive: true
      })
      .returning({ id: atz.id });

    const [otherAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-other-atz`,
        title: "Other ATZ",
        remainingLiters: "0",
        isActive: true
      })
      .returning({ id: atz.id });

    atzId = testAtz.id;
    otherAtzId = otherAtz.id;
    shiftId = crypto.randomUUID();
    otherShiftId = crypto.randomUUID();

    await db.insert(shifts).values([
      {
        id: shiftId,
        driverId,
        atzId,
        startedAtClient: new Date("2026-06-12T07:30:00.000Z"),
        endedAtClient: new Date("2026-06-12T19:30:00.000Z"),
        status: "closed",
        openingRemainingLiters: "1000.00",
        closingRemainingLiters: "880.00"
      },
      {
        id: otherShiftId,
        driverId: otherDriverId,
        atzId: otherAtzId,
        startedAtClient: new Date("2026-06-12T08:00:00.000Z"),
        endedAtClient: new Date("2026-06-12T12:00:00.000Z"),
        status: "closed",
        openingRemainingLiters: "500.00",
        closingRemainingLiters: "400.00"
      }
    ]);

    dispenseEventIds = [crypto.randomUUID(), crypto.randomUUID()];
    receiptEventId = crypto.randomUUID();

    await db.insert(fuelDispenseEvents).values([
      {
        id: dispenseEventIds[0],
        shiftId,
        vehicleId,
        liters: "10.50",
        happenedAtClient: new Date("2026-06-12T08:00:00.000Z"),
        isDeleted: false
      },
      {
        id: dispenseEventIds[1],
        shiftId,
        vehicleId,
        liters: "99.00",
        happenedAtClient: new Date("2026-06-12T09:00:00.000Z"),
        isDeleted: true
      }
    ]);

    await db.insert(fuelReceiptEvents).values({
      id: receiptEventId,
      shiftId,
      liters: "50.25",
      happenedAtClient: new Date("2026-06-12T10:00:00.000Z"),
      isDeleted: false
    });
  });

  afterAll(async () => {
    await db.delete(fuelReceiptEvents).where(inArray(fuelReceiptEvents.id, [receiptEventId]));
    await db.delete(fuelDispenseEvents).where(inArray(fuelDispenseEvents.id, dispenseEventIds));
    await db.delete(shifts).where(inArray(shifts.id, [shiftId, otherShiftId]));
    await db.delete(vehicles).where(inArray(vehicles.id, [vehicleId]));
    await db.delete(atz).where(inArray(atz.id, [atzId, otherAtzId]));
    await db.delete(organizations).where(inArray(organizations.id, [organizationId]));
    await db.delete(drivers).where(inArray(drivers.id, [driverId, otherDriverId]));
    await pool.end();
  });

  it("returns 401 without a token", async () => {
    await request(app).get("/bootstrap").expect(401).expect({ error: "Unauthorized" });
  });

  it("returns full dictionaries without since", async () => {
    const response = await request(app)
      .get("/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(typeof response.body.serverTime).toBe("string");
    expect(response.body.organizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: organizationId,
          name: `${prefix}-org`,
          kind: "hired",
          source: "admin"
        })
      ])
    );
    expect(response.body.vehicles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: vehicleId,
          gosNumber: `${prefix}-vehicle`,
          organizationId,
          isActive: true
        })
      ])
    );
    expect(response.body.atz).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: atzId,
          gosNumber: `${prefix}-atz`,
          remainingLiters: 123.45,
          isActive: true
        })
      ])
    );
  });

  it("returns empty dictionaries for a future since but keeps driver shifts", async () => {
    const response = await request(app)
      .get("/bootstrap")
      .query({ since: "3000-01-01T00:00:00.000Z" })
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.organizations).toEqual([]);
    expect(response.body.vehicles).toEqual([]);
    expect(response.body.atz).toEqual([]);
    expect(response.body.shifts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: shiftId })])
    );
  });

  it("returns 400 for an invalid since", async () => {
    await request(app)
      .get("/bootstrap")
      .query({ since: "not-a-date" })
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("does not count deleted dispense events in shift aggregates", async () => {
    const response = await request(app)
      .get("/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const shift = response.body.shifts.find((row: { id: string }) => row.id === shiftId);

    expect(shift).toMatchObject({
      id: shiftId,
      atzId,
      atzGosNumber: `${prefix}-atz`,
      openingRemainingLiters: 1000,
      closingRemainingLiters: 880,
      dispenseCount: 1,
      dispenseLiters: 10.5,
      receiptLiters: 50.25
    });
  });

  it("does not return shifts from other drivers", async () => {
    const response = await request(app)
      .get("/bootstrap")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const shiftIds = response.body.shifts.map((row: { id: string }) => row.id);

    expect(shiftIds).toContain(shiftId);
    expect(shiftIds).not.toContain(otherShiftId);
  });
});
