import { beforeEach, describe, expect, it } from "vitest";

import { outbox } from "../db/schema";
import { OutboxStore } from "./outbox";
import { createTestDb } from "./test-db";
import type { DispenseUpsertEvent, ShiftOpenEvent } from "./types";

function dispense(
  id: string,
  liters: number,
  extra: Partial<DispenseUpsertEvent> = {}
): DispenseUpsertEvent {
  return {
    type: "dispense_upsert",
    id,
    shiftId: "shift-1",
    vehicleId: "veh-1",
    liters,
    happenedAtClient: "2026-06-13T10:00:00+03:00",
    ...extra,
  };
}

describe("OutboxStore (риск №1: офлайн-синк без дублей/потерь)", () => {
  let db: ReturnType<typeof createTestDb>;
  let store: OutboxStore;

  beforeEach(() => {
    db = createTestDb();
    store = new OutboxStore(db);
  });

  it("enqueue → claim(in_flight) → apply(applied) = ровно одна confirmed-строка", async () => {
    await store.enqueue(dispense("e1", 10));
    const batch = await store.claimBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0].status).toBe("in_flight");

    await store.applyResults([{ id: "e1", type: "dispense_upsert", status: "applied" }]);

    expect((await store.byId("e1"))?.status).toBe("confirmed");
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("отправлено дважды (нет ACK → переотправка) — НЕ дублирует", async () => {
    await store.enqueue(dispense("e1", 10));

    const first = await store.claimBatch();
    expect(first).toHaveLength(1);
    await store.releaseInFlight(); // отправили, ответа не получили

    const second = await store.claimBatch(); // та же строка уезжает снова, тот же id
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("e1");
    expect(second[0].attemptCount).toBe(2);

    // двойной ACK идемпотентен на клиенте
    await store.applyResults([{ id: "e1", type: "dispense_upsert", status: "applied" }]);
    await store.applyResults([{ id: "e1", type: "dispense_upsert", status: "applied" }]);

    const all = await db.select().from(outbox);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("confirmed");
  });

  it("обрыв посреди батча: частичный ответ держит остаток в pending, потерь нет", async () => {
    await store.enqueue(dispense("e1", 10));
    await store.enqueue(dispense("e2", 20));

    const batch = await store.claimBatch();
    expect(batch).toHaveLength(2);

    // сервер ответил только по e1, затем связь оборвалась
    await store.applyResults([{ id: "e1", type: "dispense_upsert", status: "applied" }]);
    await store.releaseInFlight(); // e2 был in_flight → назад в pending

    expect((await store.byId("e1"))?.status).toBe("confirmed");
    expect((await store.byId("e2"))?.status).toBe("pending");

    const retry = await store.claimBatch();
    expect(retry.map((r) => r.id)).toEqual(["e2"]); // переотправляется только неподтверждённое
  });

  it("правка переиспользует id (без дубля), обновляет payload, возвращает в pending", async () => {
    await store.enqueue(dispense("e1", 10));
    await store.claimBatch();
    await store.applyResults([{ id: "e1", type: "dispense_upsert", status: "applied" }]);

    // водитель правит литры → тот же id, выставлен editedAt
    await store.enqueue(dispense("e1", 12, { editedAt: "2026-06-13T11:00:00+03:00" }));

    const row = await store.byId("e1");
    expect(row?.status).toBe("pending");
    expect(JSON.parse(row!.payload).liters).toBe(12);
    expect(await db.select().from(outbox)).toHaveLength(1); // правка не создала дубль
  });

  it("конфликт (stale) терминален: не переотправляется сам, пока нет retry()", async () => {
    await store.enqueue(dispense("e1", 10));
    await store.claimBatch();
    await store.applyResults([
      { id: "e1", type: "dispense_upsert", status: "conflict", code: "stale", message: "newer on server" },
    ]);

    const row = await store.byId("e1");
    expect(row?.status).toBe("conflict");
    expect(row?.conflictCode).toBe("stale");

    expect(await store.claimBatch()).toHaveLength(0); // конфликт не забирается на автоповтор

    await store.retry("e1");
    expect((await store.claimBatch()).map((r) => r.id)).toEqual(["e1"]);
  });

  it("shift_open: денорм shiftId = id события (UUID смены)", async () => {
    const open: ShiftOpenEvent = {
      type: "shift_open",
      id: "shift-1",
      atzId: "atz-1",
      startedAtClient: "2026-06-13T08:00:00+03:00",
    };
    await store.enqueue(open);
    expect((await store.byId("shift-1"))?.shiftId).toBe("shift-1");
  });
});
