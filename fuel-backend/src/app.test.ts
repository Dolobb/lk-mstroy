import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    await request(app)
      .get("/health")
      .expect(200)
      .expect({ ok: true });
  });
});
