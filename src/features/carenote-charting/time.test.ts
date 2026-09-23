import { describe, expect, it } from "vitest";
import { fromKoreaLocal, isZonedIso, toKoreaLocal } from "./time";

describe("explicit Korea-time record boundary", () => {
  it.each([
    ["2026-02-30T10:00:00+09:00", false],
    ["2026-09-23T24:00:00+09:00", false],
    ["2026-09-23T22:00:00", false],
    ["2026-09-23", false],
    ["2026-09-23T22:00:00+09:00", true],
    ["2026-09-23T13:00:00Z", true],
    ["2026-09-23T22:00+09:00", true],
  ])("validates %s without silently rolling dates forward", (input, expected) => {
    expect(isZonedIso(input)).toBe(expected);
  });
  it("round-trips a midnight boundary and rejects invalid local dates", () => {
    expect(toKoreaLocal("2026-09-23T15:00:00Z")).toBe("2026-09-24T00:00");
    expect(fromKoreaLocal("2026-09-24T00:00")).toBe("2026-09-24T00:00:00+09:00");
    expect(fromKoreaLocal("2026-02-30T10:00")).toBe("");
  });
});
