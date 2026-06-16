import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import { verifyPinOffline } from "./auth";

describe("verifyPinOffline (офлайн-логин по PIN)", () => {
  it("true для верного PIN; false для неверного и для пустого хэша", () => {
    const hash = bcrypt.hashSync("1234", 8);
    expect(verifyPinOffline("1234", hash)).toBe(true);
    expect(verifyPinOffline("0000", hash)).toBe(false);
    expect(verifyPinOffline("1234", "")).toBe(false);
  });
});
