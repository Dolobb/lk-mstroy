import { describe, expect, it } from "vitest";

import { assertValidLiters, litersError, validateSyncEvent } from "./validate";
import type { DispenseUpsertEvent, ShiftOpenEvent } from "./types";

describe("validate литры", () => {
  it("валидные значения проходят", () => {
    for (const v of [0.01, 10, 99999.99, 250.5]) expect(litersError(v)).toBeNull();
  });

  it("вне диапазона / не-число — ошибка", () => {
    for (const v of [0, -1, 100000, 6_000_000, NaN, Infinity]) expect(litersError(v)).not.toBeNull();
  });

  it("больше 2 знаков после запятой — ошибка", () => {
    expect(litersError(10.123)).not.toBeNull();
  });

  it("assertValidLiters бросает на невалидном", () => {
    expect(() => assertValidLiters(6_000_000)).toThrow();
    expect(() => assertValidLiters(10)).not.toThrow();
  });

  it("validateSyncEvent проверяет литры выдачи/получения, прочее пропускает", () => {
    const bad: DispenseUpsertEvent = {
      type: "dispense_upsert",
      id: "e1",
      shiftId: "s1",
      vehicleId: "v1",
      liters: 6_000_000,
      happenedAtClient: "2026-06-13T10:00:00+03:00",
    };
    expect(validateSyncEvent(bad)).not.toBeNull();

    const shiftOpen: ShiftOpenEvent = {
      type: "shift_open",
      id: "s1",
      atzId: "a1",
      startedAtClient: "2026-06-13T08:00:00+03:00",
    };
    expect(validateSyncEvent(shiftOpen)).toBeNull();
  });
});
