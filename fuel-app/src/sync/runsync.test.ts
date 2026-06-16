import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FuelApi } from "../api/client";
import { atz, photoQueue } from "../db/schema";
import { runSync } from "./engine";
import { OutboxStore } from "./outbox";
import { PhotoQueueStore } from "./photos";
import { createTestDb } from "./test-db";
import type { BootstrapData, ReceiptUpsertEvent } from "./types";

function emptyBootstrap(serverTime = "t"): BootstrapData {
  return { serverTime, organizations: [], vehicles: [], atz: [], shifts: [] };
}

function fakeApi(over: Partial<FuelApi> = {}): FuelApi {
  return {
    sync: vi.fn().mockResolvedValue({ serverTime: "t", results: [], atzBalances: [] }),
    bootstrap: vi.fn().mockResolvedValue(emptyBootstrap()),
    uploadTtn: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    ...over,
  };
}

const receipt: ReceiptUpsertEvent = {
  type: "receipt_upsert",
  id: "r1",
  shiftId: "s1",
  liters: 500,
  happenedAtClient: "2026-06-13T10:00:00+03:00",
};

describe("runSync (полный проход: push → фото → bootstrap)", () => {
  let db: ReturnType<typeof createTestDb>;
  let store: OutboxStore;
  let photos: PhotoQueueStore;

  beforeEach(() => {
    db = createTestDb();
    store = new OutboxStore(db);
    photos = new PhotoQueueStore(db);
  });

  it("подтверждает события, грузит фото, применяет bootstrap", async () => {
    await store.enqueue(receipt);
    await photos.enqueue("r1", "file:///c.jpg");

    const api = fakeApi({
      sync: vi.fn().mockResolvedValue({
        serverTime: "t",
        results: [{ id: "r1", type: "receipt_upsert", status: "applied" }],
        atzBalances: [],
      }),
      bootstrap: vi.fn().mockResolvedValue({
        ...emptyBootstrap("t2"),
        atz: [{ id: "a1", gosNumber: "Х001ХХ", title: null, remainingLiters: 900, isActive: true }],
      }),
    });

    const res = await runSync({ db, store, photos, api, deviceId: "dev-1" });

    expect(res.pushed).toBe(1);
    expect(res.uploaded).toBe(1);
    expect((await store.byId("r1"))?.status).toBe("confirmed");
    expect((await db.select().from(photoQueue))[0].status).toBe("uploaded");
    expect(api.uploadTtn).toHaveBeenCalledWith("r1", "file:///c.jpg");
    expect((await db.select().from(atz))[0].remainingLiters).toBe(900);
  });

  it("ошибка загрузки фото не валит проход; фото → error", async () => {
    await store.enqueue(receipt);
    await store.claimBatch();
    await store.applyResults([{ id: "r1", type: "receipt_upsert", status: "applied" }]);
    await photos.enqueue("r1", "file:///c.jpg");

    const api = fakeApi({ uploadTtn: vi.fn().mockRejectedValue(new Error("upload 500")) });
    const res = await runSync({ db, store, photos, api, deviceId: "dev-1" });

    expect(res.photoErrors).toBe(1);
    expect((await db.select().from(photoQueue))[0].status).toBe("error");
  });
});
