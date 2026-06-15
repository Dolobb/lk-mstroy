import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncApi } from "../api/client";
import { outbox } from "../db/schema";
import { buildSyncRequest, pushOutbox } from "./engine";
import { OutboxStore } from "./outbox";
import { createTestDb } from "./test-db";
import type { DispenseUpsertEvent, SyncResponse } from "./types";

function dispense(id: string, liters: number): DispenseUpsertEvent {
  return {
    type: "dispense_upsert",
    id,
    shiftId: "shift-1",
    vehicleId: "veh-1",
    liters,
    happenedAtClient: "2026-06-13T10:00:00+03:00",
  };
}

function fakeApi(response: SyncResponse): SyncApi & { sync: ReturnType<typeof vi.fn> } {
  return { sync: vi.fn().mockResolvedValue(response) };
}

describe("pushOutbox", () => {
  let db: ReturnType<typeof createTestDb>;
  let store: OutboxStore;

  beforeEach(() => {
    db = createTestDb();
    store = new OutboxStore(db);
  });

  it("buildSyncRequest распаковывает payload в события", async () => {
    await store.enqueue(dispense("e1", 10));
    const rows = await db.select().from(outbox);
    const req = buildSyncRequest("dev-1", rows);
    expect(req.deviceId).toBe("dev-1");
    expect(req.events).toEqual([dispense("e1", 10)]);
  });

  it("пустой outbox — сетевого вызова нет", async () => {
    const api = fakeApi({ serverTime: "t", results: [], atzBalances: [] });
    const res = await pushOutbox(store, api, "dev-1");
    expect(res.sent).toBe(0);
    expect(api.sync).not.toHaveBeenCalled();
  });

  it("успех: строки подтверждаются, остатки АТЗ возвращаются", async () => {
    await store.enqueue(dispense("e1", 10));
    await store.enqueue(dispense("e2", 20));
    const api = fakeApi({
      serverTime: "t",
      results: [
        { id: "e1", type: "dispense_upsert", status: "applied" },
        { id: "e2", type: "dispense_upsert", status: "applied" },
      ],
      atzBalances: [{ atzId: "atz-1", remainingLiters: 970 }],
    });

    const res = await pushOutbox(store, api, "dev-1");

    expect(api.sync).toHaveBeenCalledOnce();
    expect(res.sent).toBe(2);
    expect(res.balances).toEqual([{ atzId: "atz-1", remainingLiters: 970 }]);
    expect((await store.byId("e1"))?.status).toBe("confirmed");
    expect((await store.byId("e2"))?.status).toBe("confirmed");
  });

  it("обрыв сети: всё возвращается в pending, ошибка проброшена, дубля нет при повторе", async () => {
    await store.enqueue(dispense("e1", 10));
    const api: SyncApi = { sync: vi.fn().mockRejectedValue(new Error("network")) };

    await expect(pushOutbox(store, api, "dev-1")).rejects.toThrow("network");
    expect((await store.byId("e1"))?.status).toBe("pending");

    // повторный проход с тем же id — сервер сделает upsert, дубля не будет
    const ok = fakeApi({
      serverTime: "t",
      results: [{ id: "e1", type: "dispense_upsert", status: "applied" }],
      atzBalances: [],
    });
    await pushOutbox(store, ok, "dev-1");
    expect(await db.select().from(outbox)).toHaveLength(1);
    expect((await store.byId("e1"))?.status).toBe("confirmed");
  });

  it("конфликт в ответе раскладывается по строке, не теряется", async () => {
    await store.enqueue(dispense("e1", 10));
    const api = fakeApi({
      serverTime: "t",
      results: [{ id: "e1", type: "dispense_upsert", status: "conflict", code: "stale" }],
      atzBalances: [],
    });
    await pushOutbox(store, api, "dev-1");
    const row = await store.byId("e1");
    expect(row?.status).toBe("conflict");
    expect(row?.conflictCode).toBe("stale");
  });

  it("карантин: невалидное событие не валит батч — уходит только валидное", async () => {
    await store.enqueue(dispense("ok", 10));
    await store.enqueue(dispense("poison", 6_000_000)); // > 99999.99 → сервер бы вернул 400 на весь батч
    const api = fakeApi({
      serverTime: "t",
      results: [{ id: "ok", type: "dispense_upsert", status: "applied" }],
      atzBalances: [],
    });

    const res = await pushOutbox(store, api, "dev-1");

    expect(api.sync).toHaveBeenCalledOnce();
    expect(api.sync.mock.calls[0][0].events).toEqual([dispense("ok", 10)]); // poison НЕ отправлен
    expect(res.sent).toBe(1);
    expect((await store.byId("ok"))?.status).toBe("confirmed");
    const bad = await store.byId("poison");
    expect(bad?.status).toBe("conflict");
    expect(bad?.conflictCode).toBe("client_invalid");
  });

  it("карантин: все события невалидны — сетевого вызова нет", async () => {
    await store.enqueue(dispense("poison", 6_000_000));
    const api = fakeApi({ serverTime: "t", results: [], atzBalances: [] });
    const res = await pushOutbox(store, api, "dev-1");
    expect(api.sync).not.toHaveBeenCalled();
    expect(res.sent).toBe(0);
    expect((await store.byId("poison"))?.conflictCode).toBe("client_invalid");
  });
});
