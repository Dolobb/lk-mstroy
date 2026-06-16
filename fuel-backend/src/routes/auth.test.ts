import bcrypt from "bcrypt";
import { eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { db, pool } from "../db/client.js";
import { drivers } from "../db/schema.js";

const pin = "1234";
const login = `test-auth-${crypto.randomUUID()}`;
const inactiveLogin = `test-auth-inactive-${crypto.randomUUID()}`;

let driverId: string;
let inactiveDriverId: string;
let pinHash: string;

describe("POST /auth/login", () => {
  beforeAll(async () => {
    pinHash = await bcrypt.hash(pin, 10);

    const [driver] = await db
      .insert(drivers)
      .values({
        login,
        pinHash,
        fullName: "Test Auth Driver",
        isActive: true
      })
      .returning({ id: drivers.id });

    const [inactiveDriver] = await db
      .insert(drivers)
      .values({
        login: inactiveLogin,
        pinHash,
        fullName: "Inactive Auth Driver",
        isActive: false
      })
      .returning({ id: drivers.id });

    driverId = driver.id;
    inactiveDriverId = inactiveDriver.id;
  });

  afterAll(async () => {
    await db.delete(drivers).where(inArray(drivers.id, [driverId, inactiveDriverId]));
    await pool.end();
  });

  it("returns a JWT and driver profile for valid credentials", async () => {
    const response = await request(app).post("/auth/login").send({ login, pin }).expect(200);

    expect(response.body.driver).toEqual({
      id: driverId,
      login,
      fullName: "Test Auth Driver",
      pinHash
    });
    expect(typeof response.body.token).toBe("string");

    const jwtSecret = process.env.JWT_SECRET;
    expect(jwtSecret).toBeTruthy();

    const payload = jwt.verify(response.body.token, jwtSecret as string);
    expect(payload).toMatchObject({ sub: driverId });
  });

  it("returns 401 for an invalid PIN", async () => {
    await request(app)
      .post("/auth/login")
      .send({ login, pin: "9999" })
      .expect(401)
      .expect({ error: "Неверный логин или PIN" });
  });

  it("returns the same 401 body for a missing login", async () => {
    await request(app)
      .post("/auth/login")
      .send({ login: `missing-${login}`, pin })
      .expect(401)
      .expect({ error: "Неверный логин или PIN" });
  });

  it("returns 403 for a disabled account", async () => {
    await request(app)
      .post("/auth/login")
      .send({ login: inactiveLogin, pin })
      .expect(403)
      .expect({ error: "Учётная запись отключена" });
  });

  it("returns 400 for empty and non-numeric PIN values", async () => {
    await request(app).post("/auth/login").send({ login, pin: "" }).expect(400);
    await request(app).post("/auth/login").send({ login, pin: "abcd" }).expect(400);
  });
});
