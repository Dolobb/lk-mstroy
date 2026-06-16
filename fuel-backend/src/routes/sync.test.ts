import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../app.js";

const jwtSecret = process.env.JWT_SECRET ?? "test-jwt-secret";
process.env.JWT_SECRET = jwtSecret;

const driverId = "11111111-1111-4111-8111-111111111111";
const token = jwt.sign({ sub: driverId }, jwtSecret, { expiresIn: "7d" });

type JsonObject = Record<string, unknown>;

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function validSyncRequest(): { deviceId: string; events: JsonObject[] } {
  const orgId = uuid(1);
  const atzId = uuid(2);
  const shiftId = uuid(3);
  const vehicleId = uuid(4);

  return {
    deviceId: "tablet-1",
    events: [
      {
        type: "org_add",
        id: orgId,
        name: "Test Org"
      },
      {
        type: "shift_open",
        id: shiftId,
        atzId,
        startedAtClient: "2026-06-12T07:30:00.000Z"
      },
      {
        type: "dispense_upsert",
        id: uuid(5),
        shiftId,
        vehicleId,
        liters: 10.5,
        recipientName: "Иванов И.И.",
        happenedAtClient: "2026-06-12T08:00:00.000Z"
      }
    ]
  };
}

function postSync(body: JsonObject) {
  return request(app).post("/sync").set("Authorization", `Bearer ${token}`).send(body);
}

describe("POST /sync", () => {
  it("returns 401 without a token", async () => {
    await request(app).post("/sync").send(validSyncRequest()).expect(401).expect({
      error: "Unauthorized"
    });
  });

  it("returns 200 with per-event conflicts for unknown entities (no writes)", async () => {
    // Только события, упирающиеся в несуществующие сущности — БД не мутируется
    const response = await postSync({
      deviceId: "tablet-1",
      events: [
        {
          type: "shift_open",
          id: uuid(20),
          atzId: uuid(21),
          startedAtClient: "2026-06-12T07:30:00.000Z"
        },
        { type: "shift_close", id: uuid(22), endedAtClient: "2026-06-12T19:30:00.000Z" },
        {
          type: "dispense_upsert",
          id: uuid(23),
          shiftId: uuid(24),
          vehicleId: uuid(25),
          liters: 10.5,
          recipientName: "Иванов И.И.",
          happenedAtClient: "2026-06-12T08:00:00.000Z"
        }
      ]
    }).expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({ status: "conflict", code: "atz_not_found" }),
      expect.objectContaining({ status: "conflict", code: "shift_not_found" }),
      expect.objectContaining({ status: "conflict", code: "shift_not_found" })
    ]);
    expect(response.body.atzBalances).toEqual([]);
  });

  it("returns 400 when events is empty", async () => {
    await postSync({ ...validSyncRequest(), events: [] }).expect(400);
  });

  it("returns 400 when events has 501 items", async () => {
    const requestBody = validSyncRequest();
    const events = Array.from({ length: 501 }, (_value, index) => ({
      type: "org_add",
      id: uuid(index + 100),
      name: `Org ${index}`
    }));

    await postSync({ ...requestBody, events }).expect(400);
  });

  it("returns 400 for an unknown event type", async () => {
    const requestBody = validSyncRequest();
    requestBody.events[0] = {
      type: "unknown",
      id: uuid(10),
      name: "Unknown"
    } as (typeof requestBody.events)[number];

    await postSync(requestBody).expect(400);
  });

  it("returns 400 when an event id is not a UUID", async () => {
    const requestBody = validSyncRequest();
    requestBody.events[0].id = "not-a-uuid";

    await postSync(requestBody).expect(400);
  });

  it.each([0, -1, 100000])("returns 400 when liters is %s", async (liters) => {
    const requestBody = validSyncRequest();
    requestBody.events[2] = {
      ...requestBody.events[2],
      liters
    };

    await postSync(requestBody).expect(400);
  });

  it("returns 400 when happenedAtClient is not ISO datetime", async () => {
    const requestBody = validSyncRequest();
    requestBody.events[2] = {
      ...requestBody.events[2],
      happenedAtClient: "12.06.2026 08:00"
    };

    await postSync(requestBody).expect(400);
  });

  it("returns 400 when an event includes driverId", async () => {
    const requestBody = validSyncRequest();
    requestBody.events[2] = {
      ...requestBody.events[2],
      driverId
    };

    await postSync(requestBody).expect(400);
  });
});
