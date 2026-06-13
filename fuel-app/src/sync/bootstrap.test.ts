import { beforeEach, describe, expect, it } from "vitest";

import { atz, organizations, shifts, vehicles } from "../db/schema";
import { applyAtzBalances, applyBootstrap, type BootstrapData, getBootstrapSince } from "./bootstrap";
import { normalizeGosNumber } from "./normalize";
import { createTestDb } from "./test-db";

function sample(serverTime: string, overrides: Partial<BootstrapData> = {}): BootstrapData {
  return {
    serverTime,
    organizations: [{ id: "o1", name: "СМУ-1", kind: "internal", source: "seed" }],
    vehicles: [
      {
        id: "v1",
        gosNumber: "А 123 ВС 77",
        mark: "КамАЗ",
        vehicleType: "самосвал",
        organizationId: "o1",
        source: "tis",
        isActive: true,
      },
    ],
    atz: [{ id: "a1", gosNumber: "Х001ХХ", title: "АТЗ-1", remainingLiters: 1000, isActive: true }],
    shifts: [
      {
        id: "s1",
        atzId: "a1",
        atzGosNumber: "Х001ХХ",
        startedAtClient: "2026-06-13T08:00:00+03:00",
        endedAtClient: null,
        status: "open",
        openingRemainingLiters: 1000,
        closingRemainingLiters: null,
        dispenseCount: 0,
        dispenseLiters: 0,
        receiptLiters: 0,
      },
    ],
    ...overrides,
  };
}

describe("applyBootstrap / balances / normalize", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
  });

  it("первый bootstrap наполняет кэш, нормализует госномер, ставит курсор", async () => {
    await applyBootstrap(db, sample("2026-06-13T12:00:00Z"));
    expect(await db.select().from(organizations)).toHaveLength(1);
    const v = await db.select().from(vehicles);
    expect(v[0].gosNumberNorm).toBe("А123ВС77");
    expect(await getBootstrapSince(db)).toBe("2026-06-13T12:00:00Z");
  });

  it("повторный bootstrap (дельта) обновляет, не дублирует; смены заменяются", async () => {
    await applyBootstrap(db, sample("t1"));
    await applyBootstrap(
      db,
      sample("t2", {
        vehicles: [
          {
            id: "v1",
            gosNumber: "А 123 ВС 77",
            mark: "МАЗ",
            vehicleType: "самосвал",
            organizationId: "o1",
            source: "tis",
            isActive: false,
          },
        ],
        shifts: [],
      })
    );
    const v = await db.select().from(vehicles);
    expect(v).toHaveLength(1);
    expect(v[0].mark).toBe("МАЗ");
    expect(v[0].isActive).toBe(false);
    expect(await db.select().from(shifts)).toHaveLength(0);
    expect(await getBootstrapSince(db)).toBe("t2");
  });

  it("applyAtzBalances пишет авторитетный остаток с сервера", async () => {
    await applyBootstrap(db, sample("t1"));
    await applyAtzBalances(db, [{ atzId: "a1", remainingLiters: 880 }]);
    expect((await db.select().from(atz))[0].remainingLiters).toBe(880);
  });

  it("normalizeGosNumber: верхний регистр, без пробелов/дефисов", () => {
    expect(normalizeGosNumber("а 123 вс-77")).toBe("А123ВС77");
  });
});
