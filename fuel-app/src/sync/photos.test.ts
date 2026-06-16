import { beforeEach, describe, expect, it } from "vitest";

import { photoQueue } from "../db/schema";
import { OutboxStore } from "./outbox";
import { PhotoQueueStore } from "./photos";
import { createTestDb } from "./test-db";
import type { ReceiptUpsertEvent } from "./types";

function receipt(id: string): ReceiptUpsertEvent {
  return {
    type: "receipt_upsert",
    id,
    shiftId: "shift-1",
    liters: 500,
    happenedAtClient: "2026-06-13T10:00:00+03:00",
  };
}

describe("PhotoQueueStore (фото ТТН)", () => {
  let db: ReturnType<typeof createTestDb>;
  let outboxStore: OutboxStore;
  let photos: PhotoQueueStore;

  beforeEach(() => {
    db = createTestDb();
    outboxStore = new OutboxStore(db);
    photos = new PhotoQueueStore(db);
  });

  it("не отдаёт фото, пока receipt-событие не подтверждено сервером (§3)", async () => {
    await outboxStore.enqueue(receipt("r1")); // receipt ещё pending
    await photos.enqueue("r1", "file:///photo1.jpg");
    expect(await photos.claimReady()).toHaveLength(0);

    await outboxStore.claimBatch();
    await outboxStore.applyResults([{ id: "r1", type: "receipt_upsert", status: "applied" }]);

    expect((await photos.claimReady()).map((p) => p.receiptId)).toEqual(["r1"]);
  });

  it("обрыв аплоада: in_flight → release → переотправка без потери и без дубля", async () => {
    await outboxStore.enqueue(receipt("r1"));
    await outboxStore.claimBatch();
    await outboxStore.applyResults([{ id: "r1", type: "receipt_upsert", status: "applied" }]);
    await photos.enqueue("r1", "file:///photo1.jpg");

    const first = await photos.claimReady();
    expect(first).toHaveLength(1);
    await photos.releaseInFlight(); // обрыв посреди загрузки

    const second = await photos.claimReady();
    expect(second).toHaveLength(1);
    expect(second[0].attemptCount).toBe(2);
    await photos.markUploaded("r1");

    const all = await db.select().from(photoQueue);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("uploaded");
  });

  it("повторное фото для того же receipt перезаписывает (один ключ, без дубля)", async () => {
    await photos.enqueue("r1", "file:///a.jpg");
    await photos.enqueue("r1", "file:///b.jpg");
    const all = await db.select().from(photoQueue);
    expect(all).toHaveLength(1);
    expect(all[0].localUri).toBe("file:///b.jpg");
  });
});
