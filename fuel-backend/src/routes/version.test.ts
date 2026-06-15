import request from "supertest";
import { describe, it, expect } from "vitest";

import { app } from "../app.js";

describe("GET /version", () => {
  it("returns version object without auth", async () => {
    const res = await request(app).get("/version").expect(200);
    expect(res.body).toMatchObject({
      version: expect.any(String),
      buildNumber: expect.any(Number),
      apkUrl: expect.stringContaining("https://"),
    });
  });
});
