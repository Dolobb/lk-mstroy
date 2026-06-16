import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "../db/client.js";
import { atz, drivers, fuelReceiptEvents, shifts } from "../db/schema.js";

const jwtSecret = process.env.JWT_SECRET ?? "test-jwt-secret";
process.env.JWT_SECRET = jwtSecret;

const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "fuel-upload-test-"));
process.env.UPLOADS_DIR = uploadsDir;

const { app } = await import("../app.js");

const prefix = `test-uploads-${crypto.randomUUID()}`;

let token: string;
let otherToken: string;
let driverId: string;
let otherDriverId: string;
let atzId: string;
let otherAtzId: string;
let shiftId: string;
let otherShiftId: string;
let receiptId: string;
let otherReceiptId: string;

function jpegBuffer(contentByte = 0x11): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, contentByte, 0x00, 0x01]);
}

async function listUploadFiles(): Promise<string[]> {
  return (await fs.readdir(uploadsDir)).sort();
}

async function expectOnlyFiles(expected: string[]): Promise<void> {
  expect(await listUploadFiles()).toEqual(expected.sort());
}

function postTtn(authToken = token) {
  return request(app).post("/uploads/ttn").set("Authorization", `Bearer ${authToken}`);
}

describe("POST /uploads/ttn", () => {
  beforeAll(async () => {
    const [driver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-driver`,
        pinHash: "not-used",
        fullName: "Test Upload Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    const [otherDriver] = await db
      .insert(drivers)
      .values({
        login: `${prefix}-other-driver`,
        pinHash: "not-used",
        fullName: "Other Upload Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    driverId = driver.id;
    otherDriverId = otherDriver.id;
    token = jwt.sign({ sub: driverId }, jwtSecret, { expiresIn: "7d" });
    otherToken = jwt.sign({ sub: otherDriverId }, jwtSecret, { expiresIn: "7d" });

    const [testAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-atz`,
        title: "Test Upload ATZ",
        remainingLiters: "0",
        isActive: true
      })
      .returning({ id: atz.id });

    const [otherTestAtz] = await db
      .insert(atz)
      .values({
        gosNumber: `${prefix}-other-atz`,
        title: "Other Upload ATZ",
        remainingLiters: "0",
        isActive: true
      })
      .returning({ id: atz.id });

    atzId = testAtz.id;
    otherAtzId = otherTestAtz.id;
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
        openingRemainingLiters: "0",
        closingRemainingLiters: "0"
      },
      {
        id: otherShiftId,
        driverId: otherDriverId,
        atzId: otherAtzId,
        startedAtClient: new Date("2026-06-12T07:30:00.000Z"),
        endedAtClient: new Date("2026-06-12T19:30:00.000Z"),
        status: "closed",
        openingRemainingLiters: "0",
        closingRemainingLiters: "0"
      }
    ]);

    receiptId = crypto.randomUUID();
    otherReceiptId = crypto.randomUUID();

    await db.insert(fuelReceiptEvents).values([
      {
        id: receiptId,
        shiftId,
        liters: "100.00",
        happenedAtClient: new Date("2026-06-12T10:00:00.000Z"),
        isDeleted: false
      },
      {
        id: otherReceiptId,
        shiftId: otherShiftId,
        liters: "100.00",
        happenedAtClient: new Date("2026-06-12T10:00:00.000Z"),
        isDeleted: false
      }
    ]);
  });

  afterAll(async () => {
    await db.delete(fuelReceiptEvents).where(inArray(fuelReceiptEvents.id, [receiptId, otherReceiptId]));
    await db.delete(shifts).where(inArray(shifts.id, [shiftId, otherShiftId]));
    await db.delete(atz).where(inArray(atz.id, [atzId, otherAtzId]));
    await db.delete(drivers).where(inArray(drivers.id, [driverId, otherDriverId]));
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await pool.end();
  });

  it("returns 401 without a token", async () => {
    await request(app)
      .post("/uploads/ttn")
      .field("receiptId", receiptId)
      .attach("photo", jpegBuffer(), { filename: "ttn.jpg", contentType: "image/jpeg" })
      .expect(401)
      .expect({ error: "Unauthorized" });

    await expectOnlyFiles([]);
  });

  it("accepts a valid JPEG, stores it, and updates the receipt", async () => {
    const response = await postTtn()
      .field("receiptId", receiptId)
      .attach("photo", jpegBuffer(), { filename: "ttn.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(response.body).toEqual({ ok: true, receiptId });

    const expectedFilename = `${receiptId}.jpg`;
    const filePath = path.join(uploadsDir, expectedFilename);
    await expect(fs.stat(filePath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expectOnlyFiles([expectedFilename]);

    const [receipt] = await db
      .select({
        ttnPhotoPath: fuelReceiptEvents.ttnPhotoPath,
        ttnPhotoStatus: fuelReceiptEvents.ttnPhotoStatus
      })
      .from(fuelReceiptEvents)
      .where(eq(fuelReceiptEvents.id, receiptId))
      .limit(1);

    expect(receipt).toMatchObject({
      ttnPhotoStatus: "uploaded"
    });
    expect(receipt.ttnPhotoPath).toContain(expectedFilename);
  });

  it("overwrites the same receipt photo idempotently", async () => {
    await postTtn()
      .field("receiptId", receiptId)
      .attach("photo", jpegBuffer(0x22), { filename: "ttn-again.jpg", contentType: "image/jpeg" })
      .expect(200);

    await expectOnlyFiles([`${receiptId}.jpg`]);
  });

  it("returns 404 for a missing receipt and removes the uploaded file", async () => {
    const missingReceiptId = crypto.randomUUID();

    await postTtn()
      .field("receiptId", missingReceiptId)
      .attach("photo", jpegBuffer(), { filename: "missing.jpg", contentType: "image/jpeg" })
      .expect(404);

    await expectOnlyFiles([`${receiptId}.jpg`]);
  });

  it("returns 403 for another driver's receipt and removes the uploaded file", async () => {
    await postTtn()
      .field("receiptId", otherReceiptId)
      .attach("photo", jpegBuffer(), { filename: "forbidden.jpg", contentType: "image/jpeg" })
      .expect(403);

    await expectOnlyFiles([`${receiptId}.jpg`]);
  });

  it("returns 415 for non-images and removes the uploaded file", async () => {
    await postTtn()
      .field("receiptId", receiptId)
      .attach("photo", Buffer.from("not an image"), {
        filename: "fake.txt",
        contentType: "text/plain"
      })
      .expect(415);

    await postTtn()
      .field("receiptId", receiptId)
      .attach("photo", Buffer.from("fake jpeg bytes"), {
        filename: "fake.jpg",
        contentType: "image/jpeg"
      })
      .expect(415);

    await expectOnlyFiles([`${receiptId}.jpg`]);
  });

  it("returns 413 for files larger than 2 MB", async () => {
    const tooLarge = Buffer.alloc(2 * 1024 * 1024 + 1, 0);
    tooLarge[0] = 0xff;
    tooLarge[1] = 0xd8;
    tooLarge[2] = 0xff;

    await postTtn()
      .field("receiptId", receiptId)
      .attach("photo", tooLarge, { filename: "large.jpg", contentType: "image/jpeg" })
      .expect(413);

    await expectOnlyFiles([`${receiptId}.jpg`]);
  });

  it("allows the owner of another receipt to upload it", async () => {
    await postTtn(otherToken)
      .field("receiptId", otherReceiptId)
      .attach("photo", jpegBuffer(), { filename: "own.jpg", contentType: "image/jpeg" })
      .expect(200);

    await expectOnlyFiles([`${otherReceiptId}.jpg`, `${receiptId}.jpg`]);
  });
});
